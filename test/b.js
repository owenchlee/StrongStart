// Lane B checks: token routes, online feedback, photo pipeline (fake Gemini + fake Cloudinary), rate limiting, staff-only routes.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';

process.env.REQUIRE_AUTH = '1'; // these tests exercise the login-protected mode
process.env.AUTH_DEV_LOGIN = '1';
process.env.STAFF_ADMIN_EMAILS = 'staff@example.org';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GEMINI_API_KEY;
delete process.env.CLOUDINARY_URL;
process.env.BASE_URL = 'https://app.example.org';

const { app } = await import('../src/server.js');
const { run, one, close } = await import('../src/db.js');
const ai = await import('../src/ai.js');
const cld = await import('../src/cloudinary.js');

mkdirSync('data/uploads', { recursive: true });
const before = new Set(readdirSync('data/uploads'));
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const req = (u, init = {}) => fetch(base + u, { redirect: 'manual', ...init });
const json = (u, method, body, headers = {}) => req(u, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 2)]);
const photoForm = (...files) => { const fd = new FormData(); for (const [name, buf, type] of files) fd.append('photos', new Blob([buf], { type }), name); return fd; };

// Fake Gemini: returns queued JSON objects (or throws when the queue item is an Error).
const queue = [];
const calls = [];
ai.__setGeminiForTests({ models: { generateContent: async (a) => { calls.push(a); const n = queue.shift(); if (n instanceof Error) throw n; return { text: JSON.stringify(n) }; } } });

