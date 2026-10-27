const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createStore } = require('../recording-library.js');
function recording(id, createdAt = 1) {
    return { id, createdAt,
        mp3: { name: id + '.mp3', blob: new Blob(['mp3-' + id], { type: 'audio/mpeg' }) },
        webm: { name: id + '.webm', blob: new Blob(['webm-' + id], { type: 'audio/webm' }) } };
}
test('录音 Blob 跨数据库重开保留，列表只读取元数据并按新到旧排列', async () => {
    const factory = new IDBFactory();
    let store = createStore(factory);
    await store.save(recording('older', 10)); await store.save(recording('newer', 20));
    await store.close(); store = createStore(factory);
    const rows = await store.list();
    assert.deepEqual(rows.map(r => r.id), ['newer', 'older']);
    assert.equal(rows[0].mp3.blob, undefined);
    const saved = await store.get('newer');
    assert.equal(await saved.mp3.blob.text(), 'mp3-newer');
    assert.equal(await saved.webm.blob.text(), 'webm-newer');
    await store.close();
});
test('录音保存事务失败不覆盖已有音频和上传信息', async () => {
    const store = createStore(new IDBFactory());
    await store.save(recording('same'));
    await store.patch('same', r => { r.uploads.mp3 = { id: 'cloud-original' }; });
    await assert.rejects(store.save({ ...recording('same'), mp3: { name: 'replacement.mp3', blob: new Blob(['changed']) } }));
    const saved = await store.get('same');
    assert.equal(await saved.mp3.blob.text(), 'mp3-same');
    assert.equal(saved.uploads.mp3.id, 'cloud-original');
    await store.close();
});
test('并发保存不同格式的上传结果不会覆盖彼此，跨重开保留链接信息', async () => {
    const factory = new IDBFactory(), store = createStore(factory);
    await store.save(recording('one'));
    await Promise.all([
        store.patch('one', r => { r.uploads.mp3 = { id: 'mp3-cloud' }; }),
        store.patch('one', r => { r.uploads.webm = { id: 'webm-cloud' }; })
    ]);
    await store.close();
    const reopened = createStore(factory), saved = await reopened.get('one');
    assert.equal(saved.uploads.mp3.id, 'mp3-cloud'); assert.equal(saved.uploads.webm.id, 'webm-cloud');
    await reopened.close();
});
test('清空同时删除文件和元数据，延迟上传回写不能复活已清空的录音', async () => {
    const store = createStore(new IDBFactory());
    await store.save(recording('one')); await store.clear();
    assert.equal(await store.patch('one', r => { r.uploads.mp3 = { id: 'late' }; }), false);
    assert.deepEqual(await store.list(), []); assert.equal(await store.get('one'), undefined);
    await store.save(recording('one')); // Audio store was also cleared; add would otherwise fail.
    assert.equal(await (await store.get('one')).webm.blob.text(), 'webm-one');
    await store.close();
});
test('浏览器不支持数据库或音频数据不完整时明确失败', async () => {
    await assert.rejects(createStore(undefined).list(), /不支持/);
    const store = createStore(new IDBFactory());
    await assert.rejects(store.save({ id: 'empty' }), /不完整/);
    assert.deepEqual(await store.list(), []); await store.close();
});
