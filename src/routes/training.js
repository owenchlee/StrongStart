// Training Registration and Certification (Requirements §4)
import { Router } from 'express';
import { sendMail, STAFF_EMAIL, BASE_URL } from '../mailer.js';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { query, one, run, tx } from '../db.js';
<<<<<<< HEAD
import { sendMail } from '../mailer.js';
import { BASE_URL, str, oneLine, dateOrNull, intId, validEmail } from '../util.js';
=======

// Import Outlook helper
import { createOutlookEvent } from '../msgraph.js';

// Helper: generate meeting slots for a new training session
// Creates 30‑minute slots in a configurable window (default: 5 days before & after session date)
async function generateSlotsForSession(sessionId, { sessionDate, daysBefore = 2, daysAfter = 2, slotDurationMins = 30 }) {
  const start = new Date(sessionDate);
  start.setUTCDate(start.getUTCDate() - daysBefore);
  start.setUTCHours(9, 0, 0, 0); // start at 09:00 UTC (adjust as needed)
  const end = new Date(sessionDate);
  end.setUTCDate(end.getUTCDate() + daysAfter);
  end.setUTCHours(17, 0, 0, 0); // end at 17:00 UTC

  const slots = [];
  for (let ts = new Date(start); ts < end; ts.setUTCMinutes(ts.getUTCMinutes() + slotDurationMins)) {
    const slotStart = new Date(ts);
    const slotEnd = new Date(ts);
    slotEnd.setUTCMinutes(slotEnd.getUTCMinutes() + slotDurationMins);
    slots.push(`(${sessionId}, '${slotStart.toISOString()}', '${slotEnd.toISOString()}')`);
  }
  if (slots.length) {
    const sql = `INSERT INTO training_meeting_slots (session_id, slot_start, slot_end) VALUES ${slots.join(', ')}`;
    await run(sql);
  }
}

>>>>>>> frontend

export const trainingRouter = Router();

const PUBLIC_DIR = resolve('public');

// Public: Serve self-service registration and digital certificate pages
trainingRouter.get('/training/register', (_req, res) => res.sendFile('training-register.html', { root: PUBLIC_DIR }));
trainingRouter.get('/certificate/:code', (_req, res) => res.sendFile('certificate.html', { root: PUBLIC_DIR }));

// Public: List upcoming training sessions
trainingRouter.get('/api/training/sessions', async (_req, res) => {
  const rows = await query(`
    SELECT ts.*,
           COUNT(tr.id)::int AS registered_count
    FROM training_sessions ts
    LEFT JOIN training_registrations tr ON tr.training_session_id = ts.id AND tr.status != 'cancelled'
    GROUP BY ts.id
    ORDER BY ts.session_date ASC, ts.id ASC
  `);
  res.json(rows);
});