try {
  const { rows: [fac] } = await run("INSERT INTO facilitators (name,email) VALUES ('F','f@example.org') RETURNING id");
  const mk = async (name) => (await run('INSERT INTO programs (facilitator_id,name,location) VALUES ($1,$2,$3) RETURNING id, token', [fac.id, name, 'Town'])).rows[0];
  const prog = await mk('Spring <b>Group</b>');
  const prog2 = await mk('Rate Group');
  assert.ok(prog.token.length >= 20);

  // Unknown / malformed tokens 404 everywhere without leaking.
  for (const u of ['/feedback/nope', '/upload/nope', '/sheet/nope', '/api/programs/nope/public', '/api/programs/nope/qr.png', '/feedback/' + 'a'.repeat(30), '/api/programs/1/public'])
    assert.equal((await req(u)).status, 404, u);
  assert.equal((await json('/api/feedback/' + 'a'.repeat(30), 'POST', { rating: 5 })).status, 404);
  assert.equal((await req('/api/feedback/' + 'a'.repeat(30) + '/photos', { method: 'POST', body: photoForm(['a.jpg', JPEG, 'image/jpeg']) })).status, 404);

  // Public pages / info / QR png.
  assert.equal((await req(`/feedback/${prog.token}`)).status, 200);
  assert.equal((await req(`/upload/${prog.token}`)).status, 200);
  const pub = await req(`/api/programs/${prog.token}/public`).then((r) => r.json());
  assert.deepEqual(Object.keys(pub).sort(), ['location', 'name']);
  const qr = await req(`/api/programs/${prog.token}/qr.png`);
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.deepEqual([...Buffer.from(await qr.arrayBuffer()).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  // Sheet page: escaped name, QR, multilingual text; uses Cloudinary-hosted image when available.
  let sheet = await req(`/sheet/${prog.token}`).then((r) => r.text());
  assert.match(sheet, /Scan to share your feedback/);
  assert.match(sheet, /Escanea/);
  assert.match(sheet, /Spring &lt;b&gt;Group&lt;\/b&gt;/);
  assert.ok(!sheet.includes('<b>Group'));
  assert.match(sheet, /data:image\/png;base64/);

  // Online feedback validation.
  const post = (b) => json(`/api/feedback/${prog.token}`, 'POST', b);
  for (const bad of [{}, { rating: 0 }, { rating: 6 }, { rating: 'x' }, { rating: 2.5 }]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  const okr = await post({ rating: '5', would_recommend: 'yes', most_valued: 'The songs', suggestions: 'x'.repeat(5000), language: 'es' });
  assert.equal(okr.status, 200);
  const row = await one('SELECT * FROM feedback WHERE id=$1', [(await okr.json()).id]);
  assert.equal(row.source, 'qr'); assert.equal(row.rating, 5); assert.equal(row.would_recommend, true);
  assert.equal(row.suggestions.length, 2000); assert.equal(row.needs_review, false); assert.equal(row.language, 'es');

  // Photo upload with fake AI (local storage fallback).
  const form = (o = {}) => ({ rating: 4, would_recommend: true, most_valued: 'Los canciones', suggestions: '', raw_text: 'Los canciones', language: 'es', translated_text: 'The songs', confidence: 'high', ...o });
  queue.push(form(), form({ rating: null }), form({ confidence: 'low' }), new Error('boom'), form({ raw_text: 'se [illegible] mucho' }));
  const up = await req(`/api/feedback/${prog.token}/photos`, { method: 'POST', body: photoForm(['1.jpg', JPEG, 'image/jpeg'], ['2.png', PNG, 'image/png'], ['3.jpg', JPEG, 'image/jpeg'], ['4.jpg', JPEG, 'image/jpeg'], ['5.jpg', JPEG, 'image/jpeg']) });
  assert.equal(up.status, 200);
  const d = await up.json();
  assert.equal(d.aiEnabled, true);
  assert.deepEqual(d.results.map((r) => r.status), ['saved', 'needs_review', 'needs_review', 'needs_review', 'needs_review']);
  assert.ok(d.results[3].error);
  const r0 = await one('SELECT * FROM feedback WHERE id=$1', [d.results[0].id]);
  assert.equal(r0.source, 'photo'); assert.equal(r0.language, 'es'); assert.equal(r0.translated_text, 'The songs');
  assert.equal(r0.most_valued, 'Los canciones'); assert.equal(r0.needs_review, false); assert.ok(r0.image_path);
  assert.equal((await one('SELECT needs_review FROM feedback WHERE id=$1', [d.results[3].id])).needs_review, true);
  // AI received the image inline (local file), with the untrusted-data system instruction.
  const photoCall = calls.find((c) => c.contents[0].parts.some((p) => p.inlineData));
  assert.match(photoCall.config.systemInstruction, /untrusted/i);
  assert.equal(photoCall.config.responseMimeType, 'application/json');

  // Output clamping.
  const n = ai.normalizeFeedback({ rating: 9, would_recommend: 'maybe', most_valued: 5, suggestions: 'ok', raw_text: 'x', language: 'EN', translated_text: 'ignored', confidence: 'sure' });
  assert.deepEqual([n.rating, n.would_recommend, n.most_valued, n.translated_text, n.confidence, n.language], [null, null, '', '', 'low', 'en']);

  // Non-image rejected (wrong type and fake mimetype with bad magic bytes).
  assert.equal((await req(`/api/feedback/${prog.token}/photos`, { method: 'POST', body: photoForm(['a.txt', Buffer.from('hello'), 'text/plain']) })).status, 400);
  const fake = await req(`/api/feedback/${prog.token}/photos`, { method: 'POST', body: photoForm(['evil.jpg', Buffer.from('<?php echo 1;'), 'image/jpeg']) });
  const fd = await fake.json();
  assert.equal(fd.results[0].status, 'error');
  assert.equal((await req(`/api/feedback/${prog.token}/photos`, { method: 'POST', body: new FormData() })).status, 400);
  assert.ok(!readdirSync('data/uploads').some((f) => f.endsWith('.tmp')), 'temp files cleaned up');

  // Cloudinary path (fake): uploaded, local temp deleted, image_url stored, AI reads the hosted URL.
  const uploads = [];
  cld.__setCloudinaryForTests({
    uploader: { upload: async (p, o) => { uploads.push({ p, o }); return { public_id: 'x/y', version: 1, secure_url: 'https://res.example/orig.jpg' }; } },
    url: () => 'https://res.example/readable.jpg',
  });
  const origFetch = globalThis.fetch;
  queue.push(form({ language: 'en', translated_text: 'ignored' }));
  const seen = [];
  // Gemini fake never fetches here because ai.js fetches the URL: stub fetch for that host only.
  globalThis.fetch = async (u, init) => (String(u).startsWith('https://res.example/') ? (seen.push(String(u)), new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })) : origFetch(u, init));
  const cu = await origFetch(`${base}/api/feedback/${prog.token}/photos`, { method: 'POST', body: photoForm(['c.jpg', JPEG, 'image/jpeg']) }).then((r) => r.json());
  globalThis.fetch = origFetch;
  assert.equal(cu.results[0].status, 'saved');
  const cr = await one('SELECT * FROM feedback WHERE id=$1', [cu.results[0].id]);
  assert.equal(cr.image_url, 'https://res.example/readable.jpg'); assert.equal(cr.image_path, null); assert.equal(cr.translated_text, null);
  assert.deepEqual(seen, ['https://res.example/readable.jpg']);
  assert.ok(uploads[0].o.folder.endsWith(prog.token)); assert.ok(uploads[0].o.tags.includes(`program-${prog.token}`));
  assert.ok(!existsSync(uploads[0].p), 'local temp deleted after upload');
  sheet = await req(`/sheet/${prog.token}`).then((r) => r.text());
  assert.match(sheet, /https:\/\/res\.example\/readable\.jpg/, 'hosted sheet image used');
  cld.__setCloudinaryForTests(null);

  // Staff-only routes.
  const fid = d.results[1].id;
  assert.equal((await req(`/api/feedback/${fid}/image`)).status, 401);
  assert.equal((await json(`/api/feedback/${fid}`, 'PATCH', { rating: 3 })).status, 401);
  const login = await json('/auth/dev-login', 'POST', { email: 'staff@example.org' });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const staff = (u, m, b) => json(u, m, b, { cookie });
  const img = await req(`/api/feedback/${fid}/image`, { headers: { cookie } });
  assert.equal(img.status, 200);
  assert.equal(Buffer.from(await img.arrayBuffer()).length, PNG.length);
  const red = await req(`/api/feedback/${cu.results[0].id}/image`, { headers: { cookie } });
  assert.equal(red.status, 302); assert.equal(red.headers.get('location'), 'https://res.example/readable.jpg');
  assert.equal((await req('/api/feedback/999999/image', { headers: { cookie } })).status, 404);
  await run("UPDATE feedback SET image_path='../../package.json' WHERE id=$1", [fid]);
  assert.equal((await req(`/api/feedback/${fid}/image`, { headers: { cookie } })).status, 404, 'no path traversal');
  assert.equal((await staff(`/api/feedback/${fid}`, 'PATCH', { rating: 9 })).status, 400);
  assert.equal((await staff(`/api/feedback/${fid}`, 'PATCH', { rating: 3, would_recommend: false, most_valued: 'fixed', translated_text: 'fixed en' })).status, 200);
  const fx = await one('SELECT * FROM feedback WHERE id=$1', [fid]);
  assert.deepEqual([fx.rating, fx.would_recommend, fx.most_valued, fx.translated_text, fx.needs_review, fx.suggestions], [3, false, 'fixed', 'fixed en', false, '']);
  assert.equal((await staff('/api/feedback/999999', 'PATCH', { rating: 3 })).status, 404);

  // Rate limiting on public POSTs (429 JSON), scoped per token.
  let last;
  for (let i = 0; i < 25; i++) last = await json(`/api/feedback/${prog2.token}`, 'POST', { rating: 3 });
  assert.equal(last.status, 429);
  assert.ok((await last.json()).error);
  assert.ok(last.headers.get('retry-after'));
  assert.equal((await post({ rating: 3 })).status, 200, 'other token unaffected');

  // AI off: photo saved and flagged for review.
  ai.__setGeminiForTests(null);
  assert.equal(await ai.transcribeFeedbackPhoto('x.jpg'), null);
  const off = await req(`/api/feedback/${prog.token}/photos`, { method: 'POST', body: photoForm(['o.jpg', JPEG, 'image/jpeg']) }).then((r) => r.json());
  assert.deepEqual([off.aiEnabled, off.results[0].status], [false, 'needs_review']);

  console.log('All lane B checks passed');
} finally {
  server.close();
  for (const f of readdirSync('data/uploads')) if (!before.has(f)) rmSync('data/uploads/' + f, { force: true });
  await close();
}
