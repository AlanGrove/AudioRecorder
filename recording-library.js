/* Local audio lives in IndexedDB, never in localStorage or the OAuth broker. */
(() => {
    'use strict';
    function createStore(factory, name = 'audioRecorderLibrary') {
        let opening;
        function open() {
            if (!opening) opening = new Promise((resolve, reject) => {
                if (!factory) { reject(new Error('浏览器不支持本地录音库。')); return; }
                const request = factory.open(name, 2);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['id', 'format', 'sequence'] }).createIndex('byDraft', 'id');
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
                const tx = db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
                let value;
                tx.oncomplete = () => resolve(value);
                tx.onabort = () => reject(tx.error || new Error('本地录音保存失败。'));
                tx.onerror = () => {}; // Abort is the definitive failure, including quota errors.
                try { action(tx, result => { value = result; }); }
                catch (error) { tx.abort(); reject(error); }
            });
        }
        function deleteDraft(tx, id) {
            tx.objectStore('drafts').delete(id);
            const request = tx.objectStore('chunks').index('byDraft').openCursor(id);
            request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
        }
        return Object.freeze({
            async save(recording, expectedSequence) {
                if (!recording?.id || !recording.mp3?.blob?.size || (!recording.recovered && !recording.webm?.blob?.size)) throw new Error('录音数据不完整。');
                const meta = { id: recording.id, createdAt: recording.createdAt || Date.now(), uploads: {}, pending: {},
                    recovered: recording.recovered === true, duration: recording.duration || 0 };
                for (const format of ['mp3', 'webm']) meta[format] = recording[format]?.blob?.size ? { name: recording[format].name, size: recording[format].blob.size } : null;
                return transaction(['records', 'audio', 'drafts', 'chunks'], 'readwrite', tx => {
                    function commit() {
                        tx.objectStore('records').add(meta);
                        tx.objectStore('audio').add({ id: recording.id, mp3: recording.mp3.blob, webm: recording.webm?.blob || null });
                        deleteDraft(tx, recording.id);
                    }
                    if (expectedSequence === undefined) commit();
                    else tx.objectStore('drafts').get(recording.id).onsuccess = e => {
                        if (!e.target.result || e.target.result.nextSequence !== expectedSequence) { tx.abort(); return; }
                        commit();
                    };
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
                        if (meta && audio) done({ ...meta, mp3: { ...meta.mp3, blob: audio.mp3 }, webm: audio.webm ? { ...meta.webm, blob: audio.webm } : null });
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
            async beginDraft(metadata) {
                return transaction(['drafts'], 'readwrite', tx => tx.objectStore('drafts').add({ ...metadata,
                    state: 'recording', nextSequence: 0, protectedSeconds: 0, mp3Bytes: 0, webmBytes: 0, updatedAt: Date.now() }));
            },
            async appendDraft(id, batch) {
                return transaction(['drafts', 'chunks'], 'readwrite', (tx, done) => {
                    tx.objectStore('drafts').get(id).onsuccess = e => {
                        const draft = e.target.result;
                        if (!draft || draft.nextSequence !== batch.sequence || draft.state !== 'recording') { tx.abort(); return; }
                        for (const format of ['mp3', 'webm']) if (batch[format]?.size) {
                            tx.objectStore('chunks').add({ id, format, sequence: batch.sequence, blob: batch[format] });
                            draft[format + 'Bytes'] += batch[format].size;
                        }
                        draft.protectedSeconds += batch.seconds; draft.nextSequence++; draft.updatedAt = Date.now();
                        tx.objectStore('drafts').put(draft); done(draft);
                    };
                });
            },
            async stopDraft(id) {
                return transaction(['drafts'], 'readwrite', tx => {
                    tx.objectStore('drafts').get(id).onsuccess = e => {
                        if (e.target.result) tx.objectStore('drafts').put({ ...e.target.result, state: 'stopped', updatedAt: Date.now() });
                    };
                });
            },
            async drafts() {
                return transaction(['drafts'], 'readonly', (tx, done) => {
                    tx.objectStore('drafts').getAll().onsuccess = e => done(e.target.result.sort((a,b) => b.createdAt - a.createdAt));
                });
            },
            async draft(id) {
                return transaction(['drafts', 'chunks'], 'readonly', (tx, done) => {
                    const result = {};
                    tx.objectStore('drafts').get(id).onsuccess = e => { result.draft = e.target.result; done(result); };
                    tx.objectStore('chunks').index('byDraft').getAll(id).onsuccess = e => { result.chunks = e.target.result; done(result); };
                });
            },
            async removeDraft(id) { return transaction(['drafts', 'chunks'], 'readwrite', tx => deleteDraft(tx, id)); },
            async close() { if (opening) (await opening).close(); opening = null; }
        });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { createStore };
    if (typeof document === 'undefined') return;
    const store = createStore(window.indexedDB);
    const el = id => document.getElementById(id);
    const busy = new Map();
    const activeSessions = new Map();
    let saving = 0, clearing = false, playerUrl = '', refreshVersion = 0;
    let reconciling = null;
    const clockText = seconds => {
        const s = Math.max(0, Math.floor(seconds));
        return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
    };
    function protection(text, error = false) {
        el('recordingProtection').hidden = !text;
        el('recordingProtection').textContent = text;
        el('recordingProtection').classList.toggle('is-error', error);
    }
    async function draftLock(id, action) {
        if (activeSessions.has(id)) throw new Error('这份录音仍在录制，请先停止录音。');
        if (!navigator.locks) {
            const snapshot = await store.draft(id);
            if (snapshot.draft?.state === 'recording' && Date.now() - snapshot.draft.updatedAt < 15000) throw new Error('备份可能正在其他标签页录制，请关闭该页后稍候重试。');
            return action();
        }
        return navigator.locks.request('audio-recorder-draft:' + id, { ifAvailable: true }, lock => {
            if (!lock) throw new Error('这份录音正在其他标签页使用，请先停止录音。');
            return action();
        });
    }
    async function holdDraft(id) {
        if (!navigator.locks) return () => {};
        let release;
        await new Promise((resolve, reject) => {
            void navigator.locks.request('audio-recorder-draft:' + id, { ifAvailable: true }, async lock => {
                if (!lock) { reject(new Error('录音备份正在使用。')); return; }
                const held = new Promise(done => { release = done; }); resolve(); await held;
            }).catch(reject);
        });
        return release;
    }
    function download(blob, name) {
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    async function recoverDraft(id, downloadOnly = false) {
        await draftLock(id, async () => {
            saving++;
            try {
                const snapshot = await store.draft(id);
                const recording = await window.AudioRecorderRecovery.recoveredRecording(snapshot);
                if (downloadOnly) { download(recording.mp3.blob, recording.mp3.name); status('已下载保存的 MP3 部分，原始备份保留。'); }
                else {
                    await store.save(recording, snapshot.draft.nextSequence);
                    status('中断录音已恢复到列表。可先试听，再上传。');
                }
            } finally { saving--; }
        });
        await refresh();
    }
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
            download(file.blob, file.name);
        }
    }
    async function refresh() {
        const version = ++refreshVersion;
        try {
            const [records, drafts, locks] = await Promise.all([store.list(), store.drafts(), navigator.locks?.query?.()]);
            if (version !== refreshVersion) return;
            const rows = el('libraryRows'); rows.replaceChildren();
            const recoveryRows = el('libraryRecoveryRows'); recoveryRows.replaceChildren();
            let interrupted = 0;
            for (const draft of drafts) {
                const active = activeSessions.has(draft.id) || locks?.held.some(lock => lock.name === 'audio-recorder-draft:' + draft.id) ||
                    (!navigator.locks && draft.state === 'recording' && Date.now() - draft.updatedAt < 15000);
                if (active) continue;
                interrupted++;
                const card = document.createElement('article'); card.className = 'library-row library-recovery-row';
                const title = document.createElement('strong'); title.textContent = draft.mp3Name; card.appendChild(title);
                const info = document.createElement('p'); info.className = 'library-row-meta';
                info.textContent = '意外中断 · 已保护 ' + clockText(draft.protectedSeconds) + ' · ' + new Date(draft.createdAt).toLocaleString(); card.appendChild(info);
                const actions = document.createElement('div'); actions.className = 'library-row-actions';
                const recover = button('恢复到列表', () => recoverDraft(draft.id));
                const save = button('下载已保存部分', () => recoverDraft(draft.id, true));
                recover.disabled = save.disabled = !draft.mp3Bytes;
                actions.append(recover, save);
                if (draft.webmBytes) actions.appendChild(button('下载 WebM 原始备份', () => draftLock(draft.id, async () => {
                    const data = await store.draft(draft.id);
                    download(new Blob(data.chunks.filter(c => c.format === 'webm').sort((a,b) => a.sequence - b.sequence).map(c => c.blob), {type:'audio/webm'}), draft.webmName.replace(/\.webm$/i, '') + '_中断原始备份.webm');
                    status('已下载 WebM 原始分块备份，不保证能直接播放。');
                })));
                const remove = button('删除备份', () => { confirm.hidden = false; });
                actions.appendChild(remove); card.appendChild(actions);
                const confirm = document.createElement('div'); confirm.className = 'library-clear-confirm'; confirm.hidden = true;
                const warning = document.createElement('p'); warning.textContent = '删除后无法恢复这份中断备份，确定删除？';
                confirm.append(warning, button('取消', () => { confirm.hidden = true; }), button('确认删除备份', async () => {
                    await draftLock(draft.id, () => store.removeDraft(draft.id)); await refresh();
                }));
                card.appendChild(confirm); recoveryRows.appendChild(card);
            }
            el('recoveryNotice').hidden = !interrupted;
            el('recoveryNoticeText').textContent = '发现 ' + interrupted + ' 份中断录音，可恢复已保存部分。';
            let total = drafts.reduce((sum, draft) => sum + draft.mp3Bytes + draft.webmBytes, 0);
            for (const record of records) {
                total += record.mp3.size + (record.webm?.size || 0);
                const row = document.createElement('article'); row.className = 'library-row';
                const heading = document.createElement('div'); heading.className = 'library-row-heading';
                const name = document.createElement('span'); name.className = 'library-row-name'; name.textContent = record.mp3.name;
                heading.appendChild(name);
                const uploaded = record.uploads?.mp3 || record.uploads?.webm;
                const pendingFormat = ['mp3', 'webm'].find(format => record.pending?.[format] && !record.uploads?.[format]);
                const running = busy.get(record.id);
                const cloud = uploaded ? button('分享链接', () => copyLink('https://drive.google.com/file/d/' + encodeURIComponent(uploaded.id) + '/view'), 'library-cloud-action') :
                    button(running ? '上传中…' : pendingFormat ? '继续上传' : '上传', async () => {
                        status('正在准备上传…');
                        const recording = await store.get(record.id);
                        if (!recording) throw new Error('这份录音已从本地列表移除。');
                        const result = await window.AudioRecorderDrive.uploadRecording(recording, pendingFormat || (record.recovered && !record.webm ? 'mp3' : undefined));
                        status(result ? '上传完成，点击名称右侧的分享链接可复制。' : '上传尚未确认完成，本地录音保留。可继续上传或检查云端连接。', !result);
                        await refresh();
                    }, 'library-cloud-action');
                cloud.disabled = Boolean(running) || clearing;
                if (uploaded) cloud.title = '点击复制 Google Drive 文件链接';
                heading.appendChild(cloud); row.appendChild(heading);
                if (uploaded && pendingFormat) heading.appendChild(button('继续上传 ' + pendingFormat.toUpperCase(), async () => {
                    const recording = await store.get(record.id);
                    if (recording) await window.AudioRecorderDrive.uploadRecording(recording, pendingFormat);
                    await refresh();
                }, 'library-cloud-action'));
                const meta = document.createElement('p'); meta.className = 'library-row-meta';
                meta.textContent = new Date(record.createdAt).toLocaleString() + ' · ' + (record.mp3.size / 1024 / 1024).toFixed(2) + ' MB MP3' +
                    (record.recovered ? ' · 中断恢复 ' + clockText(record.duration) : '') +
                    (uploaded ? ' · 已上传 ' + (record.uploads?.mp3 ? 'MP3' : 'WEBM') : pendingFormat ? ' · 上次上传未完成' : ' · 保存在本机');
                row.appendChild(meta);
                const actions = document.createElement('div'); actions.className = 'library-row-actions';
                actions.append(button('播放', () => fileAction(record.id, 'mp3', true)), button('下载 MP3', () => fileAction(record.id, 'mp3', false)));
                if (record.webm?.size) actions.appendChild(button('下载 WEBM', () => fileAction(record.id, 'webm', false)));
                row.appendChild(actions); rows.appendChild(row);
            }
            el('libraryCount').textContent = records.length + ' 份录音 · 本地占用 ' + (total / 1024 / 1024).toFixed(2) + ' MB';
            el('libraryClear').disabled = !records.length || clearing || saving > 0 || activeSessions.size > 0 || Boolean(window.AudioRecorderDrive?.isBusy());
        } catch { storageError(); }
    }
    window.AudioRecorderLibrary = Object.freeze({
        async beginRecording(metadata) {
            let release;
            protection('正在建立自动保存保护…');
            try {
                release = await holdDraft(metadata.id);
                let protectedSeconds = 0;
                const session = window.AudioRecorderRecovery.createSession({ store, metadata,
                    onProgress: seconds => { protectedSeconds = seconds; protection('已保护至 ' + clockText(seconds)); },
                    onError: () => { protection('保存失败，仅保护至 ' + clockText(protectedSeconds), true); storageError(); }
                });
                await session.begin();
                const active = { ...session, release };
                activeSessions.set(metadata.id, active); protection('已保护至 00:00:00');
                return active;
            } catch { release?.(); protection('自动保存不可用，请及时停止并下载备份。', true); storageError(); return null; }
        },
        async finishRecording(session, recording) {
            saving++;
            try {
                if (session) await session.stop();
                await store.save(recording); protection('完整录音已保存到本地列表。'); return true;
            } catch { storageError(); protection('完整保存失败，中断备份保留。请先下载录音。', true); return false; }
            finally { session?.release(); activeSessions.delete(session?.id); saving--; void refresh(); }
        },
        async abandonRecording(session) {
            if (!session) return;
            try { await session.stop(); } catch { storageError(); }
            finally { session.release(); activeSessions.delete(session.id); void refresh(); }
        },
        async save(recording) {
            saving++;
            try { await store.save(recording); void refresh(); return true; }
            catch { storageError(); return false; }
            finally { saving--; }
        },
        async checkpoint(id, format, fileId, owner) {
            try { return await store.patch(id, record => { record.pending[format] = { ...record.pending[format], fileId, owner }; }); }
            catch { storageError(); return false; }
        },
        async queueUpload(id, format, folderName) {
            try { return await store.patch(id, record => { record.pending[format] = { ...record.pending[format], folderName, status: 'queued' }; }); }
            catch { storageError(); return false; }
        },
        reconcileUploads() {
            if (reconciling) return reconciling;
            reconciling = (async () => {
                try {
                    for (const record of await store.list()) for (const format of ['mp3','webm']) {
                        if (record.pending?.[format]?.fileId && !busy.has(record.id)) await window.AudioRecorderDrive?.reconcileRecording(record, format);
                    }
                } catch { /* No upload is started automatically; the Continue button remains. */ }
                finally { reconciling = null; void refresh(); }
            })();
            return reconciling;
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
            status(''); el('libraryClearConfirm').hidden = true; void refresh(); void window.AudioRecorderLibrary.reconcileUploads();
        });
        el('recoveryOpen').addEventListener('click', () => el('recordingListButton').click());
        el('libraryClose').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => { stopPlayer(); el('recordingListButton').focus(); });
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
        el('libraryClear').addEventListener('click', () => { el('libraryClearConfirm').hidden = false; });
        el('libraryClearCancel').addEventListener('click', () => { el('libraryClearConfirm').hidden = true; });
        el('libraryClearConfirmButton').addEventListener('click', async () => {
            if (clearing || saving || activeSessions.size || window.AudioRecorderDrive?.isBusy()) { status('请等待录音保存或上传完成后再清空。', true); return; }
            clearing = true; el('libraryClearConfirmButton').disabled = true;
            try {
                await store.clear(); window.AudioRecorderDrive?.clearLibraryQueue(); stopPlayer();
                el('libraryClearConfirm').hidden = true; el('libraryCopyFallback').hidden = true;
                status('本地录音列表已清空，云端文件保留。');
            } catch { storageError(); }
            finally { clearing = false; el('libraryClearConfirmButton').disabled = false; await refresh(); }
        });
        window.addEventListener('beforeunload', event => { if (saving) { event.preventDefault(); event.returnValue = ''; } });
        window.addEventListener('focus', () => void refresh());
        void refresh();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
