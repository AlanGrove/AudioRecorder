/* Only this dedicated worker loads LAME; no encoding runs on the page/audio thread. */
'use strict';
importScripts('lamejs.iife.js');
let encoder = null, finished = false;
self.onmessage = ({ data }) => {
    try {
        if (data.type === 'init') {
            if (encoder || finished) throw new Error('编码器不能重复初始化。');
            encoder = new lamejs.Mp3Encoder(1, data.sampleRate, data.bitrate);
            self.postMessage({ type: 'ready' });
            return;
        }
        if (!encoder || finished) throw new Error('编码器未就绪或已经结束。');
        let encoded;
        if (data.type === 'encode') {
            const input = data.samples;
            if (!(input instanceof Float32Array)) throw new Error('音频采样格式无效。');
            const pcm = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) pcm[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
            encoded = encoder.encodeBuffer(pcm);
        } else if (data.type === 'finish') {
            encoded = encoder.flush();
            finished = true;
            encoder = null;
        } else throw new Error('未知编码操作。');
        // Copy LAME's output before transferring: it may reuse its internal buffer.
        const chunk = new Uint8Array(encoded);
        self.postMessage({ type: finished ? 'finished' : 'encoded', chunk }, [chunk.buffer]);
    } catch (error) {
        finished = true; encoder = null;
        self.postMessage({ type: 'error', message: error.message || 'MP3 后台编码失败。' });
    }
};
