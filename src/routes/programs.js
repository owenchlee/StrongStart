// Program Lifecycle & Completion Reporting (Requirements §6, §8, §9)
import { Router } from 'express';
import { resolve } from 'node:path';
import { query, one, run, tx, PROGRAM_DELIVERY_FORMATS } from '../db.js';
import { sendMail, STAFF_EMAIL } from '../mailer.js';
import { BASE_URL, str, oneLine, intId, rateLimit } from '../util.js';

export const programsRouter = Router();

const PUBLIC_DIR = resolve('public');
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const limitCompletion = rateLimit({ name: 'completion', max: 15, windowMs: 10 * 60 * 1000 });

// Public: Serve facilitator completion reporting web page
programsRouter.get('/complete/:token', async (req, res) => {
  if (!TOKEN_RE.test(req.params.token || '')) return res.status(404).type('text').send('Not found');
  const prog = await one('SELECT id FROM programs WHERE token=$1', [req.params.token]);
  if (!prog) return res.status(404).type('text').send('Program not found');
  res.sendFile('completion.html', { root: PUBLIC_DIR });
});

// Public: Fetch program info for completion form
programsRouter.get('/api/programs/:token/completion-form', async (req, res) => {
  if (!TOKEN_RE.test(req.params.token || '')) return res.status(404).json({ error: 'Program not found' });

  const prog = await one(
    `SELECT p.id, p.token, p.name, p.location, p.start_date, p.end_date,
            p.projected_participants, p.delivery_format, p.status, p.community_served,
            f.id AS facilitator_id, f.name AS facilitator_name, f.email AS facilitator_email
     FROM programs p
     JOIN facilitators f ON f.id=p.facilitator_id
     WHERE p.token=$1`,
    [req.params.token]
  );
  if (!prog) return res.status(404).json({ error: 'Program not found' });

  // Count total kits shipped to this program across orders
  const kitsRow = await one(
    `SELECT COALESCE(SUM(oi.qty), 0)::int AS total_kits
     FROM orders o
     JOIN order_items oi ON oi.order_id=o.id
     WHERE o.program_id=$1 AND o.status IN ('shipped', 'received')`,
    [prog.id]
  );

  // Check if completion report already submitted
  const completion = await one('SELECT * FROM program_completions WHERE program_id=$1', [prog.id]);

  res.json({
    program: {
      name: prog.name,
      location: prog.location,
      startDate: prog.start_date,
      endDate: prog.end_date,
      projectedParticipants: prog.projected_participants,
      deliveryFormat: prog.delivery_format,
      status: prog.status,
      communityServed: prog.community_served
    },
    facilitator: {
      name: prog.facilitator_name,
      email: prog.facilitator_email
    },
    kitsShipped: kitsRow?.total_kits ?? 0,
    alreadySubmitted: Boolean(completion),
    completion: completion || null
  });
});

// Public: Facilitator submits completion report
programsRouter.post('/api/programs/:token/completion', limitCompletion, async (req, res) => {
  if (!TOKEN_RE.test(req.params.token || '')) return res.status(404).json({ error: 'Program not found' });

  const prog = await one(
    `SELECT p.id, p.name, p.facilitator_id, f.name AS facilitator_name, f.email AS facilitator_email
     FROM programs p
     JOIN facilitators f ON f.id=p.facilitator_id
     WHERE p.token=$1`,
    [req.params.token]
  );
  if (!prog) return res.status(404).json({ error: 'Program not found' });

  const existing = await one('SELECT id FROM program_completions WHERE program_id=$1', [prog.id]);
  if (existing) {
    return res.status(409).json({ error: 'A completion report has already been submitted for this program' });
  }

  const b = req.body ?? {};
  const familiesServed = Math.max(0, Math.min(100000, Math.floor(Number(b.families_served)) || 0));
  const kitsDistributed = Math.max(0, Math.min(100000, Math.floor(Number(b.kits_distributed)) || 0));
  const confirmed = Boolean(b.completion_confirmed);

  if (!confirmed) {
    return res.status(400).json({ error: 'Please confirm that the program has concluded' });
  }

  const reflections = str(b.reflections, 5000) || null;
  const successStories = str(b.success_stories, 5000) || null;
  const challenges = str(b.challenges, 5000) || null;

  await tx(async (q) => {
    await q.run(
      `INSERT INTO program_completions
       (program_id, facilitator_id, families_served, kits_distributed, completion_confirmed, reflections, success_stories, challenges)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [prog.id, prog.facilitator_id, familiesServed, kitsDistributed, confirmed, reflections, successStories, challenges]
    );
    await q.run("UPDATE programs SET status='completed' WHERE id=$1", [prog.id]);
  });

  // Notify Strong Start staff of completion report
  await sendMail(
    STAFF_EMAIL,
    `Program Completion Report: ${prog.name}`,
    `Hi team,\n\n${prog.facilitator_name || prog.facilitator_email} has submitted the completion report for "${prog.name}":\n\n` +
    `Families Served: ${familiesServed}\n` +
    `Kits Distributed: ${kitsDistributed}\n\n` +
    `Reflections:\n${reflections || 'None provided'}\n\n` +
    `Success Stories / Quotes:\n${successStories || 'None provided'}\n\n` +
    `Challenges:\n${challenges || 'None provided'}\n\n` +
    `View in the dashboard:\n${BASE_URL}/#programs\n\n` +
    `Baby Connections SiTE SOURCE`
  );

  res.json({
    ok: true,
    message: 'Thank you! Your program completion report has been submitted.'
  });
});

// Staff: Get program completion report
programsRouter.get('/api/programs/:id/completion', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Program not found' });

  const completion = await one(
    `SELECT pc.*, p.name AS program_name, p.token AS program_token, f.name AS facilitator_name, f.email AS facilitator_email
     FROM program_completions pc
     JOIN programs p ON p.id=pc.program_id
     JOIN facilitators f ON f.id=p.facilitator_id
     WHERE pc.program_id=$1`,
    [id]
  );
  if (!completion) return res.status(404).json({ error: 'No completion report for this program' });

  res.json(completion);
});

// Staff: Update program details and status
programsRouter.patch('/api/programs/:id', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Program not found' });

  const existing = await one('SELECT * FROM programs WHERE id=$1', [id]);
  if (!existing) return res.status(404).json({ error: 'Program not found' });

  const b = req.body ?? {};
  const status = ['scheduled', 'in_progress', 'completed', 'cancelled'].includes(b.status) ? b.status : existing.status;
  const deliveryFormat = PROGRAM_DELIVERY_FORMATS.includes(b.delivery_format) ? b.delivery_format : existing.delivery_format;
  const sessionSchedule = b.session_schedule !== undefined ? str(b.session_schedule, 200) || null : existing.session_schedule;
  const externalRegistrationUrl = b.external_registration_url !== undefined ? str(b.external_registration_url, 500) || null : existing.external_registration_url;
  const communityServed = b.community_served !== undefined ? oneLine(b.community_served, 200) || null : existing.community_served;
  const partnerId = b.partner_id !== undefined ? intId(b.partner_id) : existing.partner_id;

  const { rows } = await run(
    `UPDATE programs SET
       status = $1, delivery_format = $2, session_schedule = $3,
       external_registration_url = $4, community_served = $5, partner_id = $6
     WHERE id = $7
     RETURNING *`,
    [status, deliveryFormat, sessionSchedule, externalRegistrationUrl, communityServed, partnerId, id]
  );

  res.json(rows[0]);
});
