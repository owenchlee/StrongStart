// Small shared helpers for input cleaning, HTML escaping and rate limiting. No imports, no side effects
// beyond one unref'd sweep timer.

export const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export const str = (v, max = 5000) => (v == null ? '' : String(v)).replace(/\u0000/g, '').trim().slice(0, max);
export const oneLine = (v, max = 200) => str(v, max).replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ');
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const dateOrNull = (v) => { const s = str(v, 10); return isDate(s) ? s : null; };
export const intId = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);
export const validEmail = (e) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(e || '').trim());
export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---- tiny in-memory fixed-window rate limiter, keyed by name + IP + :token (when the route has one) ----
// Call as rateLimit({ name, max, windowMs }) or rateLimit(name, max, windowMs = 60s).
const hits = new Map(); // key -> { n, reset }
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60_000).unref();

export function rateLimit(a, b, c) {
  const { name = 'rl', max = 30, windowMs = 10 * 60 * 1000 } =
    a && typeof a === 'object' ? a : { name: a, max: b, windowMs: c ?? 60_000 };
  return (req, res, next) => {
    const key = `${name}|${req.ip}|${req.params?.token || ''}`;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    }
    next();
  };
}
