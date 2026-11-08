## Module 2: Meet the cast — one server, ten routers, one database

File to write: `docs/course/modules/02-meet-the-cast.html` — `<section class="module" id="module-2" style="background: var(--color-bg)">`. Module number "02".

### Teaching arc
- **Metaphor:** a **telephone switchboard**. One operator (`src/server.js`) receives every call (HTTP request) and patches it through to the right department (a router file in `src/routes/`). Departments share one filing room (`src/db.js`) and one drawer of common tools (`src/util.js`). Do not reuse the parcel metaphor from Module 1.
- **Opening hook:** "Module 1 followed one order through the system. Every one of those steps was handled by a different file. There are only about 8,000 lines of code in this project and no build step: what you see in the folder is exactly what runs."
- **Key insight:** the architecture is deliberately plain: **Express routers, one per business area**, mounted in one line; **static HTML pages** that call the API with `fetch`; **one database module** that both backends (PGlite, Tiger Data) hide behind; **one helpers file**. Knowing the folder lets the learner tell an AI tool exactly where a change belongs.
- **"Why should I care?":** "put the new endpoint in `src/routes/training.js`, reuse `intId` from `src/util.js`, and add the table to `src/db.js`" is a far better instruction than "add a training feature".

### Screens (suggested, 5)
1. **The whole cast on one card** — `icon-rows` for the five actors with their colours (Facilitator/Parent pages, Server, Database, Outside services, Staff dashboard). Note how small the project is: show a tiny table or badge list of line counts (orders.js 358, partners.js 383, db.js 334, index.html 876, total ≈ 7,900).
2. **The switchboard** — code↔English for snippet A (`server.js` 16–25). Emphasise the order: JSON body parsing → auth router → `requireStaff` gate → static files → ten routers. Callout (accent): "Order matters in Express. Each `app.use` is a checkpoint the request passes in sequence. Engineers call these middleware."
3. **The folder, annotated** — visual **file tree** (see below).
4. **How a page talks to the server** — code↔English for snippet B (the `j` helper from `public/index.html`). Note: no framework; every dashboard tab is an `async function` that calls `j('/api/...')` and writes HTML into a `<section>`. Then snippet C (`util.js` helpers) as a second translation block: these tiny functions clean every input before it touches the database.
5. **Drag-and-drop: which department takes the call?** then **quiz**.

### Visual file tree (write with `.file-tree` markup)
- `src/server.js` — the switchboard: wires everything together (42 lines)
- `src/routes/` — one file per business area
  - `orders.js` — inbound email → order form → ship → received
  - `feedback.js` — QR form, photo upload, QR sheet, review fixes
  - `voice.js` — read-aloud and spoken answers (ElevenLabs)
  - `compose.js` — staff email composer with dictation and AI tidy-up
  - `partners.js` — partner organisations: expression of interest → active
  - `programs.js` — completion reports from facilitators
  - `training.js` — training sessions, registration, certificates
  - `meet.js` — "let us meet" scheduling with Google Meet
  - `dashboard.js` — overview, Today list, trends, rollups, CSV, staff admin
  - `resources.js` — knowledge centre
- `src/db.js` — schema and the PGlite / Tiger Data switch
- `src/auth.js` — Google sign-in, sessions, the public allow-list
- `src/ai.js` — every Gemini call
- `src/elevenlabs.js`, `src/cloudinary.js`, `src/gcal.js` — one file per outside service
- `src/mailer.js` — sends email and logs every message to the outbox table
- `src/util.js` — input cleaning, HTML escaping, rate limiting
- `public/` — plain HTML pages: `index.html` (staff dashboard), `feedback.html`, `order.html`, `upload.html`, `meet.html`, `training-register.html`, `certificate.html`, `completion.html`, `compose.html`, `profile.html`, `login.html`, `dictate.js`
- `test/` — 11 scripts that boot the real app on an in-memory database

### Code snippets (copy EXACTLY)

Snippet A — File: `src/server.js` (lines 16–25)
```
export const app = express();
// Behind a reverse proxy (Caddy, etc.) the client IP comes from X-Forwarded-For; needed for per-IP rate limits.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
else if ((process.env.BASE_URL || '').startsWith('https:')) app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false })); // inbound-email webhooks often post form data
app.use(auth);        // /auth/*, /api/me: must come before the gate
app.use(requireStaff); // default-deny for the dashboard page and /api (before static serves index.html)
app.use(express.static('public'));
app.use(orders, feedback, dashboard, voice, compose, partners, programsRouter, trainingRouter, resourcesRouter, meetRouter);
```

Snippet B — File: `public/index.html` (lines 25–31)
```
const j = (u, o) => fetch(u, o).then(async (r) => {
  if (r.status === 401) { location.href = '/login.html'; throw new Error('signed out'); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok && !body.error) body.error = 'Request failed (' + r.status + ')';
  return body;
});
const jsonPost = (u, b, method = 'POST') => j(u, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
```

Snippet C — File: `src/util.js` (lines 4–11)
```
export const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export const str = (v, max = 5000) => (v == null ? '' : String(v)).replace(/\u0000/g, '').trim().slice(0, max);
export const oneLine = (v, max = 200) => str(v, max).replace(/\s*[\r\n  ]+\s*/g, ' ');
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const dateOrNull = (v) => { const s = str(v, 10); return isDate(s) ? s : null; };
export const intId = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);
export const validEmail = (e) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(e || '').trim());
```

### Interactive elements
- [x] **Icon-label rows** (5 actors) and **visual file tree**.
- [x] **Code↔English** ×3 (A, B, C).
- [x] **Drag-and-drop** `id="dnd-module2"`: chips = `orders.js`, `feedback.js`, `meet.js`, `dashboard.js`, `auth.js`; zones (descriptions): "A parent scans a QR code and submits the form", "Staff click Mark shipped", "A partner ticks the times they are free and a Google Meet is booked", "The Insights tab asks for responses per day", "Decides whether a request needs a staff login". Buttons call `checkDnD('dnd-module2')` / `resetDnD('dnd-module2')`.
- [x] **Quiz** `id="quiz-module2"`, 3 questions:
  1. "You ask an AI tool to add a 'resend certificate' button. It creates `src/certificates.js` with its own `express()` app and `listen(3001)`. What is wrong?" Correct: **the project has one app; new endpoints go in an existing router (training.js) which server.js already mounts; a second app on another port would skip the auth gate and the shared database.**
  2. "The dashboard shows 'Request failed (500)' on the Orders tab. Which file do you open first?" Correct: **`src/routes/orders.js`, the handler for GET /api/orders; the `j` helper only displays what the server returned.** Distractors: `public/style.css`; `src/util.js`.
  3. "A facilitator types a name with a newline inside it on the order form. Why does it not break the confirmation email?" Correct: **`oneLine` from util.js strips line breaks and caps the length before the value is saved.**
- [x] Callout (accent) on middleware order; callout (info): "No build step: `npm run dev` runs the files as they are."

### Reference files to read
- `docs/course/briefs/00-course-wide.md`, `content-philosophy.md`, `gotchas.md`
- `interactive-elements.md` → Code ↔ English, Drag-and-Drop Matching, Multiple-Choice Quizzes, Visual File Tree, Icon-Label Rows, Callout Boxes, Glossary Tooltips
- `design-system.md` → Module Structure

### Connections
- **Previous:** Module 1 traced one order through the loop (tracking-number metaphor). Refer back: "those five emails came from `orders.js`".
- **Next:** Module 3 "Two doors" explains who may call what: random tokens for parents and facilitators, Google sign-in for staff, and the default-deny gate. Set it up with one line.
