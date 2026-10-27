/* Crash protection stores complete MP3 frames and raw WebM chunks locally. */
(() => {
    'use strict';
    function join(parts) {
        const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
        let offset = 0;
        for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
        return out;
    }
    function inspectMp3(bytes) {
        let end = 0, seconds = 0, frames = 0;
        while (bytes.length - end >= 4) {
            const a = bytes[end], b = bytes[end + 1], c = bytes[end + 2];
            const version = (b >> 3) & 3, layer = (b >> 1) & 3, bitrateIndex = c >> 4, rateIndex = (c >> 2) & 3;
            if (a !== 255 || (b & 224) !== 224 || version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
                throw new Error('备份 MP3 数据无法校验，原始备份已保留。');
            }
            const rates = version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
            const rate = [44100,48000,32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
            const length = Math.floor((version === 3 ? 144000 : 72000) * rates[bitrateIndex] / rate) + ((c >> 1) & 1);
            if (end + length > bytes.length) break;
            end += length; frames++; seconds += (version === 3 ? 1152 : 576) / rate;
        }
        return { end, seconds, frames };
    }
    async function recoveredRecording(snapshot) {
        if (!snapshot?.draft) throw new Error('这份中断备份已不存在。');
        const parts = snapshot.chunks.filter(c => c.format === 'mp3').sort((a,b) => a.sequence - b.sequence);
        const bytes = new Uint8Array(await new Blob(parts.map(c => c.blob)).arrayBuffer());
        const checked = inspectMp3(bytes);
        if (!checked.frames) throw new Error('尚无完整的 MP3 音频可恢复，备份已保留。');
        const draft = snapshot.draft;
        return { id: draft.id, createdAt: draft.createdAt, recovered: true, duration: checked.seconds,
            mp3: { name: draft.mp3Name.replace(/\.mp3$/i, '') + '_中断恢复.mp3',
                blob: new Blob([bytes.subarray(0, checked.end)], { type: 'audio/mpeg' }) } };
    }
    function createSession({ store, metadata, onProgress = () => {}, onError = () => {}, interval = 2000,
        setInterval: every = globalThis.setInterval, clearInterval: cancel = globalThis.clearInterval }) {
        let mp3 = [], webm = [], tail = new Uint8Array(), writing = null, timer, sequence = 0, stopped = false;
        async function begin() {
            await store.beginDraft(metadata);
            timer = every(() => void flush(), interval);
            return api;
        }
        function flush() {
            if (writing) return writing;
            const audio = mp3.splice(0), video = webm.splice(0);
            if (!audio.length && !video.length) return Promise.resolve(true);
            writing = (async () => {
                try {
                    const bytes = join([tail, ...audio]);
                    const checked = inspectMp3(bytes);
                    const result = await store.appendDraft(metadata.id, {
                        sequence, seconds: checked.seconds,
                        mp3: checked.end ? new Blob([bytes.subarray(0, checked.end)], { type: 'audio/mpeg' }) : null,
                        webm: video.length ? new Blob(video, { type: 'audio/webm' }) : null
                    });
                    tail = bytes.slice(checked.end); sequence++;
                    onProgress(result.protectedSeconds);
                    return true;
                } catch (error) {
                    mp3.unshift(...audio); webm.unshift(...video); onError(error); return false;
                }
            })().finally(() => { writing = null; });
            return writing;
        }
        const api = Object.freeze({
            id: metadata.id, begin, flush,
            addMp3(data) { if (!stopped && data?.byteLength) mp3.push(new Uint8Array(data)); },
            addWebm(blob) { if (!stopped && blob?.size) webm.push(blob); },
            async stop() {
                stopped = true; cancel(timer);
                if (writing) await writing;
                const saved = await flush();
                await store.stopDraft(metadata.id);
                return saved;
            }
        });
        return api;
    }
    const api = Object.freeze({ inspectMp3, recoveredRecording, createSession });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AudioRecorderRecovery = api;
})();
