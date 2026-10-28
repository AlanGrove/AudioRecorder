const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../input-devices.js');
function harness(saved = '', userAgent = '') {
    const prefs = new Map([['audioRecorderInputDevice', saved]]), notices = [], noticeLevels = [], calls = [];
    const select = { value: '', disabled: false, children: [], addEventListener(_name, fn) { this.change = fn; },
        replaceChildren(...nodes) { this.children = nodes; }, appendChild(node) { this.children.push(node); } };
    const state = { devices: [], error: null, enumeration: null, settings: {} };
    const mediaDevices = {
        enumerateDevices: async () => state.enumeration || state.devices,
        getUserMedia: async constraints => { calls.push(constraints); if (state.error) throw state.error; return { fixture: true, getAudioTracks: () => [{ getSettings: () => state.settings }] }; },
        addEventListener(_name, fn) { this.devicechange = fn; }
    };
    const controller = createController({ mediaDevices, select, storage: { getItem: key => prefs.get(key), setItem: (key, value) => prefs.set(key, value) },
        userAgent, notify: (text, level) => { notices.push(text); noticeLevels.push(level); },
        option: (textContent, value) => ({ textContent, value }) });
    return { controller, select, prefs, notices, noticeLevels, calls, mediaDevices, state };
}
const input = (deviceId, label = '') => ({ kind: 'audioinput', deviceId, label });
test('刷新输入列表不请求麦克风，过滤输出设备和重复默认设备', async () => {
    const h = harness(); h.state.devices = [input('default', '默认'), input('usb', 'USB 麦克风'), input('usb', '重复'), { kind: 'audiooutput', deviceId: 'speaker' }];
    await h.controller.refresh();
    assert.deepEqual(h.select.children.map(n => n.value), ['', 'usb']); assert.equal(h.calls.length, 0);
});
test('设备选择持久保存，录音使用 exact deviceId，默认和指定输入都显式关闭语音处理', async () => {
    const h = harness(); h.state.devices = [input('usb', 'USB')]; await h.controller.refresh();
    h.select.value = 'usb'; h.select.change();
    assert.equal(h.prefs.get('audioRecorderInputDevice'), 'usb');
    const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    await h.controller.getStream(); assert.deepEqual(h.calls[0], { audio: { ...raw, deviceId: { exact: 'usb' } } });
    assert.equal(h.select.disabled, true);
    h.controller.setLocked(false); h.select.value = ''; h.select.change();
    await h.controller.getStream(); assert.deepEqual(h.calls[1], { audio: raw });
});

test('浏览器仍启用音频处理时给出提示，不把成功取得流误报为已恢复声音', async () => {
    const h = harness(); h.state.settings = { echoCancellation: 'all', autoGainControl: true };
    await h.controller.getStream(); assert.match(h.notices.at(-1), /仍有音频处理/);
    h.state.settings = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    h.controller.setLocked(false); await h.controller.getStream(); assert.equal(h.notices.at(-1), '');
});

const edgeAgent = 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

test('Edge 关闭、缺失和未知的音频设置不误报声音异常，录音流和采集约束不变', async () => {
    for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) {
        for (const value of [false, undefined, null, '', 'false', 'disabled', 'unknown', 'true', 0]) {
            const h = harness('', edgeAgent); h.state.settings = { [key]: value };
            const stream = await h.controller.getStream();
            assert.equal(stream.fixture, true);
            assert.equal(h.notices.at(-1), '', `${key}: ${String(value)}`);
            assert.deepEqual(h.calls, [{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }]);
            assert.equal(h.select.disabled, true);
        }
    }
});

