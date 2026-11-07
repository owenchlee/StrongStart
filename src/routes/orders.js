// Steps 1-3: inbound facilitator email -> order form -> confirmation + kits-received emails.
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db, KIT_ITEMS } from '../db.js';
import { sendMail, BASE_URL, STAFF_EMAIL } from '../mailer.js';

export const orders = Router();

const token = () => randomBytes(16).toString('hex');
const page = (title, msg) =>
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/style.css><title>${title}</title><main class=card><h1>${title}</h1><p>${msg}</p></main>`;

/** Accepts our own JSON ({from,subject,body,name}) or Postmark/SendGrid-style fields. */
function normalizeInbound(b) {
  const raw = b.from || b.From || b.FromFull?.Email || '';
  const email = (raw.match(/<([^>]+)>/)?.[1] || raw).trim().toLowerCase();
  const name = b.name || b.FromName || raw.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || null;
  return { email, name: name === email ? null : name, subject: b.subject || b.Subject || '', body: b.body || b.TextBody || b.text || '' };
}

// Step 1: an email from a facilitator arrives (point your email provider's inbound webhook here).
orders.post('/api/inbound-email', async (req, res) => {
  const m = normalizeInbound(req.body);
  if (!/^\S+@\S+\.\S+$/.test(m.email)) return res.status(400).json({ error: 'Valid sender email required' });

  db.prepare('INSERT INTO facilitators (email, name) VALUES (?,?) ON CONFLICT(email) DO UPDATE SET name=COALESCE(facilitators.name, excluded.name)').run(m.email, m.name);
  const fac = db.prepare('SELECT * FROM facilitators WHERE email=?').get(m.email);

  // Step 2: create an order and reply with its personal order-form link.
  const t = token();
  const { lastInsertRowid: orderId } = db.prepare('INSERT INTO orders (token, facilitator_id) VALUES (?,?)').run(t, fac.id);
  db.prepare('INSERT INTO inbound_emails (facilitator_id, from_email, subject, body, order_id) VALUES (?,?,?,?,?)')
    .run(fac.id, m.email, m.subject, m.body, orderId);

  await sendMail(m.email, 'Your Baby Connections kit order form',
    `Hi ${fac.name || 'there'},\n\nThanks for getting in touch. Please fill out your kit order form here:\n${BASE_URL}/order/${t}\n\nIt takes a couple of minutes: tell us about your program and which kits you need.\n\nBaby Connections team`);
  res.json({ ok: true, orderId, orderLink: `${BASE_URL}/order/${t}` });
});

orders.get('/order/:token', (_req, res) => res.sendFile('order.html', { root: 'public' }));

orders.get('/api/order-form/:token', (req, res) => {
  const o = db.prepare('SELECT o.status, f.name, f.email FROM orders o JOIN facilitators f ON f.id=o.facilitator_id WHERE o.token=?').get(req.params.token);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  res.json({ ...o, kitItems: KIT_ITEMS });
});

// Facilitator submits the order form -> program + items created, confirmation emailed.
orders.post('/api/order-form/:token', async (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE token=?').get(req.params.token);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (o.status !== 'form_sent') return res.status(409).json({ error: 'This order was already submitted' });

  const { program = {}, items = [], shipping_address, requested_date, notes, facilitator_name } = req.body;
  const lines = items.filter((i) => KIT_ITEMS.includes(i.item) && Number(i.qty) > 0);
  if (!program.name || !shipping_address || !lines.length)
    return res.status(400).json({ error: 'Program name, shipping address and at least one kit are required' });

  if (facilitator_name) db.prepare('UPDATE facilitators SET name=? WHERE id=?').run(facilitator_name, o.facilitator_id);
  const { lastInsertRowid: programId } = db.prepare(
    'INSERT INTO programs (facilitator_id,name,location,start_date,end_date,projected_participants) VALUES (?,?,?,?,?,?)'
  ).run(o.facilitator_id, program.name, program.location || null, program.start_date || null, program.end_date || null, Number(program.projected_participants) || null);

  db.prepare("UPDATE orders SET program_id=?, status='ordered', shipping_address=?, requested_date=?, notes=?, ordered_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(programId, shipping_address, requested_date || null, notes || null, o.id);
  const ins = db.prepare('INSERT INTO order_items (order_id,item,qty) VALUES (?,?,?)');
  lines.forEach((l) => ins.run(o.id, l.item, Math.floor(Number(l.qty))));

  const fac = db.prepare('SELECT * FROM facilitators WHERE id=?').get(o.facilitator_id);
  const summary = lines.map((l) => `  - ${l.item}: ${l.qty}`).join('\n');
  await sendMail(fac.email, `Order confirmation: ${program.name}`,
    `Hi ${fac.name || 'there'},\n\nWe've received your order for "${program.name}":\n${summary}\n\nShip to: ${shipping_address}\n${requested_date ? `Requested by: ${requested_date}\n` : ''}\nWe'll email you when it ships.\n\nBaby Connections team`);
  await sendMail(STAFF_EMAIL, `New kit order #${o.id}: ${program.name}`,
    `${fac.name || fac.email} ordered:\n${summary}\n\nShip to: ${shipping_address}\nOpen the dashboard: ${BASE_URL}/`);
  res.json({ ok: true, orderId: o.id, programId });
});

