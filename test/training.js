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

  // malformed JSON from a client is their mistake: 400, not a 500
  const bad = await fetch(`${base}/api/feedback/abc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);

  console.log('All training checks passed');
} finally {
  server.close();
  await close().catch(() => {});
}
