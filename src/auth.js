// Staff login: "Sign in with Google" (OAuth 2.0 / OpenID Connect, authorization-code + PKCE).
// Being able to sign in with Google is not enough: the verified email must be an active row in the
// `staff` table. Parents and facilitators never log in; they use tokenized links.
import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';

export const auth = Router();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = `${BASE_URL}/auth/google/callback`;
const SESSION_MS = 7 * 24 * 3600 * 1000;
const COOKIE = 'ss_session';
const secure = BASE_URL.startsWith('https:');
// Email-only login with no password. Only for local development/tests; must be opted into explicitly.
const devLogin = process.env.AUTH_DEV_LOGIN === '1';
export const googleEnabled = Boolean(CLIENT_ID && CLIENT_SECRET);

const sha = (s) => createHash('sha256').update(s).digest('hex');
const rand = () => randomBytes(32).toString('base64url');
const normEmail = (e) => String(e || '').trim().toLowerCase();

// ---- staff table helpers --------------------------------------------------------------------
export function addStaff(email, name = null, role = 'staff') {
  db.prepare(`INSERT INTO staff (email, name, role) VALUES (?,?,?)
              ON CONFLICT(email) DO UPDATE SET active=1, role=excluded.role, name=COALESCE(excluded.name, name)`)
    .run(normEmail(email), name, role);
}
// Bootstrap the first admin(s) without touching SQL: STAFF_ADMIN_EMAILS=a@x.org,b@x.org
for (const e of (process.env.STAFF_ADMIN_EMAILS || '').split(',').map(normEmail).filter(Boolean)) addStaff(e, null, 'admin');

const findStaff = (email) => db.prepare('SELECT * FROM staff WHERE email=? AND active=1').get(normEmail(email));

// ---- cookies & sessions ---------------------------------------------------------------------
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const setCookie = (res, value, maxAgeMs) =>
  res.append('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`);

function startSession(res, staff) {
  const token = rand();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (id, staff_id, expires_at) VALUES (?,?,?)').run(sha(token), staff.id, Date.now() + SESSION_MS);
  db.prepare('UPDATE staff SET last_login_at=CURRENT_TIMESTAMP WHERE id=?').run(staff.id);
  setCookie(res, token, SESSION_MS);
}

/** Returns the signed-in staff row (active only) or undefined. Deactivating staff kills their sessions. */
export function currentStaff(req) {
  const t = cookies(req)[COOKIE];
  if (!t) return undefined;
  return db.prepare(`SELECT st.id, st.email, st.name, st.role FROM sessions s JOIN staff st ON st.id=s.staff_id
                     WHERE s.id=? AND s.expires_at > ? AND st.active=1`).get(sha(t), Date.now());
}

// ---- which routes need a login --------------------------------------------------------------
// Default-deny: everything under /api and the dashboard page requires staff, except this allow-list
// of public routes (see WORKLOAD.md "Who can access what"). New API routes are protected automatically.
const PUBLIC_API = [
  ['POST', /^\/api\/inbound-email\/?$/],              // email provider webhook (add a shared secret separately)
  ['GET', /^\/api\/order-form\/[^/]+\/?$/], ['POST', /^\/api\/order-form\/[^/]+\/?$/],
  ['POST', /^\/api\/feedback\/[^/]+\/?$/],            // parent feedback form
  ['POST', /^\/api\/feedback\/[^/]+\/photos\/?$/],    // facilitator photo upload
  ['GET', /^\/api\/programs\/[^/]+\/public\/?$/],
  ['GET', /^\/api\/programs\/[^/]+\/qr\.png$/],
];
const isDashboardPage = (p) => /^\/(index\.html)?$/i.test(p);
const isApi = (p) => /^\/api(\/|$)/i.test(p);

export function requireStaff(req, res, next) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (!isDashboardPage(req.path) && !isApi(req.path)) return next();
  if (isApi(req.path) && PUBLIC_API.some(([m, re]) => m === method && re.test(req.path))) return next();
  const staff = currentStaff(req);
  if (staff) { req.staff = staff; return next(); }
  if (isApi(req.path)) return res.status(401).json({ error: 'Staff login required' });
  res.redirect('/login.html');
}

// ---- Google OAuth ---------------------------------------------------------------------------
const pending = new Map(); // state -> { verifier, nonce, exp }  (single process; fine for this app)
const sweep = () => { for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k); };
const fail = (res, code) => res.redirect(`/login.html?error=${code}`);

auth.get('/auth/google', (_req, res) => {
  if (!googleEnabled) return fail(res, 'not_configured');
  sweep();
  const state = rand(), verifier = rand(), nonce = rand();
  pending.set(state, { verifier, nonce, exp: Date.now() + 10 * 60 * 1000 });
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'openid email profile',
    state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});

auth.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const p = typeof state === 'string' ? pending.get(state) : undefined;
  if (p) pending.delete(state); // single use
  if (error || typeof code !== 'string' || !p || p.exp < Date.now()) return fail(res, 'oauth_failed');
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code', code_verifier: p.verifier,
      }),
    });
    if (!r.ok) return fail(res, 'oauth_failed');
    // The id_token came straight from Google over TLS in the code exchange, so per the OIDC spec we
    // can read its claims without checking the signature; we still validate the claims below.
    const claims = JSON.parse(Buffer.from((await r.json()).id_token.split('.')[1], 'base64url').toString());
    const okIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    if (!okIssuer || claims.aud !== CLIENT_ID || claims.nonce !== p.nonce || claims.exp * 1000 < Date.now() || claims.email_verified !== true)
      return fail(res, 'oauth_failed');
    const staff = findStaff(claims.email);
    if (!staff) return fail(res, 'not_staff');
    if (!staff.name && claims.name) db.prepare('UPDATE staff SET name=? WHERE id=?').run(claims.name, staff.id);
    startSession(res, staff);
    res.redirect('/');
  } catch (e) {
    console.error('[auth] google callback failed:', e.message);
    fail(res, 'oauth_failed');
  }
});

// ---- dev login (AUTH_DEV_LOGIN=1 only) ------------------------------------------------------
auth.post('/auth/dev-login', (req, res) => {
  if (!devLogin) return res.sendStatus(404);
  const staff = findStaff(req.body?.email);
  if (!staff) return res.status(403).json({ error: 'That email is not on the staff list' });
  startSession(res, staff);
  res.json({ ok: true });
});

// ---- session endpoints ----------------------------------------------------------------------
auth.post('/auth/logout', (req, res) => {
  const t = cookies(req)[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE id=?').run(sha(t));
  setCookie(res, '', 0);
  res.json({ ok: true });
});

// Public so the login page can learn which methods exist; returns the user when signed in.
auth.get('/api/me', (req, res) => {
  const s = currentStaff(req);
  res.json({ staff: s || null, google: googleEnabled, devLogin });
});
