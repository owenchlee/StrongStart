// ElevenLabs via plain fetch (no SDK). Docs: POST /v1/speech-to-text (multipart: file, model_id, language_code?)
// -> { text }; POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128 {text, model_id} -> audio bytes.
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.elevenlabs.io/v1';
// Default voice id is the docs example ("Rachel"-style premade voice); override with ELEVENLABS_VOICE_ID.
const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

export const elevenLabsEnabled = () => !!process.env.ELEVENLABS_API_KEY;

export class ElevenLabsError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const extFor = (mime) =>
  /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogg' : /mp4|m4a|aac/.test(mime) ? 'mp4' : /wav/.test(mime) ? 'wav' : /mpeg|mp3/.test(mime) ? 'mp3' : 'bin';

/** Returns the transcript text ('' when nothing was heard). lang is an optional ISO code hint. */
export async function speechToText(buffer, mimeType = 'audio/webm', lang) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new ElevenLabsError('Voice transcription is not configured', 503);
  const form = new FormData();
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v2');
  if (lang && /^[a-z]{2,3}$/i.test(lang)) form.append('language_code', lang.toLowerCase());
  const clean = String(mimeType).split(';')[0].trim() || 'audio/webm';
  form.append('file', new Blob([buffer], { type: clean }), `audio.${extFor(clean)}`);
  const r = await fetch(`${API}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key }, body: form });
  if (!r.ok) throw new ElevenLabsError(`Transcription failed (${r.status})`);
  const d = await r.json();
  return String(d.text ?? d.transcripts?.map((t) => t.text).join(' ') ?? '').trim();
}

/** Returns an audio/mpeg Buffer, cached on disk by hash of text+lang+voice. */
export async function textToSpeech(text, lang = 'en') {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new ElevenLabsError('Read-aloud is not configured', 503);
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const model = process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2';
  const hash = createHash('sha256').update(JSON.stringify([text, lang, voice, model])).digest('hex');
  const dir = process.env.TTS_CACHE_DIR || join('data', 'tts-cache');
  const file = join(dir, `${hash}.mp3`);
  if (existsSync(file)) return readFileSync(file);
  const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    // multilingual_v2 infers the language from the text, so no language_code is sent.
    body: JSON.stringify({ text, model_id: model }),
  });
  if (!r.ok) throw new ElevenLabsError(`Text-to-speech failed (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new ElevenLabsError('Text-to-speech returned no audio');
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, file);
  return buf;
}
