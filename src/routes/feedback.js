// Parent feedback via QR code (online form) and photos of paper forms (AI handwriting reading).
// All public URLs use the program's random token, never the numeric id.
import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { unlink, rename } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { query, one, run } from '../db.js';
import { BASE_URL, escapeHtml as esc, intId, rateLimit } from '../util.js';
import { transcribeFeedbackPhoto, aiEnabled } from '../ai.js';
import * as cld from '../cloudinary.js';
import { estimateTilt } from '../deskew.js';

export const feedback = Router();

const PUBLIC_DIR = resolve('public');
const UPLOAD_DIR = resolve('data/uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 30;

const limitOnline = rateLimit({ name: 'online', max: 20, windowMs: 10 * 60 * 1000 });
const limitPhotos = rateLimit({ name: 'photos', max: 60, windowMs: 10 * 60 * 1000 });

// ---- helpers -------------------------------------------------------------------------------
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
async function programByToken(token) {
  if (!TOKEN_RE.test(token || '')) return undefined;
  return one('SELECT id, name, location, token FROM programs WHERE token=$1', [token]);
}
const notFound = (res) => res.status(404).json({ error: 'Not found' });

/** Check the real file signature (jpeg/png/gif/webp), not the client-supplied mimetype. */
function sniffImage(path) {
  const fd = openSync(path, 'r');
  try {
    const b = Buffer.alloc(12);
    readSync(fd, b, 0, 12, 0);
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
    if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
  } finally { closeSync(fd); }
}
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // Extension is chosen after magic-byte checking; temp name carries none.
    filename: (_r, _f, cb) => cb(null, randomBytes(16).toString('hex') + '.tmp'),
  }),
  limits: { fileSize: MAX_FILE, files: MAX_FILES, fields: 5 },
  fileFilter: (_r, f, cb) => cb(null, /^image\//.test(f.mimetype)),
});
const safeUnlink = (p) => unlink(p).catch(() => {});

// ---- pages ---------------------------------------------------------------------------------
const page = (file) => async (req, res) => {
  if (!(await programByToken(req.params.token))) return res.status(404).type('text').send('Not found');
  res.set('Referrer-Policy', 'no-referrer').sendFile(file, { root: PUBLIC_DIR });
};
feedback.get('/feedback/:token', page('feedback.html'));
feedback.get('/upload/:token', page('upload.html'));

feedback.get('/api/programs/:token/public', async (req, res) => {
  const p = await programByToken(req.params.token);
  if (!p) return notFound(res);
  res.json({ name: p.name, location: p.location });
});

const qrBuffer = (token) => QRCode.toBuffer(`${BASE_URL}/feedback/${token}`, { width: 512, margin: 2 });

feedback.get('/api/programs/:token/qr.png', async (req, res) => {
  const p = await programByToken(req.params.token);
  if (!p) return notFound(res);
  res.set('Cache-Control', 'private, max-age=3600').type('png').send(await qrBuffer(p.token));
});

const sheetCache = new Map(); // token -> hosted sheet url (Cloudinary), best effort

// Printable QR sheet for the facilitator to put up or hand out.
feedback.get('/sheet/:token', async (req, res) => {
  const p = await programByToken(req.params.token);
  if (!p) return res.status(404).type('text').send('Not found');
  const link = `${BASE_URL}/feedback/${p.token}`;
  let hosted = sheetCache.get(p.token);
  if (!hosted && cld.cloudinaryEnabled) {
    try { hosted = await cld.uploadQrSheet(await qrBuffer(p.token), p.name); sheetCache.set(p.token, hosted); } catch { /* fall back to local QR */ }
  }
  const qr = hosted || (await QRCode.toDataURL(link, { width: 640, margin: 2 }));
  res.set('Referrer-Policy', 'no-referrer').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.name)} - feedback QR code</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;margin:0;padding:24px 16px 40px;text-align:center;color:#1c292d;background:#fff;line-height:1.4}
