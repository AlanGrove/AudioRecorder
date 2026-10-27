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
    const denied = await fetch(base + '/auth/start', { method: 'POST',
        headers: { ...headers, Origin: 'https://untrusted.example.invalid' }, redirect: 'error' });
    assert.equal(denied.status, 403, 'Reject an untrusted browser origin');
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
    const simple = await fetch(base + '/auth/start', { method: 'POST', headers: { Origin: headers.Origin }, redirect: 'error' });
    assert.equal(simple.status, 403, 'Reject requests without the CSRF protection header');
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
    const cancelled = await fetch(base + '/oauth/callback?' + new URLSearchParams({ state: data.flow, error: 'access_denied' }), { redirect: 'error' });
    assert.equal(cancelled.status, 400, 'An intentionally cancelled test flow does not authorize');
    assert.match(cancelled.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    const status = await (await fetch(base + '/auth/session', { headers: { ...headers, Cookie: cookie }, redirect: 'error' })).json();
    assert.equal(status.pending, false); assert.equal(status.connected, false); assert.equal(status.error, 'authorization_denied');
    console.log('线上 Worker：HTTPS、CORS/CSRF 拒绝、分区 Cookie、取消回调的事务写入及会话读取检查通过。');
} finally {
    if (cookie) {
        const logout = await fetch(base + '/auth/logout', { method: 'POST', headers: { ...headers, Cookie: cookie }, redirect: 'error' });
        assert.equal(logout.status, 200);
        const after = await fetch(base + '/auth/token', { method: 'POST', headers: { ...headers, Cookie: cookie }, redirect: 'error' });
        assert.equal(after.status, 401, 'The old cookie cannot restore a logged-out session');
        console.log('测试会话已退出并清除，原 Cookie 再请求凭据返回 401。');
    }
}
