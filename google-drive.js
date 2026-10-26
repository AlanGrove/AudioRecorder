/* Access tokens stay in memory. Optional OAuth broker keeps refresh tokens server-side. */
(() => {
    'use strict';
    const SCOPE = 'https://www.googleapis.com/auth/drive.file';
    const API = 'https://www.googleapis.com';
    const STORAGE_KEY = 'audioRecorderDriveSettings';
    const CHUNK_SIZE = 8 * 1024 * 1024;
    const extension = location.protocol === 'chrome-extension:';
    const manifestClient = extension ? chrome.runtime.getManifest().oauth2?.client_id || '' : '';
    let settings;
    try { settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { settings = {}; }
    settings = {
        clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
        backendUrl: typeof settings?.backendUrl === 'string' ? settings.backendUrl : '',
        rememberConnection: settings?.rememberConnection === true,
        disconnectPending: settings?.disconnectPending === true,
        autoUpload: settings?.autoUpload === true,
        format: settings?.format === 'webm' ? 'webm' : 'mp3',
        folderName: typeof settings?.folderName === 'string' && settings.folderName.trim() ?
            settings.folderName.trim().slice(0, 100) : 'Audio Recorder'
    };
    let token = '';
    let tokenExpires = 0;
    let account = null;
    let authEpoch = 0;
    let authorizing = false;
    let disconnecting = false;
    let sdkPromise = null;
    let currentRecording = null;
    let pumping = null;
    let activeController = null;
    let expiryTimer = null;
    let renewing = null;
    let restoring = null;
    let lastUploadUrl = '';
    const jobs = [];
    const folderCache = new Map();
    const element = id => document.getElementById(id);
    const connected = () => Boolean(token && account && Date.now() < tokenExpires);
    function backendUrl() {
        if (extension) return '';
        const value = window.AudioRecorderDriveBackendUrl || settings.backendUrl;
        if (!value) return '';
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return '';
            return url.origin;
        } catch { return ''; }
    }
    const backendErrors = {
        no_session: '保持连接的会话不存在或已过期，请重新连接一次。',
        reauthorize: 'Google 授权已撤销或失效，请重新连接一次。',
        origin_denied: '授权服务未允许当前网页地址，请检查 APP_ORIGIN 配置。',
        backend_not_configured: '授权服务尚未配置完成，请按 README 设置服务端密钥。',
        backend_unavailable: '授权服务暂时不可用，请检查服务配置或稍后重试。',
        authorization_failed: 'Google 授权未完成，请重新连接。',
        authorization_denied: 'Google 授权已取消，请连接并允许保存本应用创建的文件。',
        missing_offline_scope: '未取得完整上传授权，请重新连接并勾选保存本应用创建的 Drive 文件。',
        profile_unavailable: '无法读取云盘账号，请确认项目已启用 Google Drive API，并稍后重连。',
        google_unavailable: 'Google 授权服务暂时不可用，请稍后重试。'
    };
    async function backendRequest(path, method = 'GET') {
        const base = backendUrl();
        if (!base) throw new Error('请先配置保持连接的授权服务地址。');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(base + path, { method, credentials: 'include', redirect: 'error',
                cache: 'no-store', headers: { 'X-Recorder-Request': '1' }, signal: controller.signal });
            const data = await response.json();
            if (!response.ok) {
                const error = new Error(backendErrors[data.error] || '授权请求失败，请稍后重试。');
                error.code = data.error;
                throw error;
            }
            return data;
        } finally { clearTimeout(timeout); }
    }
    async function backendLogin() {
        const epoch = authEpoch;
        // Open synchronously from the click, before the network request, to preserve popup permission.
        const popup = window.open('about:blank', 'audio-recorder-google-auth', 'popup,width=520,height=700');
        if (!popup) throw new Error('授权窗口被拦截，请允许弹出窗口后再次连接。');
        try {
            const start = await backendRequest('/auth/start', 'POST');
            if (epoch !== authEpoch) {
                await backendRequest('/auth/logout', 'POST');
                throw new Error('连接已取消。');
            }
            const url = new URL(start.url);
            if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || !start.flow) {
                throw new Error('授权服务返回了无效的 Google 地址。');
            }
            popup.location.href = url.href;
            const deadline = Date.now() + 9 * 60 * 1000;
            while (Date.now() < deadline) {
                if (epoch !== authEpoch) throw new Error('连接已取消。');
                const session = await backendRequest('/auth/session');
                if (session.connected && session.flow === start.flow) return await backendRequest('/auth/token', 'POST');
                if (session.error && !session.pending) throw new Error(backendErrors[session.error] || 'Google 授权未完成，请重试。');
                if (popup.closed) throw new Error('授权窗口已关闭，请重新连接。');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            throw new Error('等待授权超时，请重新连接。');
        } catch (error) {
            if (error.code === 'no_session') throw new Error('浏览器未保存连接 Cookie。请使用支持分区 Cookie 的新版 Chrome，或检查隐私设置。');
            throw error;
        } finally { popup.close(); }
    }
    function photoUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password &&
                (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com')) ? url.href : '';
        } catch { return ''; }
    }
    function renderProfile() {
        const visible = Boolean(account);
        ['driveProfile', 'driveMainProfile'].forEach(id => { element(id).hidden = !visible; });
        if (!visible) return;
        const name = account.displayName || account.emailAddress || 'Google 用户';
        ['driveProfileName', 'driveMainProfileName'].forEach(id => { element(id).textContent = name; });
        element('driveProfileEmail').textContent = account.emailAddress || '';
        element('driveMainProfileState').textContent = connected() ? '云盘已连接' : '正在恢复连接';
        ['driveAvatar', 'driveMainAvatar'].forEach(id => {
            const img = element(id);
            const url = photoUrl(account.photoLink);
            if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
            if (!url) img.removeAttribute('src');
            img.hidden = !url;
        });
        ['driveAvatarFallback', 'driveMainAvatarFallback'].forEach(id => {
            element(id).textContent = Array.from(name)[0].toUpperCase();
        });
    }
    function message(text, error = false) {
        element('driveStatus').textContent = text;
        element('driveStatus').hidden = !text;
        element('driveStatus').classList.toggle('is-error', error);
        element('driveSummary').textContent = text;
    }
    function save() {
        // Store preferences only. No OAuth credentials or recordings.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    function parseClientConfig(text) {
        if (text.length > 65536) throw new Error('配置文件过大，请选择 Google OAuth 客户端 JSON。');
        let config;
        try { config = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON 配置。'); }
        if (!config || typeof config !== 'object' || config.type === 'service_account' || config.private_key) {
            throw new Error('请选择 OAuth 客户端 JSON，不支持服务账号密钥。');
        }
        const entry = config.web || config.installed || config;
        const clientId = entry?.client_id;
        if (typeof clientId !== 'string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
            throw new Error('配置文件中没有有效的 OAuth 客户端 ID。');
        }
        if (!extension && config.installed) {
            throw new Error('这是桌面或插件客户端配置。当前网页需要“Web 应用”类型的 OAuth 配置。');
        }
        if (extension && config.web) {
            throw new Error('这是网页客户端配置。Chrome 插件需要“Chrome 扩展”类型的客户端。');
        }
        return clientId;
    }
    function render() {
        const configured = Boolean(backendUrl()) || /^[\w.-]+\.apps\.googleusercontent\.com$/.test(extension ? manifestClient : settings.clientId);
        element('driveSetup').hidden = configured;
        element('driveConnectStep').textContent = configured ? '1' : '2';
        element('driveAutoUpload').checked = settings.autoUpload;
        element('driveConnect').disabled = authorizing || disconnecting || Boolean(pumping) || connected();
        element('driveConnect').textContent = authorizing ? '正在连接…' : connected() ? '已连接' : '连接 Google Drive';
        element('driveSwitchAccount').hidden = !connected() || extension;
        element('driveSwitchAccount').disabled = authorizing || disconnecting || Boolean(pumping);
        element('driveDisconnect').disabled = disconnecting || (!token && !authorizing && !settings.rememberConnection && !settings.disconnectPending);
        element('driveUploadCurrent').disabled = !currentRecording || !connected() || Boolean(pumping);
        element('driveRetry').disabled = !connected() || Boolean(pumping) || !jobs.some(j => j.status === 'failed');
        element('driveRetry').hidden = !jobs.some(j => j.status === 'failed');
        const pending = jobs.filter(j => j.status !== 'done').length;
        element('driveQueue').textContent = pending ? pending + ' 个文件待上传。关闭或刷新页面会丢失待传文件，请先下载备份。' : '没有待上传文件。';
        element('driveQueue').hidden = !pending;
        element('driveAccount').textContent = connected() ?
            '已连接：' + (account.displayName || 'Google Drive') : '尚未连接 Google Drive';
        element('driveAccount').hidden = Boolean(account);
        element('driveConnectionHelp').textContent = extension ? '下次打开会通过 Chrome 自动恢复连接。' : backendUrl() ?
            '已启用保持连接，下次打开自动恢复；授权过期会由服务自动续期。' :
            '当前为临时连接；在“更多设置”配置授权服务后，可跨天保持连接。';
        element('driveDirectClientSettings').hidden = Boolean(backendUrl());
        element('driveSaveClient').hidden = extension || Boolean(backendUrl());
        element('driveChangeConfig').hidden = Boolean(backendUrl());
        renderProfile();
        element('driveAutoHelp').textContent = '停止录音后自动保存 ' + settings.format.toUpperCase() + '，本地下载不受影响。';
    }
    function clearAuth() {
        const previous = token;
        token = '';
        tokenExpires = 0;
        account = null;
        clearTimeout(expiryTimer);
        folderCache.clear();
        if (extension && previous) {
            chrome.identity.removeCachedAuthToken({ token: previous }).catch(() => {});
        }
        render();
    }
    async function request(url, options = {}, accepted = [], retried = false) {
        const parsed = new URL(url);
        if (parsed.origin !== API || !/^\/(?:drive\/v3\/|upload\/drive\/v3\/)/.test(parsed.pathname)) {
            throw new Error('上传地址无效，请重试。');
        }
        if ((!token || Date.now() >= tokenExpires) && !authorizing && (backendUrl() || extension) && settings.rememberConnection) {
            await renewAuthorization();
        }
        if (!token || Date.now() >= tokenExpires) {
            clearAuth();
            throw new Error('Google 授权已过期，请在设置中重新连接后重试。');
        }
        const epoch = authEpoch;
        const response = await fetch(url, {
            ...options,
            headers: { ...options.headers, Authorization: 'Bearer ' + token },
            signal: activeController?.signal,
            credentials: 'omit',
            redirect: 'error'
        });
        if (epoch !== authEpoch) throw new Error('连接已更改，上传已暂停。');
        if (response.status === 401) {
            if (backendUrl() && settings.rememberConnection && !authorizing && !retried) {
                await renewAuthorization(true);
                return request(url, options, accepted, true);
            }
            clearAuth();
            throw new Error('Google 授权已过期，请重新连接后重试。');
        }
        if (!response.ok && !accepted.includes(response.status)) {
            let reason = '';
            try { reason = (await response.json()).error?.errors?.[0]?.reason || ''; } catch {}
            if (response.status === 403) {
                throw new Error(reason === 'storageQuotaExceeded' ? 'Google Drive 空间不足，请清理空间后重试。' :
                    'Google Drive 拒绝访问，请检查 Drive API 是否启用、授权权限及账号限制。');
            }
            if (response.status === 429 || response.status >= 500) throw new Error('Google Drive 暂时不可用，请稍后重试。');
            throw new Error('上传请求失败（' + response.status + '），请重试。');
        }
        return response;
    }
    async function loadWebSdk() {
        if (window.google?.accounts?.oauth2) return;
        if (!sdkPromise) {
            sdkPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                const timeout = setTimeout(() => {
                    script.remove();
                    reject(new Error('Google 授权组件加载超时，请检查网络后重试。'));
                }, 15000);
                script.src = 'https://accounts.google.com/gsi/client';
                script.async = true;
                script.onload = () => {
                    clearTimeout(timeout);
                    if (window.google?.accounts?.oauth2) resolve();
                    else reject(new Error('Google 授权组件加载失败。'));
                };
                script.onerror = () => {
                    clearTimeout(timeout);
                    script.remove();
                    reject(new Error('Google 授权组件加载失败，请检查网络。'));
                };
                document.head.appendChild(script);
            }).catch(error => { sdkPromise = null; throw error; });
        }
        return sdkPromise;
    }
    function webToken(switchAccount = false) {
        return new Promise((resolve, reject) => {
            const client = google.accounts.oauth2.initTokenClient({
                client_id: settings.clientId,
                scope: SCOPE,
                include_granted_scopes: false,
                callback: result => {
                    if (result.error || !result.access_token ||
                        !google.accounts.oauth2.hasGrantedAllScopes(result, SCOPE)) {
                        reject(new Error('未取得上传权限，请连接并允许保存本应用创建的文件。'));
                    } else resolve({ value: result.access_token, lifetime: Number(result.expires_in) || 3600 });
                },
                error_callback: () => reject(new Error('授权窗口已关闭或被浏览器拦截，请再次点击连接。'))
            });
            client.requestAccessToken({ prompt: !switchAccount && settings.rememberConnection ? '' : 'select_account' });
        });
    }
    async function applyAuthorization(result, epoch) {
        if (epoch !== authEpoch) return;
        token = result.accessToken || result.value;
        tokenExpires = result.expiresAt || Date.now() + Math.max(0, result.lifetime - 60) * 1000;
        if (!token || !Number.isFinite(tokenExpires) || tokenExpires <= Date.now()) throw new Error('授权服务返回的凭据无效。');
        const response = await request(API + '/drive/v3/about?fields=user(permissionId,displayName,emailAddress,photoLink)', {}, [], true);
        const profile = (await response.json()).user;
        if (epoch !== authEpoch) return;
        if (!profile?.permissionId) throw new Error('无法确认 Google Drive 账号，请重新连接。');
        account = profile;
        settings.rememberConnection = true;
        settings.disconnectPending = false;
        save();
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => {
            if ((backendUrl() || extension) && !pumping) {
                void renewAuthorization().catch(error => message(error.message, true));
            } else if (!backendUrl() && !extension) {
                clearAuth();
                message('Google 临时授权已过期，请点击连接。配置授权服务可自动续期。', true);
            }
        }, Math.max(0, tokenExpires - Date.now()));
        render();
    }
    async function nativeToken(interactive) {
        const allowed = interactive ? await chrome.permissions.request({ origins: [API + '/*'] }) :
            await chrome.permissions.contains({ origins: [API + '/*'] });
        if (!allowed) throw new Error('请点击连接并允许访问 Google Drive。');
        const auth = await chrome.identity.getAuthToken({ interactive, scopes: [SCOPE] });
        const value = typeof auth === 'string' ? auth : auth?.token;
        if (!value || (auth.grantedScopes && !auth.grantedScopes.includes(SCOPE))) throw new Error('未取得 Google Drive 上传权限。');
        return { value, lifetime: 3500 };
    }
    async function renewAuthorization(force = false) {
        if (renewing) return renewing;
        const epoch = authEpoch;
        renewing = (async () => {
            try {
                const result = extension ? await nativeToken(false) : await backendRequest('/auth/token' + (force ? '?refresh=1' : ''), 'POST');
                await applyAuthorization(result, epoch);
            } catch (error) {
                if (epoch === authEpoch) clearAuth();
                throw error;
            } finally { renewing = null; }
        })();
        return renewing;
    }
    async function connect(switchAccount = false) {
        if (authorizing || disconnecting || pumping) return;
        if (extension && !manifestClient) {
            message('插件尚未配置 Google OAuth 客户端 ID，请按 README 的插件配置步骤设置后重新加载。', true);
            return;
        }
        if (!extension && !backendUrl() && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(settings.clientId)) {
            message('先选择你下载的 Google 配置文件，再连接云盘。', true);
            element('driveImportClient').focus();
            return;
        }
        // SDK loading happens before the OAuth popup. A second click preserves user activation.
        if (!extension && !backendUrl() && !window.google?.accounts?.oauth2) {
            authorizing = true;
            render();
            try {
                await loadWebSdk();
                message('授权组件已准备好，请再次点击“连接 Google Drive”。');
            } catch (error) { message(error.message, true); }
            finally { authorizing = false; render(); }
            return;
        }
        authorizing = true;
        const epoch = ++authEpoch;
        render();
        message('请在 Google 窗口完成授权，完成后会自动连接。');
        try {
            const result = extension ? await nativeToken(true) : backendUrl() ? await backendLogin() : await webToken(switchAccount);
            await applyAuthorization(result, epoch);
            if (epoch !== authEpoch) return;
            message('Google Drive 已连接。可开启自动上传，或上传当前录音。');
        } catch (error) {
            if (epoch === authEpoch) { clearAuth(); message(error.message || '连接失败，请重试。', true); }
        } finally {
            if (epoch === authEpoch) authorizing = false;
            render();
        }
    }
    async function disconnect() {
        if (disconnecting) return;
        disconnecting = true;
        ++authEpoch;
        authorizing = false;
        activeController?.abort();
        clearAuth();
        settings.rememberConnection = false;
        settings.autoUpload = false;
        save();
        render();
        if (backendUrl()) {
            settings.disconnectPending = true;
            save();
            try { await backendRequest('/auth/logout', 'POST'); }
            catch (error) {
                if (error.code !== 'no_session') {
                    disconnecting = false;
                    render(); message('本页已断开。服务端退出尚未完成，请恢复网络后再次点击“断开连接”；本页不会自动恢复此会话。', true); return;
                }
            }
            settings.disconnectPending = false;
            save();
            render();
        }
        disconnecting = false;
        render();
        message('已断开连接并关闭自动上传。待传文件仅保留在当前页面。');
    }
    function quote(value) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
    async function getFolder(name) {
        const cacheKey = account.permissionId + ':' + name;
        if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);
        const query = "trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '" +
            quote(name) + "' and appProperties has { key='audioRecorderFolder' and value='v1' }";
        const found = await (await request(API + '/drive/v3/files?' +
            new URLSearchParams({ q: query, fields: 'files(id)', pageSize: '1' }))).json();
        let id = found.files?.[0]?.id;
        if (!id) {
            const created = await request(API + '/drive/v3/files?fields=id', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder',
                    appProperties: { audioRecorderFolder: 'v1' } })
            });
            id = (await created.json()).id;
        }
        if (!id) throw new Error('无法创建上传文件夹。');
        folderCache.set(cacheKey, id);
        return id;
    }
    function receivedOffset(response, size) {
        const range = response.headers.get('Range');
        if (!range) return 0;
        const match = /^bytes=0-(\d+)$/.exec(range);
        const offset = match ? Number(match[1]) + 1 : -1;
        if (offset < 0 || offset > size) throw new Error('上传进度校验失败，请重试。');
        return offset;
    }
    async function upload(job) {
        if (!connected() && (backendUrl() || extension) && settings.rememberConnection) await renewAuthorization();
        if (!connected()) throw new Error('请先在设置中连接 Google Drive，再重试上传。');
        const owner = account.permissionId;
        if (job.owner !== owner) {
            job.fileId = null;
            job.session = null;
            job.offset = 0;
            job.owner = owner;
        }
        // A stable, pre-generated file ID prevents duplicates after a lost final response.
        if (job.fileId) {
            const existing = await request(API + '/drive/v3/files/' + encodeURIComponent(job.fileId) +
                '?fields=id,name,size,webViewLink', {}, [404]);
            if (existing.ok) {
                const data = await existing.json();
                if (String(data.size) !== String(job.blob.size)) throw new Error('云端文件大小不一致，请联系维护者检查。');
                return data;
            }
        } else {
            const ids = await (await request(API + '/drive/v3/files/generateIds?count=1&space=drive&type=files')).json();
            job.fileId = ids.ids?.[0];
            if (!job.fileId) throw new Error('无法创建云端文件标识，请重试。');
        }
        if (job.session) {
            const status = await request(job.session, { method: 'PUT', headers: {
                'Content-Range': 'bytes */' + job.blob.size
            } }, [308, 404]);
            if (status.ok) return status.json();
            if (status.status === 404) { job.session = null; job.offset = 0; }
            else job.offset = receivedOffset(status, job.blob.size);
        }
        if (!job.session) {
            const folderId = await getFolder(job.folderName);
            const response = await request(API + '/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': job.blob.type },
                body: JSON.stringify({ id: job.fileId, name: job.name, mimeType: job.blob.type,
                    parents: [folderId], appProperties: { audioRecorderRecording: job.key } })
            });
            job.session = response.headers.get('Location');
            if (!job.session) throw new Error('未取得上传会话地址，请重试。');
        }
        while (job.offset < job.blob.size) {
            const start = job.offset;
            const end = Math.min(start + CHUNK_SIZE, job.blob.size);
            message('正在上传 ' + job.name + ' · ' + Math.floor(start / job.blob.size * 100) + '%');
            const response = await request(job.session, {
                method: 'PUT', headers: { 'Content-Type': job.blob.type,
                    'Content-Range': 'bytes ' + start + '-' + (end - 1) + '/' + job.blob.size },
                body: job.blob.slice(start, end)
            }, [308]);
            if (response.ok) {
                const result = await response.json();
                if (result.size !== undefined && String(result.size) !== String(job.blob.size)) {
                    throw new Error('云端文件大小校验失败，请重试。');
                }
                return result;
            }
            job.offset = receivedOffset(response, job.blob.size);
            if (job.offset <= start || job.offset >= job.blob.size) {
                throw new Error('Google Drive 尚未确认上传完成，请重试。');
            }
        }
        throw new Error('上传未完成，请重试。');
    }
    function showResult(job, result) {
        lastUploadUrl = 'https://drive.google.com/file/d/' + encodeURIComponent(result.id) + '/view';
        element('driveLastUploadName').textContent = job.name;
        element('driveMainUploadName').textContent = job.name;
        element('driveLastUploadUrl').textContent = lastUploadUrl;
        element('driveMainUploadUrl').textContent = lastUploadUrl;
        element('driveOpenUpload').href = lastUploadUrl;
        element('driveLastUpload').title = lastUploadUrl;
        element('driveMainCopy').title = lastUploadUrl;
        element('driveResult').hidden = false;
        element('driveLastUpload').hidden = false;
        element('driveMainResult').hidden = false;
        for (const id of ['driveCopyStatus', 'driveMainCopyStatus']) element(id).textContent = '';
        for (const id of ['driveCopyFallback', 'driveMainCopyFallback']) element(id).hidden = true;
    }
    function legacyCopy(text) {
        const previous = document.activeElement;
        const input = document.createElement('textarea');
        input.value = text;
        input.readOnly = true;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        const dialog = element('driveSettings');
        (dialog.open ? dialog : document.body).appendChild(input);
        try {
            input.select();
            if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
        } finally { input.remove(); previous?.focus(); }
    }
    async function copyUploadLink(fromMain) {
        if (!lastUploadUrl) return;
        const url = lastUploadUrl;
        try {
            try {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                await navigator.clipboard.writeText(url);
            } catch { legacyCopy(url); }
            for (const id of ['driveCopyStatus', 'driveMainCopyStatus']) element(id).textContent = '链接已复制';
            for (const id of ['driveCopyFallback', 'driveMainCopyFallback']) element(id).hidden = true;
        } catch {
            for (const id of ['driveCopyStatus', 'driveMainCopyStatus']) element(id).textContent = '未能自动复制，请选中下方链接手动复制。';
            for (const id of ['driveCopyFallback', 'driveMainCopyFallback']) {
                element(id).value = url;
                element(id).hidden = false;
            }
            const input = element(fromMain ? 'driveMainCopyFallback' : 'driveCopyFallback');
            input.focus();
            input.select();
        }
    }
    async function runQueue() {
        while (true) {
            const job = jobs.find(j => j.status === 'queued');
            if (!job) break;
            job.status = 'uploading';
            activeController = new AbortController();
            render();
            try {
                const result = await upload(job);
                if (!result?.id || result.id !== job.fileId) throw new Error('云端文件标识校验失败，请重试。');
                job.status = 'done';
                job.result = result;
                job.blob = null;
                job.session = null;
                showResult(job, result);
                message('已上传：' + job.name);
            } catch (error) {
                job.status = 'failed';
                message(error.name === 'AbortError' ? '上传已暂停，文件保留在当前页面。' :
                    error.message || '网络连接失败，请重试上传。', true);
            } finally { activeController = null; render(); }
        }
    }
    function pump() {
        if (pumping) return pumping;
        // Defer queue execution so the UI reflects the busy state before requests start.
        pumping = Promise.resolve().then(runQueue).finally(() => { pumping = null; render(); });
        render();
        return pumping;
    }
    async function queueCurrent() {
        if (restoring) await restoring;
        if (!currentRecording) { message('请先完成一段录音。', true); return Promise.resolve(); }
        const format = settings.format;
        const key = currentRecording.id + ':' + format;
        let job = jobs.find(j => j.key === key);
        if (job?.status === 'done') {
            showResult(job, job.result);
            message('这段录音已上传，不会重复创建。');
            return Promise.resolve();
        }
        if (!job) {
            const file = currentRecording[format];
            if (!file?.blob?.size) { message('当前录音没有可上传的音频数据。', true); return Promise.resolve(); }
            job = { key, blob: file.blob, name: file.name, folderName: settings.folderName,
                status: 'queued', offset: 0, fileId: null, session: null, owner: null };
            jobs.push(job);
        } else if (job.status === 'failed') job.status = 'queued';
        return pump();
    }
    function setRecording(recording) {
        currentRecording = recording;
        // Completed jobs no longer need their deduplication record after moving to a new take.
        for (let i = jobs.length - 1; i >= 0; i--) {
            if (jobs[i].status === 'done' && jobs[i].key.split(':')[0] !== recording?.id) jobs.splice(i, 1);
        }
        render();
        if (recording && settings.autoUpload) void queueCurrent();
    }
    function init() {
        const dialog = element('driveSettings');
        const openButton = element('driveSettingsButton');
        openButton.addEventListener('click', () => {
            if (!dialog.open) dialog.showModal();
            render();
        });
        element('driveSettingsClose').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
        dialog.addEventListener('close', () => openButton.focus());
        const clientInput = element('driveClientId');
        clientInput.value = extension ? manifestClient : settings.clientId;
        clientInput.readOnly = extension;
        element('driveClientHelp').textContent = extension ?
            '插件使用 manifest.json 中的 Chrome 扩展 OAuth 客户端 ID；配置方法见 README。' :
            '填写 Google Cloud 中“Web 应用”类型的客户端 ID，无需 Client Secret。首次连接需加载 Google 授权组件。';
        element('driveSaveClient').hidden = extension;
        element('driveImportClient').addEventListener('click', () => element('driveConfigFile').click());
        element('driveChangeConfig').addEventListener('click', () => element('driveConfigFile').click());
        element('driveLastUpload').addEventListener('click', () => void copyUploadLink(false));
        element('driveMainCopy').addEventListener('click', () => void copyUploadLink(true));
        element('driveMainProfile').addEventListener('click', () => {
            if (!dialog.open) dialog.showModal();
            render();
        });
        ['driveAvatar', 'driveMainAvatar'].forEach(id => element(id).addEventListener('error', () => {
            element(id).hidden = true;
        }));
        element('driveBackendUrl').value = window.AudioRecorderDriveBackendUrl || settings.backendUrl;
        element('driveBackendUrl').readOnly = Boolean(window.AudioRecorderDriveBackendUrl);
        element('driveBackendSave').hidden = extension || Boolean(window.AudioRecorderDriveBackendUrl);
        element('driveBackendSettings').hidden = extension;
        element('driveBackendSave').addEventListener('click', async () => {
            const value = element('driveBackendUrl').value.trim();
            if (value) {
                try {
                    const url = new URL(value);
                    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
                } catch { message('请填写 HTTPS 授权服务根地址，不含路径、账号或查询参数。', true); return; }
            }
            if (settings.backendUrl !== value) {
                await disconnect();
                if (settings.disconnectPending) return;
            }
            settings.backendUrl = value;
            save(); render();
            message(value ? '保持连接服务已设置，请连接 Google Drive 一次。' : '已切换为临时连接。');
        });
        element('driveConfigFile').addEventListener('change', async event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
                if (file.size > 65536) throw new Error('配置文件过大，请选择 Google OAuth 客户端 JSON。');
                const id = parseClientConfig(await file.text());
                if (extension && id !== manifestClient) {
                    message('已识别配置，但插件客户端 ID 需先写入 manifest.json 的 oauth2 配置并重新加载；不会保存完整配置文件。', true);
                    return;
                }
                if (!extension) {
                    if (settings.clientId !== id) {
                        await disconnect();
                        if (settings.disconnectPending) return;
                    }
                    settings.clientId = id;
                    save();
                }
                clientInput.value = id;
                render();
                message('配置已就绪，点击“连接 Google Drive”继续。');
            } catch (error) { message(error.message, true); }
        });
        element('driveSaveClient').addEventListener('click', async () => {
            const value = clientInput.value.trim();
            if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(value)) {
                message('客户端 ID 格式不正确，应以 .apps.googleusercontent.com 结尾。', true);
                return;
            }
            if (settings.clientId !== value) {
                await disconnect();
                if (settings.disconnectPending) return;
            }
            settings.clientId = value;
            save();
            render();
            message('配置已就绪，点击“连接 Google Drive”继续。');
        });
        element('driveFormat').value = settings.format;
        element('driveFormat').addEventListener('change', event => {
            settings.format = event.target.value === 'webm' ? 'webm' : 'mp3'; save(); render();
        });
        element('driveFolderName').value = settings.folderName;
        element('driveFolderName').addEventListener('change', event => {
            settings.folderName = event.target.value.trim().slice(0, 100) || 'Audio Recorder';
            event.target.value = settings.folderName;
            save();
        });
        element('driveAutoUpload').addEventListener('change', event => {
            if (event.target.checked && !connected()) {
                event.target.checked = false;
                message('请先连接 Google Drive，再开启自动上传。', true);
                return;
            }
            settings.autoUpload = event.target.checked;
            save();
            message(settings.autoUpload ? '已开启：之后每次录音停止都会自动上传。' : '已关闭自动上传，已排队的上传会继续完成。');
        });
        element('driveConnect').addEventListener('click', () => void connect());
        element('driveSwitchAccount').addEventListener('click', () => void connect(true));
        element('driveDisconnect').addEventListener('click', () => void disconnect());
        element('driveUploadCurrent').addEventListener('click', () => void queueCurrent());
        element('driveRetry').addEventListener('click', () => {
            jobs.filter(j => j.status === 'failed').forEach(j => { j.status = 'queued'; });
            void pump();
        });
        window.addEventListener('beforeunload', event => {
            if (jobs.some(j => j.status !== 'done')) { event.preventDefault(); event.returnValue = ''; }
        });
        render();
        if (settings.disconnectPending && backendUrl()) {
            void disconnect();
        } else if (backendUrl() || (extension && manifestClient && settings.rememberConnection)) {
            const restoreEpoch = authEpoch;
            authorizing = true;
            render();
            message('正在恢复 Google Drive 连接…');
            restoring = (async () => {
                try {
                    await renewAuthorization();
                    if (restoreEpoch === authEpoch) message('Google Drive 连接已恢复。' + (settings.autoUpload ? '自动上传已开启。' : ''));
                } catch (error) {
                    if (restoreEpoch === authEpoch) {
                        if (settings.rememberConnection || error.code !== 'no_session') message(error.message, true);
                        else message('请连接 Google Drive 一次，之后会自动恢复。');
                    }
                } finally { authorizing = false; restoring = null; render(); }
            })();
        } else if (settings.autoUpload) message('自动上传已开启，请先连接 Google Drive。', true);
    }
    window.AudioRecorderDrive = Object.freeze({ setRecording });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
