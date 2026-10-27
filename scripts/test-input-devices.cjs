const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../input-devices.js');
function harness(saved = '') {
    const prefs = new Map([['audioRecorderInputDevice', saved]]), notices = [], calls = [];
    const select = { value: '', disabled: false, children: [], addEventListener(_name, fn) { this.change = fn; },
        replaceChildren(...nodes) { this.children = nodes; }, appendChild(node) { this.children.push(node); } };
    const state = { devices: [], error: null, enumeration: null, settings: {} };
    const mediaDevices = {
        enumerateDevices: async () => state.enumeration || state.devices,
        getUserMedia: async constraints => { calls.push(constraints); if (state.error) throw state.error; return { fixture: true, getAudioTracks: () => [{ getSettings: () => state.settings }] }; },
        addEventListener(_name, fn) { this.devicechange = fn; }
    };
    const controller = createController({ mediaDevices, select, storage: { getItem: key => prefs.get(key), setItem: (key, value) => prefs.set(key, value) },
        notify: text => notices.push(text), option: (textContent, value) => ({ textContent, value }) });
    return { controller, select, prefs, notices, calls, mediaDevices, state };
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
