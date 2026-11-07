// Estimate how many degrees a photographed page is tilted, so Cloudinary can rotate it straight.
// Method: threshold ink/lines, then find the rotation at which ink rows line up best (projection profile).
// Returns degrees to rotate CLOCKWISE to straighten (Cloudinary `angle` convention), or 0 when unsure.
import sharp from 'sharp';

const MAX_TILT = 20;   // degrees searched either way
const MIN_FIX = 0.7;   // below this, leave the photo alone

function score(xs, ys, n, deg, height, width) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const off = Math.ceil(Math.hypot(width, height));
  const bins = new Float64Array(off * 2 + 1);
  for (let i = 0; i < n; i++) bins[Math.round(ys[i] * c - xs[i] * s) + off]++;
  let sum = 0;
  for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
  return sum;
}

export async function estimateTilt(input) {
  try {
    const { data, info } = await sharp(input).rotate() // honour EXIF first, as Cloudinary does
      .resize({ width: 700, withoutEnlargement: true }).grayscale().normalise()
      .raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const blur = await sharp(data, { raw: { width, height, channels: 1 } }).blur(12).toColourspace('b-w').raw().toBuffer();
    if (blur.length !== data.length) return 0;
    const xs = [], ys = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (blur[i] - data[i] > 22) { xs.push(x); ys.push(y); } // darker than its surroundings = ink or ruled line
    }
    if (xs.length < 200) return 0;
    const sx = Float32Array.from(xs), sy = Float32Array.from(ys), n = sx.length;
    let best = 0, bestScore = -1;
    for (let d = -MAX_TILT; d <= MAX_TILT; d += 1) { const sc = score(sx, sy, n, d, height, width); if (sc > bestScore) { bestScore = sc; best = d; } }
    for (let d = best - 1; d <= best + 1; d += 0.1) { const sc = score(sx, sy, n, d, height, width); if (sc > bestScore) { bestScore = sc; best = d; } }
    const flat = score(sx, sy, n, 0, height, width);
    if (bestScore < flat * 1.05) return 0; // no clear line structure: don't guess
    const deg = -Math.round(best * 10) / 10; // best>0 means ink rows slope the other way; negate to get Cloudinary clockwise degrees
    return Math.abs(deg) < MIN_FIX ? 0 : deg;
  } catch { return 0; }
}
