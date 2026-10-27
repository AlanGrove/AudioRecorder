const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');
const { createStore } = require('../recording-library.js');
const { inspectMp3, recoveredRecording, createSession } = require('../recording-recovery.js');
const scope = { console };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lamejs.iife.js'), 'utf8'), scope);
function encode(seconds = 3, rate = 48000, bitrate = 16) {
    const encoder = new scope.lamejs.Mp3Encoder(1, rate, bitrate), parts = [];
    for (let start = 0; start < rate * seconds; start += 2048) {
        const pcm = new Int16Array(Math.min(2048, rate * seconds - start));
        for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 440 * (start + i) / rate) * 6000;
        const data = encoder.encodeBuffer(pcm); if (data.length) parts.push(new Uint8Array(data));
    }
    return { parts, final: new Uint8Array(encoder.flush()) };
}
const metadata = id => ({ id, createdAt: 12345, mp3Name: id + '.mp3', webmName: id + '.webm', sampleRate: 48000, bitrate: 16 });
function session(store, id = 'draft', extra = {}) {
    return createSession({ store, metadata: metadata(id), setInterval: () => 1, clearInterval() {}, ...extra });
}
test('实际 LAME 音频逐块保存，意外关闭重开后恢复完整 MP3 帧和正确保护时长', async () => {
    const factory = new IDBFactory(), store = createStore(factory), progress = [];
    const recording = session(store, 'crashed', { onProgress: seconds => progress.push(seconds) });
    await recording.begin();
    const encoded = encode(4);
    const split = Math.floor(encoded.parts.length / 2);
    encoded.parts.slice(0, split).forEach(part => recording.addMp3(part));
    recording.addWebm(new Blob(['raw-webm-header'])); await recording.flush();
    encoded.parts.slice(split).forEach(part => recording.addMp3(part)); await recording.flush();
    // No encoder flush and no session.stop(): exactly the persisted prefix of a crash.
    await store.close();
    const reopened = createStore(factory), snapshot = await reopened.draft('crashed');
    const recovered = await recoveredRecording(snapshot);
    const bytes = new Uint8Array(await recovered.mp3.blob.arrayBuffer()), checked = inspectMp3(bytes);
    assert.equal(checked.end, bytes.length); assert.ok(checked.seconds > 3 && checked.seconds < 4.2);
    assert.equal(recovered.recovered, true); assert.equal(recovered.webm, undefined);
    assert.match(recovered.mp3.name, /中断恢复\.mp3$/); assert.ok(Math.abs(recovered.duration - snapshot.draft.protectedSeconds) < 0.000001);
    assert.equal(progress.length, 2);
    await reopened.save(recovered, snapshot.draft.nextSequence);
    assert.equal((await reopened.list())[0].recovered, true);
    assert.equal((await reopened.draft('crashed')).draft, undefined);
    assert.equal((await reopened.draft('crashed')).chunks.length, 0);
    assert.equal((await reopened.get('crashed')).webm, null);
    await reopened.close();
});
test('不同采样率和比特率的 MP3 帧可正确校验，不依赖输入采样率假定时长', () => {
    for (const [rate, bitrate] of [[44100,128],[48000,16],[22050,32],[16000,16],[48000,8],[48000,320]]) {
        const data = encode(1, rate, bitrate);
        const bytes = Buffer.concat([...data.parts, data.final]);
        const checked = inspectMp3(bytes);
        assert.equal(checked.end, bytes.length); assert.ok(checked.seconds >= 1 && checked.seconds < 1.3);
    }
});
test('数据库写入失败不前移保护进度，恢复后重试保留原分块顺序且不重复', async () => {
    const store = createStore(new IDBFactory()); let fail = true, errors = 0;
    const adapter = { ...store, appendDraft: (...args) => { if (fail) { fail = false; return Promise.reject(new Error('quota')); } return store.appendDraft(...args); } };
    const progress = [], recording = session(adapter, 'retry', { onProgress: n => progress.push(n), onError: () => errors++ });
    await recording.begin(); const encoded = encode(2);
    encoded.parts.forEach(part => recording.addMp3(part));
    assert.equal(await recording.flush(), false); assert.equal(progress.length, 0); assert.equal(errors, 1);
    assert.equal((await store.draft('retry')).draft.nextSequence, 0);
    recording.addMp3(encoded.final); assert.equal(await recording.flush(), true);
    const snap = await store.draft('retry'), recovered = await recoveredRecording(snap);
    assert.equal(recovered.mp3.blob.size, Buffer.concat([...encoded.parts, encoded.final]).length);
    assert.equal(snap.draft.nextSequence, 1); assert.equal(progress.length, 1);
    await store.close();
});
test('停止时等待在途写入并提交最终缓冲，正常保存原子替换草稿', async () => {
    const store = createStore(new IDBFactory()); let release;
    const gate = new Promise(resolve => { release = resolve; });
    let first = true;
    const adapter = { ...store, appendDraft: async (...args) => { if (first) { first = false; await gate; } return store.appendDraft(...args); } };
    const recording = session(adapter, 'normal'); await recording.begin(); const encoded = encode(2);
    encoded.parts.forEach(p => recording.addMp3(p)); const writing = recording.flush();
    recording.addMp3(encoded.final); recording.addWebm(new Blob(['webm-complete']));
    const stop = recording.stop(); release(); await writing; assert.equal(await stop, true);
    const snap = await store.draft('normal'); assert.equal(snap.draft.state, 'stopped'); assert.equal(snap.draft.nextSequence, 2);
    await store.save({ id: 'normal', mp3: { name:'normal.mp3', blob:new Blob([...encoded.parts, encoded.final]) }, webm:{name:'normal.webm',blob:new Blob(['webm-complete'])} });
    assert.equal((await store.draft('normal')).draft, undefined); assert.equal((await store.draft('normal')).chunks.length, 0);
    assert.equal((await store.list()).length, 1); await store.close();
});
test('恢复前序号改变时拒绝提交，避免用旧快照覆盖新录音数据', async () => {
    const store = createStore(new IDBFactory()); await store.beginDraft(metadata('race'));
    const encoded = encode(1), blob = new Blob([...encoded.parts, encoded.final]);
    await store.appendDraft('race', { sequence:0,seconds:1,mp3:blob }); const stale=await store.draft('race');
    await store.appendDraft('race', { sequence:1,seconds:1,mp3:blob });
    await assert.rejects(store.save(await recoveredRecording(stale), stale.draft.nextSequence));
    assert.equal((await store.list()).length,0); assert.equal((await store.draft('race')).draft.nextSequence,2);
    await assert.rejects(store.appendDraft('race', {sequence:1,seconds:1,mp3:blob}));
    await store.close();
});
test('损坏音频或没有完整帧时恢复失败，备份仍保留；清空已保存列表不删备份', async () => {
    const store = createStore(new IDBFactory()); await store.beginDraft(metadata('corrupt'));
    await store.appendDraft('corrupt',{sequence:0,seconds:0,mp3:new Blob(['invalid'])});
    await assert.rejects(recoveredRecording(await store.draft('corrupt')), /校验/);
    await store.clear(); assert.equal((await store.drafts()).length,1);
    await store.removeDraft('corrupt'); assert.equal((await store.draft('corrupt')).chunks.length,0);
    await store.beginDraft(metadata('short')); await assert.rejects(recoveredRecording(await store.draft('short')),/尚无完整/);
    assert.equal((await store.drafts()).length,1); await store.close();
});
test('数据库升级保留旧版已保存录音', async () => {
    const factory = new IDBFactory();
    await new Promise((resolve,reject)=>{ const r=factory.open('audioRecorderLibrary',1);
        r.onupgradeneeded=()=>{r.result.createObjectStore('records',{keyPath:'id'}).add({id:'legacy',createdAt:1,mp3:{name:'legacy.mp3',size:6},webm:{name:'legacy.webm',size:4},uploads:{},pending:{}});r.result.createObjectStore('audio',{keyPath:'id'}).add({id:'legacy',mp3:new Blob(['legacy']),webm:new Blob(['webm'])});};
        r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);
    });
    const upgraded=createStore(factory); assert.equal(await (await upgraded.get('legacy')).mp3.blob.text(),'legacy');
    assert.deepEqual(await upgraded.drafts(),[]); await upgraded.beginDraft(metadata('new')); assert.equal((await upgraded.list()).length,1);
    await upgraded.close();
});