// Public: Self-service facilitator registration for a training session
trainingRouter.post('/api/training/register', async (req, res) => {
  const b = req.body ?? {};
  const sessionId = intId(b.training_session_id);
  if (!sessionId) return res.status(400).json({ error: 'Please select a training session' });

  const session = await one('SELECT * FROM training_sessions WHERE id=$1', [sessionId]);
  if (!session) return res.status(404).json({ error: 'Training session not found' });

  const name = oneLine(b.name, 120);
  const email = str(b.email, 254).toLowerCase();
  const phone = oneLine(b.phone, 50) || null;
  const org = oneLine(b.organization, 200) || null;

  if (!name || name.length < 2) return res.status(400).json({ error: 'Your name is required' });
  if (!email || !validEmail(email)) return res.status(400).json({ error: 'A valid email is required' });

  const result = await tx(async (q) => {
    // Decide "already registered" and "full" BEFORE writing anything, so a person turned away from a full
    // session does not leave a facilitator record behind.
    const known = await q.one('SELECT id FROM facilitators WHERE lower(email)=$1', [email]);
    const prior = known && await q.one(
      'SELECT status FROM training_registrations WHERE training_session_id=$1 AND facilitator_id=$2',
      [sessionId, known.id]
    );
    const already = Boolean(prior) && prior.status !== 'cancelled'; // already on the list: not a new seat, no second email
    const regCount = (await q.one(
      "SELECT COUNT(*)::int AS n FROM training_registrations WHERE training_session_id=$1 AND status != 'cancelled'",
      [sessionId]
    )).n;
    if (!already && session.capacity && regCount >= session.capacity) return { full: true };

    // Upsert facilitator record
    await q.run(
      `INSERT INTO facilitators (email, name, phone, organization)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET name = COALESCE(excluded.name, facilitators.name),
           phone = COALESCE(excluded.phone, facilitators.phone),
           organization = COALESCE(excluded.organization, facilitators.organization)`,
      [email, name, phone, org]
    );
    const fac = await q.one('SELECT id, name, email FROM facilitators WHERE lower(email)=$1', [email]);

    // Register. Only a cancelled registration comes back to life; 'completed' must stay completed
    // or the person's certificate would stop verifying.
    const regRes = await q.run(
      `INSERT INTO training_registrations (training_session_id, facilitator_id, status)
       VALUES ($1, $2, 'registered')
       ON CONFLICT (training_session_id, facilitator_id)
       DO UPDATE SET status = CASE WHEN training_registrations.status = 'cancelled' THEN 'registered' ELSE training_registrations.status END
       RETURNING id`,
      [sessionId, fac.id]
    );

    return { fac, regId: regRes.rows[0].id, already };
  });

  if (result.full) {
    return res.status(409).json({ error: 'This training session is full. Please choose another date.' });
  }

  if (result.already) {
    return res.json({
      ok: true,
      already: true,
      message: 'You are already registered for this session. Check your inbox for the confirmation we sent earlier.',
      facilitator_id: result.fac.id,
      session_id: sessionId
    });
  }

  // Send confirmation email to facilitator
  const when = session.session_date instanceof Date
    ? new Intl.DateTimeFormat('en-CA', { dateStyle: 'full', timeZone: 'UTC' }).format(session.session_date)
    : String(session.session_date);
  const online = session.delivery_type === 'online';
  const hasLink = /https?:\/\/|emailed to you/i.test(session.location_details || ''); // a link, or text that already says one is coming
  await sendMail(
    email,
    `Baby Connections Training Confirmation: ${session.title}`,
    `Hi ${name},\n\nYou are confirmed for Baby Connections facilitator training:\n\n` +
    `Session: ${session.title}\n` +
    `Date: ${when}\n` +
    `Time: ${session.session_time || 'TBA'}\n` +
    `Format: ${online ? 'Online Webinar' : 'In-Person'}\n` +
    `Details: ${session.location_details || 'We will email you the details before the session'}\n` +
    (online && !hasLink ? `Your meeting link will be emailed to you before the session.\n` : '') +
    `Trainer: ${session.trainer_name || 'Strong Start Training Specialist'}\n\n` +
    `When you complete the training we will email your official certificate. Until then, the Knowledge Centre has guides and templates: ${BASE_URL}/resources\n\n` +
    `We look forward to meeting you!\n\n` +
    `Baby Connections Team`
  );

  res.json({
    ok: true,
    message: 'Registration successful! Confirmation details have been emailed to you.',
    facilitator_id: result.fac.id,
    session_id: sessionId
  });
});

// Public: Digital Certificate Verification
trainingRouter.get('/api/certificates/:code', async (req, res) => {
  const code = str(req.params.code, 64).toUpperCase();
  const cert = await one(
    `SELECT tr.certificate_code, tr.completed_at,
            f.name AS facilitator_name, f.email AS facilitator_email, f.organization,
            ts.title AS session_title, ts.session_date, ts.trainer_name,
            p.name AS partner_name
     FROM training_registrations tr
     JOIN facilitators f ON f.id=tr.facilitator_id
     JOIN training_sessions ts ON ts.id=tr.training_session_id
     LEFT JOIN partners p ON p.id=f.partner_id
     WHERE tr.certificate_code = $1 AND tr.status = 'completed'`,
    [code]
  );

  if (!cert) return res.status(404).json({ error: 'Certificate not found or invalid' });
  res.json(cert);
});

<<<<<<< HEAD
// Staff: Create training session
=======
// Public: List available meeting slots for a training session
trainingRouter.get('/api/training/:sessionId/slots', async (req, res) => {
  const sessionId = intId(req.params.sessionId);
  if (!sessionId) return res.status(400).json({ error: 'Invalid session id' });
  const rows = await query(
    `SELECT id, slot_start, slot_end FROM training_meeting_slots WHERE session_id=$1 AND booked_by IS NULL ORDER BY slot_start ASC`,
    [sessionId]
  );
  res.json(rows);
});

// Staff: List all slots (including booked) for admin view
trainingRouter.get('/api/training/:sessionId/admin/slots', async (req, res) => {
  const sessionId = intId(req.params.sessionId);
  if (!sessionId) return res.status(400).json({ error: 'Invalid session id' });
  const rows = await query(
    `SELECT id, slot_start, slot_end, booked_by, outlook_event_id FROM training_meeting_slots WHERE session_id=$1 ORDER BY slot_start ASC`,
    [sessionId]
  );
  res.json(rows);
});

