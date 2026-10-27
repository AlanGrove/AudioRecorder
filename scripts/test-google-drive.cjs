const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'google-drive.js'), 'utf8');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const KEY = 'audioRecorderDriveSettings';

test('连接后主页显示已连接云端图标，设置保留账号及头像回退', async () => {
    const h = harness(); await h.connect();
    assert.equal(h.el('driveProfileName').textContent, 'Test account');
    assert.equal(h.el('driveMainProfile').getAttribute('data-connected'), 'true');
    assert.equal(h.el('driveAvatar').getAttribute('src'), 'https://lh3.googleusercontent.com/test-photo');
    assert.equal(h.el('driveProfileEmail').textContent, 'test@example.invalid');
    await h.fire('driveAvatar', 'error');
    assert.equal(h.el('driveAvatar').hidden, true);
    assert.equal(h.el('driveAvatarFallback').textContent, 'T');
    await h.fire('driveMainProfile'); assert.equal(h.el('driveSettings').open, true);
});

test('拒绝非 Google 头像地址且姓名作为纯文本显示', async () => {
    const h = harness({ photoLink: 'https://evil.invalid/photo' }); await h.connect();
    assert.equal(h.el('driveAvatar').hidden, true);
    assert.equal(h.el('driveAvatar').getAttribute('src'), null);
});

test('临时连接记住账号选择，明确切换账号时才重新展示账号选择器', async () => {
    const h = harness(); await h.connect();
    assert.equal(h.authCalls[0].prompt, 'select_account');
    await h.fire('driveSwitchAccount');
    await h.until(() => h.authCalls.length === 2 && h.el('driveConnect').textContent === '已连接');
    assert.equal(h.authCalls[1].prompt, 'select_account');
});

test('后端会话自动恢复，刷新后无需弹窗，授权仅保留在内存', async () => {
    const h = harness({ backend: true, backendSession: true });
    await h.until(() => h.el('driveConnect').textContent === '已连接');
    assert.equal(h.authCalls.length, 0);
    assert.equal(h.el('driveMainProfile').getAttribute('data-connected'), 'true');
    const again = harness({ backend: true, backendSession: true, stored: h.stored });
    await again.until(() => again.el('driveConnect').textContent === '已连接');
    assert.equal(again.authCalls.length, 0);
    assert.ok(!JSON.stringify([...h.stored.values()]).includes('broker-memory-only'));
    assert.ok(!JSON.stringify([...h.stored.values()]).includes('test@example.invalid'));
});

test('恢复连接期间完成的录音会等待恢复再自动上传', async () => {
    const h = harness({ backend: true, backendSession: true, settings: { autoUpload: true } });
    h.drive.setRecording(h.recording());
    await h.until(() => h.completed.size === 1);
    assert.equal(h.uploads().length, 1);
    assert.match(h.el('driveSummary').textContent, /已上传/);
});

test('没有后端会话时可交互连接，切换账号后仍正常上传', async () => {
    const h = harness({ backend: true });
    await h.until(() => !h.el('driveConnect').disabled);
    await h.connect();
    assert.equal(h.authCalls.length, 0);
    assert.equal(h.el('driveSwitchAccount').hidden, false);
    await h.fire('driveSwitchAccount');
    await h.until(() => h.el('driveConnect').textContent === '已连接');
    h.drive.setRecording(h.recording()); await h.fire('driveUploadCurrent');
    await h.until(() => h.completed.size === 1);
});

test('断开清除账号、关闭自动上传并退出后端，下次打开不自动连接', async () => {
    const h = harness({ backend: true, backendSession: true, settings: { autoUpload: true } });
    await h.until(() => h.el('driveConnect').textContent === '已连接');
    await h.fire('driveDisconnect');
    await h.until(() => h.el('driveStatus').textContent.includes('已断开连接'));
    assert.equal(h.state.backendSession, false);
    assert.equal(h.el('driveMainProfile').getAttribute('data-connected'), 'false');
    const prefs = JSON.parse(h.stored.get(KEY));
    assert.equal(prefs.autoUpload, false); assert.equal(prefs.rememberConnection, false);
    const again = harness({ backend: true, stored: h.stored });
    await again.until(() => !again.el('driveConnect').disabled);
    assert.equal(again.el('driveMainProfile').getAttribute('data-connected'), 'false');
});

