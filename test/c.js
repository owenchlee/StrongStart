// Agent C checks: db contract, trends/rollup/outstanding, CSV export (formula injection), staff management.
import assert from 'node:assert/strict';

delete process.env.TIGER_DATABASE_URL; // in-memory PGlite
delete process.env.PGLITE_DIR;
delete process.env.GEMINI_API_KEY;
process.env.REQUIRE_AUTH = '1'; // these tests exercise the login-protected mode
process.env.AUTH_DEV_LOGIN = '1';
process.env.STAFF_ADMIN_EMAILS = 'staff@example.org';

const { app } = await import('../src/server.js');
const { query, one, run, tx, close, KIT_ITEMS, isTimescale } = await import('../src/db.js');
const { csvCell } = await import('../src/report.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const login = async (email) => {
  const r = await fetch(`${base}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  return r.status === 200 ? r.headers.getSetCookie()[0].split(';')[0] : null;
};
const mk = (cookie) => (u, method = 'GET', body) =>
  fetch(base + u, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const admin = mk(await login('staff@example.org'));

try {
  // ---- db contract
  assert.deepEqual(KIT_ITEMS.length, 4);
  assert.equal(typeof isTimescale, 'boolean');
  assert.equal((await one('SELECT COUNT(*)::int n FROM facilitators')).n, 0);
  assert.equal(await one('SELECT * FROM facilitators WHERE id=-1'), undefined);
  const f1 = (await run("INSERT INTO facilitators (name,email,organization) VALUES ('Jo','jo@example.org','Library') RETURNING id")).rows[0].id;
  const f2 = (await one("INSERT INTO facilitators (name,email) VALUES ('Sam','sam@example.org') RETURNING id")).id;
  const p1 = await one("INSERT INTO programs (facilitator_id,name,projected_participants,start_date) VALUES ($1,'Fall',10,'2026-09-01') RETURNING *", [f1]);
  const p2 = await one("INSERT INTO programs (facilitator_id,name,projected_participants,start_date) VALUES ($1,'Spring',2,'2026-03-01') RETURNING *", [f2]);
  assert.match(p1.token, /^[A-Za-z0-9_-]{22,}$/);
  assert.notEqual(p1.token, p2.token);
  await assert.rejects(tx(async (t) => { await t.run("INSERT INTO facilitators (email) VALUES ('rollback@example.org')"); throw new Error('boom'); }));
  assert.equal((await one("SELECT COUNT(*)::int n FROM facilitators WHERE email='rollback@example.org'")).n, 0, 'tx rolls back');
  await tx(async (t) => { await t.run("INSERT INTO facilitators (email) VALUES ('commit@example.org')"); assert.ok(await t.one('SELECT id FROM facilitators WHERE email=$1', ['commit@example.org'])); });
  assert.equal((await query("SELECT * FROM facilitators WHERE email='commit@example.org'")).length, 1);

  const fb = (pid, rating, rec, extra = {}) =>
    run(`INSERT INTO feedback (program_id,source,rating,would_recommend,most_valued,suggestions,language,translated_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [pid, extra.source || 'qr', rating, rec, extra.most_valued ?? null, extra.suggestions ?? null, extra.language ?? null, extra.translated ?? null]);
  await fb(p1.id, 5, true, { most_valued: '=HYPERLINK("http://evil","x")' });
  await fb(p1.id, 3, false, { suggestions: '@cmd, "quoted"\nline', source: 'voice' });
  await fb(p2.id, 4, true, { most_valued: '+1', language: 'es', translated: 'Good' });
  await fb(p2.id, 4, true);
  const rid = (await run("INSERT INTO feedback (program_id,source,needs_review,image_url,language,translated_text) VALUES ($1,'photo',true,'https://example.org/a.jpg','es','Hello') RETURNING id", [p1.id])).rows[0].id;
  assert.equal((await one('SELECT id, needs_review FROM feedback WHERE id=$1', [rid])).needs_review, true, 'lookup by id alone');

  // ---- overview / programs / filters
  const ov = await admin('/api/overview').then((r) => r.json());
  assert.equal(ov.feedbackResponses, 5);
  assert.equal(ov.needsReview, 1);
  let progs = await admin('/api/programs').then((r) => r.json());
  assert.equal(progs.length, 2);
  const fall = progs.find((p) => p.id === p1.id);
  assert.equal(fall.token, p1.token);
  assert.equal(fall.responses, 3);
  assert.equal(fall.needs_review, 1);
  assert.equal(fall.avg_rating, 4);
  assert.equal(fall.facilitator, 'Jo');
  assert.equal((await admin('/api/programs?from=2026-06-01').then((r) => r.json())).length, 1);
  assert.equal((await admin('/api/programs?to=2026-06-01').then((r) => r.json()))[0].name, 'Spring');
  assert.equal((await admin(`/api/programs?facilitator=${f2}`).then((r) => r.json())).length, 1);
  assert.equal((await admin("/api/programs?facilitator=1;DROP").then((r) => r.json())).length, 2, 'bad filter is ignored, not injected');
  const rep = await admin(`/api/programs/${p2.id}/report`).then((r) => r.json());
  assert.equal(rep.responses, 2);
  assert.equal(rep.summary, null);
  assert.equal((await admin('/api/programs/9999/report')).status, 404);
  const rq = await admin('/api/review-queue').then((r) => r.json());
  assert.deepEqual([rq.length, rq[0].image_url, rq[0].language, rq[0].translated_text, rq[0].program], [1, 'https://example.org/a.jpg', 'es', 'Hello', 'Fall']);
  const em = await admin('/api/emails').then((r) => r.json());
  assert.ok(Array.isArray(em.inbound) && Array.isArray(em.outbox));

  // ---- trends
  await run("INSERT INTO orders (token,facilitator_id,program_id,status,ordered_at,received_at) VALUES ('t1',$1,$2,'received', now() - interval '5 days', now() - interval '1 day')", [f1, p1.id]);
  await run("INSERT INTO orders (token,facilitator_id,status) VALUES ('t2',$1,'form_sent')", [f1]);
  const tr = await admin('/api/trends').then((r) => r.json());
  assert.equal(tr.responsesPerDay.reduce((s, d) => s + d.responses, 0), 5);
  assert.match(tr.responsesPerDay[0].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(tr.avgRatingPerDay[0].avg_rating > 3 && tr.avgRatingPerDay[0].avg_rating <= 4);
  assert.equal(Math.round(tr.orderToDelivery.avgDays), 4);
  assert.deepEqual(Object.fromEntries(tr.ordersByStatus.map((s) => [s.status, s.orders])), { received: 1, form_sent: 1 });

  // ---- rollup & outstanding
  const ru = await admin('/api/rollup').then((r) => r.json());
  assert.deepEqual([ru.totals.programs, ru.totals.projected_participants, ru.totals.responses], [2, 12, 5]);
  const jo = ru.byFacilitator.find((x) => x.id === f1);
  assert.deepEqual([jo.programs, jo.projected_participants, jo.responses, jo.recommend_pct], [1, 10, 3, 50]);
  assert.equal(ru.totals.recommend_pct, 75);
  const out = await admin('/api/outstanding').then((r) => r.json());
  assert.deepEqual(out.map((o) => [o.name, o.gap]), [['Fall', 7]], 'Spring met its projection (2/2)');
  assert.equal(out[0].token, p1.token);

  // ---- CSV
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('-2'), "'-2");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(5), '5');
  const csvRes = await admin('/api/export/feedback.csv');
  assert.match(csvRes.headers.get('content-type'), /text\/csv/);
  assert.match(csvRes.headers.get('content-disposition'), /attachment/);
  const csv = await csvRes.text();
  assert.ok(csv.startsWith('id,program,facilitator'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), 'formula neutralised and quoted');
  assert.ok(csv.includes(`"'@cmd, ""quoted""\nline"`));
  assert.ok(!/(^|,)[=+@]/m.test(csv.split('\r\n').slice(1).join('\n').replace(/"(?:[^"]|"")*"/g, '""')), 'no raw formula cell');
  assert.match(await admin('/api/export/programs.csv').then((r) => r.text()), /Fall/);

  // ---- staff management
  const sl = await admin('/api/staff').then((r) => r.json());
  assert.equal(sl.length, 1);
  assert.equal((await admin('/api/staff', 'POST', { email: 'not-an-email' })).status, 400);
  const added = await admin('/api/staff', 'POST', { email: 'New.Person@Example.org', name: 'New', role: 'staff' }).then((r) => r.json());
  assert.equal(added.email, 'new.person@example.org');
  const plain = mk(await login('new.person@example.org'));
  assert.equal((await plain('/api/overview')).status, 200, 'new staff can use the dashboard');
  assert.equal((await plain('/api/staff')).status, 403, 'non-admin cannot list staff');
  assert.equal((await plain('/api/staff', 'POST', { email: 'x@example.org' })).status, 403);
  assert.equal((await plain(`/api/staff/${added.id}/deactivate`, 'POST')).status, 403);
  const me = await admin('/api/me').then((r) => r.json());
  assert.equal((await admin(`/api/staff/${me.staff.id}/deactivate`, 'POST')).status, 400, 'cannot deactivate yourself');
  assert.equal((await admin(`/api/staff/${added.id}/deactivate`, 'POST')).status, 200);
  assert.equal((await plain('/api/overview')).status, 401, 'deactivated staff lose access immediately');
  assert.equal(await login('new.person@example.org'), null);
  assert.equal((await admin('/api/staff/99999/deactivate', 'POST')).status, 404);
  assert.equal((await fetch(`${base}/api/staff`)).status, 401);
  console.log('All C checks passed');
} finally {
  server.close();
  await close();
}
