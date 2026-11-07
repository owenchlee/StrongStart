// Program Partner Lifecycle Management (EOI -> Discovery -> PDSA -> Active -> Inactive)
import { Router } from 'express';
import { query, one, run, PARTNER_STAGES } from '../db.js';
import { sendMail, STAFF_EMAIL, BASE_URL } from '../mailer.js';

export const partners = Router();

const str = (v, max = 5000) => (v == null ? '' : String(v)).replace(/\u0000/g, '').trim().slice(0, max);
const oneLine = (v, max = 200) => str(v, max).replace(/\s*[\r\n]+\s*/g, ' ');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const dateOrNull = (v) => { const s = str(v, 10); return isDate(s) ? s : null; };
const intId = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);
const validEmail = (e) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(e || '').trim());

// Public: Prospective partner submits Expression of Interest (EOI)
partners.post('/api/partners/interest', async (req, res) => {
  const b = req.body ?? {};
  const name = oneLine(b.name || b.organization, 200);
  const email = str(b.contact_email || b.email, 254).toLowerCase();
  const contactName = oneLine(b.contact_name, 120) || null;
  const phone = oneLine(b.contact_phone || b.phone, 50) || null;
  const communities = str(b.communities_served || b.communities, 500) || null;
  const notes = str(b.notes || b.comments, 3000) || null;

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Organization name is required (at least 2 characters)' });
  }
  if (!email || !validEmail(email)) {
    return res.status(400).json({ error: 'A valid contact email address is required' });
  }

  const { rows } = await run(
    `INSERT INTO partners (name, contact_name, contact_email, contact_phone, communities_served, notes, stage)
     VALUES ($1, $2, $3, $4, $5, $6, 'expression_of_interest')
     RETURNING id, name, created_at`,
    [name, contactName, email, phone, communities, notes]
  );
  const partnerId = rows[0].id;

  // Notify Strong Start staff of the new Expression of Interest
  await sendMail(
    STAFF_EMAIL,
    `New Partner Expression of Interest: ${name}`,
    `Hi team,\n\nA new Program Partner Expression of Interest has been submitted:\n\n` +
    `Organization: ${name}\n` +
    `Contact: ${contactName || 'N/A'} <${email}>\n` +
    `Phone: ${phone || 'N/A'}\n` +
    `Communities Served: ${communities || 'N/A'}\n` +
    `Notes / Background:\n${notes || 'None provided'}\n\n` +
    `Review this partner in the dashboard:\n${BASE_URL}/#partners\n\n` +
    `Baby Connections SiTE SOURCE`
  );

  res.json({
    ok: true,
    partnerId,
    message: 'Thank you! Your Expression of Interest has been received. Our team will be in touch shortly.'
  });
});

// Staff: Pipeline rollup counts by stage
partners.get('/api/partners/pipeline', async (_req, res) => {
  const rows = await query('SELECT stage, COUNT(*)::int AS count FROM partners GROUP BY stage');
  const counts = Object.fromEntries(PARTNER_STAGES.map((s) => [s, 0]));
  let total = 0;
  for (const r of rows) {
    counts[r.stage] = r.count;
    total += r.count;
  }
  res.json({ counts, total, stages: PARTNER_STAGES });
});

// Staff: List partners with search and stage filter
partners.get('/api/partners', async (req, res) => {
  const where = [];
  const params = [];
  const stage = str(req.query.stage, 50);
  const search = str(req.query.search, 100);

  if (stage && PARTNER_STAGES.includes(stage)) {
    params.push(stage);
    where.push(`p.stage = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.contact_name ILIKE $${params.length} OR p.contact_email ILIKE $${params.length} OR p.communities_served ILIKE $${params.length})`);
  }

  const sql = `
    SELECT p.*,
      COUNT(DISTINCT f.id)::int AS facilitator_count,
      COUNT(DISTINCT pr.id)::int AS program_count
    FROM partners p
    LEFT JOIN facilitators f ON f.partner_id = p.id
    LEFT JOIN programs pr ON pr.partner_id = p.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY p.id
    ORDER BY p.updated_at DESC, p.id DESC
  `;
  res.json(await query(sql, params));
});

