// Today feed: GET /api/todo lists one item of each kind of pending staff work, oldest first, with counts.
import assert from 'node:assert/strict';
import { readdirSync, rmSync, mkdirSync } from 'node:fs';

delete process.env.TIGER_DATABASE_URL; // in-memory PGlite
delete process.env.PGLITE_DIR;
delete process.env.GEMINI_API_KEY; // photo uploads land in the review queue
delete process.env.CLOUDINARY_URL;
delete process.env.SMTP_HOST;
delete process.env.INBOUND_EMAIL_SECRET;
process.env.REQUIRE_AUTH = '1';
process.env.AUTH_DEV_LOGIN = '1';
process.env.STAFF_ADMIN_EMAILS = 'staff@example.org';

const { app } = await import('../src/server.js');
const { run, one, close } = await import('../src/db.js');
mkdirSync('data/uploads', { recursive: true });
const before = new Set(readdirSync('data/uploads'));
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const send = (u, method, body, headers = {}) =>
  fetch(base + u, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

try {
  const login = await fetch(`${base}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'staff@example.org' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const staff = (u, method = 'GET', body) => send(u, method, body, { cookie });

  assert.equal((await send('/api/todo', 'GET')).status, 401, 'staff only');
  const empty = (await staff('/api/todo')).body;
  assert.equal(empty.counts.total, 0);
  assert.deepEqual(empty.newPartners, []);

  // new partner (public expression of interest)
  const eoi = await send('/api/partners/interest', 'POST', { name: 'Elm Family Centre', contact_email: 'lee@elm.org' });
  assert.equal(eoi.status, 200);

  // two kit orders through the public order form; the first program ended in 2020 with no completion report
  const order = async (email, program) => {
    const tok = (await send('/api/inbound-email', 'POST', { from: email, subject: 'kits', body: 'hi' })).body.orderLink.split('/').pop();
    const r = await send(`/api/order-form/${tok}`, 'POST', { facilitator_name: 'Fac ' + email, program, items: [{ item: 'Participant Kits', qty: 8 }], shipping_address: '1 Main St' });
    assert.equal(r.status, 200);
    return r.body;
  };
  const toShip = await order('ann@example.org', { name: 'Old Sprouts', start_date: '2020-01-01', end_date: '2020-01-31' });
  const shipped = await order('bo@example.org', { name: 'New Sprouts', end_date: '2099-01-01' });
  assert.equal((await staff(`/api/orders/${shipped.orderId}/ship`, 'POST')).status, 200);
  await run("UPDATE orders SET shipped_at=now() - interval '10 days' WHERE id=$1", [shipped.orderId]);

  // a photo of a paper form with AI off -> needs review
  const { token: ptoken } = (await run('SELECT token FROM programs WHERE id=$1', [toShip.programId])).rows[0];
  const fd = new FormData();
  fd.append('photos', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'f.png');
  const up = await fetch(`${base}/api/feedback/${ptoken}/photos`, { method: 'POST', body: fd }).then((r) => r.json());
  assert.equal(up.results[0].needsReview, true);

  // a training invite the partner has not answered yet
  const allDays = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '17:00' }));
  assert.equal((await staff('/api/me/availability', 'PUT', { timezone: 'America/Toronto', windows: allDays })).status, 200);
  assert.equal((await staff(`/api/partners/${eoi.body.partnerId}/start-training`, 'POST', {})).status, 200);

  const t = (await staff('/api/todo')).body;
  assert.deepEqual(t.counts, { newPartners: 1, ordersToShip: 1, unconfirmedShipments: 1, feedbackToReview: 1, programsMissingCompletion: 1, trainingWaiting: 1, total: 6 });
  assert.deepEqual(Object.keys(t.newPartners[0]).sort(), ['contact_email', 'created_at', 'id', 'name']);
  assert.equal(t.newPartners[0].name, 'Elm Family Centre');
  const o = t.ordersToShip[0];
  assert.equal(o.id, toShip.orderId);
  assert.equal(o.program, 'Old Sprouts');
  assert.equal(o.program_id, toShip.programId);
  assert.equal(o.shipping_address, '1 Main St');
  assert.ok(o.ordered_at && o.email === 'ann@example.org' && o.facilitator === 'Fac ann@example.org');
  assert.deepEqual(o.items, [{ item: 'Participant Kits', qty: 8 }]);
  assert.equal(t.unconfirmedShipments[0].id, shipped.orderId);
  assert.equal(t.unconfirmedShipments[0].reminder_sent_at, null);
  assert.equal(t.feedbackToReview[0].id, up.results[0].id);
  assert.equal(t.feedbackToReview[0].source, 'photo');
  assert.equal(t.feedbackToReview[0].program_id, toShip.programId);
  assert.deepEqual(t.programsMissingCompletion.map((p) => [p.id, p.name, p.token, p.end_date]), [[toShip.programId, 'Old Sprouts', ptoken, '2020-01-31']]);
  assert.equal(t.programsMissingCompletion[0].facilitator_id, (await one('SELECT facilitator_id FROM programs WHERE id=$1', [toShip.programId])).facilitator_id, 'dashboard links to the composer by facilitator id');
  assert.equal(t.trainingWaiting[0].partner, 'Elm Family Centre');
  assert.equal(t.trainingWaiting[0].partner_id, eoi.body.partnerId);
  assert.equal(t.trainingWaiting[0].invitee_email, 'lee@elm.org');

  // doing the work empties the lists
  assert.equal((await staff(`/api/orders/${toShip.orderId}/ship`, 'POST')).status, 200);
  assert.equal((await staff(`/api/feedback/${up.results[0].id}`, 'PATCH', { rating: 4 })).status, 200);
  assert.equal((await send(`/api/programs/${ptoken}/completion`, 'POST', { completion_confirmed: true, families_served: 5 })).status, 200);
  assert.equal((await staff(`/api/partners/${eoi.body.partnerId}`, 'PATCH', { stage: 'discovery' })).status, 200);
  const after = (await staff('/api/todo')).body.counts;
  assert.deepEqual([after.newPartners, after.ordersToShip, after.feedbackToReview, after.programsMissingCompletion], [0, 0, 0, 0]);

  // overview is one query and still returns every count
  const ov = (await staff('/api/overview')).body;
  assert.deepEqual([ov.partners, ov.facilitators, ov.openOrders, ov.programs, ov.completedPrograms, ov.feedbackResponses, ov.needsReview], [1, 2, 2, 2, 1, 1, 0]);

  console.log('All todo checks passed');
} finally {
  server.close();
  for (const f of readdirSync('data/uploads')) if (!before.has(f)) rmSync('data/uploads/' + f, { force: true });
  await close();
}
