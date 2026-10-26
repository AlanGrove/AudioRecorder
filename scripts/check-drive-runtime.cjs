const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
    const mf = new Miniflare(convertV4MiniflareOptions({
        name: 'recorder', modules: true, scriptPath: path.join(__dirname, '../backend/worker.mjs'),
        compatibilityDate: '2026-10-01',
        bindings: { APP_ORIGIN: 'https://alangrove.github.io',
            GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret',
            TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url') },
        durableObjects: { DRIVE_SESSIONS: { className: 'DriveSession', useSQLite: true } }
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
        const logout = await mf.dispatchFetch('https://recorder.example/auth/logout', { method: 'POST', headers: { ...headers, Cookie: cookie } });
        assert.equal(logout.status, 200);
        const after = await mf.dispatchFetch('https://recorder.example/auth/session', { headers: { ...headers, Cookie: cookie } });
        assert.equal(after.status, 401);
        console.log('Worker 实际运行时与 SQLite Durable Object：创建、读取、取消及退出检查通过。');
    } finally { await mf.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
