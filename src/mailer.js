import nodemailer from 'nodemailer';
import { run } from './db.js';

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

export const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const FROM = process.env.MAIL_FROM || 'Baby Connections <babyconnections@strongstart.example>';
export const STAFF_EMAIL = process.env.STAFF_EMAIL || 'babyconnections@strongstart.example';

const oneLine = (s) => String(s ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Escape everything first, then turn http(s) URLs into links. */
function linkify(escaped) {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (u) => {
    const m = u.match(/[.,;:!?)]+$/);
    const trail = m ? m[0] : '';
    const url = trail ? u.slice(0, -trail.length) : u;
    return `<a href="${url}" style="color:#2b6cb0">${url}</a>${trail}`;
  });
}

export function renderHtml(subject, body) {
  const paras = String(body ?? '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.5">${linkify(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a202c">
<div style="max-width:600px;margin:0 auto;padding:20px">
<div style="background:#2b6cb0;color:#fff;padding:14px 20px;border-radius:8px 8px 0 0;font-size:18px;font-weight:600">Baby Connections</div>
<div style="background:#fff;padding:22px 20px;border-radius:0 0 8px 8px">${paras}</div>
<p style="color:#718096;font-size:12px;text-align:center;margin-top:14px">Strong Start &middot; Baby Connections</p>
</div><span style="display:none">${escapeHtml(subject)}</span></body></html>`;
}

/** Always records the email in the outbox; sends via SMTP when configured. Optional 4th arg: { html }. */
export async function sendMail(to, subject, body, opts = {}) {
  to = oneLine(to);
  subject = oneLine(subject).slice(0, 300);
  body = String(body ?? '');
  const html = opts.html || renderHtml(subject, body);
  const { rows } = await run('INSERT INTO outbox (to_email, subject, body) VALUES ($1,$2,$3) RETURNING id', [to, subject, body]);
  const id = rows[0].id;
  if (!transport) {
    console.log(`[mail:dev] to=${to} subject="${subject}"`);
    return;
  }
  try {
    await transport.sendMail({ from: FROM, to, subject, text: body, html });
    try { await run('UPDATE outbox SET delivered=1 WHERE id=$1', [id]); }
    catch { await run('UPDATE outbox SET delivered=true WHERE id=$1', [id]).catch(() => {}); } // integer or boolean column
  } catch (e) {
    console.error('[mail] send failed:', e.message);
  }
}