.sheet{max-width:640px;margin:0 auto;border:3px solid #0e6560;border-radius:20px;padding:24px 16px}
.brand{display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700;font-size:1.05rem;color:#0e6560;margin:0 0 8px}
.mark{width:32px;height:32px}.mark .a{fill:#0e6560}.mark .b{fill:#d4713b;mix-blend-mode:multiply;opacity:.9}
h1{font-size:clamp(1.5rem,6vw,2.25rem);margin:.3em 0;text-wrap:balance}
img{width:min(72vw,480px);height:auto;display:block;margin:16px auto;border:1px solid #d6d0c4;border-radius:12px;background:#fff}
.cta{font-size:clamp(1.4rem,5.5vw,2rem);font-weight:800;margin:.4em 0;color:#0e6560}
.alt{font-size:1.15rem;margin:.25em 0;color:#2f3d42}
.url{font-size:.9rem;color:#4a585e;word-break:break-all;margin:20px 0 0}
button{font:inherit;font-size:1.05rem;font-weight:600;min-height:48px;padding:.6em 1.6em;margin-top:24px;cursor:pointer;background:#0e6560;color:#fff;border:0;border-radius:10px}
button:hover{background:#0a4f4b}
:focus-visible{outline:3px solid #0b57d0;outline-offset:3px}
@media print{button{display:none}body{padding:0}.sheet{border-width:4px}@page{margin:14mm}}
</style></head><body>
<main class="sheet">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle class="a" cx="12" cy="17" r="9"/><circle class="b" cx="21" cy="17" r="9"/></svg>Baby Connections</p>
<h1>${esc(p.name)}</h1>
<img src="${esc(qr)}" alt="QR code linking to the feedback form for ${esc(p.name)}">
<p class="cta">Scan to share your feedback</p>
<p class="alt" lang="es">Escanea para compartir tu opini&oacute;n</p>
<p class="alt" lang="fr">Scannez pour partager vos commentaires</p>
<p class="alt" lang="pt">Escaneie para compartilhar seu feedback</p>
<p class="alt" lang="zh">&#25195;&#25551;&#20998;&#20139;&#24744;&#30340;&#21453;&#39304;</p>
<p class="alt" lang="ar" dir="rtl">&#1575;&#1587;&#1581;&#1576; &#1604;&#1578;&#1588;&#1575;&#1585;&#1603; &#1585;&#1571;&#1610;&#1603;</p>
<p class="url">${esc(link)}</p>
<button onclick="window.print()">Print this page</button>
</main></body></html>`);
});

// ---- parent submits the online form ----------------------------------------------------------
const yesNo = (v) => (v === true || v === 'yes' || v === 'true' ? true : v === false || v === 'no' || v === 'false' ? false : null);
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

feedback.post('/api/feedback/:token', limitOnline, async (req, res) => {
  const p = await programByToken(req.params.token);
  if (!p) return notFound(res);
  const b = req.body || {};
  const r = Number(b.rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return res.status(400).json({ error: 'Please choose a rating from 1 to 5' });
  const lang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(b.language || '') ? b.language.toLowerCase() : null;
  const { rows } = await run(
    `INSERT INTO feedback (program_id, source, rating, would_recommend, most_valued, suggestions, language, needs_review)
     VALUES ($1,'qr',$2,$3,$4,$5,$6,false) RETURNING id`,
    [p.id, r, yesNo(b.would_recommend), clip(b.most_valued, 2000), clip(b.suggestions, 2000), lang],
  );
  res.json({ ok: true, id: rows[0].id });
});

// ---- facilitator uploads photos of paper forms ------------------------------------------------
const receive = (req, res, next) => upload.array('photos', MAX_FILES)(req, res, (err) => {
  if (!err) return next();
  const tooBig = err.code === 'LIMIT_FILE_SIZE', tooMany = err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE';
  res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'A photo is larger than 10MB' : tooMany ? `Please upload at most ${MAX_FILES} photos at a time` : 'Upload failed' });
});

feedback.post('/api/feedback/:token/photos', limitPhotos, async (req, res, next) => {
  // Unknown token must 404 before any file is accepted.
  if (!(await programByToken(req.params.token))) return notFound(res);
  next();
}, receive, async (req, res) => {
  const p = await programByToken(req.params.token);
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No valid image files received (jpg, png, webp or gif, up to 10MB each)' });

  const results = [];
  for (const f of files) {
    const name = String(f.originalname || 'photo').slice(0, 120);
    try {
      const mime = sniffImage(f.path);
      if (!mime) { await safeUnlink(f.path); results.push({ file: name, status: 'error', error: 'Not a valid image (jpg, png, webp or gif)' }); continue; }

      let imageUrl = null, originalUrl = null, local = null, aiSource;
      if (cld.cloudinaryEnabled) {
        try {
          ({ url: imageUrl, originalUrl } = await cld.uploadFeedbackPhoto(f.path, { programToken: p.token, tilt: await estimateTilt(f.path) }));
          aiSource = imageUrl;
          await safeUnlink(f.path);
        } catch { imageUrl = null; }
      }
      if (!imageUrl) { // local fallback: keep the file with a proper extension
        local = resolve(UPLOAD_DIR, randomBytes(16).toString('hex') + (EXT[mime] || extname(f.path)));
        await rename(f.path, local);
        aiSource = local;
      }

      let t = null, aiError = null;
      try {
        try { t = await transcribeFeedbackPhoto(aiSource); }
        catch (e) { // enhanced version unavailable: fall back to the untouched original
          // A quota / rate-limit error would fail the same way again and just burn more of the allowance.
          if (!originalUrl || /\b429\b|RESOURCE_EXHAUSTED/.test(e.message)) throw e;
          console.error('[feedback] enhanced photo read failed, retrying original:', e.message);
          t = await transcribeFeedbackPhoto(originalUrl);
        }
      } catch (e) {
        aiError = 'Could not read this form automatically';
        const quota = /\b429\b|RESOURCE_EXHAUSTED/.test(e.message);
        console.error('[feedback] AI read failed:', quota ? 'Gemini quota or rate limit reached (form saved for staff review)' : e.message);
      }
      const review = !t || t.confidence === 'low' || t.rating == null || /\[illegible\]/i.test(`${t.raw_text} ${t.most_valued} ${t.suggestions}`);
      const { rows } = await run(
        `INSERT INTO feedback (program_id, source, rating, would_recommend, most_valued, suggestions, raw_text, image_url, image_path, language, translated_text, summary, needs_review)
         VALUES ($1,'photo',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [p.id, t?.rating ?? null, t?.would_recommend ?? null, t?.most_valued || '', t?.suggestions || '', t?.raw_text || '',
          imageUrl, local ? local.slice(process.cwd().length + 1) : null, t?.language || null, t?.translated_text || null, t?.summary || null, review],
      );
      results.push({ id: rows[0].id, file: name, status: review ? 'needs_review' : 'saved', needsReview: review, language: t?.language || null, ...(aiError && { error: aiError }) });
    } catch (e) {
      console.error('[feedback] photo failed:', e.message);
      await safeUnlink(f.path);
      results.push({ file: name, status: 'error', error: 'Could not save this photo. Please try again.' });
    }
  }
  res.json({ ok: results.some((r) => r.status !== 'error'), aiEnabled, results });
});

// ---- staff only (default-deny in auth.js sets req.staff) ----------------------------------------
feedback.get('/api/feedback/:id/image', async (req, res) => {
  const id = intId(req.params.id);
  const r = id && await one('SELECT image_url, image_path FROM feedback WHERE id=$1', [id]);
  if (!r) return res.sendStatus(404);
  if (r.image_url && /^https?:\/\//i.test(r.image_url)) return res.redirect(r.image_url);
  if (r.image_path) {
    const full = resolve(r.image_path);
    if (full.startsWith(UPLOAD_DIR + sep)) return res.sendFile(full, { dotfiles: 'deny' }, (e) => { if (e && !res.headersSent) res.sendStatus(404); });
  }
  res.sendStatus(404);
});

// A person fixes an AI transcription (or fills one in when AI is off). Only provided fields change.
feedback.patch('/api/feedback/:id', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.sendStatus(404);
  const b = req.body || {};
  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if ('rating' in b) {
    const r = b.rating == null || b.rating === '' ? null : Number(b.rating);
    if (r != null && !(Number.isInteger(r) && r >= 1 && r <= 5)) return res.status(400).json({ error: 'Rating must be 1-5' });
    add('rating', r);
  }
  if ('would_recommend' in b) add('would_recommend', yesNo(b.would_recommend));
  if ('most_valued' in b) add('most_valued', clip(b.most_valued, 2000));
  if ('suggestions' in b) add('suggestions', clip(b.suggestions, 2000));
  if ('translated_text' in b) add('translated_text', clip(b.translated_text, 4000));
  if ('summary' in b) add('summary', clip(b.summary, 600));
  sets.push('needs_review=false');
  vals.push(id);
  const { rowCount } = await run(`UPDATE feedback SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
  rowCount ? res.json({ ok: true }) : res.sendStatus(404);
});
