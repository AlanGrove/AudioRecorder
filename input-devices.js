/* Enumerating devices never requests microphone access; only Start recording does. */
(() => {
    'use strict';
    function createController({ mediaDevices, select, storage, notify, option, userAgent = globalThis.navigator?.userAgent || '' }) {
        const key = 'audioRecorderInputDevice';
        let preferred = '', locked = false, revision = 0;
        try { preferred = storage.getItem(key) || ''; } catch { /* Preferences are optional. */ }
        function save(value) {
            preferred = value;
            try { storage.setItem(key, value); } catch { /* Recording still works. */ }
        }
        async function refresh() {
            if (!mediaDevices?.enumerateDevices) { notify('此浏览器无法列出输入设备，将使用默认输入。'); return; }
            const current = ++revision;
            try {
                const devices = await mediaDevices.enumerateDevices();
                if (current !== revision) return;
                const seen = new Set();
                const inputs = devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && !seen.has(d.deviceId) && seen.add(d.deviceId));
                const known = devices.some(d => d.kind === 'audioinput' && d.label);
                const missing = preferred && !inputs.some(d => d.deviceId === preferred);
                if (missing && known && !locked) {
                    save(''); notify('所选输入设备已不可用，已切换为默认输入。');
                }
                select.replaceChildren(option('默认输入', ''));
                inputs.forEach((d, index) => select.appendChild(option(d.label || '麦克风 ' + (index + 1), d.deviceId)));
                if (preferred && !inputs.some(d => d.deviceId === preferred)) {
                    const unavailable = option(locked ? '当前录音设备（已移除）' : '已选设备（授权后确认）', preferred);
                    unavailable.disabled = true; select.appendChild(unavailable);
                }
                select.value = preferred; select.disabled = locked;
            } catch { notify('暂时无法读取设备列表。可重试或使用默认输入录音。'); }
        }
        select.addEventListener('change', () => { if (!locked) { save(select.value); notify(''); } });
        mediaDevices?.addEventListener?.('devicechange', () => void refresh());
        function setLocked(value) { locked = value; select.disabled = value; if (!value) void refresh(); }
        return Object.freeze({
            refresh, setLocked,
            async getStream() {
                if (!mediaDevices?.getUserMedia) throw new Error('此浏览器不支持录音，请使用 HTTPS 地址和新版 Chrome。');
                setLocked(true);
                try {
                    // This is a recorder, not a voice call. Preserve loopback/music input
                    // without relying on experimental Chrome-wide command-line flags.
                    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
                    if (preferred) audio.deviceId = { exact: preferred };
                    const stream = await mediaDevices.getUserMedia({ audio });
                    const settings = stream.getAudioTracks?.()[0]?.getSettings?.() || {};
                    const processing = ['echoCancellation', 'noiseSuppression', 'autoGainControl'];
                    if (/\bEdg\//.test(userAgent)) {
                        // Desktop Edge may report strings; an arbitrary string does not
                        // establish that processing is enabled or that playback is affected.
                        const labels = { echoCancellation: '回声消除', noiseSuppression: '降噪', autoGainControl: '自动增益' };
                        const enabled = processing.filter(key => settings[key] === true ||
                            (key === 'echoCancellation' && ['all', 'remote-only'].includes(settings[key])));
                        notify(enabled.length ?
                            `Edge 报告录音输入已启用：${enabled.map(key => labels[key]).join('、')}。试听正常可继续录音。` : '', 'info');
                    } else {
                        // Preserve the existing detection and warning for other browsers.
                        notify(processing.some(key => settings[key] === true || typeof settings[key] === 'string') ?
                            '浏览器报告仍有音频处理开启，电脑声音可能受影响。请尝试其他输入设备并短录音检查。' : '');
                    }
                    void refresh(); // Permission now exposes device labels; keep the chosen input locked.
                    return stream;
                } catch (error) {
                    if (error.name === 'OverconstrainedError' || error.name === 'NotFoundError') {
                        save(''); notify('所选输入设备不可用，请重新选择设备后开始录音。');
                    }
                    setLocked(false); throw error;
                }
            }
        });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { createController };
    if (typeof document === 'undefined') return;
    function init() {
        const select = document.getElementById('inputDevice');
        if (!select) return;
        window.AudioRecorderInputs = createController({
            mediaDevices: navigator.mediaDevices, select, storage: localStorage,
            option: (label, value) => { const node = document.createElement('option'); node.textContent = label; node.value = value; return node; },
            notify: (text, level = 'warning') => {
                const status = document.getElementById('inputDeviceStatus');
                status.textContent = text; status.hidden = !text; status.dataset.level = level;
            }
        });
        void window.AudioRecorderInputs.refresh();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