test('断开时网络失败会记住退出请求，下次打开先退出并不恢复授权', async () => {
    const h = harness({ backend: true, backendSession: true });
    await h.until(() => h.el('driveConnect').textContent === '已连接');
    h.state.failLogout = true; await h.fire('driveDisconnect');
    await h.until(() => JSON.parse(h.stored.get(KEY)).disconnectPending === true);
    const again = harness({ backend: true, backendSession: true, stored: h.stored });
    await again.until(() => !JSON.parse(again.stored.get(KEY)).disconnectPending);
    assert.equal(again.state.backendSession, false);
    assert.equal(again.calls.filter(c => c.url.endsWith('/auth/token')).length, 0);
});

test('Chrome 插件下次打开用浏览器缓存静默恢复且不申请新权限', async () => {
    const h = harness({ extension: true, manifest: { oauth2: { client_id: 'test.apps.googleusercontent.com' } },
        settings: { rememberConnection: true } });
    await h.until(() => h.el('driveConnect').textContent === '已连接');
    assert.equal(h.el('driveMainProfile').getAttribute('data-connected'), 'true');
});

test('后端连接遇到 Google 401 会强制续期一次并继续原上传', async () => {
    const h = harness({ backend: true, backendSession: true });
    await h.until(() => h.el('driveConnect').textContent === '已连接');
    h.state.unauthorized = true;
    h.drive.setRecording(h.recording()); await h.fire('driveUploadCurrent');
    await h.until(() => h.completed.size === 1);
    assert.equal(h.calls.filter(c => c.url.endsWith('/auth/token?refresh=1')).length, 1);
    assert.equal(h.uploads().length, 1);
});

test('恢复期间用户断开，延迟返回的授权不会重新显示已连接', async () => {
    const h = harness({ backend: true, backendSession: true });
    let release; h.state.brokerHold = new Promise(resolve => { release = resolve; });
    await h.fire('driveDisconnect'); release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.el('driveMainProfile').getAttribute('data-connected'), 'false');
    assert.equal(JSON.parse(h.stored.get(KEY)).rememberConnection, false);
    assert.ok(!h.el('driveStatus').textContent.includes('连接已恢复'));
});

