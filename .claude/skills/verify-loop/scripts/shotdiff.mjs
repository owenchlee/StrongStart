#!/usr/bin/env node
// Dependency-free PNG comparison. Usage: node shotdiff.mjs <baseline.png> <new.png> [--threshold 0.5]
// threshold = max percent of differing pixels. Supports 8-bit non-interlaced RGB/RGBA PNGs (Playwright output).
// Exit 0 within threshold, 1 over, 2 cannot compare (size mismatch / unsupported / missing).
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function decode(buf) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  let o = 8, w, h, ct, idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4);
      if (d[8] !== 8 || d[12] !== 0 || ![2, 6].includes(d[9])) throw new Error('unsupported PNG (need 8-bit RGB/RGBA, non-interlaced)'); ct = d[9]; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[row + i - bpp] : 0, b = y ? px[row - stride + i] : 0, c = i >= bpp && y ? px[row - stride + i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + i] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
export function diffPercent(A, B) {
  let n = 0;
  for (let i = 0; i < A.w * A.h; i++) {
    let d = 0; for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.px[i * A.bpp + k] - B.px[i * B.bpp + k]));
    if (d > 16) n++; // ignore tiny anti-aliasing noise
  }
  return (100 * n) / (A.w * A.h);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [a, b] = process.argv.slice(2), ti = process.argv.indexOf('--threshold'), th = ti > -1 ? +process.argv[ti + 1] : 0.5;
  if (!a || !b || !existsSync(a) || !existsSync(b)) { console.error('usage: shotdiff.mjs <baseline.png> <new.png> [--threshold N]; both files must exist'); process.exit(2); }
  try {
    const A = decode(readFileSync(a)), B = decode(readFileSync(b));
    if (A.w !== B.w || A.h !== B.h) { console.error(`size mismatch: ${A.w}x${A.h} vs ${B.w}x${B.h}`); process.exit(2); }
    const pct = diffPercent(A, B);
    console.log(JSON.stringify({ differingPercent: +pct.toFixed(3), threshold: th, ok: pct <= th }));
    process.exit(pct <= th ? 0 : 1);
  } catch (e) { console.error(e.message); process.exit(2); }
}
