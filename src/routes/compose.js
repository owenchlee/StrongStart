// Staff email composer with voice dictation. Staff-only (auth.js default-deny); recipients limited to facilitators.
import { Router } from 'express';
import { query, one } from '../db.js';
import * as ai from '../ai.js';
import { sendMail } from '../mailer.js';
import { speechToText, elevenLabsEnabled, ElevenLabsError } from '../elevenlabs.js';
import { AUDIO_TYPES, audioUpload, rateLimit } from './voice.js';

export const compose = Router();

compose.get('/api/compose/facilitators', async (_req, res) => {
  res.json(await query("SELECT id, name, email FROM facilitators ORDER BY COALESCE(NULLIF(name,''), email)"));
});

compose.post('/api/compose/transcribe', rateLimit('compose-stt', 30), audioUpload, async (req, res) => {
  if (!elevenLabsEnabled()) return res.status(503).json({ error: 'Voice dictation is not configured' });
  const f = req.file;
  if (!f || !f.buffer?.length) return res.status(400).json({ error: 'An audio file is required (field "audio")' });
  if (!AUDIO_TYPES.test(String(f.mimetype).split(';')[0].trim())) return res.status(400).json({ error: 'Unsupported audio type' });
  let transcript;
  try {
    transcript = await speechToText(f.buffer, f.mimetype);
  } catch (e) {
    console.error('[compose] transcription failed:', e.message);
    return res.status(e instanceof ElevenLabsError ? e.status : 502).json({ error: 'Could not transcribe the recording' });
  }
  const out = { transcript, polished: false };
  if (transcript && ['1', 'true', 'on'].includes(String(req.body?.polish ?? '')) && ai.polishEmail) {
    try {
      const fac = req.body.facilitator_id ? await one('SELECT name FROM facilitators WHERE id=$1', [Number(req.body.facilitator_id) || 0]) : null;
      const p = await ai.polishEmail(transcript, { recipientName: fac?.name || '' });
      if (p) { out.transcript = String(p); out.original = transcript; out.polished = true; }
    } catch (e) { console.error('[compose] polish failed:', e.message); }
  }
  res.json(out);
});

// Optional tidy-up of text already in the box (used by the "Tidy with AI" button).
compose.post('/api/compose/polish', rateLimit('compose-polish', 30), async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text || text.length > 10000) return res.status(400).json({ error: 'text is required (max 10000 characters)' });
  if (!ai.polishEmail) return res.status(503).json({ error: 'AI tidy-up is not available' });
  try {
    const fac = Number(req.body.facilitator_id) ? await one('SELECT name FROM facilitators WHERE id=$1', [Number(req.body.facilitator_id)]) : null;
    const p = await ai.polishEmail(text, { recipientName: fac?.name || '' });
    if (!p) return res.status(503).json({ error: 'AI tidy-up is not available' });
    res.json({ text: String(p) });
  } catch (e) {
    console.error('[compose] polish failed:', e.message);
    res.status(503).json({ error: 'AI tidy-up is not available' });
  }
});

compose.post('/api/compose/send', rateLimit('compose-send', 30), async (req, res) => {
  const { facilitator_id, subject, body } = req.body ?? {};
  const id = Number(facilitator_id);
  const subj = String(subject ?? '').replace(/[\r\n]+/g, ' ').trim();
  const text = String(body ?? '').trim();
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a facilitator' });
  if (!subj || subj.length > 200) return res.status(400).json({ error: 'Subject is required (max 200 characters)' });
  if (!text || text.length > 10000) return res.status(400).json({ error: 'Message is required (max 10000 characters)' });
  const fac = await one('SELECT id, name, email FROM facilitators WHERE id=$1', [id]);
  if (!fac) return res.status(404).json({ error: 'Facilitator not found' });
  const who = req.staff?.name || req.staff?.email;
  const sig = who ? `\n\n${who}\nBaby Connections team` : '\n\nBaby Connections team';
  await sendMail(fac.email, subj, text + sig);
  console.log(`[compose] ${req.staff?.email ?? 'unknown'} emailed facilitator #${fac.id}`);
  res.json({ ok: true });
});
