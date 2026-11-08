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
let browser;
try { browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' })); } // bundled Chromium, else installed Google Chrome
catch (e) { console.error('Could not launch the browser (run: npx playwright install chromium, or install Google Chrome). Visual check NOT done.\n' + String(e.message).split('\n')[0]); process.exit(2); }
const page = await browser.newPage({ viewport: { width: arg('--width', 1280), height: arg('--height', 800) } });
const errors = [];
// "Failed to load resource" console lines carry no URL, so report HTTP failures from responses instead (ignoring the browser's own favicon probe).
page.on('console', m => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push('console: ' + m.text()));
page.on('response', r => r.status() >= 400 && !/\/favicon\.ico$/.test(r.url()) && errors.push(`http ${r.status()}: ${r.url()}`));
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('requestfailed', r => !/\/favicon\.ico$/.test(r.url()) && errors.push('requestfailed: ' + r.url()));
try { await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }); }
catch (e) { await browser.close(); console.error('Could not load ' + url + ': ' + String(e.message).split('\n')[0] + '\nVisual check NOT done.'); process.exit(2); }
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(JSON.stringify({ screenshot: out, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
