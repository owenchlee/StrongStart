// Staff login: "Sign in with Google" (OAuth 2.0 / OpenID Connect, authorization-code + PKCE).
// Being able to sign in with Google is not enough: the verified email must be an active row in the
// `staff` table. Parents and facilitators never log in; they use tokenized links.
import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { one, run } from './db.js';

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

// Staff login is OFF unless REQUIRE_AUTH=1 (temporary: the dashboard is open to anyone who can reach the server).
// Turn it back on before deploying anywhere public. The login code below is unchanged and still tested.
export const authRequired = process.env.REQUIRE_AUTH === '1';
const LOCAL_STAFF = { id: 0, email: 'staff@local', name: 'Staff (login off)', role: 'admin', partner_id: null };
if (!authRequired) console.warn('[auth] WARNING: staff login is OFF (set REQUIRE_AUTH=1 to enable). Do not expose this server publicly.');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const rand = () => randomBytes(32).toString('base64url');
const normEmail = (e) => String(e || '').trim().toLowerCase();

// ---- staff table helpers --------------------------------------------------------------------
export async function addStaff(email, name = null, role = 'staff') {
  await run(`INSERT INTO staff (email, name, role) VALUES ($1,$2,$3)
             ON CONFLICT (lower(email)) DO UPDATE SET active=true, role=excluded.role, name=COALESCE(excluded.name, staff.name)`,
    [normEmail(email), name, role]);
}
// Bootstrap the first admin(s) without touching SQL: STAFF_ADMIN_EMAILS=a@x.org,b@x.org
for (const e of (process.env.STAFF_ADMIN_EMAILS || '').split(',').map(normEmail).filter(Boolean)) await addStaff(e, null, 'admin');

const findStaff = (email) => one('SELECT * FROM staff WHERE lower(email)=$1 AND active=true', [normEmail(email)]);

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

async function startSession(res, staff) {
  const token = rand();
  await run('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]);
  await run('INSERT INTO sessions (id, staff_id, expires_at) VALUES ($1,$2,$3)', [sha(token), staff.id, Date.now() + SESSION_MS]);
  await run('UPDATE staff SET last_login_at=now() WHERE id=$1', [staff.id]);
  setCookie(res, token, SESSION_MS);
}

/** Returns the signed-in staff row (active only) or undefined. Deactivating staff kills their sessions. */
export async function currentStaff(req) {
  const t = cookies(req)[COOKIE];
  if (!t) return undefined;
  return one(`SELECT st.id, st.email, st.name, st.role, st.partner_id, p.name AS partner_name
              FROM sessions s
              JOIN staff st ON st.id=s.staff_id
              LEFT JOIN partners p ON p.id=st.partner_id
              WHERE s.id=$1 AND s.expires_at > $2 AND st.active=true`, [sha(t), Date.now()]);
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
  ['POST', /^\/api\/feedback\/[^/]+\/voice\/?$/],   // parent voice answer (rate limited by its route)
  ['GET', /^\/api\/tts\/?$/],                         // read-aloud audio for the public feedback form
  ['POST', /^\/api\/partners\/interest\/?$/],         // prospective partner expression of interest
  ['GET', /^\/api\/programs\/[^/]+\/completion-form\/?$/], // facilitator completion form details
  ['POST', /^\/api\/programs\/[^/]+\/completion\/?$/],     // facilitator completion report submission
  ['GET', /^\/api\/training\/sessions\/?$/],               // public list of available training sessions
  ['POST', /^\/api\/training\/register\/?$/],              // self-service facilitator training registration
  ['GET', /^\/api\/certificates\/[^/]+\/?$/],              // digital certificate verification
  ['GET', /^\/api\/resources\/?$/],                        // resources hub data
  ['GET', /^\/api\/partners\/\d+\/documents\/\d+\/download\/?$/], // document download for partners/facilitators
];
const isDashboardPage = (p) => /^\/(index\.html|compose\.html)?$/i.test(p);
const isApi = (p) => /^\/api(\/|$)/i.test(p);

export async function requireStaff(req, res, next) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (!authRequired) { req.staff = LOCAL_STAFF; return next(); }
  if (!isDashboardPage(req.path) && !isApi(req.path)) return next();
  if (isApi(req.path) && PUBLIC_API.some(([m, re]) => m === method && re.test(req.path))) return next();
  const staff = await currentStaff(req);
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
    const staff = await findStaff(claims.email);
    if (!staff) return fail(res, 'not_staff');
    if (!staff.name && claims.name) await run('UPDATE staff SET name=$1 WHERE id=$2', [claims.name, staff.id]);
    await startSession(res, staff);
    res.redirect('/');
  } catch (e) {
    console.error('[auth] google callback failed:', e.message);
    fail(res, 'oauth_failed');
  }
});

// ---- dev login (AUTH_DEV_LOGIN=1 only) ------------------------------------------------------
auth.post('/auth/dev-login', async (req, res) => {
  if (!devLogin) return res.sendStatus(404);
  const staff = await findStaff(req.body?.email);
  if (!staff) return res.status(403).json({ error: 'That email is not on the staff list' });
  await startSession(res, staff);
  res.json({ ok: true });
});

// ---- session endpoints ----------------------------------------------------------------------
auth.post('/auth/logout', async (req, res) => {
  const t = cookies(req)[COOKIE];
  if (t) await run('DELETE FROM sessions WHERE id=$1', [sha(t)]);
  setCookie(res, '', 0);
  res.json({ ok: true });
});

// Public so the login page can learn which methods exist; returns the user when signed in.
auth.get('/api/me', async (req, res) => {
  if (!authRequired) return res.json({ staff: LOCAL_STAFF, google: false, devLogin: false, authDisabled: true });
  const s = await currentStaff(req);
  res.json({ staff: s || null, google: googleEnabled, devLogin });
});
