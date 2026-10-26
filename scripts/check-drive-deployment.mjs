// Creates and immediately removes one empty test session. No Google authorization or audio.
import assert from 'node:assert/strict';
const base = process.argv[2];
if (!base || new URL(base).protocol !== 'https:') throw new Error('Provide the deployed HTTPS Worker origin.');
const headers = { Origin: 'https://alangrove.github.io', 'X-Recorder-Request': '1' };
let cookie = '';
try {
    const health = await fetch(base + '/auth/health', { headers, redirect: 'error' });
    assert.equal(health.status, 200, 'Worker encryption health');
    assert.equal((await health.json()).ready, true);
    const start = await fetch(base + '/auth/start', { method: 'POST', headers, redirect: 'error' });
    assert.equal(start.status, 200, 'OAuth start endpoint');
    assert.equal(start.headers.get('Access-Control-Allow-Origin'), headers.Origin);
    const setCookie = start.headers.get('Set-Cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Partitioned/);
    cookie = setCookie.split(';')[0];
    const data = await start.json();
    const authorization = new URL(data.url);
    assert.equal(authorization.origin, 'https://accounts.google.com');
    assert.equal(authorization.searchParams.get('redirect_uri'), base + '/oauth/callback');
    const session = await fetch(base + '/auth/session', { headers: { ...headers, Cookie: cookie }, redirect: 'error' });
    assert.equal(session.status, 200);
    const current = await session.json();
    assert.equal(current.connected, false); assert.equal(current.pending, true);
    console.log('线上 Worker：HTTPS、CORS、分区 Cookie、OAuth 回调及会话读取检查通过。');
} finally {
    if (cookie) {
        const logout = await fetch(base + '/auth/logout', { method: 'POST', headers: { ...headers, Cookie: cookie }, redirect: 'error' });
        assert.equal(logout.status, 200);
        console.log('测试会话已退出并清除。');
    }
}