// Staff: Add a new meeting slot for a session (admin UI)
trainingRouter.post('/api/training/:sessionId/admin/slots', async (req, res) => {
  const sessionId = intId(req.params.sessionId);
  const { slot_start, slot_end } = req.body;
  if (!sessionId || !slot_start || !slot_end) {
    return res.status(400).json({ error: 'sessionId, slot_start and slot_end required' });
  }
  const start = new Date(slot_start);
  const end = new Date(slot_end);
  if (isNaN(start) || isNaN(end) || start >= end) {
    return res.status(400).json({ error: 'Invalid slot times' });
  }
  await run(
    `INSERT INTO training_meeting_slots (session_id, slot_start, slot_end) VALUES ($1, $2, $3)`,
    [sessionId, start.toISOString(), end.toISOString()]
  );
  // Notify staff about the new slot proposal
  try {
    await sendMail(
      STAFF_EMAIL,
      'New Training Meeting Slot Proposed',
      `A new meeting slot has been added for session ID ${sessionId}:
Start: ${start.toISOString()}
End: ${end.toISOString()}`
    );
  } catch (e) {
    console.error('Failed to send admin slot notification email:', e);
  }
  res.json({ ok: true, message: 'Slot added' });
});

trainingRouter.get('/api/training/:sessionId/slots', async (req, res) => {
  const sessionId = intId(req.params.sessionId);
  if (!sessionId) return res.status(400).json({ error: 'Invalid session id' });
  const rows = await query(
    `SELECT id, slot_start, slot_end FROM training_meeting_slots WHERE session_id=$1 AND booked_by IS NULL ORDER BY slot_start ASC`,
    [sessionId]
  );
  res.json(rows);
});

// Public: Book a meeting slot and create Outlook event
trainingRouter.post('/api/training/:sessionId/book-slot', async (req, res) => {
  const sessionId = intId(req.params.sessionId);
  const { slotId, facilitator_id } = req.body;
  if (!sessionId || !slotId || !facilitator_id) {
    return res.status(400).json({ error: 'sessionId, slotId and facilitator_id required' });
  }

  const slot = await one(`
    SELECT id, slot_start, slot_end FROM training_meeting_slots
    WHERE id = $1 AND session_id = $2 AND booked_by IS NULL FOR UPDATE`,
    [slotId, sessionId]
  );
  if (!slot) return res.status(409).json({ error: 'Slot already taken or not found' });

  const fac = await one('SELECT name, email FROM facilitators WHERE id = $1', [facilitator_id]);
  if (!fac) return res.status(404).json({ error: 'Facilitator not found' });

  try {
    const outlookId = await createOutlookEvent({
      subject: `Training meeting – ${fac.name}`,
      startUtc: slot.slot_start.toISOString(),
      endUtc: slot.slot_end.toISOString(),
      attendees: [{ email: fac.email, name: fac.name }],
    });
    await run(
      `UPDATE training_meeting_slots SET booked_by = $1, outlook_event_id = $2 WHERE id = $3`,
      [facilitator_id, outlookId, slotId]
    );
    res.json({ ok: true, message: 'Meeting scheduled and Outlook event created' });
  } catch (e) {
    console.error('Outlook event creation failed →', e);
    res.status(500).json({ error: 'Failed to create Outlook event' });
  }
});

