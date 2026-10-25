const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'google-drive.js'), 'utf8');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const KEY = 'audioRecorderDriveSettings';

function harness(options = {}) {
    const elements = new Map();
    const stored = new Map([[KEY, JSON.stringify({ clientId: 'test.apps.googleusercontent.com' })]]);
    const calls = [];
    const sessions = new Map();
    const completed = new Map();
    const copied = [];
    let legacyInput = null;
    let idCount = 0;
    let chunkCount = 0;
    const state = { failChunk: 0, lostFinal: false, unauthorized: false, badLocation: false, hold: null };
    class Element {
        constructor() {
            this.listeners = {};
            this.value = '';
            this.checked = false;
            this.textContent = '';
            this.hidden = false;
            this.classList = { toggle() {} };
            this.style = {};
        }
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
        focus() {}
        select() { this.selected = true; }
        remove() {}
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
        assert.equal(new URL(url).origin, 'https://www.googleapis.com');
        assert.match(request.headers.Authorization, /^Bearer /);
        if (state.unauthorized) { state.unauthorized = false; return json({}, 401); }
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/about')) return json({ user: { permissionId: 'owner-1', displayName: 'Test account' } });
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
        localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
        URL, URLSearchParams, Blob, AbortController, fetch, console, Date,
        setTimeout: () => 1, clearTimeout() {},
        google: { accounts: { oauth2: {
            initTokenClient: config => ({ requestAccessToken() {
                queueMicrotask(() => config.callback({ access_token: 'fake-only', expires_in: 3600 }));
            } }),
            hasGrantedAllScopes: (_response, scope) => scope === SCOPE
        } } },
        addEventListener() {}
    };
    if (options.extension) context.chrome = {
        runtime: { getManifest: () => options.manifest || {} },
        permissions: { request: async () => options.allowed !== false },
        identity: { getAuthToken: async args => {
            assert.equal(args.interactive, true);
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
        await until(() => !el('driveConnect').disabled);
        assert.match(el('driveAccount').textContent, /已连接/);
    }
    function recording(id = 'take1', size = 64) {
        return { id, mp3: { blob: new Blob([new Uint8Array(size)], { type: 'audio/mpeg' }), name: id + '.mp3' },
            webm: { blob: new Blob(['webm'], { type: 'audio/webm' }), name: id + '.webm' } };
    }
    const uploads = () => calls.filter(c => c.method === 'POST' && c.url.includes('uploadType=resumable'));
    return { el, fire, connect, until, recording, calls, state, stored, completed, uploads, copied,
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
