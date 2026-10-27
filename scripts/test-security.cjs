const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createPreviewServer } = require('./preview-recording-library.cjs');
const root = path.resolve(__dirname, '..');

test('发布标签作为环境数据读取，拒绝脚本元字符、越界及全零版本', () => {
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
    const script = workflow.match(/- name: Read version from tag[\s\S]*?run: \|\n([\s\S]*?)\n      - name:/)[1].replace(/^          /gm, '');
    assert.ok(!script.includes('${{'));
    const output = path.join(os.tmpdir(), 'recorder-tag-test-' + crypto.randomUUID());
    try {
        for (const tag of ['v1.23', 'v1$(whoami)', 'v1";throw', 'v65536.1', 'v0.0', 'v1.2.3.4.5', 'v01.23']) {
            const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"\n' + script], {
                encoding: 'utf8', env: { ...process.env, RELEASE_TAG: tag, GITHUB_OUTPUT: output }
            });
            if (result.error) throw result.error;
            assert.equal(result.status === 0, tag === 'v1.23', tag);
        }
        assert.equal(fs.readFileSync(output, 'utf8').trim(), 'version=1.23');
    } finally { if (fs.existsSync(output)) fs.unlinkSync(output); }
});

test('预览服务拒绝凭据文件、异常编码、外部 Host/Origin 和写请求', async () => {
    const server = createPreviewServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const request = (pathname, { host = '127.0.0.1:4174', origin, method = 'GET' } = {}) => new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method,
            headers: { Host: host, ...(origin ? { Origin: origin } : {}) } }, response => {
            const parts = []; response.on('data', data => parts.push(data));
            response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(parts).toString('utf8') }));
        }); req.on('error', reject); req.end();
    });
    try {
        for (const name of ['/backend/.env', '/backend/.dev.vars', '/backend/.wrangler/cache/wrangler-account.json', '/.git/config', '/README.md', '/..%5c..%5c.env']) assert.equal((await request(name)).status, 404, name);
        assert.equal((await request('/%ZZ')).status, 400);
        assert.equal((await request('/', { host: 'attacker.invalid' })).status, 403);
        assert.equal((await request('/', { origin: 'https://attacker.invalid' })).status, 403);
        assert.equal((await request('/', { method: 'POST' })).status, 405);
        const page = await request('/'); assert.equal(page.status, 200);
        assert.match(page.body, /Content-Security-Policy/);
        assert.match(page.body, /nonce="[A-Za-z0-9+/]+"/);
        assert.ok(!page.body.includes("script-src 'self' 'unsafe-inline'"));
        assert.equal((await request('/AudioRecorder.js')).status, 200);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('内置编码器与已核对的上游发布文件哈希保持一致', () => {
    for (const [file, expected] of [
        ['lamejs.iife.js', '0be202ec162aa3042d5c5c4e6288ad326cff8cec7312c2894a0a91ad2f9aeda1'],
        ['lame.min.js', '15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4']
    ]) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), expected, file);
});
