// OAuth broker only. Recordings upload directly from the browser to Google Drive.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const COOKIE = '__Host-recorder_session';
const SESSION_MS = 30 * 86400000;
const FLOW_MS = 10 * 60000;
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const hash = async text => b64(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
const json = (data, status = 200, headers = {}) => Response.json(data, {
    status, headers: { 'Cache-Control': 'no-store', ...headers }
});
function fail(code, status = 400) { return json({ error: code }, status); }
function cookie(value, maxAge = SESSION_MS / 1000) {
    return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=${maxAge}`;
}
async function encryptionKey(env) {
    const bytes = unb64(env.TOKEN_ENCRYPTION_KEY || '');
    if (bytes.length !== 32) throw new Error('Missing encryption key');
    return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, value, context) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
        await encryptionKey(env), encoder.encode(JSON.stringify(value)));
    return { iv: b64(iv), data: b64(data) };
}
async function unseal(env, value, context) {
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(value.iv), additionalData: encoder.encode(context) },
        await encryptionKey(env), unb64(value.data));
    return JSON.parse(new TextDecoder().decode(data));
}
async function googleToken(env, params) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET, ...params }), redirect: 'manual'
    });
    if (response.status >= 300 && response.status < 400) {
        const error = new Error('google_unavailable'); error.status = 502; throw error;
    }
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data.error === 'invalid_grant' ? 'reauthorize' : 'google_unavailable');
        error.status = data.error === 'invalid_grant' ? 401 : 502;
        throw error;
    }
    if (!data.access_token) throw new Error('google_unavailable');
    return data;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        const allowed = origin === env.APP_ORIGIN;
        const cors = allowed ? { 'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin' } : {};
        const respond = response => {
            const headers = new Headers(response.headers);
            Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
            headers.set('Cache-Control', 'no-store');
            headers.set('Referrer-Policy', 'no-referrer');
            headers.set('X-Content-Type-Options', 'nosniff');
            return new Response(response.body, { status: response.status, headers });
        };
        try {
            if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.DRIVE_SESSIONS) {
                return respond(fail('backend_not_configured', 503));
            }
            if (url.pathname === '/oauth/callback' && request.method === 'GET') {
                const state = url.searchParams.get('state') || '';
                if (!/^[\w-]{43}\.[\w-]{43}$/.test(state)) return respond(fail('invalid_state'));
                const session = env.DRIVE_SESSIONS.get(env.DRIVE_SESSIONS.idFromName(state.split('.')[0]));
                const result = await session.fetch(new Request('https://session/callback', {
                    method: 'POST', body: JSON.stringify({ state, code: url.searchParams.get('code'),
                        denied: Boolean(url.searchParams.get('error')) })
                }));
                // No query data, tokens, remote images, or executable code are rendered here.
                return respond(new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
                    '<title>Google Drive 连接</title><p>' + (result.ok ? '授权完成，请关闭此页并返回录音器。' :
                        '授权未完成，请返回录音器重新连接。') + '</p>', {
                    status: result.status,
                    headers: { 'Content-Type': 'text/html; charset=utf-8',
                        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" }
                }));
            }
            if (!allowed) return respond(fail('origin_denied', 403));
            if (request.method === 'OPTIONS') return respond(new Response(null, {
                status: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'X-Recorder-Request, Content-Type', 'Access-Control-Max-Age': '600' }
            }));
            const paths = { '/auth/start': 'POST', '/auth/session': 'GET', '/auth/token': 'POST', '/auth/logout': 'POST', '/auth/health': 'GET' };
            if (!paths[url.pathname]) return respond(fail('not_found', 404));
            if (request.method !== paths[url.pathname]) return respond(fail('method_not_allowed', 405));
            if (request.headers.get('X-Recorder-Request') !== '1') return respond(fail('request_denied', 403));
            if (url.pathname === '/auth/health') {
                try {
                    const probe = await seal(env, { ready: true }, 'health');
                    if (!(await unseal(env, probe, 'health')).ready) throw new Error();
                    return respond(json({ ready: true }));
                } catch { return respond(fail('crypto_unavailable', 503)); }
            }
            let secret = (request.headers.get('Cookie') || '').split(';').map(p => p.trim())
                .find(p => p.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
            if (!/^[\w-]{43}$/.test(secret || '')) secret = '';
            if (!secret && url.pathname !== '/auth/start') return respond(fail('no_session', 401));
            secret ||= random();
            const id = await hash(secret);
            const session = env.DRIVE_SESSIONS.get(env.DRIVE_SESSIONS.idFromName(id));
            const result = await session.fetch(new Request('https://session' + url.pathname, {
                method: 'POST', body: JSON.stringify({ id, redirectUri: url.origin + '/oauth/callback',
                    forceRefresh: url.searchParams.get('refresh') === '1' })
            }));
            const headers = new Headers(result.headers);
            if (url.pathname === '/auth/start' && result.ok) headers.set('Set-Cookie', cookie(secret));
            if (url.pathname === '/auth/logout') headers.set('Set-Cookie', cookie('', 0));
            return respond(new Response(result.body, { status: result.status, headers }));
        } catch {
            // Never log OAuth codes, credentials, cookies, or Google response bodies.
            return respond(fail('backend_unavailable', 503));
        }
    }
};

export class DriveSession {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; this.refreshing = null; }
    async read() {
        const session = await this.ctx.storage.get('session');
        if (session && session.expires > Date.now()) return session;
        if (session) await this.ctx.storage.deleteAll();
        return null;
    }
    async alarm() {
        const session = await this.read();
        if (session) await this.ctx.storage.setAlarm(session.expires);
    }
    async fetch(request) {
        try {
            const path = new URL(request.url).pathname;
            const body = await request.json();
            if (path === '/auth/start') {
                let session = await this.read();
                session ||= { id: body.id, expires: Date.now() + SESSION_MS, version: random() };
                session.pending = { state: body.id + '.' + random(), verifier: random(),
                    redirectUri: body.redirectUri, expires: Date.now() + FLOW_MS };
                session.processing = null;
                session.error = '';
                await this.ctx.storage.put('session', session);
                await this.ctx.storage.setAlarm(session.expires);
                const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
                authorization.search = new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID,
                    redirect_uri: body.redirectUri, response_type: 'code', scope: SCOPE,
                    access_type: 'offline', prompt: 'consent select_account',
                    state: session.pending.state, code_challenge: await hash(session.pending.verifier),
                    code_challenge_method: 'S256', include_granted_scopes: 'false' });
                return json({ url: authorization.href, flow: session.pending.state });
            }
            if (path === '/auth/logout') {
                await this.ctx.storage.deleteAll();
                return json({ connected: false });
            }
            let session = await this.read();
            if (!session) return fail('no_session', 401);
            if (path === '/callback') {
                const pending = session.pending;
                if (!pending || pending.state !== body.state || pending.expires <= Date.now()) return fail('invalid_state');
                // Consume the state before the outbound token exchange; replay is rejected.
                session.pending = null;
                session.processing = { state: body.state, expires: Date.now() + 120000 };
                session.error = '';
                await this.ctx.storage.put('session', session);
                const callbackVersion = session.version;
                const callbackFailure = async (code, status = 400) => {
                    const current = await this.read();
                    if (current?.version === callbackVersion && current.processing?.state === body.state) {
                        current.processing = null;
                        current.error = code;
                        await this.ctx.storage.put('session', current);
                    }
                    return fail(code, status);
                };
                if (body.denied || !body.code) return callbackFailure('authorization_denied');
                let callbackStage = 'token_exchange';
                try {
                    const tokens = await googleToken(this.env, { grant_type: 'authorization_code', code: body.code,
                        redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
                    if (!(tokens.scope || '').split(' ').includes(SCOPE) || !tokens.refresh_token) return callbackFailure('missing_offline_scope');
                    callbackStage = 'profile_read';
                    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,displayName,emailAddress,photoLink)', {
                        headers: { Authorization: 'Bearer ' + tokens.access_token }, redirect: 'manual'
                    });
                    if (!response.ok) return callbackFailure('profile_unavailable', 502);
                    const profile = (await response.json()).user;
                    if (!profile?.permissionId) return callbackFailure('profile_unavailable', 502);
                    callbackStage = 'session_read';
                    const current = await this.read();
                    if (!current || current.version !== callbackVersion || current.pending ||
                        current.processing?.state !== body.state) return fail('session_changed', 409);
                    session = current;
                    session.version = random();
                    session.activeFlow = body.state;
                    session.profile = profile;
                    session.reauthorize = false;
                    session.error = '';
                    session.processing = null;
                    callbackStage = 'encryption';
                    session.tokens = await seal(this.env, { access: tokens.access_token, refresh: tokens.refresh_token,
                        expires: Date.now() + Math.max(0, Number(tokens.expires_in || 3600) - 90) * 1000 }, session.id);
                    callbackStage = 'session_write';
                    await this.ctx.storage.put('session', session);
                    return json({ connected: true });
                } catch (error) {
                    return callbackFailure(['reauthorize', 'google_unavailable'].includes(error.message) ? error.message : 'callback_' + callbackStage + '_failed',
                        error.status || 503);
                }
            }
            if (path === '/auth/session') return json({ connected: Boolean(session.tokens && !session.reauthorize),
                profile: session.profile || null, flow: session.activeFlow || '',
                pending: Boolean((session.pending && session.pending.expires > Date.now()) ||
                    (session.processing && session.processing.expires > Date.now())),
                error: session.error || (session.processing && session.processing.expires <= Date.now() ? 'authorization_failed' : ''),
                reauthorize: session.reauthorize === true });
            if (path === '/auth/token') {
                if (!session.tokens || session.reauthorize) return fail(session.reauthorize ? 'reauthorize' : session.error || 'no_session', 401);
                if (!this.refreshing) this.refreshing = this.freshToken(session, body.forceRefresh).finally(() => { this.refreshing = null; });
                return json(await this.refreshing);
            }
            return fail('not_found', 404);
        } catch (error) {
            return fail(['reauthorize', 'google_unavailable'].includes(error.message) ? error.message : 'backend_unavailable',
                error.status || 503);
        }
    }
    async freshToken(session, force = false) {
        const tokens = await unseal(this.env, session.tokens, session.id);
        if (force || tokens.expires <= Date.now()) {
            let refreshed;
            try { refreshed = await googleToken(this.env, { grant_type: 'refresh_token', refresh_token: tokens.refresh }); }
            catch (error) {
                const current = await this.read();
                if (error.message === 'reauthorize' && current?.version === session.version) {
                    current.reauthorize = true;
                    current.tokens = null;
                    await this.ctx.storage.put('session', current);
                }
                throw error;
            }
            const current = await this.read();
            if (!current || current.version !== session.version) throw new Error('reauthorize');
            tokens.access = refreshed.access_token;
            tokens.refresh = refreshed.refresh_token || tokens.refresh;
            tokens.expires = Date.now() + Math.max(0, Number(refreshed.expires_in || 3600) - 90) * 1000;
            current.tokens = await seal(this.env, tokens, current.id);
            await this.ctx.storage.put('session', current);
        }
        const current = await this.read();
        if (!current || current.version !== session.version) {
            const error = new Error('reauthorize'); error.status = 401; throw error;
        }
        return { accessToken: tokens.access, expiresAt: tokens.expires, profile: current.profile };
    }
}
