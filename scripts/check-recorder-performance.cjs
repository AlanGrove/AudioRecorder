/* Synthetic local recording only; measures main-thread forwarding/drawing, not YouTube playback. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createPreviewServer } = require('./preview-recording-library.cjs');
(async () => {
    const server = createPreviewServer(); let browser;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4174, '127.0.0.1', resolve); });
    try {
        browser = await chromium.launch({ channel: process.argv.includes('--edge') ? 'msedge' : 'chrome', headless: true,
            args: ['--autoplay-policy=no-user-gesture-required'] });
        const context = await browser.newContext();
        await context.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
        const page = await context.newPage(); await page.goto('http://127.0.0.1:4174/');
        await page.evaluate(() => {
            window.profile = { forwardingMs: 0, forwardingCalls: 0, maxForwardingMs: 0, paintedFrames: 0, longTasks: [] };
            const enqueue = encodeMp3Samples, fill = CanvasRenderingContext2D.prototype.fillRect;
            encodeMp3Samples = samples => {
                const start = performance.now();
                try { return enqueue(samples); }
                finally { const ms = performance.now() - start; profile.forwardingMs += ms; profile.forwardingCalls++;
                    profile.maxForwardingMs = Math.max(ms, profile.maxForwardingMs); }
            };
            CanvasRenderingContext2D.prototype.fillRect = function(...args) {
                if (this.canvas.id === 'waveform' && args[0] === 0 && args[1] === 0) profile.paintedFrames++;
                return fill.apply(this, args);
            };
            new PerformanceObserver(list => { for (const entry of list.getEntries()) profile.longTasks.push(entry.duration); })
                .observe({ type: 'longtask', buffered: false });
        });
        await page.locator('#toggle').click();
        await page.waitForFunction(() => document.getElementById('recorderStatus').textContent === '录音中');
        await page.evaluate(() => { profile.started = performance.now(); profile.paintedFrames = 0; profile.longTasks = []; });
        await page.waitForTimeout(10000); await page.locator('#toggle').click();
        const metrics = await page.evaluate(() => ({ ...profile, elapsedMs: performance.now() - profile.started,
            encoder: activeMp3Encoder.type, pageHasLame: typeof window.lamejs !== 'undefined' }));
        assert.equal(metrics.encoder, 'worker'); assert.equal(metrics.pageHasLame, false);
        assert.ok(metrics.forwardingCalls > 150); assert.ok(metrics.paintedFrames < 220);
        console.log(JSON.stringify(metrics, null, 2));
        await page.evaluate(() => window.removeEventListener('beforeunload', beforeUnloadListener));
        await context.close();
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
