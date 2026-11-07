// Lane A checks: inbound email + hints, orders, reminders, mailer, ElevenLabs audio, staff composer.
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'ss-a-'));
process.env.REQUIRE_AUTH = '1'; // these tests exercise the login-protected mode
process.env.AUTH_DEV_LOGIN = '1';
process.env.STAFF_ADMIN_EMAILS = 'staff@example.org';
process.env.TTS_CACHE_DIR = join(dir, 'tts');
process.env.BASE_URL = 'http://test.local';
for (const k of ['ELEVENLABS_API_KEY', 'INBOUND_EMAIL_SECRET', 'GEMINI_API_KEY', 'SMTP_HOST', 'GOOGLE_CLIENT_ID', 'TIGER_DATABASE_URL', 'ENABLE_JOBS']) delete process.env[k];

const { app } = await import('../src/server.js');
const { query, one, run, close } = await import('../src/db.js');
const ai = await import('../src/ai.js');
const { sendOverdueReminders, parseHints } = await import('../src/routes/orders.js');
const { renderHtml } = await import('../src/mailer.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;

// Fake ElevenLabs; everything else passes through to the real fetch (our own server).
const realFetch = globalThis.fetch;
const eleven = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.elevenlabs.io/')) {
    eleven.push({ url: String(url), init });
    if (String(url).includes('/speech-to-text')) return Response.json({ text: 'We loved the singing circle. Please run it longer.' });
    return new Response(Buffer.from('FAKEMP3'), { headers: { 'content-type': 'audio/mpeg' } });
  }
  return realFetch(url, init);
};
const req = (u, init = {}) => fetch(base + u, { redirect: 'manual', ...init });
const json = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const audioForm = (type = 'audio/webm', extra = {}) => {
  const fd = new FormData();
  fd.append('audio', new Blob([Buffer.from('fake-audio-bytes')], { type }), 'a.webm');
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return { method: 'POST', body: fd };
};
const outbox = (to) => query('SELECT * FROM outbox WHERE to_email=$1 ORDER BY id', [to]);

