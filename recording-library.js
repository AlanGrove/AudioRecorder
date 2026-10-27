/* Local audio lives in IndexedDB, never in localStorage or the OAuth broker. */
(() => {
    'use strict';
    function createStore(factory, name = 'audioRecorderLibrary') {
        let opening;
        function open() {
            if (!opening) opening = new Promise((resolve, reject) => {
                if (!factory) { reject(new Error('浏览器不支持本地录音库。')); return; }
                const request = factory.open(name, 1);
                request.onupgradeneeded = () => {
                    request.result.createObjectStore('records', { keyPath: 'id' });
                    request.result.createObjectStore('audio', { keyPath: 'id' });
                };
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('请关闭其他录音器标签页后重试。'));
                request.onsuccess = () => {
                    const db = request.result;
                    db.onversionchange = () => { db.close(); opening = null; };
                    resolve(db);
                };
            }).catch(error => { opening = null; throw error; });
            return opening;
        }
        async function transaction(stores, mode, action) {
            const db = await open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(stores, mode);
                let value;
                tx.oncomplete = () => resolve(value);
                tx.onabort = () => reject(tx.error || new Error('本地录音保存失败。'));
                tx.onerror = () => {}; // Abort is the definitive failure, including quota errors.
                try { action(tx, result => { value = result; }); }
                catch (error) { tx.abort(); reject(error); }
            });
        }
        return Object.freeze({
            async save(recording) {
                if (!recording?.id || !recording.mp3?.blob?.size || !recording.webm?.blob?.size) throw new Error('录音数据不完整。');
                const meta = { id: recording.id, createdAt: recording.createdAt || Date.now(), uploads: {}, pending: {} };
                for (const format of ['mp3', 'webm']) meta[format] = { name: recording[format].name, size: recording[format].blob.size };
                return transaction(['records', 'audio'], 'readwrite', tx => {
                    tx.objectStore('records').add(meta);
                    tx.objectStore('audio').add({ id: recording.id, mp3: recording.mp3.blob, webm: recording.webm.blob });
                });
            },
            async list() {
                return transaction(['records'], 'readonly', (tx, done) => {
                    tx.objectStore('records').getAll().onsuccess = e => done(e.target.result.sort((a, b) => b.createdAt - a.createdAt));
                });
            },
            async get(id) {
                return transaction(['records', 'audio'], 'readonly', (tx, done) => {
                    let meta, audio;
                    function finish() {
                        if (meta && audio) done({ ...meta, mp3: { ...meta.mp3, blob: audio.mp3 }, webm: { ...meta.webm, blob: audio.webm } });
                    }
                    tx.objectStore('records').get(id).onsuccess = e => { meta = e.target.result; finish(); };
                    tx.objectStore('audio').get(id).onsuccess = e => { audio = e.target.result; finish(); };
                });
            },
            async patch(id, change) {
                return transaction(['records'], 'readwrite', (tx, done) => {
                    const store = tx.objectStore('records');
                    store.get(id).onsuccess = e => {
                        if (!e.target.result) { done(false); return; } // Never recreate cleared audio.
                        const record = e.target.result;
                        change(record);
                        store.put(record);
                        done(true);
                    };
                });
            },
            async clear() {
                return transaction(['records', 'audio'], 'readwrite', tx => {
                    tx.objectStore('records').clear(); tx.objectStore('audio').clear();
                });
            },
            async close() { if (opening) (await opening).close(); opening = null; }
        });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { createStore };
    if (typeof document === 'undefined') return;
    const store = createStore(window.indexedDB);
    const el = id => document.getElementById(id);
    const busy = new Map();
    let saving = 0, clearing = false, playerUrl = '', refreshVersion = 0;
    function status(text, error = false) {
        el('libraryStatus').textContent = text;
        el('libraryStatus').classList.toggle('is-error', error);
    }
    function storageError() {
        el('libraryNotice').textContent = '录音库无法保存或读取，可能是浏览器空间不足或存储受限。请先下载录音备份。';
        el('libraryNotice').hidden = false;
        status('无法访问本地录音库，请先下载录音备份。', true);
    }
    function stopPlayer() {
        const player = el('libraryPlayer');
        player.pause(); player.removeAttribute('src'); player.load(); player.hidden = true;
        if (playerUrl) URL.revokeObjectURL(playerUrl);
        playerUrl = '';
    }
    async function copyLink(url) {
        try {
            try { await navigator.clipboard.writeText(url); }
            catch {
                const input = el('libraryCopyFallback');
                input.value = url; input.hidden = false; input.focus(); input.select();
                if (!document.execCommand('copy')) throw new Error('copy');
            }
            el('libraryCopyFallback').hidden = true;
            status('分享链接已复制。');
        } catch { status('请选中下方链接手动复制。'); }
    }
    function button(label, action, className = '') {
        const node = document.createElement('button');
        node.type = 'button'; node.textContent = label; node.className = className;
        node.addEventListener('click', () => void Promise.resolve().then(action).catch(error => status(error.message || '操作失败，请重试。', true)));
        return node;
    }
    async function fileAction(id, format, play) {
        const recording = await store.get(id);
        if (!recording) throw new Error('这份录音已从本地列表移除。');
        const file = recording[format];
        if (play) {
            stopPlayer(); playerUrl = URL.createObjectURL(file.blob);
            const player = el('libraryPlayer'); player.src = playerUrl; player.hidden = false;
            await player.play();
            status('正在播放：' + file.name);
        } else {
            const url = URL.createObjectURL(file.blob), link = document.createElement('a');
            link.href = url; link.download = file.name; document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
    }
    async function refresh() {
        const version = ++refreshVersion;
        try {
            const records = await store.list();
            if (version !== refreshVersion) return;
            const rows = el('libraryRows'); rows.replaceChildren();
            let total = 0;
            for (const record of records) {
                total += record.mp3.size + record.webm.size;
                const row = document.createElement('article'); row.className = 'library-row';
                const heading = document.createElement('div'); heading.className = 'library-row-heading';
                const name = document.createElement('span'); name.className = 'library-row-name'; name.textContent = record.mp3.name;
                heading.appendChild(name);
                const uploaded = record.uploads?.mp3 || record.uploads?.webm;
                const running = busy.get(record.id);
                const cloud = uploaded ? button('分享链接', () => copyLink('https://drive.google.com/file/d/' + encodeURIComponent(uploaded.id) + '/view'), 'library-cloud-action') :
                    button(running ? '上传中…' : '上传', async () => {
                        status('正在准备上传…');
                        const recording = await store.get(record.id);
                        if (!recording) throw new Error('这份录音已从本地列表移除。');
                        const result = await window.AudioRecorderDrive.uploadRecording(recording);
                        status(result ? '上传完成，点击名称右侧的分享链接可复制。' : '上传未完成，请连接 Google Drive 后重试。', !result);
                        await refresh();
                    }, 'library-cloud-action');
                cloud.disabled = Boolean(running) || clearing;
                if (uploaded) cloud.title = '点击复制 Google Drive 文件链接';
                heading.appendChild(cloud); row.appendChild(heading);
                const meta = document.createElement('p'); meta.className = 'library-row-meta';
                meta.textContent = new Date(record.createdAt).toLocaleString() + ' · ' + (record.mp3.size / 1024 / 1024).toFixed(2) + ' MB MP3' + (uploaded ? ' · 已上传 ' + (record.uploads?.mp3 ? 'MP3' : 'WEBM') : ' · 保存在本机');
                row.appendChild(meta);
                const actions = document.createElement('div'); actions.className = 'library-row-actions';
                actions.append(button('播放', () => fileAction(record.id, 'mp3', true)), button('下载 MP3', () => fileAction(record.id, 'mp3', false)), button('下载 WEBM', () => fileAction(record.id, 'webm', false)));
                row.appendChild(actions); rows.appendChild(row);
            }
            el('libraryCount').textContent = records.length + ' 份录音 · 本地占用 ' + (total / 1024 / 1024).toFixed(2) + ' MB';
            el('libraryClear').disabled = !records.length || clearing || saving > 0 || Boolean(window.AudioRecorderDrive?.isBusy());
        } catch { storageError(); }
    }
    window.AudioRecorderLibrary = Object.freeze({
        async save(recording) {
            saving++;
            try { await store.save(recording); void refresh(); return true; }
            catch { storageError(); return false; }
            finally { saving--; }
        },
        async checkpoint(id, format, fileId, owner) {
            try { return await store.patch(id, record => { record.pending[format] = { fileId, owner }; }); }
            catch { storageError(); return false; }
        },
        async uploaded(id, format, result, owner) {
            try {
                await store.patch(id, record => { record.uploads[format] = { id: result.id, owner }; delete record.pending[format]; });
            } catch { storageError(); }
            void refresh();
        },
        setUploadState(id, state) { if (state) busy.set(id, state); else busy.delete(id); void refresh(); },
        isClearing: () => clearing,
        refresh
    });
    function init() {
        const dialog = el('recordingLibrary');
        el('recordingListButton').addEventListener('click', () => {
            if (!dialog.open) dialog.showModal();
            status(''); el('libraryClearConfirm').hidden = true; void refresh();
        });
        el('libraryClose').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => { stopPlayer(); el('recordingListButton').focus(); });
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
        el('libraryClear').addEventListener('click', () => { el('libraryClearConfirm').hidden = false; });
        el('libraryClearCancel').addEventListener('click', () => { el('libraryClearConfirm').hidden = true; });
        el('libraryClearConfirmButton').addEventListener('click', async () => {
            if (clearing || saving || window.AudioRecorderDrive?.isBusy()) { status('请等待录音保存或上传完成后再清空。', true); return; }
            clearing = true; el('libraryClearConfirmButton').disabled = true;
            try {
                await store.clear(); window.AudioRecorderDrive?.clearLibraryQueue(); stopPlayer();
                el('libraryClearConfirm').hidden = true; el('libraryCopyFallback').hidden = true;
                status('本地录音列表已清空，云端文件保留。');
            } catch { storageError(); }
            finally { clearing = false; el('libraryClearConfirmButton').disabled = false; await refresh(); }
        });
        window.addEventListener('beforeunload', event => { if (saving) { event.preventDefault(); event.returnValue = ''; } });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
