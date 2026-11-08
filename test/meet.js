// Training scheduling: availability -> start training link -> partner picks times -> earliest overlap booked as a Meet.
import assert from 'node:assert/strict';

delete process.env.TIGER_DATABASE_URL; delete process.env.PGLITE_DIR; delete process.env.GEMINI_API_KEY;
process.env.REQUIRE_AUTH = '1'; process.env.AUTH_DEV_LOGIN = '1'; process.env.STAFF_ADMIN_EMAILS = 'host@example.org';
process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'sec';

const { generateSlots, zonedToUtc } = await import('../src/slots.js');
// Toronto is UTC-5 in January and UTC-4 in July
assert.equal(new Date(zonedToUtc(2027, 0, 5, 9 * 60, 'America/Toronto')).toISOString(), '2027-01-05T14:00:00.000Z');
assert.equal(new Date(zonedToUtc(2027, 6, 5, 9 * 60, 'America/Toronto')).toISOString(), '2027-07-05T13:00:00.000Z');
// Mon 2027-01-04 09:00-10:00 Toronto -> 2 half-hour slots; a busy meeting removes one; lead time hides the past
const now = Date.parse('2027-01-01T00:00:00Z');
const win = [{ weekday: 1, start_min: 540, end_min: 600 }];
const s1 = generateSlots({ windows: win, tz: 'America/Toronto', now, days: 5 });
assert.deepEqual(s1, ['2027-01-04T14:00:00.000Z', '2027-01-04T14:30:00.000Z']);
assert.deepEqual(generateSlots({ windows: win, tz: 'America/Toronto', now, days: 5, busy: [{ start: '2027-01-04T14:00:00Z', end: '2027-01-04T14:30:00Z' }] }), ['2027-01-04T14:30:00.000Z']);
assert.deepEqual(generateSlots({ windows: win, tz: 'America/Toronto', now: Date.parse('2027-01-04T14:00:00Z'), days: 3 }), [], 'too soon / past');

