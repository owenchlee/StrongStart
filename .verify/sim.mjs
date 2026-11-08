// End-to-end simulation of the Strong Start loop. Run from the project root: node <this file>
import assert from 'node:assert/strict';
delete process.env.TIGER_DATABASE_URL; delete process.env.PGLITE_DIR; delete process.env.GEMINI_API_KEY;
delete process.env.ELEVENLABS_API_KEY; delete process.env.CLOUDINARY_URL;
process.env.REQUIRE_AUTH = '1'; process.env.AUTH_DEV_LOGIN = '1'; process.env.STAFF_ADMIN_EMAILS = 'staff@example.org';
process.env.BASE_URL = 'http://localhost:3000';

const ROOT = process.cwd();
const { app } = await import(`${ROOT}/src/server.js`);
const { close } = await import(`${ROOT}/src/db.js`);
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const findings = []; let checks = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => { checks++; }, (e) => { findings.push(`${name}: ${e.message.split('\n')[0]}`); });
const j = (r) => r.json();
const post = (u, body, h = {}) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });
const loginRes = await post('/auth/dev-login', { email: 'staff@example.org' });
const cookie = loginRes.headers.getSetCookie()[0].split(';')[0];
const staff = (u, method = 'GET', body) => fetch(base + u, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

// ---- 0. security: staff pages closed, public pages open
await check('staff API blocked anonymously', async () => { assert.equal((await fetch(base + '/api/orders')).status, 401); });
await check('dashboard page redirects/blocks anonymously', async () => { const r = await fetch(base + '/', { redirect: 'manual' }); assert.ok([301, 302, 303, 401].includes(r.status), `status ${r.status}`); });
await check('login page public', async () => { assert.equal((await fetch(base + '/login.html')).status, 200); });
await check('public training page', async () => { assert.equal((await fetch(base + '/training/register')).status, 200); });
await check('public resources page', async () => { assert.equal((await fetch(base + '/resources')).status, 200); });

// ---- 1. staff creates a training session
const sess = await staff('/api/training/sessions', 'POST', { title: 'Fall training', session_date: '2026-12-01', capacity: 2 }).then(j);
await check('session created', () => assert.ok(sess.id));

// ---- 2. three facilitators run the whole pipeline
const facs = [
  { email: 'ana@example.org', name: 'Ana', parents: [5, 4, 5, 3], projected: 6 },
  { email: 'ben@example.org', name: 'Ben', parents: [2, 3], projected: 2 },
  { email: 'cy@example.org', name: 'Cy', parents: [], projected: 5 },
];
const progs = [];
for (const f of facs) {
  // inbound email -> order form link
  const inb = await post('/api/inbound-email', { from: `${f.name} <${f.email}>`, email: f.email, name: f.name, subject: 'Kit request', body: 'Please send 2 kits' }).then(j);
  await check(`${f.name}: inbound email gives order link`, () => assert.match(inb.orderLink, /\/order\/.+/));
  const tok = inb.orderLink?.split('/order/')[1];
  await check(`${f.name}: order page loads`, async () => { assert.equal((await fetch(`${base}/order/${tok}`)).status, 200); });
  const form = await fetch(`${base}/api/order-form/${tok}`).then(j);
  await check(`${f.name}: order form has kit items`, () => assert.ok(form.kitItems?.length));

  // training registration (capacity 2 -> Cy should be rejected, a real edge case)
  const reg = await post('/api/training/register', { training_session_id: sess.id, name: f.name + ' Test', email: f.email });
  if (f.name === 'Cy') await check('full session rejected with 409', () => assert.equal(reg.status, 409));
  else await check(`${f.name}: training registration`, () => assert.equal(reg.status, 200));

  // submit order
  const sub = await post(`/api/order-form/${tok}`, { facilitator_name: f.name, shipping_address: '1 Main St', items: [{ item: form.kitItems[0].name ?? form.kitItems[0], qty: 2 }], program: { name: `${f.name} program`, projected_participants: f.projected, delivery_format: 'in_person' } });
  const subBody = await sub.json();
  await check(`${f.name}: order submitted`, () => assert.equal(sub.status, 200, JSON.stringify(subBody)));
  await check(`${f.name}: double submit blocked`, async () => assert.equal((await post(`/api/order-form/${tok}`, { shipping_address: 'x', items: [{ item: 'x', qty: 1 }], program: { name: 'x' } })).status, 409));
  progs.push({ ...f, tok, programId: subBody.programId, orderId: subBody.orderId });
}

// staff: complete training for registered ones, ship orders
const orders = await staff('/api/orders').then(j);
await check('orders listed for staff', () => assert.equal(orders.length, 3));
for (const p of progs) {
  const shipped = await staff(`/api/orders/${p.orderId}/ship`, 'POST', {});
  await check(`${p.name}: ship`, () => assert.equal(shipped.status, 200));
  await check(`${p.name}: ship twice rejected`, async () => assert.equal((await staff(`/api/orders/${p.orderId}/ship`, 'POST', {})).status, 409));
  const rec = await fetch(`${base}/received/${p.tok}`);
  await check(`${p.name}: received link shows confirm page`, () => assert.equal(rec.status, 200));
  const confirmed = await fetch(`${base}/received/${p.tok}`, { method: 'POST' });
  await check(`${p.name}: received confirmed by button`, () => assert.equal(confirmed.status, 200));
}
const roster = await staff(`/api/training/sessions/${sess.id}/roster`).then(j);
await check('roster has 2', () => assert.equal((Array.isArray(roster) ? roster : roster.roster ?? []).length, 2));
const regRow = (Array.isArray(roster) ? roster : roster.roster)?.[0];
const complete = await staff(`/api/training/registrations/${regRow?.id ?? regRow?.registration_id}/complete`, 'POST', {});
const completeBody = await complete.json().catch(() => ({}));
await check('training completion', () => assert.equal(complete.status, 200, JSON.stringify(completeBody)));
const code = completeBody.certificate_code ?? completeBody.certificateCode ?? completeBody.code;
await check('certificate verifiable', async () => { assert.ok(code, 'no certificate code in response: ' + JSON.stringify(completeBody)); assert.equal((await fetch(`${base}/api/certificates/${code}`)).status, 200); });
await check('bad certificate 404', async () => assert.equal((await fetch(`${base}/api/certificates/NOPE`)).status, 404));

// ---- 3. parents give feedback via QR (public pages)
const programRows = await staff('/api/programs').then(j);
for (const p of progs) {
  const row = programRows.find((r) => r.id === p.programId);
  p.token = row?.token;
  await check(`${p.name}: program token`, () => assert.ok(p.token));
  await check(`${p.name}: feedback page`, async () => assert.equal((await fetch(`${base}/feedback/${p.token}`)).status, 200));
  await check(`${p.name}: QR png`, async () => { const r = await fetch(`${base}/api/programs/${p.token}/qr.png`); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /png/); });
  await check(`${p.name}: print sheet`, async () => assert.equal((await fetch(`${base}/sheet/${p.token}`)).status, 200));
  for (const r of p.parents) {
    const res = await post(`/api/feedback/${p.token}`, { rating: r, would_recommend: r >= 4 ? 'yes' : 'no', most_valued: 'The songs', suggestions: '', language: 'en' });
    await check(`${p.name}: parent rating ${r}`, () => assert.equal(res.status, 200));
  }
}
// hostile / sloppy parents
const t0 = progs[0].token;
await check('rating 0 rejected', async () => assert.equal((await post(`/api/feedback/${t0}`, { rating: 0 })).status, 400));
await check('rating 6 rejected', async () => assert.equal((await post(`/api/feedback/${t0}`, { rating: 6 })).status, 400));
await check('rating string junk rejected', async () => assert.equal((await post(`/api/feedback/${t0}`, { rating: 'abc' })).status, 400));
await check('unknown token 404', async () => assert.equal((await post('/api/feedback/' + 'x'.repeat(22), { rating: 5 })).status, 404));
await check('numeric program id not usable as token', async () => assert.equal((await post('/api/feedback/1', { rating: 5 })).status, 404));
await check('huge text clipped, not crashing', async () => { const r = await post(`/api/feedback/${t0}`, { rating: 4, most_valued: 'a'.repeat(50000) }); assert.equal(r.status, 200); });
await check('malformed JSON handled (no 500)', async () => { const r = await fetch(`${base}/api/feedback/${t0}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }); assert.ok(r.status < 500, 'status ' + r.status); });
await check('photo upload with no files 400', async () => { const r = await fetch(`${base}/api/feedback/${t0}/photos`, { method: 'POST', body: new FormData() }); assert.equal(r.status, 400); });
await check('photo upload fake image rejected', async () => { const fd = new FormData(); fd.append('photos', new Blob(['not an image'], { type: 'image/png' }), 'x.png'); const r = await fetch(`${base}/api/feedback/${t0}/photos`, { method: 'POST', body: fd }); const b = await r.json(); assert.equal(b.results?.[0]?.status, 'error'); });
await check('photo upload valid PNG lands in review queue (AI off)', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData(); fd.append('photos', new Blob([png], { type: 'image/png' }), 'form.png');
  const r = await fetch(`${base}/api/feedback/${t0}/photos`, { method: 'POST', body: fd }); const b = await r.json();
  assert.equal(r.status, 200, JSON.stringify(b)); assert.equal(b.results[0].needsReview, true);
});
await check('rate limit eventually trips on feedback flood', async () => {
  let saw429 = false; for (let i = 0; i < 80 && !saw429; i++) saw429 = (await post(`/api/feedback/${progs[0].token}`, { rating: 5 })).status === 429;
  assert.ok(saw429, 'no 429 after 80 rapid submissions from one client (spam risk: one device can inflate a program\'s ratings)');
});

// ---- 4. facilitator completion report
await check('completion form loads', async () => { const b = await fetch(`${base}/api/programs/${progs[0].token}/completion-form`).then(j); assert.equal(b.kitsShipped, 2); });
await check('completion needs confirmation', async () => assert.equal((await post(`/api/programs/${progs[0].token}/completion`, { families_served: 5 })).status, 400));
await check('completion submit', async () => assert.equal((await post(`/api/programs/${progs[0].token}/completion`, { completion_confirmed: true, families_served: 5, kits_distributed: 2 })).status, 200));
await check('completion double submit 409', async () => assert.equal((await post(`/api/programs/${progs[0].token}/completion`, { completion_confirmed: true })).status, 409));

// ---- 5. staff dashboard numbers must match what was submitted
const ov = await staff('/api/overview').then(j);
await check('overview: 3 programs', () => assert.equal(ov.programs, 3));
await check('overview: 1 completed program', () => assert.equal(ov.completedPrograms, 1));
await check('overview: needsReview >= 1', () => assert.ok(ov.needsReview >= 1));
const out = await staff('/api/outstanding').then(j);
await check('outstanding lists Cy (0 of 5) first-ish and excludes Ben (2 of 2)', () => { assert.ok(out.find((o) => o.name === 'Cy program')); assert.ok(!out.find((o) => o.name === 'Ben program')); });
const roll = await staff('/api/rollup').then(j);
const ben = roll.byFacilitator.find((x) => x.name === 'Ben');
await check('rollup: Ben avg rating 2.5 and recommend 0%', () => { assert.equal(ben.avg_rating, 2.5); assert.equal(ben.recommend_pct, 0); });
const trends = await staff('/api/trends?days=30').then(j);
await check('trends has today with responses', () => assert.ok(trends.responsesPerDay.reduce((s, d) => s + d.responses, 0) >= 6));
await check('trends delivery measured (received orders)', () => assert.equal(trends.orderToDelivery.orders, 3));
const csv = await staff('/api/export/feedback.csv'); const csvText = await csv.text();
await check('feedback CSV has header + rows', () => { assert.equal(csv.status, 200); assert.ok(csvText.split('\n').length > 6); });
const emails = (await staff('/api/emails').then(j)).outbox;
await check('emails logged: order form, confirmation, shipped, received, cert', () => {
  const subj = emails.map((e) => e.subject).join('|');
  for (const s of ['order form', 'Order confirmation', 'shipped', 'kits received', 'Certification']) assert.ok(subj.toLowerCase().includes(s.toLowerCase()), 'missing email: ' + s);
});

console.log(JSON.stringify({ checks, failures: findings.length, findings }, null, 2));
server.close(); await close().catch(() => {}); process.exit(findings.length ? 1 : 0);
