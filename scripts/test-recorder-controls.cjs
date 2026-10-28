const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createButtonControls, createRecordingClock } = require('../recorder-controls.js');

function gestures() {
    class Target {
        constructor() {
            this.events = new Map(); this.hidden = false; this.attributes = {}; this.title = '';
            const classes = new Set();
            this.classList = { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) };
        }
        addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn); }
        removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
        setAttribute(name, value) { this.attributes[name] = value; }
        getAttribute(name) { return this.attributes[name] ?? null; }
        contains(target) { return target === this.child; }
        focus() { state.focus = this; }
        fire(name, values = {}) {
            const e = { target: this, button: 0, pointerId: 1, isPrimary: true, clientX: 0, clientY: 0,
                detail: 1, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...values };
            this.events.get(name)?.forEach(fn => fn(e)); return e;
        }
    }
    const state = { active: true, activated: 0, stopped: 0, focus: null }, button = new Target(), menu = new Target(),
        stopButton = new Target(), doc = new Target(), win = new Target();
    menu.child = stopButton;
    const hint = { textContent: '单击暂停 · 长按更多' };
    button.setAttribute('aria-label', '暂停录音'); button.title = '单击暂停录音；长按 0.8 秒展开停止菜单';
    let clock = 0, next = 0; const timers = new Map();
    const controls = createButtonControls({ button, menu, stopButton, hint, document: doc, window: win,
        onActivate() { state.activated++; }, onStop() { state.stopped++; }, isActive: () => state.active,
        setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: clock + delay }); return id; },
        clearTimeout(id) { timers.delete(id); } });
    return { button, menu, stopButton, hint, doc, win, controls, state,
        advance(ms) { clock += ms; for (const [id, t] of timers) if (t.at <= clock) { timers.delete(id); t.fn(); } },
        release() { doc.fire('pointerup'); button.fire('click'); } };
}
test('单击触发暂停/继续；长按不足 800ms 不展开', () => {
    const h = gestures(); h.button.fire('pointerdown'); h.advance(799);
    assert.equal(h.menu.hidden, true); h.release(); assert.equal(h.state.activated, 1);
    h.advance(1); assert.equal(h.menu.hidden, true);
});
test('长按 800ms 展开，松手不误触暂停；菜单外点击只收起', () => {
    const h = gestures(); h.button.fire('pointerdown'); h.advance(800);
    assert.equal(h.menu.hidden, false); assert.equal(h.button.attributes['aria-expanded'], 'true');
    assert.equal(h.state.focus, h.stopButton); h.release(); assert.equal(h.state.activated, 0);
    h.doc.fire('pointerdown'); assert.equal(h.menu.hidden, true); assert.equal(h.state.stopped, 0);
    assert.equal(h.button.classList.contains('stop-ready'), false);
    assert.equal(h.button.getAttribute('aria-label'), '暂停录音'); assert.equal(h.hint.textContent, '单击暂停 · 长按更多');
});
test('长按后圆按钮变为停止，松手不停止，再次单击只停止一次且不触发暂停', () => {
    const h = gestures(); h.button.fire('pointerdown'); h.advance(800);
    assert.equal(h.button.classList.contains('stop-ready'), true);
    assert.equal(h.button.getAttribute('aria-label'), '停止并保存'); assert.equal(h.hint.textContent, '单击停止并保存');
    h.release(); assert.equal(h.state.stopped, 0);
    h.button.fire('pointerdown'); h.release();
    assert.equal(h.state.stopped, 1); assert.equal(h.state.activated, 0); assert.equal(h.menu.hidden, true);
});
test('暂停状态取消停止时恢复继续按钮，下一次单击仍执行继续', () => {
    const h = gestures(); h.button.setAttribute('aria-label', '继续录音'); h.hint.textContent = '单击继续 · 长按更多';
    h.button.fire('pointerdown'); h.advance(800); h.release(); h.doc.fire('pointerdown');
    assert.equal(h.button.getAttribute('aria-label'), '继续录音'); assert.equal(h.hint.textContent, '单击继续 · 长按更多');
    h.button.fire('pointerdown'); h.release(); assert.equal(h.state.activated, 1); assert.equal(h.state.stopped, 0);
});
test('触屏原生上下文菜单不能提前绕过 800ms 阈值', () => {
    const h = gestures(); h.button.fire('pointerdown'); h.advance(500);
    assert.equal(h.button.fire('contextmenu', { pointerType: 'touch' }).prevented, true);
    assert.equal(h.menu.hidden, true); h.advance(300); assert.equal(h.menu.hidden, false);
});
test('停止只能在菜单展开且录音活跃时执行一次', () => {
    const h = gestures(); h.stopButton.fire('click'); assert.equal(h.state.stopped, 0);
    h.button.fire('pointerdown'); h.advance(800); h.release(); h.stopButton.fire('click'); h.stopButton.fire('click');
    assert.equal(h.state.stopped, 1); assert.equal(h.menu.hidden, true);
    h.state.active = false; h.button.fire('pointerdown'); h.advance(1000); assert.equal(h.menu.hidden, true);
});
test('移动、取消和窗口失焦取消长按，键盘仍可正常操作', () => {
    for (const cancel of [h => h.doc.fire('pointermove', { clientX: 11 }), h => h.doc.fire('pointercancel'), h => h.win.fire('blur')]) {
        const h = gestures(); h.button.fire('pointerdown'); cancel(h); h.advance(1000);
        assert.equal(h.menu.hidden, true); h.button.fire('click', { detail: 0 }); assert.equal(h.state.activated, 1);
    }
    const h = gestures(); h.doc.fire('keydown', { target: h.button, key: 'ArrowDown' });
    assert.equal(h.menu.hidden, false); h.doc.fire('keydown', { key: 'Escape' });
    assert.equal(h.menu.hidden, true); assert.equal(h.state.focus, h.button);
});
test('禁用状态和非主指针不启动长按；销毁后不再响应', () => {
    const h = gestures(); h.button.disabled = true; h.button.fire('pointerdown'); h.advance(900);
    assert.equal(h.menu.hidden, true); h.button.disabled = false;
    h.button.fire('pointerdown', { isPrimary: false }); h.advance(900); assert.equal(h.menu.hidden, true);
    h.controls.destroy(); h.button.fire('click'); assert.equal(h.state.activated, 0);
});
test('活动计时保留小数余量，暂停不计时，重复继续不产生多个计时器', () => {
    let now = 0, callbacks = new Map(), id = 0; const ticks = [];
    const clock = createRecordingClock({ now: () => now, onTick: n => ticks.push(n),
        setInterval(fn) { callbacks.set(++id, fn); return id; }, clearInterval(id) { callbacks.delete(id); } });
    clock.start(); now = 1250; clock.pause(); assert.equal(clock.seconds(), 1.25); assert.equal(callbacks.size, 0);
    now = 10000; assert.equal(clock.seconds(), 1.25); clock.start(); clock.start(); assert.equal(callbacks.size, 1);
    now = 10750; clock.pause(); assert.equal(clock.seconds(), 2); assert.equal(ticks.at(-1), 2);
    clock.reset(); assert.equal(clock.seconds(), 0); assert.equal(callbacks.size, 0);
});
test('AudioWorklet 暂停前缓冲保留，暂停样本丢弃，继续和暂停后最终刷新可用', () => {
    let Processor; const sent = [];
    vm.runInNewContext(fs.readFileSync(require.resolve('../AudioRecorderWorklet.js'), 'utf8'), {
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage: m => sent.push(m) }; } },
        registerProcessor(_name, p) { Processor = p; }, Float32Array
    });
    const p = new Processor(), output = new Float32Array([1, 1]);
    const feed = values => p.process([[new Float32Array(values)]], [[output]]);
    feed([.1, .2]); p.port.onmessage({ data: { type: 'setPaused', paused: true } });
    feed([.8, .9]); assert.equal(p.sampleOffset, 0);
    p.port.onmessage({ data: { type: 'setPaused', paused: false } }); feed([.3]);
    p.port.onmessage({ data: { type: 'setPaused', paused: true } });
    p.port.onmessage({ data: { type: 'flush' } });
    assert.deepEqual(sent.map(m => m.type), ['samples', 'samples', 'flushed']);
    assert.equal(sent[0].samples.length, 2); assert.equal(sent[1].samples.length, 1);
    assert.deepEqual([...output], [0, 0]);
});
