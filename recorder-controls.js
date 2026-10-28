/* Recording gestures and an active-time clock; neither starts audio on page load. */
(() => {
    'use strict';
    function createRecordingClock({ now = () => performance.now(), onTick = () => {},
        setInterval: every = globalThis.setInterval, clearInterval: cancel = globalThis.clearInterval } = {}) {
        let elapsed = 0, started = null, timer = null;
        const seconds = () => (elapsed + (started === null ? 0 : Math.max(0, now() - started))) / 1000;
        const tick = () => onTick(Math.floor(seconds()));
        function pause() {
            if (started !== null) elapsed += Math.max(0, now() - started);
            started = null;
            if (timer !== null) cancel(timer);
            timer = null; tick();
        }
        return Object.freeze({
            seconds, pause,
            start() { if (started !== null) return; started = now(); timer = every(tick, 200); tick(); },
            reset() { pause(); elapsed = 0; tick(); }
        });
    }
    function createButtonControls({ button, menu, stopButton, onActivate, onStop, isActive,
        document: doc = button.ownerDocument, window: win = doc.defaultView,
        setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout }) {
        let timer = null, pointer = null, origin = null, suppressClick = false;
        const listeners = [];
        const contains = (element, target) => element === target || element.contains(target);
        const open = () => !menu.hidden;
        function listen(target, name, handler) {
            target.addEventListener(name, handler);
            listeners.push(() => target.removeEventListener(name, handler));
        }
        function cancelPress() { if (timer !== null) cancel(timer); timer = null; pointer = null; origin = null; }
        function closeMenu(focus = false) {
            menu.hidden = true; button.setAttribute('aria-expanded', 'false');
            if (focus) button.focus({ preventScroll: true });
        }
        function openMenu() {
            if (button.disabled || !isActive()) return;
            menu.hidden = false; button.setAttribute('aria-expanded', 'true');
            stopButton.focus({ preventScroll: true });
        }
        closeMenu();
        listen(button, 'pointerdown', event => {
            if (button.disabled || event.button !== 0 || event.isPrimary === false || pointer !== null) return;
            suppressClick = false;
            if (open()) { closeMenu(); suppressClick = true; return; }
            if (!isActive()) return;
            pointer = event.pointerId; origin = { x: event.clientX, y: event.clientY };
            timer = later(() => {
                timer = null; suppressClick = true;
                if (pointer !== null) openMenu();
            }, 800);
        });
        listen(doc, 'pointermove', event => {
            if (pointer !== event.pointerId || !origin) return;
            if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
                suppressClick = true; cancelPress();
            }
        });
        listen(doc, 'pointerup', event => { if (pointer === event.pointerId) cancelPress(); });
        listen(doc, 'pointercancel', event => {
            if (pointer === event.pointerId) { suppressClick = true; cancelPress(); }
        });
        listen(button, 'click', event => {
            if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); return; }
            suppressClick = false;
            if (open()) { closeMenu(true); return; }
            if (!button.disabled) void onActivate();
        });
        listen(doc, 'pointerdown', event => {
            if (open() && !contains(menu, event.target) && !contains(button, event.target)) closeMenu();
        });
        listen(doc, 'click', event => {
            if (open() && !contains(menu, event.target) && !contains(button, event.target)) closeMenu();
        });
        listen(doc, 'keydown', event => {
            if (event.key === 'Escape' && open()) { event.preventDefault(); closeMenu(true); }
            if (contains(button, event.target) && (event.key === 'ArrowDown' || (event.shiftKey && event.key === 'F10'))) {
                event.preventDefault(); cancelPress(); openMenu();
            }
        });
        listen(button, 'contextmenu', event => {
            // Native touch context menus may fire before 800ms; only our timer opens it.
            if (isActive()) event.preventDefault();
        });
        listen(win, 'blur', () => { if (pointer !== null) suppressClick = true; cancelPress(); closeMenu(); });
        listen(stopButton, 'click', event => {
            event.stopPropagation();
            if (!open()) return;
            closeMenu(); cancelPress();
            if (!button.disabled && isActive()) void onStop();
        });
        return Object.freeze({ closeMenu, destroy() { cancelPress(); closeMenu(); listeners.splice(0).forEach(remove => remove()); } });
    }
    const api = Object.freeze({ createRecordingClock, createButtonControls });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AudioRecorderControls = api;
})();