function harness(options = {}) {
    const elements = new Map();
    const stored = options.stored || new Map([[KEY, JSON.stringify({ clientId: 'test.apps.googleusercontent.com', ...options.settings })]]);
    const calls = [];
    const sessions = new Map();
    const completed = options.completed || new Map();
    const copied = [];
    let legacyInput = null;
    let idCount = 0;
    let chunkCount = 0;
    const state = { failChunk: 0, lostFinal: false, unauthorized: false, badLocation: false, hold: null,
        backendSession: options.backendSession === true, brokerFlow: 'flow-test', failLogout: false, brokerHold: null };
    const authCalls = [];
    class Element {
        constructor() {
            this.listeners = {};
            this.value = '';
            this.checked = false;
            this.textContent = '';
            this.hidden = false;
            this.classList = { toggle() {} };
            this.style = {};
            this.attributes = {};
        }
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
        focus() {}
        select() { this.selected = true; }
        remove() {}
        getAttribute(name) { return this.attributes[name] || null; }
        setAttribute(name, value) { this.attributes[name] = value; }
        removeAttribute(name) { delete this.attributes[name]; }
        appendChild(input) { legacyInput = input; }
        click() { return fire(this, 'click'); }
        showModal() { this.open = true; }
        close() { this.open = false; }
    }
    function el(id) {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
    }
    async function fire(target, type = 'click', extra = {}) {
        if (typeof target === 'string') target = el(target);
        for (const listener of target.listeners[type] || []) await listener({ target, ...extra });
    }
    const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
        status, headers: { 'Content-Type': 'application/json', ...headers }
    });
    async function fetch(url, request = {}) {
        calls.push({ url, ...request });
        if (new URL(url).origin === 'https://recorder.example') {
            assert.equal(request.credentials, 'include');
            assert.equal(request.cache, 'no-store');
            assert.equal(request.headers['X-Recorder-Request'], '1');
            const route = new URL(url).pathname;
            if (route === '/auth/token') {
                if (state.brokerHold) await state.brokerHold;
                return state.backendSession ? json({ accessToken: 'broker-memory-only', expiresAt: Date.now() + 3000000 }) :
                    json({ error: 'no_session' }, 401);
            }
            if (route === '/auth/start') {
                state.backendSession = true;
                return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test', flow: state.brokerFlow });
            }
            if (route === '/auth/session') return json({ connected: state.backendSession, flow: state.brokerFlow });
            if (route === '/auth/logout') {
                if (state.failLogout) throw new Error('offline');
                state.backendSession = false;
                return json({ connected: false });
            }
            throw new Error('Unexpected broker request');
        }
        assert.equal(new URL(url).origin, 'https://www.googleapis.com');
        assert.match(request.headers.Authorization, /^Bearer /);
        if (state.unauthorized) { state.unauthorized = false; return json({}, 401); }
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/about')) return json({ user: { permissionId: 'owner-1', displayName: 'Test account',
            emailAddress: 'test@example.invalid', photoLink: options.photoLink || 'https://lh3.googleusercontent.com/test-photo' } });
        if (parsed.pathname.endsWith('/generateIds')) return json({ ids: ['file-' + ++idCount] });
        if (parsed.pathname === '/drive/v3/files' && request.method === 'POST') return json({ id: 'folder-1' });
        if (parsed.pathname === '/drive/v3/files') return json({ files: [{ id: 'folder-1' }] });
        if (parsed.pathname.startsWith('/drive/v3/files/')) {
            const id = parsed.pathname.split('/').pop();
            return completed.has(id) ? json(completed.get(id)) : json({}, 404);
        }
        if (request.method === 'POST' && parsed.searchParams.has('uploadType')) {
            const metadata = JSON.parse(request.body);
            const session = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=' + metadata.id;
            sessions.set(session, { metadata, received: 0 });
            return json({}, 200, { Location: state.badLocation ? 'https://example.invalid/upload' : session });
        }
        if (request.method === 'PUT') {
            const session = sessions.get(url);
            assert.ok(session, 'session should exist');
            const range = request.headers['Content-Range'];
            if (range.startsWith('bytes */')) {
                if (completed.has(session.metadata.id)) return json(completed.get(session.metadata.id));
                return new Response(null, { status: 308,
                    headers: session.received ? { Range: 'bytes=0-' + (session.received - 1) } : {} });
            }
            chunkCount++;
            if (state.hold) { const wait = state.hold; state.hold = null; await wait; }
            if (state.failChunk === chunkCount) { state.failChunk = 0; throw new TypeError('simulated network loss'); }
            const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
            assert.ok(match);
            const [, start, end, size] = match.map(Number);
            assert.equal(start, session.received);
            assert.equal(request.body.size, end - start + 1);
            session.received = end + 1;
            if (session.received === size) {
                const file = { id: session.metadata.id, name: session.metadata.name, size: String(size) };
                completed.set(file.id, file);
                if (state.lostFinal) { state.lostFinal = false; throw new TypeError('lost final response'); }
                return json(file);
            }
            return new Response(null, { status: 308, headers: { Range: 'bytes=0-' + end } });
        }
        throw new Error('Unexpected mock request: ' + url);
    }
    const context = {
        document: { readyState: 'complete', getElementById: el,
            createElement: () => new Element(),
            body: { appendChild(input) { legacyInput = input; } },
            execCommand: () => {
                if (options.legacyCopy === false) return false;
                copied.push(legacyInput.value);
                return true;
            },
            head: { appendChild() { throw new Error('Unexpected SDK load'); } } },
        navigator: options.clipboardMissing ? {} : { clipboard: { writeText: async text => {
            if (options.clipboardFails) throw new Error('simulated denied clipboard');
            copied.push(text);
        } } },
        location: { protocol: options.extension ? 'chrome-extension:' : 'https:' },
        AudioRecorderDriveBackendUrl: options.backend ? 'https://recorder.example' : '',
        AudioRecorderLibrary: options.library,
        open: () => options.popupBlocked ? null : { location: {}, closed: false, close() { this.closed = true; } },
        localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
        URL, URLSearchParams, Blob, AbortController, fetch, console, Date,
        setTimeout: () => 1, clearTimeout() {},
        google: { accounts: { oauth2: {
            initTokenClient: config => ({ requestAccessToken(args) {
                authCalls.push(args);
                queueMicrotask(() => config.callback({ access_token: 'fake-only', expires_in: 3600 }));
            } }),
            hasGrantedAllScopes: (_response, scope) => scope === SCOPE
        } } },
        addEventListener() {}
    };
    if (options.extension) context.chrome = {
        runtime: { getManifest: () => options.manifest || {} },
        permissions: { request: async () => options.allowed !== false, contains: async () => options.allowed !== false },
        identity: { getAuthToken: async args => {
            if (!options.settings?.rememberConnection) assert.equal(args.interactive, true);
            assert.deepEqual(Array.from(args.scopes), [SCOPE]);
            return { token: 'fake-only', grantedScopes: [SCOPE] };
        }, removeCachedAuthToken: async () => {} }
    };
    context.window = context;
    vm.runInNewContext(source, context);
    const tick = () => new Promise(resolve => setImmediate(resolve));
    async function until(predicate) {
        for (let i = 0; i < 200; i++) { if (predicate()) return; await tick(); }
        throw new Error('Timed out: ' + el('driveStatus').textContent);
    }
    async function connect() {
        await fire('driveConnect');
        await until(() => el('driveConnect').textContent === '已连接' || !el('driveConnect').disabled);
        assert.match(el('driveAccount').textContent, /已连接/);
    }
    function recording(id = 'take1', size = 64) {
        return { id, mp3: { blob: new Blob([new Uint8Array(size)], { type: 'audio/mpeg' }), name: id + '.mp3' },
            webm: { blob: new Blob(['webm'], { type: 'audio/webm' }), name: id + '.webm' } };
    }
    const uploads = () => calls.filter(c => c.method === 'POST' && c.url.includes('uploadType=resumable'));
    return { el, fire, connect, until, recording, calls, state, stored, completed, uploads, copied, authCalls,
        drive: context.AudioRecorderDrive };
}

