// Training scheduling: staff send a partner a "let us meet" link; the partner ticks the times they are free
// (out of the host's availability) and we book the earliest overlap as a Google Meet.
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { query, one, run, tx } from '../db.js';
import { sendMail, BASE_URL } from '../mailer.js';
import { generateSlots, validTimeZone, parseHhmm, hhmm, localDate, addDays, SLOT_MINUTES } from '../slots.js';
import { calendarConfigured, calendarAuthUrl, exchangeCalendarCode, createMeetEvent } from '../gcal.js';

export const meetRouter = Router();
const PUBLIC_DIR = resolve('public');
const DEFAULT_TZ = 'America/Toronto';
const str = (v, max = 200) => (v == null ? '' : String(v)).replace(/\u0000/g, '').replace(/\s*[\r\n]+\s*/g, ' ').trim().slice(0, max);
const intId = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);
const validEmail = (e) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(e || '').trim());
const fmt = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));

// ---- host availability ------------------------------------------------------------------------
async function loadAvailability(email) {
  const cal = await one('SELECT timezone, google_refresh_token, google_account FROM staff_calendar WHERE staff_email=$1', [email]);
  const rows = await query('SELECT weekday, start_min, end_min FROM staff_availability WHERE staff_email=$1 ORDER BY weekday, start_min', [email]);
  return { timezone: cal?.timezone || DEFAULT_TZ, windows: rows, googleConnected: Boolean(cal?.google_refresh_token), googleAccount: cal?.google_account || null };
}

async function loadOverrides(email, fromDay) {
  const rows = await query('SELECT day::text AS day, windows FROM staff_day_overrides WHERE staff_email=$1 AND day >= $2', [email, fromDay]);
  const out = {};
  for (const r of rows) { try { out[r.day] = JSON.parse(r.windows); } catch { /* ignore a corrupt row */ } }
  return out;
}

async function hostSlots(hostEmail, now = Date.now()) {
  const av = await loadAvailability(hostEmail);
  const busy = await query(
    "SELECT meeting_start AS start, meeting_end AS end FROM training_invites WHERE host_email=$1 AND status='scheduled' AND meeting_end > now()",
    [hostEmail]
  );
  const overrides = await loadOverrides(hostEmail, addDays(localDate(av.timezone, now), -1));
  return { av, slots: generateSlots({ windows: av.windows, tz: av.timezone, now, busy, overrides }) };
}

const toWindow = (w) => ({ start: hhmm(w.start_min), end: hhmm(w.end_min) });

meetRouter.get('/api/me/availability', async (req, res) => {
  const av = await loadAvailability(req.staff.email);
  const today = localDate(av.timezone);
  const overrides = await loadOverrides(req.staff.email, addDays(today, -7));
  res.json({
    timezone: av.timezone,
    today,
    windows: av.windows.map((w) => ({ weekday: w.weekday, start: hhmm(w.start_min), end: hhmm(w.end_min) })),
    overrides: Object.fromEntries(Object.entries(overrides).map(([d, ws]) => [d, ws.map(toWindow)])),
    google: { configured: calendarConfigured(), connected: av.googleConnected, account: av.googleAccount },
  });
});

meetRouter.put('/api/me/availability', async (req, res) => {
  const tz = str(req.body?.timezone, 64) || DEFAULT_TZ;
  if (!validTimeZone(tz)) return res.status(400).json({ error: 'Unknown time zone' });
  const windows = [];
  for (const w of Array.isArray(req.body?.windows) ? req.body.windows.slice(0, 50) : []) {
    const weekday = Number(w.weekday), s = parseHhmm(w.start), e = parseHhmm(w.end);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || s == null || e == null) return res.status(400).json({ error: 'Each window needs a day and valid start/end times' });
    if (e - s < SLOT_MINUTES) return res.status(400).json({ error: `Each window must be at least ${SLOT_MINUTES} minutes long` });
    windows.push([weekday, s, e]);
  }
  const email = req.staff.email;
  await tx(async (q) => {
    await q.run(`INSERT INTO staff_calendar (staff_email, timezone) VALUES ($1,$2)
                 ON CONFLICT (staff_email) DO UPDATE SET timezone=excluded.timezone, updated_at=now()`, [email, tz]);
    await q.run('DELETE FROM staff_availability WHERE staff_email=$1', [email]);
    for (const [weekday, s, e] of windows) await q.run('INSERT INTO staff_availability (staff_email, weekday, start_min, end_min) VALUES ($1,$2,$3,$4)', [email, weekday, s, e]);
  });
  res.json({ ok: true });
});

