/* Isolated browser check: synthetic input and mocked Drive from the local preview.
 * Requires Playwright and an installed Chrome/Edge. Does not use a personal profile.
 * NODE_PATH may point to a preinstalled Playwright; no browser download is needed.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createPreviewServer } = require('./preview-recording-library.cjs');
const channel = process.argv.includes('--edge') ? 'msedge' : 'chrome';
const fallback = process.argv.includes('--fallback');
const screenshot = process.env.RECORDER_SCREENSHOT;
async function rows(page, store) {
    return page.evaluate(store => new Promise((resolve, reject) => {
        const request = indexedDB.open('audioRecorderLibrary', 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result, tx = db.transaction(store), r = tx.objectStore(store).getAll();
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); tx.oncomplete = () => db.close();
        };
    }), store);
}
async function hold(page, milliseconds = 850) {
    const box = await page.locator('#toggle').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(milliseconds); await page.mouse.up();
}
async function start(page) {
    await page.locator('#toggle').click();
    await page.waitForFunction(() => document.getElementById('recorderStatus').textContent === '录音中');
}
async function finish(page) {
    await hold(page); await page.locator('#stopRecordingButton').click();
    await page.waitForFunction(() => document.getElementById('recorderStatus').textContent === '准备录音');
}
async function audioStats(page) {
    return page.evaluate(async () => {
        const db = await new Promise(resolve => { const r = indexedDB.open('audioRecorderLibrary', 2); r.onsuccess = () => resolve(r.result); });
        const records = await new Promise(resolve => { const r = db.transaction('audio').objectStore('audio').getAll(); r.onsuccess = () => resolve(r.result); });
        db.close();
        const audio = records.at(-1), bytes = new Uint8Array(await audio.mp3.arrayBuffer());
        const checked = AudioRecorderRecovery.inspectMp3(bytes), ctx = new AudioContext();
        try {
            const mp3 = await ctx.decodeAudioData(await audio.mp3.arrayBuffer());
            const webm = audio.webm ? await ctx.decodeAudioData(await audio.webm.arrayBuffer()) : null;
            function rms(buffer) { const a = buffer.getChannelData(0); return Math.sqrt(a.reduce((n, x) => n + x * x, 0) / a.length); }
            return { mp3: checked.seconds, webm: webm?.duration, mp3Rms: rms(mp3), webmRms: webm ? rms(webm) : null };
        } finally { await ctx.close(); }
    });
}
(async () => {
    const server = createPreviewServer(); let browser;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4174, '127.0.0.1', resolve); });
    try {
        browser = await chromium.launch({ channel, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
        const context = await browser.newContext({ viewport: { width: 440, height: 760 }, acceptDownloads: true });
        await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        if (fallback) await context.addInitScript(() => { Object.defineProperty(window, 'AudioWorkletNode', { value: undefined }); });
        const page = await context.newPage(), errors = [], dialogs = [], downloads = [];
        page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });
        page.on('download', d => downloads.push(d.suggestedFilename()));
        await page.goto('http://127.0.0.1:4174/');
        await page.waitForFunction(() => !!window.AudioRecorderInputs && !!window.AudioRecorderControls);
        // Existing Drive UI, with fixture-only OAuth and upload endpoints.
        await page.locator('#driveSettingsButton').click(); await page.locator('#driveConnect').click();
        await page.waitForFunction(() => !document.getElementById('driveDisconnect').disabled);
        await page.locator('#driveAutoUpload').check();
        await page.evaluate(() => document.getElementById('driveSettings').close());
        await page.locator('label').filter({ has: page.locator('#autoDownloadToggle') }).click();
        assert.equal(await page.locator('#autoDownloadToggle').isChecked(), true);
        await start(page); await page.waitForTimeout(2250);
        assert.equal(await page.evaluate(() => activeMp3Processor.type), fallback ? 'scriptProcessor' : 'audioWorklet');
        await page.locator('#toggle').click();
        await page.waitForFunction(() => document.getElementById('recorderStatus').textContent === '已暂停');
        const time = await page.locator('#timer').textContent();
        await page.waitForTimeout(2400); // Allow final pre-pause PCM/checkpoint to settle.
        const before = (await rows(page, 'drafts'))[0]; assert.ok(before.mp3Bytes > 0);
        await page.waitForTimeout(2200);
        assert.equal(await page.locator('#timer').textContent(), time);
        const after = (await rows(page, 'drafts'))[0];
        assert.equal(after.mp3Bytes, before.mp3Bytes); assert.equal(after.protectedSeconds, before.protectedSeconds);
        assert.equal((await rows(page, 'records')).length, 0);
        assert.equal(await page.evaluate(() => localStorage.getItem('fixtureCloudFiles')), null);
        assert.equal(downloads.length, 0);
        await hold(page); assert.equal(await page.locator('#stopRecordingMenu').isVisible(), true);
        assert.equal(await page.locator('#recorderStatus').textContent(), '已暂停');
        if (screenshot) await page.screenshot({ path: screenshot });
        await page.locator('h1').click(); assert.equal(await page.locator('#stopRecordingMenu').isVisible(), false);
        assert.equal(await page.locator('#recorderStatus').textContent(), '已暂停');
        await page.locator('#toggle').click(); await page.waitForTimeout(2100); await page.locator('#toggle').click();
        await finish(page); // Stop directly from paused state.
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('fixtureCloudFiles') || '[]').some(([, f]) => f.size));
        const records = await rows(page, 'records'); assert.equal(records.length, 1);
        assert.equal((await rows(page, 'drafts')).length, 0); assert.equal((await rows(page, 'chunks')).length, 0);
        const durations = await audioStats(page);
        assert.ok(records[0].duration > 4 && records[0].duration < 6, JSON.stringify(records));
        for (const format of ['mp3', 'webm']) {
            assert.ok(durations[format] > 3.8 && durations[format] < 6, JSON.stringify(durations));
            assert.ok(durations[format + 'Rms'] > .01, JSON.stringify(durations));
        }
        assert.equal(downloads.length, 1);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fixtureCloudFiles')).length), 1);
        await page.reload(); await page.locator('#recordingListButton').click();
        assert.equal(await page.locator('#libraryRows .library-row').count(), 1);
        await page.locator('#libraryClose').click();
        // Pause, crash while paused, reload and recover the same draft; no auto upload on pause.
        await start(page); await page.waitForTimeout(2300); await page.locator('#toggle').click();
        await page.waitForTimeout(2300); const draft = (await rows(page, 'drafts'))[0];
        assert.ok(draft.protectedSeconds > 1.5);
        await page.locator('#fixtureCrash').click();
        await page.waitForFunction(() => !document.getElementById('recoveryNotice').hidden);
        await page.locator('#recoveryOpen').click(); await page.getByRole('button', { name: '恢复到列表', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('#libraryRows .library-row').length === 2);
        const restored = (await rows(page, 'records')).find(r => r.id === draft.id);
        assert.ok(restored.recovered); assert.ok(Math.abs(restored.duration - draft.protectedSeconds) < .05);
        assert.equal((await rows(page, 'drafts')).length, 0);
        await page.locator('#libraryClose').click();
        await start(page); await page.waitForTimeout(1200); await hold(page);
        assert.equal(await page.locator('#recorderStatus').textContent(), '录音中');
        await page.locator('#stopRecordingButton').click();
        await page.waitForFunction(() => document.getElementById('recorderStatus').textContent === '准备录音');
        assert.equal((await rows(page, 'records')).length, 3);
        assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
        console.log(JSON.stringify({ channel, processor: fallback ? 'scriptProcessor' : 'audioWorklet',
            activeSeconds: records[0].duration, ...durations, restoredSeconds: restored.duration,
            savedOnce: true, autoDownload: true, mockedAutoUpload: true, pausedRecovery: true, errors }, null, 2));
        await context.close();
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
