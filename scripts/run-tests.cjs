/* Run all existing suites with the declared backend development dependencies. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const runtime = process.argv.includes('--runtime');
const files = runtime ? ['check-drive-runtime.cjs'] : fs.readdirSync(__dirname).filter(name => /^test-.*\.(cjs|mjs)$/.test(name)).sort();
const result = spawnSync(process.execPath, [...(runtime ? [] : ['--test']), ...files.map(file => path.join(__dirname, file))], {
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: [path.join(__dirname, '../backend/node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter) }
});
if (result.error) { console.error(result.error.message); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