test('默认不上传，未连接不能开启自动上传', async () => {
    const h = harness();
    h.drive.setRecording(h.recording());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.length, 0);
    h.el('driveAutoUpload').checked = true;
    await h.fire('driveAutoUpload', 'change');
    assert.equal(h.el('driveAutoUpload').checked, false);
    assert.match(h.el('driveStatus').textContent, /先连接/);
});

test('JSON 导入只保存客户端 ID，拒绝错误类型', async () => {
    const h = harness();
    h.el('driveConfigFile').files = [{ size: 100, text: async () => JSON.stringify({
        web: { client_id: 'imported.apps.googleusercontent.com', client_secret: 'fake-only', project_id: 'discard-me' }
    }) }];
    await h.fire('driveConfigFile', 'change');
    const stored = h.stored.get(KEY);
    assert.equal(JSON.parse(stored).clientId, 'imported.apps.googleusercontent.com');
    assert.ok(!stored.includes('fake-only') && !stored.includes('discard-me'));
    h.el('driveConfigFile').files = [{ size: 100, text: async () => JSON.stringify({
        installed: { client_id: 'wrong.apps.googleusercontent.com' }
    }) }];
    await h.fire('driveConfigFile', 'change');
    assert.match(h.el('driveStatus').textContent, /Web 应用/);
    assert.equal(JSON.parse(h.stored.get(KEY)).clientId, 'imported.apps.googleusercontent.com');
    assert.equal(h.calls.length, 0);
});

