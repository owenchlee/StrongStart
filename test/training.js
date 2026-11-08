// Training pipeline: register -> capacity -> complete -> certificate. Also: malformed JSON is a 400, not a 500.
import assert from 'node:assert/strict';

delete process.env.TIGER_DATABASE_URL; // in-memory PGlite
delete process.env.PGLITE_DIR;
delete process.env.GEMINI_API_KEY;
process.env.REQUIRE_AUTH = '1';
process.env.AUTH_DEV_LOGIN = '1';
process.env.STAFF_ADMIN_EMAILS = 'staff@example.org';

const { app } = await import('../src/server.js');
const { close } = await import('../src/db.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const json = (u, body, headers = {}) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

try {
  const login = await json('/auth/dev-login', { email: 'staff@example.org' });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const staff = (u, method = 'GET', body) => fetch(base + u, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

  const sess = await (await staff('/api/training/sessions', 'POST', { title: 'Fall training', session_date: '2026-12-01', capacity: 2 })).json();
  assert.ok(sess.id, 'staff can create a session');

  // public registration (this used to 500: ON CONFLICT (lower(email)) had no matching index)
  const reg = (name, email) => json('/api/training/register', { training_session_id: sess.id, name, email });
  assert.equal((await reg('Ana Test', 'Ana@Example.org')).status, 200, 'first registration');
  assert.equal((await reg('Ana Again', 'ana@example.org')).status, 200, 'same person re-registering is idempotent');
  assert.equal((await reg('Ben Test', 'ben@example.org')).status, 200, 'second registration');
  assert.equal((await reg('Cy Test', 'cy@example.org')).status, 409, 'full session is rejected');
  assert.ok(!JSON.stringify(await (await staff('/api/compose/facilitators')).json()).includes('cy@example.org'), 'a person turned away leaves no facilitator record');
  assert.equal((await reg('X', 'bad')).status, 400, 'bad name/email rejected');
  assert.equal((await json('/api/training/register', { training_session_id: 9999, name: 'Zed Z', email: 'z@example.org' })).status, 404);

  const { roster } = await (await staff(`/api/training/sessions/${sess.id}/roster`)).json();
  assert.equal(roster.length, 2, 'two people on the roster, no duplicate for the re-registration');

  const done = await staff(`/api/training/registrations/${roster[0].registration_id}/complete`, 'POST', {});
  assert.equal(done.status, 200, 'staff completes training');
  const { certificate_code: code } = await (await staff(`/api/training/sessions/${sess.id}/roster`)).json().then((r) => r.roster.find((x) => x.certificate_code) || {});
  assert.match(code || '', /^BC-[0-9A-F]{8}$/, 'certificate code issued');
  assert.equal((await fetch(`${base}/api/certificates/${code}`)).status, 200, 'certificate verifies publicly');
  assert.equal((await fetch(`${base}/api/certificates/BC-NOPE`)).status, 404, 'unknown certificate is 404');

  // re-registering: already-listed people are not turned away from a full session, are not emailed twice,
  // and finishing training can't be undone by submitting the form again (the certificate must keep verifying)
  const again = await reg('Ben Again', 'ben@example.org');
  assert.equal(again.status, 200, 'someone already on a full session is not told it is full');
  assert.equal((await again.json()).already, true);
  const redo = await reg('Ana Again', 'ana@example.org');
  assert.equal((await redo.json()).already, true);
  const after = await (await staff(`/api/training/sessions/${sess.id}/roster`)).json();
  assert.equal(after.roster.find((x) => x.email === 'ana@example.org').status, 'completed', 're-registering does not undo completion');
  assert.equal((await fetch(`${base}/api/certificates/${code}`)).status, 200, 'certificate still verifies after re-registering');
  const outbox = (await (await staff('/api/emails')).json()).outbox;
  const confirmations = (to) => outbox.filter((m) => m.to_email === to && /Training Confirmation/.test(m.subject));
  assert.equal(confirmations('ana@example.org').length, 1, 'one confirmation email, not one per click');
  assert.doesNotMatch(confirmations('ana@example.org')[0].body, /GMT|00:00:00/, 'email shows a readable date');
  assert.match(confirmations('ana@example.org')[0].body, /December 1, 2026/, 'email shows the session date');

  // edit and delete sessions (staff only; delete refused while people are registered)
  assert.equal((await fetch(`${base}/api/training/sessions/${sess.id}`, { method: 'PATCH' })).status, 401, 'edit is staff-only');
  assert.equal((await fetch(`${base}/api/training/sessions/${sess.id}`, { method: 'DELETE' })).status, 401, 'delete is staff-only');
  const ed = await staff(`/api/training/sessions/${sess.id}`, 'PATCH', { title: 'Winter training', capacity: 30, delivery_type: 'in_person' });
  assert.equal(ed.status, 200);
  assert.deepEqual(await ed.json().then((s) => [s.title, s.capacity, s.delivery_type]), ['Winter training', 30, 'in_person']);
  assert.equal((await staff(`/api/training/sessions/${sess.id}`, 'PATCH', { session_date: 'soon' })).status, 400);
  assert.equal((await staff(`/api/training/sessions/${sess.id}`, 'PATCH', {})).status, 400);
  assert.equal((await staff('/api/training/sessions/9999', 'PATCH', { title: 'x' })).status, 404);
  assert.equal((await staff(`/api/training/sessions/${sess.id}`, 'DELETE')).status, 409, 'has registrations');
  const empty = await (await staff('/api/training/sessions', 'POST', { title: 'Spare', session_date: '2026-12-02' })).json();
  assert.equal((await staff(`/api/training/sessions/${empty.id}`, 'DELETE')).status, 200);
  assert.equal((await staff(`/api/training/sessions/${empty.id}`, 'DELETE')).status, 404);
  for (const u of [`/api/training/${sess.id}/slots`, `/api/training/${sess.id}/admin/slots`])
    assert.equal((await staff(u)).status, 404, `${u} removed`);

  // malformed JSON from a client is their mistake: 400, not a 500
  const bad = await fetch(`${base}/api/feedback/abc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);

  console.log('All training checks passed');
} finally {
  server.close();
  await close().catch(() => {});
}