// Custom days: { days: { "2027-01-05": [{start:"10:00", end:"12:00"}], "2027-01-06": [], "2027-01-07": null } }
// array = replace that date (empty = day off), null = back to the standard week.
meetRouter.put('/api/me/availability/days', async (req, res) => {
  const email = req.staff.email;
  const av = await loadAvailability(email);
  const today = localDate(av.timezone);
  const entries = Object.entries(req.body?.days && typeof req.body.days === 'object' ? req.body.days : {});
  if (!entries.length || entries.length > 62) return res.status(400).json({ error: 'Send between 1 and 62 days' });
  const work = [];
  for (const [day, list] of entries) {
    const t = Date.parse(day + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(t) || day < addDays(today, -1) || day > addDays(today, 183)) return res.status(400).json({ error: `Bad date ${str(day, 20)}` });
    if (list === null) { work.push([day, null]); continue; }
    if (!Array.isArray(list) || list.length > 24) return res.status(400).json({ error: 'Too many windows in one day' });
    const weekday = new Date(t).getUTCDay();
    const ws = [];
    for (const w of list) {
      const s = parseHhmm(w?.start), e = parseHhmm(w?.end);
      if (s == null || e == null || e - s < SLOT_MINUTES) return res.status(400).json({ error: `Each window must be valid and at least ${SLOT_MINUTES} minutes` });
      ws.push({ weekday, start_min: s, end_min: e });
    }
    // identical to the standard week for that weekday: no override needed
    const std = av.windows.filter((w) => w.weekday === weekday).map((w) => `${w.start_min}-${w.end_min}`).sort().join();
    work.push([day, ws.map((w) => `${w.start_min}-${w.end_min}`).sort().join() === std ? null : ws]);
  }
  await tx(async (q) => {
    for (const [day, ws] of work) {
      if (ws === null) await q.run('DELETE FROM staff_day_overrides WHERE staff_email=$1 AND day=$2', [email, day]);
      else await q.run(`INSERT INTO staff_day_overrides (staff_email, day, windows) VALUES ($1,$2,$3)
                        ON CONFLICT (staff_email, day) DO UPDATE SET windows=excluded.windows`, [email, day, JSON.stringify(ws)]);
    }
    await q.run('DELETE FROM staff_day_overrides WHERE staff_email=$1 AND day < $2', [email, addDays(today, -30)]);
  });
  res.json({ ok: true });
});

// ---- connect Google Calendar (so meetings get a Google Meet link) -----------------------------
const pendingConnect = new Map(); // state -> { email, exp }
meetRouter.get('/api/me/google/connect', (req, res) => {
  if (!calendarConfigured()) return res.status(400).json({ error: 'Google is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)' });
  for (const [k, v] of pendingConnect) if (v.exp < Date.now()) pendingConnect.delete(k);
  const state = randomBytes(24).toString('base64url');
  pendingConnect.set(state, { email: req.staff.email, exp: Date.now() + 10 * 60e3 });
  res.redirect(calendarAuthUrl(state, req.staff.email.includes('@') && req.staff.email !== 'staff@local' ? req.staff.email : undefined));
});

