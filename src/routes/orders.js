// Steps 1-3: inbound facilitator email -> order form -> confirmation + kits-received emails.
import { Router } from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { query, one, run, tx, KIT_ITEMS } from '../db.js';
import { sendMail, STAFF_EMAIL } from '../mailer.js';
import { BASE_URL, str, oneLine, isDate, dateOrNull, intId, validEmail, escapeHtml as esc } from '../util.js';

export const orders = Router();

const token = () => randomBytes(16).toString('hex');
const page = (title, msg, extra = '') =>
  `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/style.css><title>${esc(title)}</title></head><body class=public><header class="site-head simple"><div class=in><p class=brand><svg class=mark viewBox="0 0 32 32" aria-hidden=true focusable=false><circle class=a cx=12 cy=17 r=9 /><circle class=b cx=21 cy=17 r=9 /></svg><span>Baby Connections <small>Strong Start</small></span></p></div></header><main id=main><div class=card>${title === 'Thank you!' ? `<div class=done-icon><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>` : ''}<h1>${esc(title)}</h1><p>${esc(msg)}</p>${extra}</div></main></body></html>`;

// ---------- input helpers ----------
const MAX_QTY = 5000;
const cleanItems = (items) => {
  const out = new Map();
  for (const i of Array.isArray(items) ? items.slice(0, 50) : []) {
    const qty = Math.floor(Number(i?.qty));
    if (KIT_ITEMS.includes(i?.item) && Number.isFinite(qty) && qty > 0) out.set(i.item, Math.min(qty, MAX_QTY));
  }
  return [...out].map(([item, qty]) => ({ item, qty }));
};
const money = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : undefined; // undefined = invalid
};

