// With REQUIRE_AUTH unset, the staff login is switched off: the dashboard and staff API open without a login,
// public pages still work, and /api/me reports it. (test/auth.js covers the protected mode.)
import assert from 'node:assert/strict';

delete process.env.REQUIRE_AUTH;
delete process.env.AUTH_DEV_LOGIN;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.SMTP_HOST;

const { app } = await import('../src/server.js');
const { close } = await import('../src/db.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const req = (u, init = {}) => fetch(base + u, { redirect: 'manual', ...init });

try {
  for (const u of ['/', '/index.html', '/compose.html', '/api/overview', '/api/orders', '/api/programs', '/api/review-queue', '/api/emails'])
    assert.equal((await req(u)).status, 200, `${u} should be open while login is off`);
  const me = await req('/api/me').then((r) => r.json());
  assert.equal(me.authDisabled, true);
  assert.equal(me.staff.role, 'admin');
  assert.equal((await req('/login.html')).status, 200);
  assert.equal((await req('/order/abc')).status, 200);
  assert.equal((await req('/api/order-form/nope')).status, 404, 'public routes still behave normally');
  console.log('All auth-off checks passed');
} finally {
  server.close();
  await close();
}
