// ElevenLabs audio: read-aloud (GET /api/tts) and voice feedback in (POST /api/feedback/:token/voice).
import { Router } from 'express';
import multer from 'multer';
import { one, run } from '../db.js';
import * as ai from '../ai.js';
import { speechToText, textToSpeech, elevenLabsEnabled, ElevenLabsError } from '../elevenlabs.js';

export const voice = Router();

export const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|x-m4a|m4a|aac|wav|x-wav|wave|mpeg|mp3)$/i;
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } });

/** Tiny in-memory fixed-window limiter, per IP + bucket. */
const hits = new Map();
export function rateLimit(bucket, max, windowMs = 60_000) {
  return (req, res, next) => {
    const now = Date.now();
    const k = `${bucket}:${req.ip}`;
    let h = hits.get(k);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests, please slow down' });
    }
    next();
  };
}
setInterval(() => { const n = Date.now(); for (const [k, h] of hits) if (h.reset < n) hits.delete(k); }, 60_000).unref();

/** multer wrapper that turns upload errors into JSON. */
export const audioUpload = (req, res, next) =>
  upload.single('audio')(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Audio is too large (10MB max)' : 'Invalid upload' });
  });

const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

voice.get('/api/tts', rateLimit('tts', 30), async (req, res) => {
  if (!elevenLabsEnabled()) return res.status(503).json({ error: 'Read-aloud is not configured' });
  const text = String(req.query.text ?? '').trim();
  const lang = String(req.query.lang ?? 'en').trim().toLowerCase();
  if (!text || text.length > 300) return res.status(400).json({ error: 'text is required (max 300 characters)' });
  if (!LANG.test(lang)) return res.status(400).json({ error: 'Invalid lang' });
  try {
    const buf = await textToSpeech(text, lang);
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' }).send(buf);
  } catch (e) {
    console.error('[tts]', e.message);
    res.status(e instanceof ElevenLabsError ? e.status : 502).json({ error: 'Could not generate audio' });
  }
});

const clip = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));

voice.post('/api/feedback/:token/voice', rateLimit('voice', 10), audioUpload, async (req, res) => {
  const prog = await one('SELECT id FROM programs WHERE token=$1', [req.params.token]);
  if (!prog) return res.status(404).json({ error: 'Program not found' });
  if (!elevenLabsEnabled()) return res.status(503).json({ error: 'Voice feedback is not configured' });
  const f = req.file;
  if (!f || !f.buffer?.length) return res.status(400).json({ error: 'An audio file is required (field "audio")' });
  if (!AUDIO_TYPES.test(String(f.mimetype).split(';')[0].trim())) return res.status(400).json({ error: 'Unsupported audio type' });
  const lang = LANG.test(String(req.body?.lang ?? '')) ? req.body.lang.toLowerCase() : undefined;

  let transcript;
  try {
    transcript = await speechToText(f.buffer, f.mimetype, lang);
  } catch (e) {
    console.error('[voice] transcription failed:', e.message);
    return res.status(e instanceof ElevenLabsError ? e.status : 502).json({ error: 'Could not transcribe the recording' });
  }
  if (!transcript) return res.status(422).json({ error: 'We could not hear anything in that recording. Please try again.' });

  let s = null;
  try { s = ai.structureFeedbackText ? await ai.structureFeedbackText(transcript) : null; } catch (e) { console.error('[voice] structuring failed:', e.message); }
  const rating = Number.isFinite(Number(s?.rating)) && s?.rating != null ? Math.round(Number(s.rating)) : null;
  const weak = !s || rating == null || rating < 1 || rating > 5 || (!s.most_valued && !s.suggestions);
  const { rows } = await run(
    `INSERT INTO feedback (program_id, source, rating, would_recommend, most_valued, suggestions, raw_text, audio_transcript, language, translated_text, needs_review)
     VALUES ($1,'voice',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [prog.id, rating >= 1 && rating <= 5 ? rating : null, typeof s?.would_recommend === 'boolean' ? s.would_recommend : null,
      clip(s?.most_valued, 2000), clip(s?.suggestions, 2000), clip(s?.raw_text ?? transcript, 5000), transcript.slice(0, 10000),
      clip(s?.language ?? lang, 20), clip(s?.translated_text, 5000), weak]);
  res.json({ ok: true, id: rows[0].id, transcript });
});

// Generic dictation for any text box (public pages use it too): audio in, transcript out. Nothing is stored.
voice.get('/api/transcribe', (_req, res) => res.json({ enabled: elevenLabsEnabled() }));
voice.post('/api/transcribe', rateLimit('stt', 20), audioUpload, async (req, res) => {
  if (!elevenLabsEnabled()) return res.status(503).json({ error: 'Voice typing is not set up yet.' });
  const f = req.file;
  if (!f || !f.buffer?.length) return res.status(400).json({ error: 'An audio file is required (field "audio")' });
  if (!AUDIO_TYPES.test(String(f.mimetype).split(';')[0].trim())) return res.status(400).json({ error: 'Unsupported audio type' });
  try {
    res.json({ text: await speechToText(f.buffer, f.mimetype) });
  } catch (e) {
    console.error('[transcribe]', e.message);
    res.status(e instanceof ElevenLabsError ? e.status : 502).json({ error: 'Could not transcribe that. Please try again.' });
  }
});
