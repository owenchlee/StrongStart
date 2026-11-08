## Module 3: Two doors — links for the public, Google sign-in for staff

File to write: `docs/course/modules/03-two-doors.html` — `<section class="module" id="module-3" style="background: var(--color-bg-warm)">`. Module number "03".

### Teaching arc
- **Metaphor:** a **museum with two doors**. Visitors get a **wristband** (a random token in a link) that admits them to exactly one exhibit: *their* order form, *their* program's feedback page. Staff wear a **badge** (a session cookie earned by Google sign-in) that opens every back-office door. Nothing is open by default: a door without a wristband slot or badge reader is locked. Do not reuse earlier metaphors.
- **Opening hook:** "Parents and facilitators never create an account or remember a password. Staff never type one either. How is that safe?"
- **Key insight:** two mechanisms. (1) **Default-deny**: `requireStaff` runs on every request; anything under `/api` or the dashboard page needs a staff session unless it is on a short, explicit **allow-list** (`PUBLIC_API`). New routes are protected automatically. (2) **Capability links**: public URLs use a random token (`/feedback/8f3a…`), never the numeric id, so knowing one link tells you nothing about the others. Plus the small things that make it hold: session ids stored as a SHA-256 hash, PKCE on the Google OAuth flow, the email must be an active row in the `staff` table, deactivating staff deletes their sessions.
- **"Why should I care?":** judges ask "who can see the parents' data?". The answer is one sentence: "only signed-in staff; everything else is a random link that reaches exactly one program." Also: when adding a route, the learner must know whether to add it to the allow-list.
- **Honest caveat to include (callout-warning):** staff login is currently **OFF** unless `REQUIRE_AUTH=1` (temporary for the hackathon demo; the code path is still tested with `REQUIRE_AUTH=1` in every test). Say it plainly: "set it before any public deploy".

### Screens (suggested, 5)
1. **Two kinds of visitor** — two side-by-side cards (pattern-cards with 2 columns): Wristband (parents, facilitators, partners: `/order/:token`, `/feedback/:token`, `/upload/:token`, `/sheet/:token`, `/complete/:token`, `/meet/:token`, `/certificate/:code`, `/training/register`) vs Badge (staff: `/`, `/compose.html`, `/profile.html`, every other `/api/*`).
2. **The gate on every request** — code↔English for snippet A (`requireStaff`). Walk the four exits in order.
3. **The allow-list** — code↔English for snippet B (`PUBLIC_API` head). Callout (accent): "Default-deny with an allow-list is the safest shape for permissions: forgetting to add a route makes it *too locked*, which someone notices immediately, instead of *too open*, which nobody notices."
4. **Why a random token and not /feedback/12** — code↔English for snippet C (`programByToken`) and snippet D (sessions table comment). Explain: 16–64 characters of letters and digits; a guessable id would let anyone submit fake feedback for any program or read any order.
5. **Group chat: a staff member opens the dashboard** (see below), then the **quiz**.

### Code snippets (copy EXACTLY)

Snippet A — File: `src/auth.js` (lines 99–108)
```
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
```

Snippet B — File: `src/auth.js` (lines 74–80; the list continues to line 95 with 20 entries in total)
```
// Default-deny: everything under /api and the dashboard page requires staff, except this allow-list
// of public routes (see WORKLOAD.md "Who can access what"). New API routes are protected automatically.
const PUBLIC_API = [
  ['POST', /^\/api\/inbound-email\/?$/],              // email provider webhook (add a shared secret separately)
  ['GET', /^\/api\/order-form\/[^/]+\/?$/], ['POST', /^\/api\/order-form\/[^/]+\/?$/],
  ['POST', /^\/api\/feedback\/[^/]+\/?$/],            // parent feedback form
  ['POST', /^\/api\/feedback\/[^/]+\/photos\/?$/],    // facilitator photo upload
```

Snippet C — File: `src/routes/feedback.js` (lines 29–33)
```
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
async function programByToken(token) {
  if (!TOKEN_RE.test(token || '')) return undefined;
  return one('SELECT id, name, location, token FROM programs WHERE token=$1', [token]);
}
```

Snippet D — File: `src/db.js` (lines 115–119)
```
-- Server-side sessions; id is the SHA-256 of the cookie value, so a leaked DB can't be replayed.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
);
```

Snippet E (for the caveat callout, show as a small translation block or plain code) — File: `src/auth.js` (lines 21–23)
```
// Staff login is OFF unless REQUIRE_AUTH=1 (temporary: the dashboard is open to anyone who can reach the server).
// Turn it back on before deploying anywhere public. The login code below is unchanged and still tested.
export const authRequired = process.env.REQUIRE_AUTH === '1';
```

### Interactive elements
- [x] **Group chat animation** `id="chat-module3"`. Actors: Browser (staff member's browser, actor-5 colour, initial "B"), Gate (`requireStaff`, actor-2, "G"), Google (actor-4, "Go"), Database (actor-3, "D"). Messages in order:
  1. Browser → "GET /api/orders please. Here is my cookie: ss_session=…"
  2. Gate → "Is /api/orders on the public list? No. Let me hash that cookie and look it up."
  3. Database → "Found a session for staff #3, not expired, and the staff row is still active."
  4. Gate → "Welcome back, Jo. Passing you through to orders.js."
  5. Browser → "(Later, cookie deleted) GET /api/orders"
  6. Gate → "No session. 401: Staff login required. Redirecting to /login.html."
  7. Browser → "Sign in with Google, then."
  8. Google → "Here is a signed ID token: jo@strongstart.org, email verified."
  9. Gate → "Checked the issuer, audience, nonce and expiry. Is jo@strongstart.org an active row in the staff table?"
  10. Database → "Yes. New session created; id stored as a SHA-256 hash."
  11. Gate → "New cookie set for 7 days. In you go."
- [x] **Code↔English** ×4 (A–D) plus E in the caveat.
- [x] **Pattern cards** two-column for the two doors.
- [x] **Quiz** `id="quiz-module3"`, 4 questions:
  1. "You add `GET /api/kits/stock` for the Orders tab. Do you have to touch auth.js?" Correct: **No. Anything under /api is staff-only by default; only public routes are listed.**
  2. "You add `GET /api/programs/:token/thank-you` that the parent page calls after submitting. The page shows 'Staff login required'. Why?" Correct: **it is a new public route and must be added to PUBLIC_API with its method and a regex.**
  3. "A judge asks: if your database were leaked, could an attacker log in as staff with the stolen session rows?" Correct: **No: the table holds SHA-256 hashes of the cookie values, not the cookies, so a row cannot be replayed.**
  4. "A facilitator forwards their feedback-page link to a colleague at a different library. What can the colleague do?" Correct: **submit feedback for that one program only; the token identifies one program and grants nothing else.** Distractor: see all programs / nothing.
- [x] **Callouts:** accent (default-deny), warning (login currently OFF unless REQUIRE_AUTH=1).

### Reference files to read
- `docs/course/briefs/00-course-wide.md`, `content-philosophy.md`, `gotchas.md`
- `interactive-elements.md` → Code ↔ English, Group Chat Animation, Multiple-Choice Quizzes, Pattern/Feature Cards, Callout Boxes, Glossary Tooltips
- `design-system.md` → Module Structure

### Connections
- **Previous:** Module 2 introduced the files and the middleware order in server.js ("auth before the gate, the gate before static files"). Refer back to that line.
- **Next:** Module 4 "Reading handwriting" follows a photographed paper form through Cloudinary and Gemini into the review queue. One-line hand-off: "Now that we know who may knock, let us follow the most interesting thing that comes through the public door: a photo of a paper form."
