/* Ordered PCM/finish messages share one Worker port; buffers are transferred, not cloned. */
(() => {
    'use strict';
    function createEncoder({ sampleRate, bitrate, onChunk, onError = () => {},
        workerUrl = new URL('mp3-encoder-worker.js?audio=worker-encoding', location.href).href,
        Worker: WorkerClass = globalThis.Worker, setTimeout: later = globalThis.setTimeout,
        clearTimeout: cancel = globalThis.clearTimeout, startupTimeout = 10000, finishTimeout = 30000 }) {
        let worker, state = 'starting', failure = null, finishing = null, finishResolve, finishReject, finishTimer;
        let readyResolve, readyReject;
        const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
        const startupTimer = later(() => fail(new Error('MP3 后台编码器启动超时，请刷新页面后重试。')), startupTimeout);
        function terminate() {
            cancel(startupTimer); if (finishTimer !== undefined) cancel(finishTimer);
            if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); worker = null; }
        }
        function fail(error) {
            if (['failed', 'finished', 'closed'].includes(state)) return;
            const wasReady = state !== 'starting'; failure = error; state = 'failed'; terminate();
            readyReject(error); finishReject?.(error);
            if (wasReady) onError(error);
        }
        try {
            if (!WorkerClass) throw new Error('此浏览器无法启动后台 MP3 编码，请使用新版浏览器。');
            worker = new WorkerClass(workerUrl);
            worker.onmessage = ({ data }) => {
                if (['failed', 'finished', 'closed'].includes(state)) return;
                try {
                    if (data.type === 'error') { fail(new Error(data.message || 'MP3 后台编码失败。')); return; }
                    if (data.type === 'ready' && state === 'starting') {
                        cancel(startupTimer); state = 'active'; readyResolve(); return;
                    }
                    if (!['encoded', 'finished'].includes(data.type)) return;
                    if (data.chunk?.byteLength) onChunk(data.chunk);
                    if (data.type === 'finished' && state === 'finishing') {
                        state = 'finished'; terminate(); finishResolve();
                    }
                } catch (error) { fail(error); }
            };
            worker.onerror = event => { event.preventDefault?.(); fail(new Error('MP3 后台编码线程异常，请保留 WebM 或恢复备份。')); };
            worker.onmessageerror = () => fail(new Error('无法读取后台编码结果，请保留 WebM 或恢复备份。'));
            worker.postMessage({ type: 'init', sampleRate, bitrate });
        } catch (error) { fail(error); }
        return Object.freeze({
            type: 'worker', ready,
            get error() { return failure; },
            encode(samples) {
                if (state !== 'active') throw failure || new Error('MP3 编码器当前不能接收音频。');
                if (!samples?.length) return;
                try { worker.postMessage({ type: 'encode', samples }, [samples.buffer]); }
                catch (error) { fail(error); }
            },
            finish() {
                if (finishing) return finishing;
                if (state !== 'active') return Promise.reject(failure || new Error('MP3 编码器当前不能结束录音。'));
                state = 'finishing';
                finishing = new Promise((resolve, reject) => { finishResolve = resolve; finishReject = reject; });
                finishTimer = later(() => fail(new Error('MP3 编码未能及时结束，请下载 WebM 或恢复备份。')), finishTimeout);
                try { worker.postMessage({ type: 'finish' }); } catch (error) { fail(error); }
                return finishing;
            },
            destroy() {
                if (!['finished', 'failed', 'closed'].includes(state)) {
                    const error = new Error('MP3 编码器已关闭。'); readyReject(error); finishReject?.(error);
                }
                state = 'closed'; terminate();
            }
        });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { createEncoder };
    if (typeof window !== 'undefined') window.AudioRecorderMp3 = Object.freeze({ createEncoder });
})();
