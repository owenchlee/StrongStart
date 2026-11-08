#!/usr/bin/env node
// Screenshot + console error capture. Needs playwright (npm i -D playwright && npx playwright install chromium).
// Usage: node shot.mjs <url> <out.png> [--width 1280] [--height 800]
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const [url, out] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? +process.argv[i + 1] : d; };
if (!url || !out) { console.error('usage: shot.mjs <url> <out.png> [--width N] [--height N]'); process.exit(2); }
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright not installed. Use Claude in Chrome or install playwright. Visual check NOT done.'); process.exit(2); }
mkdirSync(dirname(out), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: arg('--width', 1280), height: arg('--height', 800) } });
const errors = [];
page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
await page.goto(url, { waitUntil: 'networkidle' });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(JSON.stringify({ screenshot: out, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
