// Voice typing endpoint + profile page gating.
import assert from 'node:assert/strict';

delete process.env.TIGER_DATABASE_URL; delete process.env.PGLITE_DIR; delete process.env.GEMINI_API_KEY; delete process.env.ELEVENLABS_API_KEY;
process.env.REQUIRE_AUTH = '1'; process.env.AUTH_DEV_LOGIN = '1'; process.env.STAFF_ADMIN_EMAILS = 'host@example.org';

const realFetch = globalThis.fetch; const stt = [];
globalThis.fetch = async (u, o) => {
  if (String(u).startsWith('https://api.elevenlabs.io/v1/speech-to-text')) { stt.push(o.body.get('model_id')); return Response.json({ text: ' hello from the mic ' }); }
  return realFetch(u, o);
};
const { app } = await import('../src/server.js');
const { close } = await import('../src/db.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const audio = (type = 'audio/webm') => { const fd = new FormData(); fd.append('audio', new Blob([Buffer.alloc(2000, 1)], { type }), 'a.webm'); return fd; };
const post = (fd) => realFetch(base + '/api/transcribe', { method: 'POST', body: fd });

try {
  // public (partners use it on public forms), reports when not configured
  assert.deepEqual(await (await realFetch(base + '/api/transcribe')).json(), { enabled: false });
  assert.equal((await post(audio())).status, 503, 'not configured');

  process.env.ELEVENLABS_API_KEY = 'k';
  assert.deepEqual(await (await realFetch(base + '/api/transcribe')).json(), { enabled: true });
  const ok = await post(audio('audio/webm;codecs=opus'));
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { text: 'hello from the mic' }, 'transcript trimmed and returned');
  assert.equal(stt.length, 1);
  assert.equal((await post(audio('text/plain'))).status, 400, 'non-audio rejected');
  assert.equal((await realFetch(base + '/api/transcribe', { method: 'POST' })).status, 400, 'missing file');

  // profile page needs a login; the script is served
  const anon = await realFetch(base + '/profile.html', { redirect: 'manual' });
  assert.equal(anon.status, 302); assert.match(anon.headers.get('location'), /login/);
  const login = await realFetch(base + '/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'host@example.org' }) });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const page = await realFetch(base + '/profile.html', { headers: { cookie } });
  assert.equal(page.status, 200); assert.match(await page.text(), /My availability/);
  assert.equal((await realFetch(base + '/dictate.js')).status, 200);
  const dash = await (await realFetch(base + '/', { headers: { cookie } })).text();
  assert.match(dash, /href="\/profile\.html"/, 'dashboard profile control is a link'); assert.ok(!dash.includes('profileMenu'), 'dropdown is gone');
  console.log('dictate: ok');
} finally { globalThis.fetch = realFetch; server.close(); await close(); }
