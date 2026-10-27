const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
    let redirectProbe = false;
    let refreshCalls = 0;
    let unexpectedCalls = 0;
    const mf = new Miniflare(convertV4MiniflareOptions({
        name: 'recorder', modules: true, scriptPath: path.join(__dirname, '../backend/worker.mjs'),
        compatibilityDate: '2026-10-01',
        bindings: { APP_ORIGIN: 'https://alangrove.github.io',
            GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret',
            TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url') },
        durableObjects: { DRIVE_SESSIONS: { className: 'DriveSession', useSQLite: true } },
        outboundService: async request => {
            if (request.url === 'https://oauth2.googleapis.com/token') {
                if (redirectProbe) return new Response(null, { status: 302, headers: { Location: 'https://unexpected.invalid/token' } });
                const params = new URLSearchParams(await request.text());
                if (params.get('grant_type') === 'refresh_token') {
                    refreshCalls++;
                    return Response.json({ access_token: 'runtime-refreshed', expires_in: 3600 });
                }
                assert.ok(params.get('code_verifier'));
                return Response.json({ access_token: 'runtime-access', refresh_token: 'runtime-refresh', expires_in: 1,
                    scope: 'https://www.googleapis.com/auth/drive.file' });
            }
            if (new URL(request.url).origin === 'https://www.googleapis.com') {
                assert.equal(request.headers.get('Authorization'), 'Bearer runtime-access');
                return Response.json({ user: { permissionId: 'runtime-owner', displayName: 'Runtime Test' } });
            }
            unexpectedCalls++;
            throw new Error('Unexpected outbound target');
        }
    }));
    try {
        const headers = { Origin: 'https://alangrove.github.io', 'X-Recorder-Request': '1' };
        const start = await mf.dispatchFetch('https://recorder.example/auth/start', { method: 'POST', headers });
        assert.equal(start.status, 200);
        const data = await start.json();
        assert.equal(new URL(data.url).origin, 'https://accounts.google.com');
        const cookie = start.headers.get('Set-Cookie').split(';')[0];
        const session = await mf.dispatchFetch('https://recorder.example/auth/session', { headers: { ...headers, Cookie: cookie } });
        assert.equal(session.status, 200);
        assert.equal((await session.json()).pending, true);
        const replay = await mf.dispatchFetch('https://recorder.example/oauth/callback?state=' + encodeURIComponent(data.flow) + '&error=access_denied');
        assert.equal(replay.status, 400);
        const login = await mf.dispatchFetch('https://recorder.example/auth/start', { method: 'POST', headers: { ...headers, Cookie: cookie } });
        const loginData = await login.json();
        const complete = await mf.dispatchFetch('https://recorder.example/oauth/callback?' +
            new URLSearchParams({ state: loginData.flow, code: 'runtime-code' }));
        assert.equal(complete.status, 200, 'Real workerd fetch must accept the Google request options');
        const access = await mf.dispatchFetch('https://recorder.example/auth/token', { method: 'POST', headers: { ...headers, Cookie: cookie } });
        assert.equal(access.status, 200);
        const token = await access.json();
        assert.equal(token.accessToken, 'runtime-refreshed');
        assert.ok(token.expiresIn > 3000 && token.expiresIn <= 3510, 'Return remaining duration instead of relying on the browser wall clock');
        assert.equal(refreshCalls, 1);
        redirectProbe = true;
        const rejectedStart = await mf.dispatchFetch('https://recorder.example/auth/start', { method: 'POST', headers: { ...headers, Cookie: cookie } });
        const rejectedData = await rejectedStart.json();
        const rejected = await mf.dispatchFetch('https://recorder.example/oauth/callback?' +
            new URLSearchParams({ state: rejectedData.flow, code: 'redirect-code' }));
        assert.equal(rejected.status, 502);
        assert.equal(unexpectedCalls, 0, 'Google redirects must never be followed');
        const logout = await mf.dispatchFetch('https://recorder.example/auth/logout', { method: 'POST', headers: { ...headers, Cookie: cookie } });
        assert.equal(logout.status, 200);
        const after = await mf.dispatchFetch('https://recorder.example/auth/session', { headers: { ...headers, Cookie: cookie } });
        assert.equal(after.status, 401);
        console.log('Worker 实际运行时：OAuth 交换、资料读取、加密保存、刷新续期、拒绝跳转、取消及退出均通过（Google 响应为测试替身）。');
    } finally { await mf.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
