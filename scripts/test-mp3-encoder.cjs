const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createEncoder } = require('../mp3-encoder.js');
const { inspectMp3 } = require('../recording-recovery.js');
function harness(extra = {}) {
    const sent = [], chunks = [], errors = [], timers = new Map(); let id = 0, worker;
    class Worker {
        constructor(url) { this.url = url; this.terminated = 0; worker = this; }
        postMessage(data, transfer = []) { sent.push(structuredClone(data, { transfer })); }
        terminate() { this.terminated++; }
        receive(data) { this.onmessage?.({ data }); }
    }
    const encoder = createEncoder({ sampleRate: 48000, bitrate: 16, workerUrl: 'mp3-encoder-worker.js', Worker,
        onChunk: chunk => chunks.push(chunk), onError: error => errors.push(error),
        setTimeout(fn, ms) { const n = ++id; timers.set(n, { fn, ms }); return n; }, clearTimeout: n => timers.delete(n), ...extra });
    return { encoder, worker, sent, chunks, errors, timers,
        expire(ms) { for (const [id, timer] of timers) if (timer.ms === ms) { timers.delete(id); timer.fn(); } } };
}
test('PCM 所有权转交 Worker，finish 在全部 PCM 后发送且只发送一次；末尾音频先于完成返回', async () => {
    const h = harness(); h.worker.receive({ type: 'ready' }); await h.encoder.ready;
    const pcm = new Float32Array([.1, -.2]); h.encoder.encode(pcm); assert.equal(pcm.byteLength, 0);
    const result = h.encoder.finish(); assert.equal(h.encoder.finish(), result);
    assert.deepEqual(h.sent.map(m => m.type), ['init', 'encode', 'finish']);
    assert.deepEqual([...h.sent[1].samples], [...new Float32Array([.1, -.2])]);
    assert.throws(() => h.encoder.encode(new Float32Array(1)));
    let settled = false; void result.then(() => { settled = true; });
    h.worker.receive({ type: 'encoded', chunk: new Uint8Array([1]) }); await Promise.resolve(); assert.equal(settled, false);
    h.worker.receive({ type: 'finished', chunk: new Uint8Array([2, 3]) }); await result;
    assert.deepEqual(h.chunks.map(c => [...c]), [[1], [2, 3]]); assert.equal(h.worker.terminated, 1);
    h.encoder.destroy(); assert.equal(h.worker.terminated, 1); assert.equal(h.timers.size, 0);
});
test('Worker 运行失败拒绝完成，不把已编码的前缀当完整录音；错误回调只触发一次', async () => {
    const h = harness(); h.worker.receive({ type: 'ready' }); await h.encoder.ready;
    h.worker.receive({ type: 'encoded', chunk: new Uint8Array([1]) });
    const done = assert.rejects(h.encoder.finish(), /后台线程失败/);
    h.worker.receive({ type: 'error', message: '后台线程失败' }); await done;
    assert.equal(h.errors.length, 1); assert.equal(h.encoder.error.message, '后台线程失败');
    assert.equal(h.worker.terminated, 1); assert.equal(h.timers.size, 0);
    assert.deepEqual([...h.chunks[0]], [1]); await assert.rejects(h.encoder.finish(), /后台线程失败/);
});
test('Worker 不可用、加载失败和启动超时明确拒绝启动并清理资源', async () => {
    const missing = harness({ Worker: null }); await assert.rejects(missing.encoder.ready, /无法启动/);
    const failed = harness(); const rejected = assert.rejects(failed.encoder.ready, /后台编码线程异常/);
    failed.worker.onerror({ preventDefault() {} }); await rejected; assert.equal(failed.worker.terminated, 1);
    const timed = harness(); const timeout = assert.rejects(timed.encoder.ready, /启动超时/);
    timed.expire(10000); await timeout; assert.equal(timed.timers.size, 0); assert.equal(timed.worker.terminated, 1);
});
test('结束超时或结果读取失败不会永远卡在正在处理', async () => {
    const h = harness(); h.worker.receive({ type: 'ready' }); await h.encoder.ready;
    const done = assert.rejects(h.encoder.finish(), /未能及时结束/); h.expire(30000); await done;
    assert.equal(h.worker.terminated, 1); assert.equal(h.errors.length, 1);
    const unreadable = harness(); unreadable.worker.receive({ type: 'ready' }); await unreadable.encoder.ready;
    unreadable.worker.onmessageerror(); assert.match(unreadable.encoder.error.message, /无法读取/);
    assert.equal(unreadable.worker.terminated, 1);
});
test('停止前取消启动会拒绝就绪，已存在的计时器和线程均释放', async () => {
    const h = harness(); const done = assert.rejects(h.encoder.ready, /已关闭/); h.encoder.destroy(); await done;
    assert.equal(h.timers.size, 0); assert.equal(h.worker.terminated, 1);
});
test('Worker 使用真实 LAME 的结果与旧编码逐字节一致，保留末尾不足一个采样块的音频', () => {
    for (const [sampleRate, bitrate] of [[48000, 16], [44100, 128]]) {
        const messages = [], scope = vm.createContext({ Float32Array, Uint8Array, Int16Array, console });
        scope.self = { postMessage(message) { messages.push(message); } };
        scope.importScripts = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), scope);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../mp3-encoder-worker.js'), 'utf8'), scope);
        const send = data => scope.self.onmessage({ data }); send({ type: 'init', sampleRate, bitrate });
        const legacy = new scope.lamejs.Mp3Encoder(1, sampleRate, bitrate), expected = [];
        const count = sampleRate * 2 + 137;
        for (let offset = 0; offset < count; offset += 2048) {
            const input = new Float32Array(Math.min(2048, count - offset));
            for (let i = 0; i < input.length; i++) input[i] = Math.sin((offset + i) * 2 * Math.PI * 440 / sampleRate) * .2;
            const pcm = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) pcm[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
            expected.push(Buffer.from(legacy.encodeBuffer(pcm))); send({ type: 'encode', samples: input });
        }
        expected.push(Buffer.from(legacy.flush())); send({ type: 'finish' });
        assert.equal(messages[0].type, 'ready'); assert.equal(messages.at(-1).type, 'finished');
        const actual = Buffer.concat(messages.filter(m => m.chunk?.length).map(m => Buffer.from(m.chunk)));
        assert.deepEqual(actual, Buffer.concat(expected));
        const checked = inspectMp3(actual); assert.equal(checked.end, actual.length); assert.ok(checked.seconds > 2);
        send({ type: 'finish' }); assert.equal(messages.at(-1).type, 'error');
    }
});
test('页面不再加载编码库或直接编码，两种入口及未来发布清单都包含 Worker 资源', () => {
    const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(read('index.html'), read('AudioRecorder.html'));
    assert.ok(!/lamejs\.iife\.js/.test(read('index.html')));
    assert.ok(!/encodeBuffer\(|new lamejs/.test(read('AudioRecorder.js')));
    for (const file of ['mp3-encoder.js', 'mp3-encoder-worker.js']) {
        assert.ok(read('.github/workflows/release.yml').includes('"' + file + '"'));
        assert.ok(read('scripts/validate-release.ps1').includes('"' + file + '"'));
    }
});