test('手动上传及重复点击只创建一个文件，不持久化授权', async () => {
    const h = harness();
    await h.connect();
    h.drive.setRecording(h.recording());
    await h.fire('driveUploadCurrent');
    await h.fire('driveUploadCurrent');
    await h.until(() => h.completed.size === 1 && !h.el('driveUploadCurrent').disabled);
    await h.fire('driveUploadCurrent');
    assert.equal(h.uploads().length, 1);
    assert.match(h.el('driveStatus').textContent, /不会重复/);
    assert.ok(!JSON.stringify([...h.stored.values()]).includes('fake-only'));
});

test('上传期间产生新录音仍按顺序上传，保留各自文件名与快照', async () => {
    const h = harness();
    await h.connect();
    h.el('driveAutoUpload').checked = true;
    await h.fire('driveAutoUpload', 'change');
    let release;
    h.state.hold = new Promise(resolve => { release = resolve; });
    h.drive.setRecording(h.recording('first', 80));
    await h.until(() => h.calls.some(c => c.method === 'PUT'));
    h.drive.setRecording(null);
    h.drive.setRecording(h.recording('second', 120));
    release();
    await h.until(() => h.completed.size === 2 && !h.el('driveUploadCurrent').disabled);
    assert.deepEqual([...h.completed.values()].map(f => [f.name, f.size]), [['first.mp3', '80'], ['second.mp3', '120']]);
});

test('分块断线后查询服务端偏移并续传，不新建上传会话', async () => {
    const h = harness();
    await h.connect();
    h.state.failChunk = 2;
    h.drive.setRecording(h.recording('large', 9 * 1024 * 1024));
    await h.fire('driveUploadCurrent');
    await h.until(() => !h.el('driveRetry').disabled);
    assert.equal(h.completed.size, 0);
    await h.fire('driveRetry');
    await h.until(() => h.completed.size === 1 && !h.el('driveUploadCurrent').disabled);
    assert.equal(h.uploads().length, 1);
    const chunks = h.calls.filter(c => c.method === 'PUT');
    assert.ok(chunks.some(c => c.headers['Content-Range'].startsWith('bytes */')));
    assert.equal(chunks.at(-1).headers['Content-Range'], 'bytes 8388608-9437183/9437184');
});

test('最终响应丢失时核对固定文件 ID，不重复创建', async () => {
    const h = harness();
    await h.connect();
    h.state.lostFinal = true;
    h.drive.setRecording(h.recording());
    await h.fire('driveUploadCurrent');
    await h.until(() => !h.el('driveRetry').disabled);
    await h.fire('driveRetry');
    await h.until(() => h.el('driveStatus').textContent.startsWith('已上传') && !h.el('driveUploadCurrent').disabled);
    assert.equal(h.completed.size, 1);
    assert.equal(h.uploads().length, 1);
});

test('授权失效保留队列，重新连接后可重试', async () => {
    const h = harness();
    await h.connect();
    h.state.unauthorized = true;
    h.drive.setRecording(h.recording());
    await h.fire('driveUploadCurrent');
    await h.until(() => h.el('driveStatus').textContent.includes('授权已过期'));
    assert.match(h.el('driveQueue').textContent, /1 个文件/);
    assert.equal(h.el('driveAccount').textContent, '尚未连接 Google Drive');
    await h.connect();
    await h.fire('driveRetry');
    await h.until(() => h.completed.size === 1);
});