// ---------- inbound email ----------
/** Accepts our own JSON ({from,subject,body,name}) or Postmark/SendGrid-style fields. */
function normalizeInbound(b = {}) {
  const raw = str(b.from || b.From || b.FromFull?.Email || b.sender, 320);
  const email = (raw.match(/<([^>]+)>/)?.[1] || raw).trim().toLowerCase();
  const name = oneLine(b.name || b.FromName || raw.replace(/<[^>]*>/, '').replace(/"/g, ''), 120) || null;
  return {
    email,
    name: name === email ? null : name,
    subject: oneLine(b.subject || b.Subject, 300),
    body: str(b.body || b.TextBody || b.text || b.plain || '', 20000),
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Regex-only extraction of order hints from a facilitator's free-text email. Exported for tests. */
export function parseHints(subject = '', body = '', now = new Date()) {
  const text = `${subject}\n${body}`;
  const h = {};
  const prog =
    text.match(/\b(?:program|class|group|series|workshop|session)\s*(?:name\s*)?(?:(?:is|was)\s+(?:called|named)|is|:|called|named)\s*["“']?([^\n"”.,;]{3,80}?)(?=\s+(?:and\s+)?(?:is|has|have|will|we|starting|starts|that|which|for\s+\d|with\s+\d)\b|["”.,;\n]|$)/i) ||
    text.match(/\bfor (?:our|my|the)\s+([A-Z][\w'’& -]{2,60}?)\s+(?:program|class|group|series|workshop)\b/);
  if (prog) h.program_name = prog[1].trim();
  const ppl = text.match(/\b(\d{1,3})\s+(?:participants?|parents?|families|caregivers?|moms?|mothers?|babies|people|attendees|registrants)\b/i);
  if (ppl) h.participants = Number(ppl[1]);
  const kits = text.match(/\b(\d{1,3})\s+(?:participant\s+|parent\s+)?kits?\b/i);
  if (kits) h.kits = Number(kits[1]);

  const dates = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) if (isDate(m[0])) dates.push(m[0]);
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi)) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    const day = Number(m[2]);
    if (day < 1 || day > 31) continue;
    let year = m[3] ? Number(m[3]) : now.getUTCFullYear();
    if (!m[3] && Date.UTC(year, mo, day) < now.getTime() - 86400000) year += 1;
    const iso = `${year}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isDate(iso)) dates.push(iso);
  }
  const uniq = [...new Set(dates)].slice(0, 4);
  if (uniq.length) { h.dates = uniq; h.start_date = uniq[0]; if (uniq.length > 1) h.end_date = uniq[uniq.length - 1]; }

  // Start at the street number (not the start of the line) so a one-paragraph email doesn't return the whole paragraph,
  // and stop at the postal code (US ZIP or Canadian) when there is one.
  const POSTAL = /\b(?:[A-Z]\d[A-Z] ?\d[A-Z]\d|\d{5}(?:-\d{4})?)\b/i;
  const addr = text.match(/\b\d{1,6}\s+(?:(?:[A-Za-z.'’-]+|\d+(?:st|nd|rd|th))\s+){0,4}(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|cres|crescent|hwy|highway)\b\.?[^\n]*(?:\n[^\n]*\b(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)\b[^\n]*)?/i);
  if (addr) {
    const kept = [];
    for (const line of addr[0].split('\n')) {
      const pc = line.match(POSTAL);
      if (pc) { kept.push(line.slice(0, pc.index + pc[0].length)); break; }
      kept.push(line);
    }
    h.address = kept.join('\n').trim().slice(0, 300);
  }
  return h;
}

let warnedNoSecret = false;
const sha = (s) => createHash('sha256').update(String(s)).digest();
function inboundAllowed(req) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) {
    if (!warnedNoSecret) { warnedNoSecret = true; console.warn('[inbound-email] INBOUND_EMAIL_SECRET is not set: the webhook accepts anyone. Set it in production.'); }
    return true;
  }
  const given = req.get('x-inbound-secret') ?? (typeof req.query.secret === 'string' ? req.query.secret : '');
  return timingSafeEqual(sha(given), sha(secret));
}

// Step 1: an email from a facilitator arrives (point your email provider's inbound webhook here).
orders.post('/api/inbound-email', async (req, res) => {
  if (!inboundAllowed(req)) return res.status(401).json({ error: 'Unauthorized' });
  const m = normalizeInbound(req.body);
  if (m.email.length > 254 || !validEmail(m.email)) return res.status(400).json({ error: 'Valid sender email required' });
  const hints = parseHints(m.subject, m.body);

  const t = token();
  const matchedPartner = await one(
    `SELECT p.id FROM partners p WHERE lower(p.contact_email) = $1
     UNION
     SELECT f.partner_id AS id FROM facilitators f WHERE lower(f.email) = $1 AND f.partner_id IS NOT NULL
     LIMIT 1`,
    [m.email]
  );

  if (matchedPartner?.id) {
    await run(
      `INSERT INTO partner_messages (partner_id, direction, from_email, to_email, subject, body)
       VALUES ($1, 'inbound', $2, $3, $4, $5)`,
      [matchedPartner.id, m.email, STAFF_EMAIL, m.subject, m.body]
    );
  }

  const { fac, orderId } = await tx(async (q) => {
    await q.run('INSERT INTO facilitators (email, name, partner_id) VALUES ($1,$2,$3) ON CONFLICT(email) DO UPDATE SET name=COALESCE(facilitators.name, excluded.name), partner_id=COALESCE(facilitators.partner_id, excluded.partner_id)',
      [m.email, m.name, matchedPartner?.id || null]);
    const fac = await q.one('SELECT * FROM facilitators WHERE email=$1', [m.email]);
    // Step 2: create an order and reply with its personal order-form link.
    const { rows } = await q.run('INSERT INTO orders (token, facilitator_id) VALUES ($1,$2) RETURNING id', [t, fac.id]);
    await q.run('INSERT INTO inbound_emails (facilitator_id, from_email, subject, body, order_id, hints, partner_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',
      [fac.id, m.email, m.subject, m.body, rows[0].id, JSON.stringify(hints), matchedPartner?.id || null]);
    return { fac, orderId: rows[0].id };
  });

  await sendMail(m.email, 'Your Baby Connections kit order form',
    `Hi ${fac.name || 'there'},\n\nThanks for getting in touch. Please fill out your kit order form here:\n${BASE_URL}/order/${t}\n\nIt takes a couple of minutes: tell us about your program and which kits you need.\n\nBaby Connections team`);
  res.json({ ok: true, orderId, orderLink: `${BASE_URL}/order/${t}` });
});

orders.get('/order/:token', (_req, res) => res.sendFile('order.html', { root: 'public' }));

orders.get('/api/order-form/:token', async (req, res) => {
  const o = await one(`SELECT o.id, o.status, f.name, f.email,
      (SELECT ie.hints FROM inbound_emails ie WHERE ie.order_id=o.id ORDER BY ie.id DESC LIMIT 1) AS hints
    FROM orders o JOIN facilitators f ON f.id=o.facilitator_id WHERE o.token=$1`, [req.params.token]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const { id: _id, ...rest } = o;
  res.json({ ...rest, hints: o.hints || {}, kitItems: KIT_ITEMS });
});

// Facilitator submits the order form -> program + items created, confirmation emailed.
orders.post('/api/order-form/:token', async (req, res) => {
  const o = await one('SELECT * FROM orders WHERE token=$1', [req.params.token]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (o.status !== 'form_sent') return res.status(409).json({ error: 'This order was already submitted' });

  const b = req.body ?? {};
  const program = b.program ?? {};
  const lines = cleanItems(b.items);
  const pname = oneLine(program.name, 200);
  const address = str(b.shipping_address, 500);
  if (!pname || !address || !lines.length)
    return res.status(400).json({ error: 'Program name, shipping address and at least one kit are required' });
  const requested = dateOrNull(b.requested_date);
  if (b.requested_date && !requested) return res.status(400).json({ error: 'Requested delivery date is not a valid date' });
  const fname = oneLine(b.facilitator_name, 120);
  const notes = str(b.notes, 2000) || null;
  const projected = Math.min(Math.floor(Number(program.projected_participants)) || 0, 100000) || null;
  const deliveryFormat = ['in_person', 'virtual', 'hybrid'].includes(program.delivery_format) ? program.delivery_format : 'in_person';
  const sessionSchedule = str(program.session_schedule, 200) || null;
  const externalRegUrl = str(program.external_registration_url, 500) || null;
  const communityServed = oneLine(program.community_served, 200) || null;

  const existingFac = await one('SELECT partner_id FROM facilitators WHERE id=$1', [o.facilitator_id]);
  const partnerId = existingFac?.partner_id || null;

  const programId = await tx(async (q) => {
    const claim = await q.run("UPDATE orders SET status='ordered', shipping_address=$1, requested_date=$2, notes=$3, ordered_at=now() WHERE id=$4 AND status='form_sent' RETURNING id",
      [address, requested, notes, o.id]);
    if (!claim.rows.length) return null;
    if (fname) await q.run('UPDATE facilitators SET name=$1 WHERE id=$2', [fname, o.facilitator_id]);
    const { rows } = await q.run('INSERT INTO programs (facilitator_id,name,location,start_date,end_date,projected_participants,delivery_format,session_schedule,external_registration_url,community_served,partner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
      [o.facilitator_id, pname, oneLine(program.location, 200) || null, dateOrNull(program.start_date), dateOrNull(program.end_date), projected, deliveryFormat, sessionSchedule, externalRegUrl, communityServed, partnerId]);
    await q.run('UPDATE orders SET program_id=$1 WHERE id=$2', [rows[0].id, o.id]);
    for (const l of lines) await q.run('INSERT INTO order_items (order_id,item,qty) VALUES ($1,$2,$3)', [o.id, l.item, l.qty]);
    return rows[0].id;
  });
  if (programId == null) return res.status(409).json({ error: 'This order was already submitted' });

  const fac = await one('SELECT * FROM facilitators WHERE id=$1', [o.facilitator_id]);
  const summary = lines.map((l) => `  - ${l.item}: ${l.qty}`).join('\n');
  await sendMail(fac.email, `Order confirmation: ${pname}`,
    `Hi ${fac.name || 'there'},\n\nWe've received your order for "${pname}":\n${summary}\n\nShip to: ${address}\n${requested ? `Requested by: ${requested}\n` : ''}\nWe'll email you when it ships.\n\nBaby Connections team`);
  await sendMail(STAFF_EMAIL, `New kit order #${o.id}: ${pname}`,
    `${fac.name || fac.email} ordered:\n${summary}\n\nShip to: ${address}\nTraining: ${fac.certified ? 'completed (certified)' : 'not completed yet'}\nOpen the dashboard: ${BASE_URL}/`);
  res.json({ ok: true, orderId: o.id, programId });
});

// ---------- staff: orders (auth.js default-deny covers everything below) ----------
async function itemsFor(orderId) {
  return query('SELECT item, qty FROM order_items WHERE order_id=$1 ORDER BY id', [orderId]);
}

orders.get('/api/orders', async (_req, res) => {
  const rows = await query(`SELECT o.id, o.status, o.token, o.created_at, o.ordered_at, o.shipped_at, o.received_at, o.cancelled_at, o.reminder_sent_at,
      o.shipping_address, o.requested_date, o.notes, o.shipping_cost,
      f.name AS facilitator, f.email, f.certified, p.name AS program, p.id AS program_id, p.token AS program_token
    FROM orders o JOIN facilitators f ON f.id=o.facilitator_id LEFT JOIN programs p ON p.id=o.program_id ORDER BY o.id DESC`);
  const items = await query('SELECT order_id, item, qty FROM order_items ORDER BY id');
  const by = new Map();
  for (const i of items) (by.get(i.order_id) ?? by.set(i.order_id, []).get(i.order_id)).push({ item: i.item, qty: i.qty });
  res.json(rows.map((r) => ({ ...r, items: by.get(r.id) ?? [] })));
});

// Staff edits an order that has not shipped yet.
orders.patch('/api/orders/:id', async (req, res) => {
  const id = intId(req.params.id);
  const o = id && (await one('SELECT * FROM orders WHERE id=$1', [id]));
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const b = req.body ?? {};
  if (o.status === 'cancelled') return res.status(409).json({ error: 'Order is cancelled' });
  const editable = ['form_sent', 'ordered'].includes(o.status);
  const touchesShipment = ['shipping_address', 'requested_date', 'notes', 'items'].some((k) => k in b);
  if (touchesShipment && !editable) return res.status(409).json({ error: 'Only orders that have not shipped can be edited' });

  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if ('shipping_address' in b) {
    const a = str(b.shipping_address, 500);
    if (!a) return res.status(400).json({ error: 'Shipping address cannot be empty' });
    add('shipping_address', a);
  }
  if ('requested_date' in b) {
    const d = b.requested_date ? dateOrNull(b.requested_date) : null;
    if (b.requested_date && !d) return res.status(400).json({ error: 'Requested date is not a valid date' });
    add('requested_date', d);
  }
  if ('notes' in b) add('notes', str(b.notes, 2000) || null);
  if ('shipping_cost' in b) {
    const c = money(b.shipping_cost);
    if (c === undefined) return res.status(400).json({ error: 'Shipping cost must be a non-negative number' });
    add('shipping_cost', c);
  }
  let lines = null;
  if ('items' in b) {
    lines = cleanItems(b.items);
    if (!lines.length) return res.status(400).json({ error: 'At least one kit is required' });
  }
  if (!sets.length && !lines) return res.status(400).json({ error: 'Nothing to update' });

  const ok = await tx(async (q) => {
    vals.push(id);
    const r = await q.run(`UPDATE orders SET ${sets.length ? sets.join(',') : 'id=id'} WHERE id=$${vals.length} AND status<>'cancelled' RETURNING id`, vals);
    if (!r.rows.length) return false;
    if (lines) {
      await q.run('DELETE FROM order_items WHERE order_id=$1', [id]);
      for (const l of lines) await q.run('INSERT INTO order_items (order_id,item,qty) VALUES ($1,$2,$3)', [id, l.item, l.qty]);
    }
    return true;
  });
  if (!ok) return res.status(409).json({ error: 'Order could not be updated' });
  const fresh = await one('SELECT id, status, shipping_address, requested_date, notes, shipping_cost FROM orders WHERE id=$1', [id]);
  res.json({ ok: true, order: { ...fresh, items: await itemsFor(id) } });
});

orders.post('/api/orders/:id/cancel', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Order not found' });
  const { rows } = await run("UPDATE orders SET status='cancelled', cancelled_at=now() WHERE id=$1 AND status IN ('form_sent','ordered','shipped') RETURNING id, facilitator_id, program_id", [id]);
  if (!rows.length) {
    return res.status(await one('SELECT 1 AS x FROM orders WHERE id=$1', [id]) ? 409 : 404)
      .json({ error: 'Order not found or cannot be cancelled' });
  }
  const o = rows[0];
  const fac = await one('SELECT * FROM facilitators WHERE id=$1', [o.facilitator_id]);
  const prog = o.program_id ? await one('SELECT name FROM programs WHERE id=$1', [o.program_id]) : null;
  await sendMail(fac.email, 'Your Baby Connections order was cancelled',
    `Hi ${fac.name || 'there'},\n\nYour kit order${prog ? ` for "${prog.name}"` : ''} has been cancelled. If this is unexpected, or you'd still like kits, just reply to this email and we'll help.\n\nBaby Connections team`);
  res.json({ ok: true });
});

// Staff marks an order shipped -> facilitator gets a "confirm you received it" link; staff get a packing slip.

// Staff: Update order status via dropdown (staff only)
orders.patch('/api/orders/:id/status', async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Order not found' });
  const { status } = req.body ?? {};
  const allowed = ['form_sent', 'ordered', 'shipped', 'received']; // map to our UI labels
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  // Build UPDATE with optional timestamps
  let sql = `UPDATE orders SET status=$1`;
  const params = [status, id];
  if (status === 'shipped') {
    sql += `, shipped_at=now()`;
  } else if (status === 'received') {
    sql += `, received_at=now()`;
  }
  sql += ` WHERE id=$2 AND status <> 'cancelled' RETURNING id`;

  const { rows } = await run(sql, params);
  if (!rows.length) return res.status(409).json({ error: 'Order could not be updated' });
  res.json({ ok: true });
});
 
// Staff marks an order shipped – sends email and packing‑slip
orders.post('/api/orders/:id/ship', async (req, res) => {
  const id = intId(req.params.id);
  const claim = id && (await run(
    "UPDATE orders SET status='shipped', shipped_at=now() WHERE id=$1 AND status='ordered' RETURNING *",
    [id]
  ));
  if (!claim?.rows.length) {
    return res.status(409).json({ error: 'Order not found or not in "ordered" status' });
  }
  const o = claim.rows[0];
  const fac = await one('SELECT * FROM facilitators WHERE id=$1', [o.facilitator_id]);
  const prog = o.program_id ? await one('SELECT * FROM programs WHERE id=$1', [o.program_id]) : null;
  // Email facilitator about shipment
  await sendMail(fac.email, 'Your Baby Connections kits have shipped',
    `Hi ${fac.name || 'there'},\n\nYour order is on its way to ${o.shipping_address}.\n\nWhen the kits arrive, please open this link and press the button to confirm:\n${BASE_URL}/received/${o.token}\n\nBaby Connections team`);
  // Packing‑slip email to staff
  const lines = (await itemsFor(o.id)).map((l) => `  [ ] ${l.item}: ${l.qty}`).join('\n');
  await sendMail(STAFF_EMAIL, `Packing slip: order #${o.id}${prog ? ` (${prog.name})` : ''}`,
    `PACKING SLIP, order #${o.id}\n\nFacilitator: ${fac.name || ''} <${fac.email}>\n${prog ? `Program: ${prog.name}${prog.location ? ` (${prog.location})` : ''}\n` : ''}Ship to:\n${o.shipping_address}\n\nItems:\n${lines}\n\n${o.requested_date ? `Requested by: ${o.requested_date}\n` : ''}${o.shipping_cost != null ? `Shipping cost: $${Number(o.shipping_cost).toFixed(2)}\n` : ''}${o.notes ? `Notes: ${o.notes}\n` : ''}${prog ? `\nProgram QR sheet to include: ${BASE_URL}/sheet/${prog.token}\n` : ''}`);
  res.json({ ok: true });
});
// ---------- reminders ----------
async function remind(token, facilitatorId, n) {
  const fac = await one('SELECT * FROM facilitators WHERE id=$1', [facilitatorId]);
  await sendMail(fac.email, 'Did your Baby Connections kits arrive?',
    `Hi ${fac.name || 'there'},\n\nOur records show your kits shipped ${n} days ago, but we haven't heard that they arrived. When they do, please open this link and press the button to confirm:\n${BASE_URL}/received/${token}\n\nIf something is wrong, just reply to this email.\n\nBaby Connections team`);
}

/** Emails facilitators whose order shipped more than `days` days ago and is still unconfirmed (once per order). */
export async function sendOverdueReminders(days = 7) {
  const n = Math.min(Math.max(Number(days) || 7, 0), 365);
  const due = await query(`SELECT o.id FROM orders o WHERE o.status='shipped' AND o.reminder_sent_at IS NULL
    AND o.shipped_at < now() - ($1::float8 * interval '1 day') ORDER BY o.id`, [n]);
  let sent = 0;
  for (const { id } of due) {
    const { rows } = await run("UPDATE orders SET reminder_sent_at=now() WHERE id=$1 AND status='shipped' AND reminder_sent_at IS NULL RETURNING token, facilitator_id", [id]);
    if (!rows.length) continue; // someone else got it first
    await remind(rows[0].token, rows[0].facilitator_id, `over ${n}`);
    sent++;
  }
  return sent;
}

// Body: { days } for every overdue order, or { order_id } to remind one shipped order now (staff asked for it).
orders.post('/api/orders/send-reminders', async (req, res) => {
  if (req.body?.order_id != null) {
    const id = intId(req.body.order_id);
    if (!id) return res.status(400).json({ error: 'order_id must be an order number' });
    const { rows } = await run(`UPDATE orders SET reminder_sent_at=now() WHERE id=$1 AND status='shipped'
      RETURNING token, facilitator_id, GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - shipped_at)) / 86400))::int AS days`, [id]);
    if (rows.length) await remind(rows[0].token, rows[0].facilitator_id, rows[0].days);
    return res.json({ ok: true, sent: rows.length });
  }
  const raw = req.body?.days ?? req.query.days;
  const days = raw == null || raw === '' ? 7 : Number(raw);
  if (!Number.isFinite(days) || days < 0 || days > 365) return res.status(400).json({ error: 'days must be between 0 and 365' });
  res.json({ ok: true, sent: await sendOverdueReminders(days) });
});

if (process.env.ENABLE_JOBS === '1') {
  setInterval(() => sendOverdueReminders().catch((e) => console.error('[jobs] reminders failed:', e.message)), 60 * 60 * 1000).unref();
}

// Facilitator clicks the link in the shipped email. GET only shows a confirm button: email scanners
// follow links, so the state change happens on POST.
const thanks = (res) => res.send(page('Thank you!', 'Your kit delivery is confirmed. We just emailed you the parent feedback links for your program.'));
const notShipped = (res) => res.status(404).send(page('Not found', 'We could not find a shipped order for this link.'));

orders.get('/received/:token', async (req, res) => {
  const o = await one('SELECT o.*, p.name AS program FROM orders o LEFT JOIN programs p ON p.id=o.program_id WHERE o.token=$1', [req.params.token]);
  if (!o || !['shipped', 'received'].includes(o.status)) return notShipped(res);
  if (o.status === 'received') return thanks(res);
  const items = (await itemsFor(o.id)).map((l) => `<li>${esc(l.item)}: ${esc(l.qty)}</li>`).join('');
  res.send(page('Did your kits arrive?', `Please confirm that your Baby Connections kits${o.program ? ` for "${o.program}"` : ''} have arrived.`,
    `${items ? `<ul>${items}</ul>` : ''}${o.shipping_address ? `<p class=muted>Shipped to: ${esc(o.shipping_address)}</p>` : ''}` +
    `<form method=post action="/received/${encodeURIComponent(o.token)}"><button type=submit>Yes, the kits arrived</button></form>`));
});

orders.post('/received/:token', async (req, res) => {
  const o = await one('SELECT * FROM orders WHERE token=$1', [req.params.token]);
  if (!o || !['shipped', 'received'].includes(o.status)) return notShipped(res);
  if (o.status === 'shipped') {
    const claim = await run("UPDATE orders SET status='received', received_at=now() WHERE id=$1 AND status='shipped' RETURNING id", [o.id]);
    if (claim.rows.length) {
      const fac = await one('SELECT * FROM facilitators WHERE id=$1', [o.facilitator_id]);
      const prog = o.program_id ? await one('SELECT * FROM programs WHERE id=$1', [o.program_id]) : null;
      await sendMail(fac.email, 'Thanks, kits received',
        `Hi ${fac.name || 'there'},\n\nThanks for confirming your kits arrived.${prog ? `\n\nFor parent feedback, share this QR/link at the end of your program:\n${BASE_URL}/feedback/${prog.token}\nPrint a QR sheet to hand out:\n${BASE_URL}/sheet/${prog.token}\nPrinted paper forms? Photograph and upload them here:\n${BASE_URL}/upload/${prog.token}\n\nWhen your program concludes, submit your completion report here:\n${BASE_URL}/complete/${prog.token}` : ''}\n\nBaby Connections team`);
      await sendMail(STAFF_EMAIL, `Order #${o.id} received by facilitator`, `${fac.name || fac.email} confirmed receipt of order #${o.id}.`);
    }
  }
  thanks(res);
});