// Staff: Create training session (now also generate meeting slots)
>>>>>>> frontend
trainingRouter.post('/api/training/sessions', async (req, res) => {
  const b = req.body ?? {};
  const title = oneLine(b.title, 200);
  const trainer = oneLine(b.trainer_name, 120) || 'Strong Start Staff';
  const sessionDate = dateOrNull(b.session_date);
  const sessionTime = oneLine(b.session_time, 50) || '10:00 AM - 12:00 PM';
  const deliveryType = b.delivery_type === 'in_person' ? 'in_person' : 'online';
  const locationDetails = str(b.location_details, 500) || (deliveryType === 'online' ? 'Online (the meeting link will be emailed to you before the session)' : 'Strong Start Waterloo Centre');
  const capacity = Math.max(1, Math.min(500, Number(b.capacity) || 25));

  if (!title || !sessionDate) {
    return res.status(400).json({ error: 'Session title and valid session date are required' });
  }

  const { rows } = await run(
    `INSERT INTO training_sessions (title, trainer_name, session_date, session_time, delivery_type, location_details, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [title, trainer, sessionDate, sessionTime, deliveryType, locationDetails, capacity]
  );

  res.json(rows[0]);
});

// Staff: Edit a training session. Only the fields sent change.
trainingRouter.patch('/api/training/sessions/:id', async (req, res) => {
  const id = intId(req.params.id);
  if (!id || !(await one('SELECT id FROM training_sessions WHERE id=$1', [id]))) return res.status(404).json({ error: 'Session not found' });
  const b = req.body ?? {};
  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if ('title' in b) {
    const t = oneLine(b.title, 200);
    if (!t) return res.status(400).json({ error: 'Session title cannot be empty' });
    add('title', t);
  }
  if ('trainer_name' in b) add('trainer_name', oneLine(b.trainer_name, 120) || null);
  if ('session_date' in b) {
    const d = dateOrNull(b.session_date);
    if (!d) return res.status(400).json({ error: 'Session date is not a valid date' });
    add('session_date', d);
  }
  if ('session_time' in b) add('session_time', oneLine(b.session_time, 50) || null);
  if ('delivery_type' in b) {
    if (!['online', 'in_person'].includes(b.delivery_type)) return res.status(400).json({ error: 'Format must be online or in person' });
    add('delivery_type', b.delivery_type);
  }
  if ('location_details' in b) add('location_details', str(b.location_details, 500) || null);
  if ('capacity' in b) {
    const c = Number(b.capacity);
    if (!Number.isInteger(c) || c < 1 || c > 500) return res.status(400).json({ error: 'Capacity must be a whole number from 1 to 500' });
    add('capacity', c);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(id);
  const { rows } = await run(`UPDATE training_sessions SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  res.json(rows[0]);
});

// Staff: Delete a training session that nobody has registered for.
trainingRouter.delete('/api/training/sessions/:id', async (req, res) => {
  const id = intId(req.params.id);
  if (!id || !(await one('SELECT id FROM training_sessions WHERE id=$1', [id]))) return res.status(404).json({ error: 'Session not found' });
  const { n } = await one('SELECT COUNT(*)::int AS n FROM training_registrations WHERE training_session_id=$1', [id]);
  if (n) return res.status(409).json({ error: `This session has ${n} registration${n === 1 ? '' : 's'}, so it cannot be deleted` });
  await run('DELETE FROM training_sessions WHERE id=$1', [id]);
  res.json({ ok: true });
});

// Staff: Session attendees roster
trainingRouter.get('/api/training/sessions/:id/roster', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Session not found' });

  const session = await one('SELECT * FROM training_sessions WHERE id=$1', [id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const roster = await query(
    `SELECT tr.id AS registration_id, tr.status, tr.certificate_code, tr.completed_at, tr.created_at,
            f.id AS facilitator_id, f.name, f.email, f.phone, f.organization, f.certified,
            p.name AS partner_name
     FROM training_registrations tr
     JOIN facilitators f ON f.id=tr.facilitator_id
     LEFT JOIN partners p ON p.id=f.partner_id
     WHERE tr.training_session_id=$1
     ORDER BY tr.created_at ASC`,
    [id]
  );

  res.json({ session, roster });
});

// Staff: Mark training completion and issue certificate
trainingRouter.post('/api/training/registrations/:id/complete', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Registration not found' });

  const reg = await one(
    `SELECT tr.*, f.name AS facilitator_name, f.email AS facilitator_email, ts.title AS session_title
     FROM training_registrations tr
     JOIN facilitators f ON f.id=tr.facilitator_id
     JOIN training_sessions ts ON ts.id=tr.training_session_id
     WHERE tr.id=$1`,
    [id]
  );
  if (!reg) return res.status(404).json({ error: 'Registration not found' });

  const certCode = reg.certificate_code || ('BC-' + randomBytes(4).toString('hex').toUpperCase());

  await tx(async (q) => {
    await q.run(
      `UPDATE training_registrations
       SET status='completed', certificate_code=$1, completed_at=now()
       WHERE id=$2`,
      [certCode, id]
    );

    await q.run(
      `UPDATE facilitators
       SET certified=true, certification_date=now()::date, certificate_code=$1
       WHERE id=$2`,
      [certCode, reg.facilitator_id]
    );
  });

  // Send certificate email with social share guidance
  await sendMail(
    reg.facilitator_email,
    `Congratulations on your Baby Connections Certification!`,
    `Hi ${reg.facilitator_name || 'there'},\n\n` +
    `Congratulations! You have completed the Baby Connections® Facilitator Training for "${reg.session_title}".\n\n` +
    `Your official digital certificate is ready:\n` +
    `${BASE_URL}/certificate/${certCode}\n\n` +
    `You can verify, download, print, or share your certificate directly on LinkedIn to celebrate your accomplishment!\n\n` +
    `What's next:\n` +
    `1. Access facilitator guides and templates in the Knowledge Centre: ${BASE_URL}/resources\n` +
    `2. Order materials when you are ready to launch your first session.\n\n` +
    `Thank you for helping babies and parents get a Strong Start!\n\n` +
    `Baby Connections Team`
  );

  res.json({
    ok: true,
    certificateCode: certCode,
    message: `Certificate issued for ${reg.facilitator_name || reg.facilitator_email}`
  });
});