// fake Google
const realFetch = globalThis.fetch; const gcalCalls = [];
globalThis.fetch = async (u, o) => {
  if (String(u).startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'at' });
  if (String(u).startsWith('https://www.googleapis.com/calendar/')) { gcalCalls.push(JSON.parse(o.body)); return Response.json({ id: 'evt1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }); }
  return realFetch(u, o);
};

const { app } = await import('../src/server.js');
const { close, run, one } = await import('../src/db.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;

try {
  const login = await realFetch(base + '/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'host@example.org' }) });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const staff = (u, method = 'GET', body) => realFetch(base + u, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const pub = (u, method = 'GET', body) => realFetch(base + u, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

  const partner = await (await staff('/api/partners', 'POST', { name: 'Maple Library', contact_name: 'Pat', contact_email: 'pat@maple.org', stage: 'expression_of_interest' })).json();
  assert.ok(partner.id, 'partner created');

  // no availability yet -> cannot start training
  assert.equal((await staff(`/api/partners/${partner.id}/start-training`, 'POST', {})).status, 400);

  assert.equal((await staff('/api/me/availability', 'PUT', { timezone: 'Nope/Zone', windows: [] })).status, 400, 'bad tz');
  assert.equal((await staff('/api/me/availability', 'PUT', { timezone: 'America/Toronto', windows: [{ weekday: 1, start: '10:00', end: '10:10' }] })).status, 400, 'window too short');
  const allDays = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '17:00' }));
  assert.equal((await staff('/api/me/availability', 'PUT', { timezone: 'America/Toronto', windows: allDays })).status, 200);
  const av = await (await staff('/api/me/availability')).json();
  assert.equal(av.windows.length, 7); assert.equal(av.google.connected, false);

  // custom days: a specific date can differ from the standard week; null/identical goes back to standard
  const { addDays } = await import('../src/slots.js');
  const D = addDays(av.today, 4), D2 = addDays(av.today, 5);
  const onDay = (slots, d) => slots.filter((iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date(iso)) === d);
  assert.equal((await staff('/api/me/availability/days', 'PUT', { days: { '2020-01-01': [] } })).status, 400, 'past date rejected');
  assert.equal((await staff('/api/me/availability/days', 'PUT', { days: { [D]: [{ start: '10:00', end: '10:10' }] } })).status, 400, 'short window rejected');
  assert.equal((await staff('/api/me/availability/days', 'PUT', { days: { [D]: [{ start: '10:00', end: '11:00' }], [D2]: [] } })).status, 200);
  const av2 = await (await staff('/api/me/availability')).json();
  assert.deepEqual(av2.overrides[D], [{ start: '10:00', end: '11:00' }]); assert.deepEqual(av2.overrides[D2], [], 'day off stored');
  assert.equal(av2.windows.length, 7, 'standard week untouched');
  const inv = await (await staff(`/api/partners/${partner.id}/start-training`, 'POST', {})).json();
  const iv = await (await pub('/api/meet/' + inv.link.split('/').pop())).json();
  assert.equal(onDay(iv.slots, D).length, 2, 'custom day offers only 10:00-11:00 (two 30-min slots)');
  assert.equal(onDay(iv.slots, D2).length, 0, 'day off offers nothing');
  assert.ok(onDay(iv.slots, addDays(av.today, 6)).length > 4, 'other days follow the standard week');
  // saving a day identical to the standard week removes its override; null resets too
  await staff('/api/me/availability/days', 'PUT', { days: { [D]: [{ start: '09:00', end: '17:00' }], [D2]: null } });
  const av3 = await (await staff('/api/me/availability')).json();
  assert.equal(av3.overrides[D], undefined); assert.equal(av3.overrides[D2], undefined);

  // staff-only endpoints are protected, the partner page is public
  assert.equal((await pub('/api/me/availability')).status, 401);
  assert.equal((await pub(`/api/partners/${partner.id}/start-training`, 'POST', {})).status, 401);

  const started = await (await staff(`/api/partners/${partner.id}/start-training`, 'POST', {})).json();
  assert.match(started.link, /\/meet\/[\w-]+$/); assert.equal(started.sent_to, 'pat@maple.org');
  const mail = await one("SELECT * FROM outbox WHERE to_email='pat@maple.org' ORDER BY id DESC LIMIT 1");
  assert.ok(mail.body.includes(started.link), 'link emailed to the partner');
  const token = started.link.split('/').pop();

  assert.equal((await pub('/meet/' + token)).status, 200, 'page is public');
  const view = await (await pub('/api/meet/' + token)).json();
  assert.ok(view.slots.length > 20, 'host slots offered'); assert.equal(view.host_timezone, 'America/Toronto');
  assert.equal((await pub('/api/meet/nope')).status, 404);

  // partner picks 3 times (unsorted) + one time the host never offered -> earliest valid overlap wins
  const [a, b, c] = [view.slots[10], view.slots[3], view.slots[7]];
  assert.equal((await pub(`/api/meet/${token}/choose`, 'POST', { slots: [] })).status, 400);
  assert.equal((await pub(`/api/meet/${token}/choose`, 'POST', { slots: ['2020-01-01T10:00:00Z'] })).status, 409, 'unoffered time rejected');
  // host connects Google (token stored directly; OAuth redirect itself needs a browser)
  await run("INSERT INTO staff_calendar (staff_email, google_refresh_token, google_account) VALUES ('host@example.org','rt','host@example.org') ON CONFLICT (staff_email) DO UPDATE SET google_refresh_token='rt', google_account='host@example.org'");
  const done = await pub(`/api/meet/${token}/choose`, 'POST', { slots: [a, '2020-01-01T10:00:00Z', b, c], name: 'Pat P' });
  assert.equal(done.status, 200, JSON.stringify(await done.clone().json()));
  const res = await done.json();
  assert.equal(res.meeting.start, b, 'earliest chosen time is booked'); assert.equal(res.meeting.meet_link, 'https://meet.google.com/abc-defg-hij');
  assert.equal(gcalCalls.length, 1); assert.deepEqual(gcalCalls[0].attendees, [{ email: 'pat@maple.org' }]);
  assert.equal(gcalCalls[0].conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.equal(gcalCalls[0].start.dateTime, b);
  assert.ok((await one("SELECT * FROM outbox WHERE to_email='pat@maple.org' AND subject LIKE '%booked%'")), 'confirmation emailed');

  // can't double book; the booked time disappears for other invites; the host's calendar view shows it
  assert.equal((await pub(`/api/meet/${token}/choose`, 'POST', { slots: [a] })).status, 409);
  const again = await (await pub('/api/meet/' + token)).json();
  assert.equal(again.status, 'scheduled'); assert.equal(again.meeting.meet_link, res.meeting.meet_link);
  const second = await (await staff(`/api/partners/${partner.id}/start-training`, 'POST', {})).json();
  const view2 = await (await pub('/api/meet/' + second.link.split('/').pop())).json();
  assert.ok(!view2.slots.includes(b), 'booked time is no longer offered');
  const list = await (await staff(`/api/partners/${partner.id}/training-invites`)).json();
  assert.ok(list.some((i) => i.status === 'scheduled' && i.meet_link));

  // without Google connected the meeting is still booked, with a warning for the host
  await run("UPDATE staff_calendar SET google_refresh_token=NULL WHERE staff_email='host@example.org'");
  const t2 = second.link.split('/').pop();
  const r2 = await (await pub(`/api/meet/${t2}/choose`, 'POST', { slots: [view2.slots[0]] })).json();
  assert.equal(r2.meeting.meet_link, null); assert.ok(r2.warning);

  console.log('meet: ok');
} finally {
  globalThis.fetch = realFetch;
  server.close(); await close();
}
