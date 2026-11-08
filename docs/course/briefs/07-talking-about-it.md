## Module 7: Talking about it — the big picture, the trade-offs, and the judge drill

File to write: `docs/course/modules/07-talking-about-it.html` — `<section class="module" id="module-7" style="background: var(--color-bg-warm)">`. Module number "07". This is the closing module: shorter text, more interactive.

### Teaching arc
- **Metaphor:** a **tour guide's answer sheet**. A good guide does not memorise the building; they know the five rooms, the three stories visitors always ask about, and the two things under repair. This module is that sheet for the learner. Do not reuse earlier metaphors.
- **Opening hook:** "You have followed an order, a photo and a voice note through the system. Now compress all of it into what you can say in a hallway."
- **Key insight:** the project can be described in three layers: **people and links** (facilitators, parents, partners never log in), **one plain Node/Express server with one database**, **four outside services with exactly one job each**. The trade-offs were deliberate: no framework and no build step (speed, readability), default-deny auth (safety), idempotent schema (zero migration tooling), graceful degradation (demo-proof). The honest gaps: staff login off unless `REQUIRE_AUTH=1`; Timescale paths untested live; inbound webhook accepts anyone until `INBOUND_EMAIL_SECRET` is set; the Knowledge Centre has placeholder content; the paper form questions are placeholders until matched to the real form.
- **"Why should I care?":** this is literally the thing the learner asked for: to talk about the codebase and answer questions.

### Screens (suggested, 5)
1. **The whole system on one diagram** — interactive **architecture diagram** (see below). Clicking a component shows one sentence.
2. **Four defensive habits you can name** — pattern cards: input cleaning + length caps (`util.js`), rate limits per IP and token (snippet A), atomic claims in SQL (`UPDATE … WHERE status='shipped' RETURNING`), HTML escaping everywhere (`escapeHtml`). Code↔English for snippet A (`rateLimit`). Then a second translation block for snippet B (`inboundAllowed` with the timing-safe compare) with one line: "a constant-time comparison so an attacker cannot measure how many characters matched".
3. **What is on and what is off** — a **badge list** of the environment variables and what turning each on does (`TIGER_DATABASE_URL`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `CLOUDINARY_URL`, `GOOGLE_CLIENT_ID/SECRET`, `REQUIRE_AUTH`, `INBOUND_EMAIL_SECRET`, `ENABLE_JOBS`, `SMTP_HOST`). Code↔English for snippet C (the startup log) so the learner knows how to read the console at demo time.
4. **Known gaps, said plainly** — `callout-warning` list of the five honest gaps above (one line each). Judges respect this.
5. **The judge drill** — a **scenario quiz** (`id="quiz-module7"`, 5 questions, see below) followed by a closing `callout-accent`: "You can now say what it does, where each thing lives, who can see what, what happens when a service is missing, and what is not finished. That is technical fluency."

### Code snippets (copy EXACTLY)

Snippet A — File: `src/util.js` (lines 20–33)
```
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
```
(Used as, `src/routes/feedback.js` lines 25–26:)
```
const limitOnline = rateLimit({ name: 'online', max: 20, windowMs: 10 * 60 * 1000 });
const limitPhotos = rateLimit({ name: 'photos', max: 60, windowMs: 10 * 60 * 1000 });
```

Snippet B — File: `src/routes/orders.js` (lines 79–87)
```
function inboundAllowed(req) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) {
    if (!warnedNoSecret) { warnedNoSecret = true; console.warn('[inbound-email] INBOUND_EMAIL_SECRET is not set: the webhook accepts anyone. Set it in production.'); }
    return true;
  }
  const given = req.get('x-inbound-secret') ?? (typeof req.query.secret === 'string' ? req.query.secret : '');
  return timingSafeEqual(sha(given), sha(secret));
}
```

Snippet C — File: `src/server.js` (lines 34–41)
```
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    const persisted = process.env.PGLITE_DIR ? ' (persisted)' : ' (in-memory, resets on restart)';
    console.log(`StrongStart running at http://localhost:${port}`);
    console.log(`  AI (Gemini): ${aiEnabled ? 'on' : 'OFF (set GEMINI_API_KEY)'}`);
    console.log(`  Database: ${dbBackend === 'tiger' ? 'Tiger Data / Postgres' : 'local PGlite' + persisted}${isTimescale ? ' + TimescaleDB' : ''}`);
  });
```

### Interactive elements
- [x] **Architecture diagram** (`.arch-diagram` with `.arch-zone`s and `.arch-component`s carrying `data-desc`; the engine wires clicks). Zones: "People, by link" (Facilitator: order form, kits-received button, photo upload, completion report; Parent: QR form, voice; Partner: expression of interest, meet link; Trainee: training registration, certificate), "The server" (Express, 10 routers, auth gate, mailer, util), "Staff, by badge" (Dashboard tabs: Partners, Orders, Programs & feedback, Insights, Emails, Staff), "Data" (PGlite or Tiger Data; outbox table logs every email), "Outside services, one job each" (Gemini: read, translate, summarise, tidy; ElevenLabs: hear and speak; Cloudinary: images and QR sheets; Google: sign-in and Calendar/Meet; Email provider: inbound webhook, SMTP out). Each `data-desc` one plain sentence. Include `<div class="arch-description">Click any box to hear its one-line job</div>`.
- [x] **Pattern cards** (four defensive habits), **badge list** (env vars), **code↔English** ×3 (A, B, C).
- [x] **Scenario quiz** `id="quiz-module7"`, 5 questions using `.scenario-block` wrappers, each the kind of thing a judge or engineer asks. Give a model spoken answer in the explanation-right text:
  1. Scenario: "A judge: 'Why would a charity use this instead of a Google Form?'" Correct: **because it closes the whole loop: the kit order, the training, the QR/voice/paper feedback with handwriting reading and translation, and the staff Today list and funder reports are one system; a form only covers one step.**
  2. "A judge: 'What happens if Gemini misreads a form?'" Correct: **low confidence, missing rating or [illegible] text sends it to the Review queue; staff see the photo next to the fields and correct it; nothing is published unreviewed.**
  3. "An engineer: 'How do you deploy a schema change?'" Correct: **add an idempotent statement to db.js; the app upgrades the database on start, on PGlite and Tiger Data alike.**
  4. "An engineer: 'Who can call POST /api/inbound-email?'" Correct: **anyone until INBOUND_EMAIL_SECRET is set; with it, the provider must send a matching x-inbound-secret header, compared in constant time.**
  5. "A judge: 'What is not finished?'" Correct: **staff login is off by default for the demo, the Timescale paths have not run on a live server, the knowledge centre and the paper-form questions are placeholders, and a real inbound email provider and SMTP are not yet connected.**
- [x] **Callouts:** warning (gaps), accent (closing).

### Reference files to read
- `docs/course/briefs/00-course-wide.md`, `content-philosophy.md`, `gotchas.md`
- `interactive-elements.md` → Interactive Architecture Diagram, Scenario Quiz, Multiple-Choice Quizzes, Pattern/Feature Cards, Permission/Config Badges, Code ↔ English, Callout Boxes, Glossary Tooltips
- `design-system.md` → Module Structure

### Connections
- **Previous:** Module 6 (database and insights). Open by zooming out from the database to the whole system.
- **Next:** none. End the course with the closing callout; no "next module" line.