test('Chrome 插件未配置时给出指引，配置后使用原生授权', async () => {
    const missing = harness({ extension: true });
    await missing.fire('driveConnect');
    assert.match(missing.el('driveStatus').textContent, /尚未配置/);
    assert.equal(missing.calls.length, 0);
    const ready = harness({ extension: true, manifest: { oauth2: { client_id: 'chrome.apps.googleusercontent.com' } } });
    await ready.connect();
    assert.equal(ready.el('driveClientId').value, 'chrome.apps.googleusercontent.com');
});

test('拒绝向非 Google 上传地址发送授权', async () => {
    const h = harness();
    await h.connect();
    h.state.badLocation = true;
    h.drive.setRecording(h.recording());
    await h.fire('driveUploadCurrent');
    await h.until(() => !h.el('driveRetry').disabled);
    assert.match(h.el('driveStatus').textContent, /上传地址无效/);
    assert.ok(h.calls.every(c => new URL(c.url).origin === 'https://www.googleapis.com'));
});

test('设置和主页面都复制同一云端链接，不重复上传或打开链接', async () => {
    const h = harness();
    await h.connect();
    h.drive.setRecording(h.recording());
    await h.fire('driveUploadCurrent');
    await h.until(() => h.completed.size === 1 && !h.el('driveUploadCurrent').disabled);
    const url = 'https://drive.google.com/file/d/file-1/view';
    assert.equal(h.el('driveMainResult').hidden, false);
    assert.equal(h.el('driveResult').hidden, false);
    assert.equal(h.el('driveLastUploadUrl').textContent, url);
    assert.equal(h.el('driveMainUploadUrl').textContent, url);
    assert.equal(h.el('driveOpenUpload').href, url);
    const requestCount = h.calls.length;
    await h.fire('driveLastUpload');
    await h.until(() => h.copied.length === 1);
    await h.fire('driveMainCopy');
    await h.until(() => h.copied.length === 2);
    assert.deepEqual(h.copied, [url, url]);
    assert.equal(h.el('driveCopyStatus').textContent, '链接已复制');
    assert.equal(h.el('driveMainCopyStatus').textContent, '链接已复制');
    assert.equal(h.calls.length, requestCount);
});

test('剪贴板受限时提供已选中的链接，不虚报复制成功', async () => {
    const h = harness({ clipboardFails: true, legacyCopy: false });
    await h.connect();
    h.drive.setRecording(h.recording());
    await h.fire('driveUploadCurrent');
    await h.until(() => h.completed.size === 1 && !h.el('driveUploadCurrent').disabled);
    await h.fire('driveMainCopy');
    await h.until(() => h.el('driveMainCopyFallback').selected);
    assert.equal(h.copied.length, 0);
    assert.equal(h.el('driveMainCopyFallback').hidden, false);
    assert.equal(h.el('driveMainCopyFallback').value, 'https://drive.google.com/file/d/file-1/view');
    assert.match(h.el('driveMainCopyStatus').textContent, /未能自动复制/);
});

test('缺少 Clipboard API 时设置弹窗内仍可使用兼容复制', async () => {
    const h = harness({ clipboardMissing: true });
    await h.connect();
    h.drive.setRecording(h.recording());
    await h.fire('driveUploadCurrent');
    await h.until(() => h.completed.size === 1 && !h.el('driveUploadCurrent').disabled);
    await h.fire('driveSettingsButton');
    await h.fire('driveLastUpload');
    await h.until(() => h.copied.length === 1);
    assert.equal(h.copied[0], 'https://drive.google.com/file/d/file-1/view');
});