// Staff: Create partner manually
partners.post('/api/partners', async (req, res) => {
  const b = req.body ?? {};
  const name = oneLine(b.name, 200);
  const email = str(b.contact_email, 254).toLowerCase() || null;
  const contactName = oneLine(b.contact_name, 120) || null;
  const phone = oneLine(b.contact_phone, 50) || null;
  const communities = str(b.communities_served, 500) || null;
  const stage = PARTNER_STAGES.includes(b.stage) ? b.stage : 'expression_of_interest';
  const notes = str(b.notes, 5000) || null;

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Organization name is required (at least 2 characters)' });
  }
  if (email && !validEmail(email)) {
    return res.status(400).json({ error: 'Contact email is invalid' });
  }

  const { rows } = await run(
    `INSERT INTO partners (name, contact_name, contact_email, contact_phone, communities_served, stage, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [name, contactName, email, phone, communities, stage, notes]
  );
  res.json(rows[0]);
});

// Staff: Get partner details including linked facilitators and programs
partners.get('/api/partners/:id', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Partner not found' });

  const partner = await one('SELECT * FROM partners WHERE id=$1', [id]);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const facilitators = await query(
    'SELECT id, name, email, organization, created_at FROM facilitators WHERE partner_id=$1 ORDER BY name, email',
    [id]
  );
  const programs = await query(
    `SELECT p.*, f.name AS facilitator_name, f.email AS facilitator_email,
            COUNT(fb.id)::int AS feedback_count
     FROM programs p
     LEFT JOIN facilitators f ON f.id=p.facilitator_id
     LEFT JOIN feedback fb ON fb.program_id=p.id
     WHERE p.partner_id=$1
     GROUP BY p.id, f.id
     ORDER BY p.start_date DESC NULLS LAST, p.id DESC`,
    [id]
  );

  res.json({
    ...partner,
    facilitators,
    programs
  });
});

// Staff: Update partner details, stage, and PDSA agreements
partners.patch('/api/partners/:id', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Partner not found' });

  const existing = await one('SELECT * FROM partners WHERE id=$1', [id]);
  if (!existing) return res.status(404).json({ error: 'Partner not found' });

  const b = req.body ?? {};
  let stage = existing.stage;
  if (b.stage && PARTNER_STAGES.includes(b.stage)) {
    stage = b.stage;
  }

  let pdsaStatus = b.pdsa_status !== undefined ? str(b.pdsa_status, 50) : existing.pdsa_status;
  // If stage transitions to 'active' or 'pdsa_signed', automatically update PDSA status if pending
  if (stage === 'active' && (!pdsaStatus || pdsaStatus === 'pending')) {
    pdsaStatus = 'executed';
  } else if (stage === 'pdsa_signed' && (!pdsaStatus || pdsaStatus === 'pending')) {
    pdsaStatus = 'signed';
  }

  const name = b.name !== undefined ? oneLine(b.name, 200) : existing.name;
  const contactName = b.contact_name !== undefined ? oneLine(b.contact_name, 120) || null : existing.contact_name;
  const contactEmail = b.contact_email !== undefined ? str(b.contact_email, 254).toLowerCase() || null : existing.contact_email;
  const contactPhone = b.contact_phone !== undefined ? oneLine(b.contact_phone, 50) || null : existing.contact_phone;
  const communities = b.communities_served !== undefined ? str(b.communities_served, 500) || null : existing.communities_served;
  const notes = b.notes !== undefined ? str(b.notes, 5000) || null : existing.notes;

  const pdsaIssued = b.pdsa_issued_date !== undefined ? dateOrNull(b.pdsa_issued_date) : existing.pdsa_issued_date;
  const pdsaExecuted = b.pdsa_executed_date !== undefined ? dateOrNull(b.pdsa_executed_date) : existing.pdsa_executed_date;
  const pdsaExpiry = b.pdsa_expiry_date !== undefined ? dateOrNull(b.pdsa_expiry_date) : existing.pdsa_expiry_date;

  const { rows } = await run(
    `UPDATE partners SET
       name = $1, contact_name = $2, contact_email = $3, contact_phone = $4,
       communities_served = $5, stage = $6, notes = $7,
       pdsa_status = $8, pdsa_issued_date = $9, pdsa_executed_date = $10, pdsa_expiry_date = $11,
       updated_at = now()
     WHERE id = $12
     RETURNING *`,
    [name, contactName, contactEmail, contactPhone, communities, stage, notes, pdsaStatus, pdsaIssued, pdsaExecuted, pdsaExpiry, id]
  );

  res.json(rows[0]);
});

// Staff: Link a facilitator to a partner
partners.post('/api/partners/:id/facilitators', async (req, res) => {
  const partnerId = intId(req.params.id);
  if (!partnerId) return res.status(404).json({ error: 'Partner not found' });

  const partner = await one('SELECT id, name FROM partners WHERE id=$1', [partnerId]);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const facilitatorId = intId(req.body?.facilitator_id);
  const facilitatorEmail = str(req.body?.email, 254).toLowerCase();

  let fac = null;
  if (facilitatorId) {
    fac = await one('SELECT * FROM facilitators WHERE id=$1', [facilitatorId]);
  } else if (facilitatorEmail) {
    fac = await one('SELECT * FROM facilitators WHERE lower(email)=$1', [facilitatorEmail]);
  }

  if (!fac) return res.status(404).json({ error: 'Facilitator not found' });

  await run('UPDATE facilitators SET partner_id=$1 WHERE id=$2', [partnerId, fac.id]);
  // Also link any existing programs belonging to this facilitator that don't have a partner yet
  await run('UPDATE programs SET partner_id=$1 WHERE facilitator_id=$2 AND partner_id IS NULL', [partnerId, fac.id]);

  res.json({ ok: true, message: `Linked ${fac.name || fac.email} to ${partner.name}` });
});