orders.get('/api/orders', (_req, res) => {
  const rows = db.prepare(`SELECT o.id, o.status, o.token, o.created_at, o.ordered_at, o.shipped_at, o.received_at, o.shipping_address,
      f.name AS facilitator, f.email, p.name AS program, p.id AS program_id
    FROM orders o JOIN facilitators f ON f.id=o.facilitator_id LEFT JOIN programs p ON p.id=o.program_id ORDER BY o.id DESC`).all();
  const items = db.prepare('SELECT item, qty FROM order_items WHERE order_id=?');
  res.json(rows.map((r) => ({ ...r, items: items.all(r.id) })));
});

// Staff marks an order shipped -> facilitator gets a "confirm you received it" link.
orders.post('/api/orders/:id/ship', async (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE id=? AND status='ordered'").get(req.params.id);
  if (!o) return res.status(409).json({ error: 'Order not found or not in "ordered" status' });
  db.prepare("UPDATE orders SET status='shipped', shipped_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id);
  const fac = db.prepare('SELECT * FROM facilitators WHERE id=?').get(o.facilitator_id);
  await sendMail(fac.email, 'Your Baby Connections kits have shipped',
    `Hi ${fac.name || 'there'},\n\nYour order is on its way to ${o.shipping_address}.\n\nWhen the kits arrive, please confirm with one click:\n${BASE_URL}/received/${o.token}\n\nBaby Connections team`);
  res.json({ ok: true });
});

// Facilitator clicks the link in the shipped email.
orders.get('/received/:token', async (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE token=?').get(req.params.token);
  if (!o || !['shipped', 'received'].includes(o.status)) return res.status(404).send(page('Not found', 'We could not find a shipped order for this link.'));
  if (o.status === 'shipped') {
    db.prepare("UPDATE orders SET status='received', received_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id);
    const fac = db.prepare('SELECT * FROM facilitators WHERE id=?').get(o.facilitator_id);
    const prog = db.prepare('SELECT * FROM programs WHERE id=?').get(o.program_id);
    await sendMail(fac.email, 'Thanks, kits received',
      `Hi ${fac.name || 'there'},\n\nThanks for confirming your kits arrived.${prog ? `\n\nFor parent feedback, share this QR/link at the end of your program:\n${BASE_URL}/feedback/${prog.id}\nPrinted paper forms? Photograph and upload them here:\n${BASE_URL}/upload/${prog.id}` : ''}\n\nBaby Connections team`);
    await sendMail(STAFF_EMAIL, `Order #${o.id} received by facilitator`, `${fac.name || fac.email} confirmed receipt of order #${o.id}.`);
  }
  res.send(page('Thank you!', 'Your kit delivery is confirmed. We just emailed you the parent feedback links for your program.'));
});