test('下一段上传成功后两处链接同步更新，导入后隐藏首次配置', async () => {
    const h = harness();
    assert.equal(h.el('driveSetup').hidden, true);
    await h.connect();
    h.drive.setRecording(h.recording('first'));
    await h.fire('driveUploadCurrent');
    await h.until(() => h.completed.size === 1 && !h.el('driveUploadCurrent').disabled);
    await h.fire('driveMainCopy');
    await h.until(() => h.copied.length === 1);
    h.drive.setRecording(h.recording('second'));
    await h.fire('driveUploadCurrent');
    await h.until(() => h.completed.size === 2 && !h.el('driveUploadCurrent').disabled);
    assert.equal(h.el('driveMainUploadName').textContent, 'second.mp3');
    assert.equal(h.el('driveLastUploadUrl').textContent, 'https://drive.google.com/file/d/file-2/view');
    assert.equal(h.el('driveMainUploadUrl').textContent, h.el('driveLastUploadUrl').textContent);
    assert.equal(h.el('driveCopyStatus').textContent, '');
});

function localLibrary() {
    const saved = new Map(), events = [];
    return { saved, events,
        save: async r => { saved.set(r.id, { ...r, uploads: {}, pending: {} }); return true; },
        checkpoint: async (id, format, fileId, owner) => { events.push('checkpoint'); if(saved.has(id)) saved.get(id).pending[format] = { fileId, owner }; },
        uploaded: async (id, format, result, owner) => { events.push('uploaded'); if(saved.has(id)) { saved.get(id).uploads[format] = { id: result.id, owner }; delete saved.get(id).pending[format]; } },
        setUploadState() {}, isClearing: () => false
    };
}
test('从列表上传旧录音不替换主页面当前录音，完成后保存分享链接', async () => {
    const library=localLibrary(), h=harness({library}); await h.connect();
    const old=h.recording('older'), current=h.recording('current');
    h.drive.setRecording(old); h.drive.setRecording(current);
    assert.equal(await h.drive.uploadRecording(library.saved.get('older')),true);
    await h.fire('driveUploadCurrent');
    await h.until(() => h.completed.size === 2);
    assert.deepEqual(h.uploads().map(c=>JSON.parse(c.body).name),['older.mp3','current.mp3']);
    assert.ok(library.saved.get('older').uploads.mp3.id);
    assert.ok(library.events.indexOf('checkpoint')<library.events.indexOf('uploaded'));
});
test('上传完成响应丢失后重开，通过已保存文件 ID 核对，不创建重复文件', async () => {
    const library=localLibrary(), h=harness({library}); await h.connect();
    h.state.lostFinal=true; h.drive.setRecording(h.recording('persistent'));
    assert.equal(await h.drive.uploadRecording(library.saved.get('persistent')),false);
    assert.equal(h.completed.size,1); assert.ok(library.saved.get('persistent').pending.mp3.fileId);
    const reopened=harness({library,completed:h.completed}); await reopened.connect();
    assert.equal(await reopened.drive.uploadRecording(library.saved.get('persistent')),true);
    assert.equal(reopened.uploads().length,0); assert.ok(library.saved.get('persistent').uploads.mp3.id);
    assert.equal(await reopened.drive.uploadRecording(library.saved.get('persistent')),true);
    assert.equal(reopened.uploads().length,0);
});
test('未连接时列表上传引导连接，不提交音频；清空后不能重试旧队列', async () => {
    const h=harness();
    assert.equal(await h.drive.uploadRecording(h.recording()),false);
    assert.equal(h.el('driveSettings').open,true); assert.equal(h.uploads().length,0);
    await h.connect(); h.drive.setRecording(h.recording()); h.state.failChunk=1;
    await h.fire('driveUploadCurrent');
    await h.until(() => !h.drive.isBusy());
    h.drive.clearLibraryQueue();
    assert.equal(h.el('driveRetry').hidden,true); assert.equal(h.el('driveUploadCurrent').disabled,true);
    assert.equal(h.drive.isBusy(),false);
});