meetRouter.get('/api/google/calendar/callback', async (req, res) => {
  const p = typeof req.query.state === 'string' ? pendingConnect.get(req.query.state) : undefined;
  if (p) pendingConnect.delete(req.query.state);
  if (!p || p.exp < Date.now() || p.email !== req.staff.email || typeof req.query.code !== 'string' || req.query.error) return res.redirect('/profile.html?calendar=failed');
  try {
    const { refreshToken, account } = await exchangeCalendarCode(req.query.code);
    await run(`INSERT INTO staff_calendar (staff_email, google_refresh_token, google_account) VALUES ($1,$2,$3)
               ON CONFLICT (staff_email) DO UPDATE SET google_refresh_token=excluded.google_refresh_token, google_account=excluded.google_account, updated_at=now()`,
      [req.staff.email, refreshToken, account]);
    res.redirect('/profile.html?calendar=connected');
  } catch (e) {
    console.error('[meet] calendar connect failed:', e.message);
    res.redirect('/profile.html?calendar=failed');
  }
});

meetRouter.delete('/api/me/google', async (req, res) => {
  await run('UPDATE staff_calendar SET google_refresh_token=NULL, google_account=NULL WHERE staff_email=$1', [req.staff.email]);
  res.json({ ok: true });
});

// ---- staff: send a partner the link -----------------------------------------------------------
meetRouter.post('/api/partners/:id/start-training', async (req, res) => {
  const id = intId(req.params.id);
  const partner = id && await one('SELECT id, name, contact_name, contact_email FROM partners WHERE id=$1', [id]);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const to = str(req.body?.email, 254).toLowerCase() || String(partner.contact_email || '').toLowerCase();
  if (!validEmail(to)) return res.status(400).json({ error: 'This partner has no valid contact email' });

  const host = req.staff;
  const { slots } = await hostSlots(host.email);
  if (!slots.length) return res.status(400).json({ error: 'You have no available times in the next two weeks. Set them under your profile first.' });

  const token = randomBytes(18).toString('base64url');
  await run("UPDATE training_invites SET status='cancelled' WHERE partner_id=$1 AND host_email=$2 AND status='pending'", [id, host.email]);
  await run(`INSERT INTO training_invites (token, partner_id, host_email, host_name, invitee_email, invitee_name) VALUES ($1,$2,$3,$4,$5,$6)`,
    [token, id, host.email, host.name || null, to, partner.contact_name || null]);

  const link = `${BASE_URL}/meet/${token}`;
  await sendMail(to, 'Let\'s schedule your Baby Connections training',
    `Hi ${partner.contact_name || 'there'},\n\nWe'd love to get your Baby Connections facilitator training on the calendar. ` +
    `Please open the link below and tick every time that works for you. We'll book the earliest time we're both free and send you a Google Meet invitation.\n\n${link}\n\n` +
    `Baby Connections Team${host.name ? ` (${host.name})` : ''}`);
  res.json({ ok: true, link, sent_to: to });
});

meetRouter.get('/api/partners/:id/training-invites', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Partner not found' });
  res.json(await query(
    `SELECT id, status, invitee_email, host_name, host_email, meeting_start, meeting_end, meet_link, created_at, token
     FROM training_invites WHERE partner_id=$1 ORDER BY id DESC LIMIT 10`, [id]));
});

// ---- public: the "let us meet" page -----------------------------------------------------------
meetRouter.get('/meet/:token', (_req, res) => res.sendFile('meet.html', { root: PUBLIC_DIR }));

const getInvite = (token) => one(
  `SELECT i.*, p.name AS partner_name FROM training_invites i LEFT JOIN partners p ON p.id=i.partner_id WHERE i.token=$1`,
  [String(token).slice(0, 80)]);

meetRouter.get('/api/meet/:token', async (req, res) => {
  const inv = await getInvite(req.params.token);
  if (!inv || inv.status === 'cancelled') return res.status(404).json({ error: 'This link is no longer valid. Please ask Strong Start for a new one.' });
  const base = { status: inv.status, partner_name: inv.partner_name, host_name: inv.host_name || 'Strong Start' };
  if (inv.status === 'scheduled') {
    return res.json({ ...base, meeting: { start: inv.meeting_start, end: inv.meeting_end, meet_link: inv.meet_link } });
  }
  const { av, slots } = await hostSlots(inv.host_email);
  res.json({ ...base, host_timezone: av.timezone, slot_minutes: SLOT_MINUTES, slots, invitee_name: inv.invitee_name || '' });
});

