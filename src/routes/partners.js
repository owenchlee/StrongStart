// Program Partner Lifecycle Management (EOI -> Discovery -> PDSA -> Active -> Inactive)
import { Router } from 'express';
import multer from 'multer';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { query, one, run, PARTNER_STAGES } from '../db.js';
import { sendMail, STAFF_EMAIL } from '../mailer.js';
import { BASE_URL, str, oneLine, dateOrNull, intId, validEmail } from '../util.js';

export const partners = Router();

const DOCS_DIR = resolve('data/partner_docs');
const docUpload = multer({
  storage: multer.diskStorage({
    destination: DOCS_DIR,
    filename: (_r, file, cb) => {
      const ext = extname(file.originalname).slice(0, 10);
      cb(null, randomBytes(16).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

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

// Staff: Upload documents for a partner
partners.post('/api/partners/:id/documents', docUpload.array('files', 10), async (req, res) => {
  const partnerId = intId(req.params.id);
  if (!partnerId) return res.status(404).json({ error: 'Partner not found' });

  const partner = await one('SELECT id FROM partners WHERE id=$1', [partnerId]);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files were uploaded' });

  const saved = [];
  for (const f of files) {
    const { rows } = await run(
      `INSERT INTO partner_documents (partner_id, filename, original_name, mime_type, file_size, file_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'staff')
       RETURNING *`,
      [partnerId, f.filename, f.originalname, f.mimetype, f.size, f.path]
    );
    saved.push(rows[0]);
  }

  res.json({ ok: true, documents: saved });
});

// Staff: List documents for a partner
partners.get('/api/partners/:id/documents', async (req, res) => {
  const partnerId = intId(req.params.id);
  if (!partnerId) return res.status(404).json({ error: 'Partner not found' });

  const docs = await query('SELECT * FROM partner_documents WHERE partner_id=$1 ORDER BY id DESC', [partnerId]);
  res.json(docs);
});

// Public: download a document from an emailed link (random token, not the guessable id)
partners.get('/api/documents/:token/download', async (req, res) => {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(req.params.token)) return res.status(404).send('Not found');
  const doc = await one('SELECT * FROM partner_documents WHERE token=$1', [req.params.token]);
  if (!doc || !existsSync(doc.file_path)) return res.status(404).send('Document not found or removed');
  res.download(doc.file_path, doc.original_name);
});

// Staff: Download document
partners.get('/api/partners/:partnerId/documents/:docId/download', async (req, res) => {
  const partnerId = intId(req.params.partnerId);
  const docId = intId(req.params.docId);
  if (!partnerId || !docId) return res.status(404).send('Not found');

  const doc = await one('SELECT * FROM partner_documents WHERE id=$1 AND partner_id=$2', [docId, partnerId]);
  if (!doc || !existsSync(doc.file_path)) return res.status(404).send('Document not found or removed');

  res.download(doc.file_path, doc.original_name);
});

// Staff: Delete document
partners.delete('/api/partners/:id/documents/:docId', async (req, res) => {
  const partnerId = intId(req.params.id);
  const docId = intId(req.params.docId);
  if (!partnerId || !docId) return res.status(404).json({ error: 'Not found' });

  const doc = await one('SELECT * FROM partner_documents WHERE id=$1 AND partner_id=$2', [docId, partnerId]);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  await run('DELETE FROM partner_documents WHERE id=$1', [docId]);
  await unlink(doc.file_path).catch(() => {});

  res.json({ ok: true });
});

// Staff: Get conversation history for a partner
partners.get('/api/partners/:id/messages', async (req, res) => {
  const partnerId = intId(req.params.id);
  if (!partnerId) return res.status(404).json({ error: 'Partner not found' });

  const messages = await query(
    'SELECT * FROM partner_messages WHERE partner_id=$1 ORDER BY created_at ASC',
    [partnerId]
  );
  res.json(messages);
});

// Staff: Send CRM reply to partner with uploaded documents
partners.post('/api/partners/:id/reply', async (req, res) => {
  const partnerId = intId(req.params.id);
  if (!partnerId) return res.status(404).json({ error: 'Partner not found' });

  const partner = await one('SELECT * FROM partners WHERE id=$1', [partnerId]);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  if (!partner.contact_email) return res.status(400).json({ error: 'Partner has no contact email on file' });

  const b = req.body ?? {};
  const subject = oneLine(b.subject || `Re: Baby Connections - ${partner.name}`, 300);
  const messageBody = str(b.body, 10000);
  if (!messageBody) return res.status(400).json({ error: 'Message body is required' });

  // Optional: advance stage from the reply action
  if (b.stage && PARTNER_STAGES.includes(b.stage)) {
    await run('UPDATE partners SET stage=$1, updated_at=now() WHERE id=$2', [b.stage, partnerId]);
  }

  // Find documents to attach (all or specific ids)
  let docRows = [];
  if (Array.isArray(b.document_ids) && b.document_ids.length) {
    const ids = b.document_ids.map(Number).filter(Boolean);
    docRows = await query('SELECT * FROM partner_documents WHERE partner_id=$1 AND id=ANY($2::int[])', [partnerId, ids]);
  } else if (b.attach_all) {
    docRows = await query('SELECT * FROM partner_documents WHERE partner_id=$1', [partnerId]);
  }

  // Format document links in email body
  let fullBody = messageBody;
  const attachmentsInfo = [];
  const mailAttachments = [];

  if (docRows.length) {
    fullBody += '\n\nAttached Documents:\n' + docRows.map((d) => {
      const link = `${BASE_URL}/api/documents/${d.token}/download`;
      attachmentsInfo.push({ id: d.id, name: d.original_name, url: link });
      if (existsSync(d.file_path)) {
        mailAttachments.push({ filename: d.original_name, path: d.file_path });
      }
      return `- ${d.original_name}: ${link}`;
    }).join('\n');
  }

  // Send the email
  await sendMail(partner.contact_email, subject, fullBody, { attachments: mailAttachments });

  // Record outbound message in conversation history
  const { rows } = await run(
    `INSERT INTO partner_messages (partner_id, direction, from_email, to_email, subject, body, attachments)
     VALUES ($1, 'outbound', $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [partnerId, STAFF_EMAIL, partner.contact_email, subject, fullBody, JSON.stringify(attachmentsInfo)]
  );

  res.json({ ok: true, message: docRows.length ? `Reply sent with ${docRows.length} attached document${docRows.length === 1 ? '' : 's'}` : 'Reply sent', record: rows[0] });
});
