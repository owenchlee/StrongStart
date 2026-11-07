// Step 4: parent feedback via QR code (online form) and photos of paper forms (AI handwriting reading).
import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { db } from '../db.js';
import { BASE_URL } from '../mailer.js';
import { transcribeFeedbackPhoto, aiEnabled } from '../ai.js';

export const feedback = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: 'data/uploads',
    filename: (_r, f, cb) => cb(null, randomBytes(12).toString('hex') + extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 30 },
  fileFilter: (_r, f, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(f.mimetype)),
});

const program = (id) => db.prepare('SELECT id, name, location FROM programs WHERE id=?').get(id);

feedback.get('/feedback/:id', (_req, res) => res.sendFile('feedback.html', { root: 'public' }));
feedback.get('/upload/:id', (_req, res) => res.sendFile('upload.html', { root: 'public' }));

feedback.get('/api/programs/:id/public', (req, res) => {
  const p = program(req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Program not found' });
});

// The QR code points parents at the feedback form for this program.
feedback.get('/api/programs/:id/qr.png', async (req, res) => {
  if (!program(req.params.id)) return res.sendStatus(404);
  res.type('png').send(await QRCode.toBuffer(`${BASE_URL}/feedback/${req.params.id}`, { width: 512, margin: 2 }));
});

// Parent submits the online form (reached by scanning the QR code).
feedback.post('/api/feedback/:id', (req, res) => {
  if (!program(req.params.id)) return res.status(404).json({ error: 'Program not found' });
  const { rating, would_recommend, most_valued, suggestions } = req.body;
  const r = Number(rating);
  if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: 'Please choose a rating from 1 to 5' });
  db.prepare('INSERT INTO feedback (program_id,source,rating,would_recommend,most_valued,suggestions) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, 'qr', r, would_recommend === true || would_recommend === 'yes' ? 1 : would_recommend === false || would_recommend === 'no' ? 0 : null,
      String(most_valued || '').slice(0, 2000), String(suggestions || '').slice(0, 2000));
  res.json({ ok: true });
});

// Facilitator/staff uploads photos of completed paper forms; each is read by AI.
feedback.post('/api/feedback/:id/photos', upload.array('photos', 30), async (req, res) => {
  if (!program(req.params.id)) return res.status(404).json({ error: 'Program not found' });
  if (!req.files?.length) return res.status(400).json({ error: 'No valid image files received (jpg, png, webp, gif up to 10MB)' });

  const insert = db.prepare('INSERT INTO feedback (program_id,source,rating,would_recommend,most_valued,suggestions,raw_text,image_path,needs_review) VALUES (?,?,?,?,?,?,?,?,?)');
  const results = [];
  for (const f of req.files) {
    let t = null, error = null;
    try { t = await transcribeFeedbackPhoto(f.path); } catch (e) { error = e.message; }
    // Anything the AI couldn't read confidently goes to a human review queue.
    const review = !t || t.confidence === 'low' || t.rating == null || /\[illegible\]/.test(t.raw_text || '') ? 1 : 0;
    const { lastInsertRowid } = insert.run(req.params.id, 'photo', t?.rating ?? null, t?.would_recommend == null ? null : t.would_recommend ? 1 : 0,
      t?.most_valued || '', t?.suggestions || '', t?.raw_text || '', f.path, review);
    results.push({ id: lastInsertRowid, file: f.originalname, needsReview: !!review, ...(error && { error }) });
  }
  res.json({ ok: true, aiEnabled, results });
});

feedback.get('/api/feedback/:id/image', (req, res) => {
  const r = db.prepare('SELECT image_path FROM feedback WHERE id=?').get(req.params.id);
  r?.image_path ? res.sendFile(r.image_path, { root: process.cwd() }) : res.sendStatus(404);
});

// A person fixes an AI transcription (or fills one in when AI is off).
feedback.patch('/api/feedback/:id', (req, res) => {
  const { rating, would_recommend, most_valued, suggestions } = req.body;
  const r = rating == null || rating === '' ? null : Number(rating);
  if (r != null && !(r >= 1 && r <= 5)) return res.status(400).json({ error: 'Rating must be 1-5' });
  const { changes } = db.prepare('UPDATE feedback SET rating=?, would_recommend=?, most_valued=?, suggestions=?, needs_review=0 WHERE id=?')
    .run(r, would_recommend == null ? null : would_recommend ? 1 : 0, most_valued || '', suggestions || '', req.params.id);
  changes ? res.json({ ok: true }) : res.sendStatus(404);
});
