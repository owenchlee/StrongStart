// Staff login checks: staff routes need a login, public routes don't, and only emails in the staff table get in.
import assert from 'node:assert/strict';

delete process.env.TIGER_DATABASE_URL; // in-memory PGlite
delete process.env.PGLITE_DIR;
process.env.REQUIRE_AUTH = '1'; // these tests exercise the login-protected mode
process.env.AUTH_DEV_LOGIN = '1';
process.env.STAFF_ADMIN_EMAILS = 'Admin@Example.org';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.SMTP_HOST;

const { app } = await import('../src/server.js');
const { one, run, close } = await import('../src/db.js');
const { addStaff } = await import('../src/auth.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const req = (u, init = {}) => fetch(base + u, { redirect: 'manual', ...init });
const devLogin = (email) => req('/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });

try {
  // Staff routes are locked without a login (including case/trailing-slash variants).
  for (const u of ['/api/overview', '/api/trends', '/api/rollup', '/api/outstanding', '/api/staff', '/api/export/feedback.csv', '/api/export/programs.csv', '/api/compose/facilitators', '/api/orders', '/api/programs', '/api/programs/1/report', '/api/review-queue', '/api/emails', '/API/Overview', '/api/emails/', '/api/feedback/1/image', '/api/something-new'])
    assert.equal((await req(u)).status, 401, `${u} should be 401`);
  assert.equal((await req('/api/feedback/1', { method: 'PATCH' })).status, 401);
  assert.equal((await req('/api/orders/1/ship', { method: 'POST' })).status, 401);
  for (const u of ['/', '/index.html', '/INDEX.HTML', '/compose.html', '/COMPOSE.HTML']) {
    const r = await req(u);
    assert.equal(r.status, 302, `${u} should redirect`);
    assert.equal(r.headers.get('location'), '/login.html');
  }

  // Public routes still work with no login.
  assert.equal((await req('/login.html')).status, 200);
  assert.equal((await req('/order/abc')).status, 200);
  await run("INSERT INTO facilitators (id,email) VALUES (1,'f@example.org')");
  const ptok = (await one("INSERT INTO programs (facilitator_id,name) VALUES (1,'P') RETURNING token")).token;
  for (const pg of ['feedback', 'upload', 'sheet']) assert.equal((await req(`/${pg}/${ptok}`)).status, 200, `/${pg}/:token is public`);
  assert.equal((await req('/feedback/1')).status, 404, 'numeric ids are not valid links');
  assert.notEqual((await req('/api/tts?text=hi')).status, 401, 'tts is public');
  assert.notEqual((await req('/api/feedback/sometoken/voice', { method: 'POST' })).status, 401, 'voice answers are public');
  assert.equal((await req('/api/compose/send', { method: 'POST' })).status, 401, 'compose is staff-only');
  assert.equal((await req('/api/programs/1/public')).status, 404, 'reaches the route (404 = no such program), not 401');
  assert.equal((await req('/api/order-form/nope')).status, 404);
  const me = await req('/api/me').then((r) => r.json());
  assert.deepEqual([me.staff, me.google, me.devLogin], [null, false, true]);

  // Only emails in the staff table can sign in (case-insensitive); inactive staff cannot.
  assert.equal((await devLogin('stranger@example.org')).status, 403);
  const ok = await devLogin('admin@example.org');
  assert.equal(ok.status, 200);
  const sc = ok.headers.getSetCookie()[0];
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  const cookie = sc.split(';')[0];
  const authed = (u, init = {}) => req(u, { ...init, headers: { cookie, ...init.headers } });
  assert.equal((await authed('/api/overview')).status, 200);
  assert.equal((await authed('/')).status, 200);
  assert.equal((await authed('/compose.html')).status, 200, 'staff can open compose page');
  assert.equal((await authed('/api/me').then((r) => r.json())).staff.email, 'admin@example.org');
  assert.equal((await one('SELECT COUNT(*)::int n FROM sessions WHERE id=$1', [cookie.split('=')[1]])).n, 0, 'raw token is never stored');

  // Deactivating staff ends their session immediately.
  await run("UPDATE staff SET active=false WHERE email='admin@example.org'");
  assert.equal((await authed('/api/overview')).status, 401);
  assert.equal((await devLogin('admin@example.org')).status, 403);
  await addStaff('admin@example.org'); // re-adding reactivates
  assert.equal((await devLogin('admin@example.org')).status, 200);

  // Logout invalidates the session; Google flow reports "not configured" instead of crashing.
  assert.equal((await authed('/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await authed('/api/overview')).status, 401);
  assert.equal((await req('/auth/google')).headers.get('location'), '/login.html?error=not_configured');
  assert.equal((await req('/auth/google/callback?code=x&state=bogus')).headers.get('location'), '/login.html?error=oauth_failed');
  console.log('All auth checks passed');
} finally {
  server.close();
  await close();
}
