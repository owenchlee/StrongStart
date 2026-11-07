import nodemailer from 'nodemailer';
import { db } from './db.js';

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const FROM = process.env.MAIL_FROM || 'Baby Connections <babyconnections@strongstart.example>';
export const STAFF_EMAIL = process.env.STAFF_EMAIL || 'babyconnections@strongstart.example';

/** Always records the email in the outbox; sends via SMTP when configured. */
export async function sendMail(to, subject, body) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO outbox (to_email, subject, body) VALUES (?,?,?)')
    .run(to, subject, body);
  if (!transport) {
    console.log(`[mail:dev] to=${to} subject="${subject}"`);
    return;
  }
  try {
    await transport.sendMail({ from: FROM, to, subject, text: body });
    db.prepare('UPDATE outbox SET delivered=1 WHERE id=?').run(lastInsertRowid);
  } catch (e) {
    console.error('[mail] send failed:', e.message);
  }
}
