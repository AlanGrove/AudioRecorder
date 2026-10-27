import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { DriveSession } from '../backend/worker.mjs';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APP = 'https://alangrove.github.io';
function harness() {
    const objects = new Map();
    const network = [];
    const env = { APP_ORIGIN: APP, GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'test-only-secret', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64url') };
    env.DRIVE_SESSIONS = {
        idFromName: name => name,
        get(id) {
            if (!objects.has(id)) {
                const values = new Map();
                const storage = { get: async key => structuredClone(values.get(key)),
                    put: async (key, value) => values.set(key, structuredClone(value)),
                    deleteAll: async () => values.clear(), setAlarm: async () => {} };
                storage.transaction = action => action(storage);
                objects.set(id, { values, object: new DriveSession({ storage }, env) });
            }
            return objects.get(id).object;
        }
    };
    let cookie = '';
    const state = { invalidGrant: false, missingScope: false, holdRefresh: null, holdExchange: null, failGoogle: false, throwGoogle: false };
    const fetchGoogle = async (url, options) => {
        network.push({ url, options });
        assert.equal(options.redirect, 'manual');
        if (url === 'https://oauth2.googleapis.com/token') {
            if (state.throwGoogle) throw new TypeError('simulated transport failure');
            const body = options.body;
            assert.equal(body.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
            if (state.failGoogle) return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
            if (body.get('grant_type') === 'refresh_token') {
                if (state.holdRefresh) await state.holdRefresh;
                if (state.invalidGrant) return Response.json({ error: 'invalid_grant' }, { status: 400 });
                assert.equal(body.get('refresh_token'), 'test-refresh');
                return Response.json({ access_token: 'renewed-access', expires_in: 3600 });
            }
            assert.ok(body.get('code_verifier'));
            if (state.holdExchange) await state.holdExchange;
            return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 1,
                scope: state.missingScope ? '' : SCOPE });
        }
        assert.equal(new URL(url).pathname, '/drive/v3/about');
        return Response.json({ user: { permissionId: 'owner', displayName: '测试用户',
            emailAddress: 'test@example.invalid', photoLink: 'https://lh3.googleusercontent.com/mock' } });
    };
    async function request(path, method = 'GET', opts = {}) {
        const headers = { Origin: APP, 'X-Recorder-Request': '1', ...opts.headers };
        if (cookie && !opts.noCookie) headers.Cookie = cookie;
        const response = await worker.fetch(new Request('https://recorder.example' + path, { method, headers }), env);
        const setCookie = response.headers.get('Set-Cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return response;
    }
    async function start() {
        const response = await request('/auth/start', 'POST');
        assert.equal(response.status, 200);
        return { response, data: await response.json() };
    }
    async function callback(flow, code = 'test-code') {
        return worker.fetch(new Request('https://recorder.example/oauth/callback?' + new URLSearchParams({ state: flow, code })), env);
    }
    async function authorize() {
        const { data } = await start();
        assert.equal((await callback(data.flow)).status, 200);
        return data;
    }
    return { env, network, objects, state, fetchGoogle, request, start, callback, authorize };
}
// Network replacement stays inside one sequential parent test to prevent global mock races.
test('Cloudflare OAuth 后端', async t => {
    const originalFetch = globalThis.fetch;
    try {
        await t.test('拒绝其他来源、简单 CSRF 请求和无会话请求', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle;
            assert.equal((await h.request('/auth/start', 'POST', { headers: { Origin: 'https://evil.invalid' } })).status, 403);
            assert.equal((await h.request('/auth/start', 'POST', { headers: { 'X-Recorder-Request': '' } })).status, 403);
            assert.equal((await h.request('/auth/token', 'POST')).status, 401);
            assert.equal(h.network.length, 0);
        });
        await t.test('健康检查验证实际加密往返，不泄露密钥且拒绝格式损坏的密钥', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle;
            const healthy = await h.request('/auth/health');
            assert.equal(healthy.status, 200); assert.equal((await healthy.json()).ready, true);
            h.env.TOKEN_ENCRYPTION_KEY = 'invalid';
            const broken = await h.request('/auth/health');
            assert.equal(broken.status, 503); assert.equal((await broken.json()).error, 'crypto_unavailable');
            assert.equal(h.network.length, 0);
        });
        await t.test('CORS 仅允许指定来源，Cookie 使用 HttpOnly Secure Partitioned', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle;
            const { response, data } = await h.start();
            const pendingToken = await h.request('/auth/token', 'POST');
            assert.equal(pendingToken.status, 401);
            assert.equal((await pendingToken.json()).error, 'no_session');
            const cookie = response.headers.get('Set-Cookie');
            assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /Partitioned/);
            assert.match(cookie, /SameSite=None/); assert.match(cookie, /Max-Age=2592000/);
            assert.equal(response.headers.get('Access-Control-Allow-Origin'), APP);
            assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
            assert.equal(response.headers.get('Cache-Control'), 'no-store');
            const url = new URL(data.url);
            assert.equal(url.searchParams.get('access_type'), 'offline');
            assert.equal(url.searchParams.get('scope'), SCOPE);
            assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
            assert.ok(!data.url.includes('test-only-secret'));
        });
        await t.test('授权保存头像与用户名，凭据加密且不出现在 session 响应', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle;
            const flow = await h.authorize();
            const data = await (await h.request('/auth/session')).json();
            assert.equal(data.profile.displayName, '测试用户');
            assert.match(data.profile.photoLink, /^https:/);
            assert.equal(data.flow, flow.flow);
            const stored = JSON.stringify([...h.objects.values()].map(x => [...x.values]));
            assert.ok(!stored.includes('test-access') && !stored.includes('test-refresh'));
            assert.ok(!JSON.stringify(data).includes('test-access') && !JSON.stringify(data).includes('test-refresh'));
        });
        await t.test('回调换取凭据期间保持处理中，轮询不会误判失败，state 仍只能消费一次', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle;
            const { data } = await h.start();
            let release; h.state.holdExchange = new Promise(resolve => { release = resolve; });
            const processing = h.callback(data.flow);
            await new Promise(resolve => setImmediate(resolve));
            const waiting = await (await h.request('/auth/session')).json();
            assert.equal(waiting.pending, true); assert.equal(waiting.error, ''); assert.equal(waiting.connected, false);
            assert.equal((await h.callback(data.flow)).status, 400);
            release(); assert.equal((await processing).status, 200);
            const ready = await (await h.request('/auth/session')).json();
            assert.equal(ready.pending, false); assert.equal(ready.error, ''); assert.equal(ready.connected, true);
        });
        await t.test('两个授权回调交错时，旧回调不能覆盖正在处理的新账号连接', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle;
            const first = await h.start();
            let releaseFirst; h.state.holdExchange = new Promise(resolve => { releaseFirst = resolve; });
            const firstCallback = h.callback(first.data.flow);
            await new Promise(resolve => setImmediate(resolve));
            const second = await h.start();
            let releaseSecond; h.state.holdExchange = new Promise(resolve => { releaseSecond = resolve; });
            const secondCallback = h.callback(second.data.flow);
            await new Promise(resolve => setImmediate(resolve));
            releaseFirst(); assert.equal((await firstCallback).status, 409);
            const waiting = await (await h.request('/auth/session')).json();
            assert.equal(waiting.pending, true); assert.equal(waiting.connected, false); assert.equal(waiting.error, '');
            releaseSecond(); assert.equal((await secondCallback).status, 200);
            assert.equal((await (await h.request('/auth/session')).json()).flow, second.data.flow);
        });
        await t.test('无效、重放、过期和取消的 OAuth state 不能授权', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle;
            const { data } = await h.start();
            assert.equal((await h.callback('invalid')).status, 400);
            assert.equal((await h.callback(data.flow)).status, 200);
            assert.equal((await h.callback(data.flow)).status, 400);
            const again = await h.start();
            const object = [...h.objects.values()][0];
            const session = object.values.get('session'); session.pending.expires = 0;
            assert.equal((await h.callback(again.data.flow)).status, 400);
        });
        await t.test('授权不足不会保存可用连接', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle; h.state.missingScope = true;
            const { data } = await h.start();
            assert.equal((await h.callback(data.flow)).status, 400);
            assert.equal((await (await h.request('/auth/session')).json()).connected, false);
        });
        await t.test('回调交换失败会结束处理中状态并报告不含凭据的失败步骤', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle; h.state.throwGoogle = true;
            const { data } = await h.start();
            assert.equal((await h.callback(data.flow)).status, 503);
            const status = await (await h.request('/auth/session')).json();
            assert.equal(status.pending, false); assert.equal(status.error, 'callback_token_exchange_failed');
            assert.ok(!JSON.stringify(status).includes('test-only-secret'));
        });
        await t.test('过期 access token 自动刷新，并发刷新只调用一次 Google', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle; await h.authorize();
            let release; h.state.holdRefresh = new Promise(resolve => { release = resolve; });
            const first = h.request('/auth/token', 'POST');
            const second = h.request('/auth/token', 'POST');
            await new Promise(resolve => setImmediate(resolve)); release();
            const responses = await Promise.all([first, second]);
            for (const response of responses) {
                assert.equal(response.status, 200);
                const data = await response.json();
                assert.equal(data.accessToken, 'renewed-access');
                assert.ok(data.expiresIn > 3000 && data.expiresIn <= 3510);
                assert.ok(data.expiresAt > Date.now());
            }
            assert.equal(h.network.filter(x => x.options.body?.get('grant_type') === 'refresh_token').length, 1);
        });
        await t.test('invalid_grant 要求重新授权，临时故障保留刷新凭据', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle; await h.authorize();
            h.state.failGoogle = true;
            assert.equal((await h.request('/auth/token', 'POST')).status, 502);
            assert.equal((await (await h.request('/auth/session')).json()).connected, true);
            h.state.failGoogle = false; h.state.invalidGrant = true;
            assert.equal((await h.request('/auth/token', 'POST')).status, 401);
            const data = await (await h.request('/auth/session')).json();
            assert.equal(data.connected, false); assert.equal(data.reauthorize, true);
            assert.equal([...h.objects.values()][0].values.get('session').tokens, null);
        });
        await t.test('断开后后台会话清除，正在续期的请求不能恢复已退出会话', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle; await h.authorize();
            let release; h.state.holdRefresh = new Promise(resolve => { release = resolve; });
            const pending = h.request('/auth/token', 'POST');
            await new Promise(resolve => setImmediate(resolve));
            const logout = await h.request('/auth/logout', 'POST');
            assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
            release(); assert.equal((await pending).status, 503);
            assert.equal([...h.objects.values()][0].values.size, 0);
            assert.equal((await h.request('/auth/token', 'POST')).status, 401);
        });
        await t.test('会话 30 天到期后删除凭据', async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle; await h.authorize();
            [...h.objects.values()][0].values.get('session').expires = 0;
            assert.equal((await h.request('/auth/token', 'POST')).status, 401);
            assert.equal([...h.objects.values()][0].values.size, 0);
        });
        for (const operation of ['callback', 'refresh']) await t.test(`${operation} 加密期间退出，迟到的凭据不能重建已删除会话`, async () => {
            const h = harness(); globalThis.fetch = h.fetchGoogle;
            if (operation === 'refresh') await h.authorize();
            const flow = operation === 'callback' ? (await h.start()).data.flow : null;
            const originalEncrypt = crypto.subtle.encrypt;
            let release, entered;
            const gate = new Promise(resolve => { release = resolve; });
            const waiting = new Promise(resolve => { entered = resolve; });
            crypto.subtle.encrypt = async function(...args) {
                const result = await originalEncrypt.apply(this, args);
                entered(); await gate; return result;
            };
            try {
                const pending = operation === 'callback' ? h.callback(flow) : h.request('/auth/token', 'POST');
                await waiting;
                assert.equal((await h.request('/auth/logout', 'POST')).status, 200);
                release();
                assert.ok([401,409].includes((await pending).status), 'Late credential commit must be rejected');
                assert.equal([...h.objects.values()][0].values.size, 0);
                assert.equal((await h.request('/auth/session')).status, 401);
            } finally { release(); crypto.subtle.encrypt = originalEncrypt; }
        });
    } finally { globalThis.fetch = originalFetch; }
});