test('Edge 明确开启的处理列出实际项目，只显示中性说明，不推断播放声音异常', async () => {
    for (const [settings, labels] of [
        [{ echoCancellation: true }, ['回声消除']],
        [{ echoCancellation: 'all' }, ['回声消除']],
        [{ echoCancellation: 'remote-only' }, ['回声消除']],
        [{ noiseSuppression: true }, ['降噪']],
        [{ autoGainControl: true }, ['自动增益']],
        [{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }, ['回声消除', '降噪', '自动增益']]
    ]) {
        const h = harness('', edgeAgent); h.state.settings = settings;
        await h.controller.getStream();
        for (const label of labels) assert.ok(h.notices.at(-1).includes(label));
        assert.equal(h.noticeLevels.at(-1), 'info');
        assert.doesNotMatch(h.notices.at(-1), /电脑声音可能受影响|请尝试其他输入设备/);
        assert.match(h.notices.at(-1), /试听正常可继续录音/);
    }
    // These mode strings are defined only for echoCancellation, not other flags.
    const h = harness('', edgeAgent); h.state.settings = { noiseSuppression: 'all', autoGainControl: 'remote-only' };
    await h.controller.getStream(); assert.equal(h.notices.at(-1), '');
});

test('Chrome、Firefox、Safari、移动 Edge 和未识别浏览器沿用原检测与提示', async () => {
    for (const userAgent of ['', 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
        'Mozilla/5.0 Firefox/140.0', 'Mozilla/5.0 Version/18.0 Safari/605.1.15',
        'Mozilla/5.0 Chrome/140.0.0.0 EdgA/140.0.0.0']) {
        for (const settings of [{ echoCancellation: 'all' }, { echoCancellation: 'false' },
            { noiseSuppression: true }, { autoGainControl: true }]) {
            const h = harness('', userAgent); h.state.settings = settings;
            await h.controller.getStream();
            assert.equal(h.notices.at(-1), '浏览器报告仍有音频处理开启，电脑声音可能受影响。请尝试其他输入设备并短录音检查。');
            assert.notEqual(h.noticeLevels.at(-1), 'info');
        }
        const h = harness('', userAgent); h.state.settings = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        await h.controller.getStream(); assert.equal(h.notices.at(-1), '');
    }
});
test('未授权时不丢弃以前的选择，授权后显示设备名称', async () => {
    const h = harness('usb'); await h.controller.refresh(); assert.equal(h.select.value, 'usb');
    h.state.devices = [input('usb', 'USB 麦克风')]; await h.controller.refresh();
    assert.equal(h.select.children[1].textContent, 'USB 麦克风'); assert.equal(h.calls.length, 0);
});
test('设备移除后回退默认并提示，正在录音时不切换设备', async () => {
    const h = harness('usb'); h.state.devices = [input('usb', 'USB'), input('built-in', '内置')];
    await h.controller.getStream(); h.state.devices = [input('built-in', '内置')]; await h.controller.refresh();
    assert.equal(h.select.value, 'usb'); assert.equal(h.select.disabled, true);
    h.controller.setLocked(false); await h.controller.refresh();
    assert.equal(h.select.value, ''); assert.match(h.notices.at(-1), /默认输入/);
});
test('设备不可用时释放下拉锁定，不暗中改用其他麦克风采集', async () => {
    const h = harness('removed'); h.state.error = Object.assign(new Error('removed'), { name: 'OverconstrainedError' });
    await assert.rejects(h.controller.getStream());
    assert.equal(h.calls.length, 1); assert.equal(h.select.disabled, false); assert.equal(h.prefs.get('audioRecorderInputDevice'), '');
    assert.match(h.notices.at(-1), /重新选择/);
});
test('拒绝麦克风权限后解除锁定，保留设备偏好供下次尝试', async () => {
    const h = harness('usb'); h.state.error = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    await assert.rejects(h.controller.getStream()); assert.equal(h.select.disabled, false);
    assert.equal(h.prefs.get('audioRecorderInputDevice'), 'usb');
});
test('过时的设备枚举结果不能覆盖新设备列表', async () => {
    const h = harness(); let release; h.state.enumeration = new Promise(resolve => { release = resolve; });
    const old = h.controller.refresh(); h.state.enumeration = null; h.state.devices = [input('new', '新设备')];
    await h.controller.refresh(); release([input('old', '旧设备')]); await old;
    assert.deepEqual(h.select.children.map(n => n.value), ['', 'new']);
});