meetRouter.post('/api/meet/:token/choose', async (req, res) => {
  const inv = await getInvite(req.params.token);
  if (!inv || inv.status === 'cancelled') return res.status(404).json({ error: 'This link is no longer valid.' });
  if (inv.status === 'scheduled') return res.status(409).json({ error: 'A meeting is already booked from this link.' });

  const picked = [...new Set((Array.isArray(req.body?.slots) ? req.body.slots : []).slice(0, 500).map((s) => {
    const d = new Date(s); return Number.isNaN(+d) ? null : d.toISOString();
  }))].filter(Boolean);
  if (!picked.length) return res.status(400).json({ error: 'Please tick at least one time that works for you.' });

  // Claim the invite so a double click can't book twice.
  const claim = await run("UPDATE training_invites SET status='scheduling' WHERE id=$1 AND status='pending' RETURNING id", [inv.id]);
  if (!claim.rows.length) return res.status(409).json({ error: 'This request is already being processed.' });

  let start;
  try {
    const { slots } = await hostSlots(inv.host_email);
    const free = new Set(slots);
    start = picked.filter((s) => free.has(s)).sort()[0]; // earliest overlap
    if (!start) {
      await run("UPDATE training_invites SET status='pending' WHERE id=$1", [inv.id]);
      return res.status(409).json({ error: 'Those times were just taken. Please pick from the refreshed list.', refresh: true });
    }
    const end = new Date(+new Date(start) + SLOT_MINUTES * 60e3).toISOString();
    const name = str(req.body?.name, 120) || inv.invitee_name || inv.invitee_email;

    const cal = await one('SELECT timezone, google_refresh_token FROM staff_calendar WHERE staff_email=$1', [inv.host_email]);
    const tz = cal?.timezone || DEFAULT_TZ;
    let meetLink = null, eventId = null, warning = null;
    if (cal?.google_refresh_token) {
      try {
        ({ meetLink, eventId } = await createMeetEvent({
          refreshToken: cal.google_refresh_token,
          summary: `Baby Connections training: ${inv.partner_name || name}`,
          description: 'Baby Connections facilitator training, scheduled through Strong Start.',
          startIso: start, endIso: end, attendeeEmails: [inv.invitee_email],
        }));
      } catch (e) { console.error('[meet] google event failed:', e.message); warning = 'Google Meet could not be created'; }
    } else warning = 'Host has not connected Google Calendar';

    await run(`UPDATE training_invites SET status='scheduled', chosen_slots=$2, meeting_start=$3, meeting_end=$4, meet_link=$5, event_id=$6, invitee_name=$7 WHERE id=$1`,
      [inv.id, JSON.stringify(picked), start, end, meetLink, eventId, name]);

    const when = fmt(start, tz);
    const where = meetLink ? `Join with Google Meet: ${meetLink}` : 'A video link will be sent to you shortly.';
    await sendMail(inv.invitee_email, 'Your Baby Connections training is booked',
      `Hi ${name},\n\nYour training meeting is booked for:\n\n${when} (${tz.replace(/_/g, ' ')})\n\n${where}\n\nBaby Connections Team`);
    await sendMail(inv.host_email, `Training booked with ${inv.partner_name || name}`,
      `${inv.partner_name || name} (${inv.invitee_email}) picked ${when} (${tz.replace(/_/g, ' ')}).\n\n${where}` +
      (warning ? `\n\nNote: ${warning}, so please send them a meeting link yourself.` : ''));

    res.json({ ok: true, meeting: { start, end, meet_link: meetLink }, warning });
  } catch (e) {
    console.error('[meet] choose failed:', e);
    await run("UPDATE training_invites SET status='pending' WHERE id=$1 AND status='scheduling'", [inv.id]).catch(() => {});
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
