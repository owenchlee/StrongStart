// End-to-end check of the whole workflow against a throwaway database. Run: npm test
import assert from 'node:assert/strict';

delete process.env.TIGER_DATABASE_URL; // in-memory PGlite
delete process.env.PGLITE_DIR;
delete process.env.GEMINI_API_KEY; // exercise the no-AI path
delete process.env.CLOUDINARY_URL;
delete process.env.SMTP_HOST;
process.env.REQUIRE_AUTH = '1'; // these tests exercise the login-protected mode
process.env.AUTH_DEV_LOGIN = '1';
process.env.STAFF_ADMIN_EMAILS = 'staff@example.org';

const { app } = await import('../src/server.js');
const { one, close } = await import('../src/db.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
// Staff routes need a login; public routes work with or without it.
const login = await fetch(`${base}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'staff@example.org' }) });
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const get = (u, init = {}) => fetch(base + u, { ...init, headers: { cookie, ...init.headers } });
const post = (u, body, method = 'POST') =>
  fetch(base + u, { method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

try {
  // 1. facilitator email arrives -> order form link emailed
  let r = await post('/api/inbound-email', { from: 'Jo Facilitator <jo@example.org>', subject: 'Need kits', body: 'Hi' });
  assert.equal(r.status, 200);
  const token = r.body.orderLink.split('/').pop();
  assert.equal((await one("SELECT COUNT(*)::int n FROM outbox WHERE to_email='jo@example.org' AND body LIKE $1", [`%/order/${token}%`])).n, 1);
  assert.equal((await post('/api/inbound-email', { from: 'nope' })).status, 400);

  // 2. order form submission -> confirmation email
  r = await post(`/api/order-form/${token}`, {
    facilitator_name: 'Jo', program: { name: 'Fall Babies', location: 'Library', projected_participants: 10 },
    items: [{ item: 'Participant Kits', qty: 10 }, { item: 'Bogus', qty: 5 }], shipping_address: '1 Main St',
  });
  assert.equal(r.status, 200);
  const programId = r.body.programId;
  assert.equal((await post(`/api/order-form/${token}`, {})).status, 409, 'cannot resubmit');
  assert.equal((await one('SELECT COUNT(*)::int n FROM order_items')).n, 1, 'invalid kit ignored');
  assert.equal((await one("SELECT COUNT(*)::int n FROM outbox WHERE subject LIKE 'Order confirmation%'")).n, 1);

  // 3. shipped, then facilitator confirms receipt
  const orderId = (await one('SELECT id FROM orders WHERE token=$1', [token])).id;
  assert.equal((await post(`/api/orders/${orderId}/ship`)).status, 200);
  const confirmPage = await fetch(`${base}/received/${token}`);
  assert.equal(confirmPage.status, 200);
  assert.match(await confirmPage.text(), /Yes, the kits arrived/);
  assert.equal((await one('SELECT status FROM orders WHERE id=$1', [orderId])).status, 'shipped', 'GET (e.g. an email scanner) changes nothing');
  assert.equal((await fetch(`${base}/received/${token}`, { method: 'POST' })).status, 200);
  assert.equal((await one('SELECT status FROM orders WHERE id=$1', [orderId])).status, 'received');
  assert.equal((await one("SELECT COUNT(*)::int n FROM outbox WHERE subject LIKE 'Thanks, kits received'")).n, 1);

  // 4a. QR code + online feedback
  const ptoken = (await one('SELECT token FROM programs WHERE id=$1', [programId])).token;
  assert.ok(ptoken && ptoken.length >= 22, 'programs get a random token');
  const qr = await fetch(`${base}/api/programs/${ptoken}/qr.png`);
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.equal((await post(`/api/feedback/${ptoken}`, { rating: 5, would_recommend: 'yes', most_valued: 'Meeting other parents' })).status, 200);
  assert.equal((await post(`/api/feedback/${ptoken}`, { rating: 9 })).status, 400);
  await post(`/api/feedback/${ptoken}`, { rating: 3, would_recommend: 'no', suggestions: 'Longer sessions' });

  // 4b. photo upload (no AI key -> flagged for human review, then corrected)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('photos', new Blob([png], { type: 'image/png' }), 'form1.png');
  const up = await fetch(`${base}/api/feedback/${ptoken}/photos`, { method: 'POST', body: fd }).then((x) => x.json());
  assert.equal(up.results[0].needsReview, true);
  const fbId = up.results[0].id;
  assert.equal((await get(`/api/feedback/${fbId}/image`, { redirect: 'manual' })).status < 400, true);
  assert.equal((await fetch(`${base}/api/feedback/${fbId}/image`)).status, 401, 'photo is staff-only');
  assert.equal((await fetch(`${base}/api/programs/${programId}/report`)).status, 401, 'report is staff-only');
  assert.equal((await fetch(`${base}/api/programs/${ptoken}/public`)).status, 200, 'token page data is public');
  for (const pg of ['feedback', 'upload', 'sheet']) assert.equal((await fetch(`${base}/${pg}/${ptoken}`)).status, 200);
  assert.equal((await fetch(`${base}/feedback/${programId}`)).status, 404);
  const listed = await get('/api/programs').then((x) => x.json());
  assert.equal(listed[0].token, ptoken);
  assert.equal((await post(`/api/feedback/${fbId}`, { rating: 4, would_recommend: true, most_valued: 'Songs', suggestions: '' }, 'PATCH')).status, 200);

  // 5. report
  const rep = await get(`/api/programs/${programId}/report`).then((x) => x.json());
  assert.equal(rep.responses, 3);
  assert.deepEqual(rep.bySource, { qr: 2, photo: 1, voice: 0 });
  assert.equal(rep.avgRating, 4);
  assert.equal(rep.responseRate, 30);
  assert.equal(rep.recommendPct, 67);
  assert.equal(rep.needsReview, 0);
  console.log('All smoke checks passed');
} finally {
  server.close();
  await close();
}