try {
  const login = await req('/auth/dev-login', json({ email: 'staff@example.org' }));
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const authed = (u, init = {}) => req(u, { ...init, headers: { cookie, ...init.headers } });

  // ---- hints parsing (pure) ----
  const h = parseHints('Kits please', 'Hi! Our program name is "Little Sprouts Playgroup". We expect 14 parents, need 14 kits. Starts 2030-03-04, ends March 25, 2030.\nShip to: 12 Maple Street, Springfield\nSpringfield, IL 62704', new Date('2030-01-01'));
  assert.equal(h.program_name, 'Little Sprouts Playgroup');
  assert.equal(h.participants, 14);
  assert.equal(h.kits, 14);
  assert.deepEqual(h.dates, ['2030-03-04', '2030-03-25']);
  assert.equal(h.start_date, '2030-03-04');
  assert.match(h.address, /12 Maple Street/);
  assert.deepEqual(parseHints('hi', 'nothing useful here'), {});

  // ---- inbound secret enforcement ----
  const inbound = { from: 'Dana Lee <dana@example.com>', subject: 'Kit order', body: 'Our program name is "Sprouts". 10 participants. Ship to: 5 Oak Avenue, Town' };
  assert.equal((await req('/api/inbound-email', json({ from: 'x' }))).status, 400, 'open when secret unset, validates sender');
  process.env.INBOUND_EMAIL_SECRET = 's3cret';
  assert.equal((await req('/api/inbound-email', json(inbound))).status, 401);
  assert.equal((await req('/api/inbound-email', json(inbound, { 'x-inbound-secret': 'wrong' }))).status, 401);
  assert.equal((await req('/api/inbound-email?secret=nope', json(inbound))).status, 401);
  assert.equal((await query('SELECT id FROM orders')).length, 0, 'rejected calls create nothing');
  const ok = await req('/api/inbound-email', json(inbound, { 'x-inbound-secret': 's3cret' }));
  assert.equal(ok.status, 200);
  const { orderId, orderLink } = await ok.json();
  const ok2 = await req('/api/inbound-email?secret=s3cret', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: 'sam@example.com', FromName: 'Sam', Subject: 'hi', TextBody: 'need kits' }) });
  assert.equal(ok2.status, 200, 'Postmark-style form fields + query secret');
  delete process.env.INBOUND_EMAIL_SECRET;
  const tok = orderLink.split('/').pop();
  assert.equal((await outbox('dana@example.com')).length, 1);
  assert.ok((await outbox('dana@example.com'))[0].body.includes(`http://test.local/order/${tok}`));

  // ---- order form prefill + submit ----
  const form = await req(`/api/order-form/${tok}`).then((r) => r.json());
  assert.equal(form.status, 'form_sent');
  assert.equal(form.hints.program_name, 'Sprouts');
  assert.equal(form.hints.participants, 10);
  assert.equal(form.id, undefined);
  assert.equal((await req('/api/order-form/nope')).status, 404);
  assert.equal((await req('/order/' + tok)).status, 200);

  assert.equal((await req(`/api/order-form/${tok}`, json({ program: { name: 'Sprouts' }, items: [] }))).status, 400);
  assert.equal((await req(`/api/order-form/${tok}`, json({ program: { name: 'S' }, shipping_address: 'a', items: [{ item: 'Participant Kits', qty: 1 }], requested_date: 'soon' }))).status, 400);
  const submit = { facilitator_name: 'Dana Lee', program: { name: 'Sprouts', projected_participants: 10 }, items: [{ item: 'Participant Kits', qty: 10 }, { item: 'Bogus', qty: 5 }, { item: 'Facilitator Kits', qty: 1 }], shipping_address: '5 Oak Avenue', requested_date: '2030-02-01' };
  const sub = await req(`/api/order-form/${tok}`, json(submit));
  assert.equal(sub.status, 200);
  const { programId } = await sub.json();
  assert.equal((await req(`/api/order-form/${tok}`, json(submit))).status, 409, 'double submit');
  const prog = await one('SELECT * FROM programs WHERE id=$1', [programId]);
  assert.ok(prog.token && prog.token.length >= 20);
  assert.equal((await query('SELECT * FROM order_items WHERE order_id=$1', [orderId])).length, 2, 'unknown kit dropped');
  assert.equal((await outbox('dana@example.com')).length, 2, 'confirmation sent');

  // ---- staff-only order endpoints ----
  for (const [m, u] of [['PATCH', `/api/orders/${orderId}`], ['POST', `/api/orders/${orderId}/cancel`], ['POST', `/api/orders/${orderId}/ship`], ['POST', '/api/orders/send-reminders'], ['GET', '/api/orders']])
    assert.equal((await req(u, { method: m })).status, 401, `${m} ${u}`);

  // edit
  assert.equal((await authed(`/api/orders/${orderId}`, { ...json({}), method: 'PATCH' })).status, 400);
  assert.equal((await authed(`/api/orders/${orderId}`, { ...json({ shipping_cost: -3 }), method: 'PATCH' })).status, 400);
  const patch = await authed(`/api/orders/${orderId}`, { ...json({ shipping_address: '9 Elm Road', notes: 'Leave at door', shipping_cost: '12.5', items: [{ item: 'Participant Kits', qty: 12 }] }), method: 'PATCH' });
  assert.equal(patch.status, 200);
  const pj = await patch.json();
  assert.equal(pj.order.shipping_address, '9 Elm Road');
  assert.deepEqual(pj.order.items, [{ item: 'Participant Kits', qty: 12 }]);
  assert.equal(Number(pj.order.shipping_cost), 12.5);
  assert.equal((await authed('/api/orders/99999', { ...json({ notes: 'x' }), method: 'PATCH' })).status, 404);

  // ship -> facilitator email with received link + packing slip to staff
  assert.equal((await authed(`/api/orders/${orderId}/ship`, { method: 'POST' })).status, 200);
  assert.equal((await authed(`/api/orders/${orderId}/ship`, { method: 'POST' })).status, 409);
  const shipped = (await outbox('dana@example.com')).at(-1);
  assert.match(shipped.body, new RegExp(`http://test.local/received/${tok}`));
  const staffMail = (await query("SELECT * FROM outbox WHERE subject LIKE 'Packing slip%'"))[0];
  assert.ok(staffMail, 'packing slip emailed to staff');
  assert.match(staffMail.body, /9 Elm Road/);
  assert.match(staffMail.body, /Participant Kits: 12/);
  assert.match(staffMail.body, new RegExp(`/sheet/${prog.token}`));
  assert.equal((await authed(`/api/orders/${orderId}`, { ...json({ notes: 'late' }), method: 'PATCH' })).status, 409, 'no edits after shipping');
  const list = await authed('/api/orders').then((r) => r.json());
  assert.equal(list.find((o) => o.id === orderId).status, 'shipped');

  // ---- reminders ----
  assert.equal(await sendOverdueReminders(7), 0, 'just shipped: not overdue');
  await run("UPDATE orders SET shipped_at=now() - interval '10 days' WHERE id=$1", [orderId]);
  const before = (await outbox('dana@example.com')).length;
  assert.equal((await authed('/api/orders/send-reminders', json({ days: 7 }))).status, 200);
  const after = await outbox('dana@example.com');
  assert.equal(after.length, before + 1);
  assert.match(after.at(-1).body, new RegExp(`/received/${tok}`));
  assert.ok((await one('SELECT reminder_sent_at FROM orders WHERE id=$1', [orderId])).reminder_sent_at);
  assert.equal(await sendOverdueReminders(7), 0, 'only one reminder per order');
  assert.equal((await authed('/api/orders/send-reminders', json({ days: 9999 }))).status, 400);

  // ---- received flow: emails use the program token ----
  assert.equal((await req('/received/nope')).status, 404);
  assert.equal((await req(`/received/${tok}`)).status, 200);
  assert.equal((await req(`/received/${tok}`)).status, 200, 'idempotent');
  const rec = (await outbox('dana@example.com')).filter((m) => m.subject === 'Thanks, kits received');
  assert.equal(rec.length, 1, 'thanks email sent once');
  for (const p of ['feedback', 'upload', 'sheet']) assert.ok(rec[0].body.includes(`http://test.local/${p}/${prog.token}`), p);
  assert.ok(!rec[0].body.includes(`/feedback/${programId}\n`), 'no numeric id links');
  assert.equal((await authed(`/api/orders/${orderId}/cancel`, { method: 'POST' })).status, 409, 'cannot cancel received');

  // ---- cancel ----
  const o2 = await req('/api/inbound-email', json({ from: 'cancel@example.com', body: 'hi' })).then((r) => r.json());
  assert.equal((await authed(`/api/orders/${o2.orderId}/cancel`, { method: 'POST' })).status, 200);
  const c = await one('SELECT status, cancelled_at FROM orders WHERE id=$1', [o2.orderId]);
  assert.equal(c.status, 'cancelled');
  assert.ok(c.cancelled_at);
  assert.ok((await outbox('cancel@example.com')).some((m) => /cancelled/i.test(m.subject)));
  assert.equal((await authed(`/api/orders/${o2.orderId}/cancel`, { method: 'POST' })).status, 409);
  assert.equal((await authed('/api/orders/424242/cancel', { method: 'POST' })).status, 404);

  // ---- mailer: html wrapper, escaping, header injection ----
  const { sendMail } = await import('../src/mailer.js');
  const html = renderHtml('s', 'Hi <script>alert(1)</script>\n\nSee https://x.test/a?b=1&c=2.');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<a href="https://x.test/a?b=1&amp;c=2"'));
  await sendMail('inj@example.com\r\nBcc: evil@x.com', 'Hello\r\nBcc: evil@x.com', 'body');
  const inj = (await query("SELECT * FROM outbox WHERE to_email LIKE 'inj@%'"))[0];
  assert.ok(inj && !/[\r\n]/.test(inj.to_email + inj.subject), 'no newlines in headers');

  // ---- TTS ----
  assert.equal((await req('/api/tts?text=hello&lang=en')).status, 503, 'no key');
  assert.equal(eleven.length, 0);
  process.env.ELEVENLABS_API_KEY = 'test-key';
  assert.equal((await req('/api/tts?text=&lang=en')).status, 400);
  assert.equal((await req('/api/tts?text=' + 'a'.repeat(301))).status, 400);
  const t1 = await req('/api/tts?text=Hello%20there&lang=en');
  assert.equal(t1.status, 200);
  assert.equal(t1.headers.get('content-type'), 'audio/mpeg');
  assert.equal(Buffer.from(await t1.arrayBuffer()).toString(), 'FAKEMP3');
  assert.equal(eleven.length, 1);
  assert.equal(eleven[0].init.headers['xi-api-key'], 'test-key');
  assert.match(eleven[0].url, /\/v1\/text-to-speech\//);
  assert.equal((await req('/api/tts?text=Hello%20there&lang=en')).status, 200);
  assert.equal(eleven.length, 1, 'second play served from disk cache');
  assert.equal(readdirSync(process.env.TTS_CACHE_DIR).length, 1);
  await req('/api/tts?text=Hello%20there&lang=es');
  assert.equal(eleven.length, 2, 'lang is part of the cache key');

  // ---- voice feedback ----
  const vurl = `/api/feedback/${prog.token}/voice`;
  delete process.env.ELEVENLABS_API_KEY;
  assert.equal((await req(vurl, audioForm())).status, 503, 'no key');
  process.env.ELEVENLABS_API_KEY = 'test-key';
  assert.equal((await req('/api/feedback/nope/voice', audioForm())).status, 404);
  assert.equal((await req(vurl, audioForm('text/plain'))).status, 400, 'bad mime');
  assert.equal((await req(vurl, { method: 'POST', body: new FormData() })).status, 400, 'no file');
  ai.__setGeminiForTests(null);
  const v1 = await req(vurl, audioForm('audio/webm;codecs=opus', { lang: 'en' }));
  assert.equal(v1.status, 200);
  const v1j = await v1.json();
  assert.equal(v1j.ok, true);
  assert.match(v1j.transcript, /singing circle/);
  let fb = await one('SELECT * FROM feedback WHERE id=$1', [v1j.id]);
  assert.equal(fb.source, 'voice');
  assert.equal(fb.program_id, programId);
  assert.match(fb.audio_transcript, /singing circle/);
  assert.equal(fb.needs_review, true, 'AI off -> needs review, transcript kept');
  const stt = eleven.at(-1);
  assert.match(stt.url, /\/v1\/speech-to-text$/);
  assert.equal(stt.init.body.get('model_id'), 'scribe_v2');

  ai.__setGeminiForTests({ models: { generateContent: async () => ({ text: JSON.stringify({ rating: 5, would_recommend: true, most_valued: 'Singing circle', suggestions: 'Run it longer', raw_text: 'x', language: 'en', translated_text: '' }) }) } });
  const v2 = await req(vurl, audioForm('audio/mp4')).then((r) => r.json());
  fb = await one('SELECT * FROM feedback WHERE id=$1', [v2.id]);
  assert.equal(fb.rating, 5);
  assert.equal(fb.would_recommend, true);
  assert.equal(fb.needs_review, false, 'strong AI result');
  const big = new FormData();
  big.append('audio', new Blob([Buffer.alloc(10 * 1024 * 1024 + 10)], { type: 'audio/webm' }), 'big.webm');
  assert.equal((await req(vurl, { method: 'POST', body: big })).status, 413);

  // ---- composer ----
  for (const [m, u] of [['GET', '/api/compose/facilitators'], ['POST', '/api/compose/send'], ['POST', '/api/compose/transcribe'], ['POST', '/api/compose/polish']])
    assert.equal((await req(u, { method: m })).status, 401, `${u} staff-only`);
  const facs = await authed('/api/compose/facilitators').then((r) => r.json());
  assert.ok(facs.length >= 2 && facs[0].email && facs[0].id);
  const dana = facs.find((f) => f.email === 'dana@example.com');
  const send = (b) => authed('/api/compose/send', json(b));
  assert.equal((await send({ facilitator_id: 99999, subject: 's', body: 'b' })).status, 404, 'unknown recipient');
  assert.equal((await send({ to: 'evil@example.com', subject: 's', body: 'b' })).status, 400, 'arbitrary address not accepted');
  assert.equal((await send({ facilitator_id: dana.id, subject: '', body: 'b' })).status, 400);
  assert.equal((await send({ facilitator_id: dana.id, subject: 's', body: 'x'.repeat(10001) })).status, 400);
  assert.equal((await send({ facilitator_id: dana.id, subject: 's'.repeat(201), body: 'b' })).status, 400);
  const n = (await outbox('dana@example.com')).length;
  assert.equal((await send({ facilitator_id: dana.id, subject: 'Hello\r\nBcc: x@y.z', body: 'See you soon' })).status, 200);
  const sent = (await outbox('dana@example.com')).at(-1);
  assert.equal((await outbox('dana@example.com')).length, n + 1);
  assert.ok(!/[\r\n]/.test(sent.subject));
  assert.match(sent.body, /See you soon/);
  const tr = await authed('/api/compose/transcribe', audioForm('audio/webm', { polish: '1' })).then((r) => r.json());
  assert.ok(tr.transcript);
  assert.equal((await authed('/api/compose/transcribe', audioForm('image/png'))).status, 400);
  const pol = await authed('/api/compose/polish', json({ text: 'um hi dana' }));
  assert.equal(pol.status, 200);
  ai.__setGeminiForTests(null);
  assert.equal((await authed('/api/compose/polish', json({ text: 'um hi' }))).status, 503, 'AI off');
  delete process.env.ELEVENLABS_API_KEY;
  assert.equal((await authed('/api/compose/transcribe', audioForm())).status, 503);

  console.log('All lane A checks passed');
} finally {
  globalThis.fetch = realFetch;
  server.close();
  await close();
  rmSync(dir, { recursive: true, force: true });
}
