## Module 6: The database and insights — PGlite on your laptop, Tiger Data in the cloud

File to write: `docs/course/modules/06-database-insights.html` — `<section class="module" id="module-6" style="background: var(--color-bg)">`. Module number "06".

### Teaching arc
- **Metaphor:** **seedlings in a windowsill pot versus the same seeds in a field**. The SQL is the seed; PGlite is a pot on the windowsill (grows instantly, in memory, resets when you restart unless you set `PGLITE_DIR`); Tiger Data is the field (hosted Postgres with TimescaleDB, where the same seeds also grow faster trend charts). Same seeds, same SQL, two soils. Do not reuse earlier metaphors.
- **Opening hook:** "`npm install && npm run dev` and the app is running with a real Postgres inside the Node process, no Docker, no account. Set one environment variable and the identical code runs on Tiger Data."
- **Key insight:** (1) `src/db.js` picks a backend by one variable and wraps both so every route uses the same three functions: `query`, `one`, `run` (plus `tx` for transactions). (2) The **schema is idempotent**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, backfills, so starting the app upgrades an old database in place. There are no migration files. (3) On Timescale, `feedback` becomes a **hypertable** and a **continuous aggregate** (`feedback_daily`) pre-computes responses and average rating per day; the Trends endpoint tries that first and falls back to plain SQL. (4) Reports: `programReport` computes rating distribution, recommend percentage, response rate and asks Gemini for a 3–4 sentence summary; CSV export neutralises spreadsheet formulas. (5) Tests boot the real app on in-memory PGlite with every key removed, so `npm test` covers the whole order → feedback → report loop in seconds.
- **"Why should I care?":** judges ask "why Tiger Data?" and "how do you test?"; engineers ask "how do you migrate?". Three crisp answers. Also the learner should be able to say what is *not yet proven*: the hypertable and aggregate paths have not run against a live Timescale server yet (WORKLOAD.md says so).

### Screens (suggested, 6)
1. **Two soils, one seed** — two-column pattern cards: PGlite (in-process, in-memory by default, `PGLITE_DIR` to keep it, used by every test) vs Tiger Data (hosted Postgres, SSL, TimescaleDB extension when available). Then code↔English for snippet A (the switch).
2. **One interface for both** — short `icon-rows` for `query` (many rows), `one` (first row), `run` (rows + rowCount), `tx` (all-or-nothing). One line each.
3. **A schema that upgrades itself** — code↔English for snippet B (ADD COLUMN IF NOT EXISTS + token backfill). Callout (accent): "Idempotent means: running it twice is the same as running it once. That is what lets the app create or upgrade the database on every start with no migration tool."
4. **Time-series when you have it, plain SQL when you do not** — code↔English for snippet C (feedback primary key depends on Timescale) and snippet D (trends endpoint with fallback). **Layer toggle demo** (see below) showing the same chart question answered three ways.
5. **Reports that are safe to open in Excel** — code↔English for snippet E (`csvCell`). Callout (warning): "CSV injection: a cell starting with = or + runs as a formula when opened in a spreadsheet. Prefixing a quote neutralises it."
6. **Tests that boot the real thing** — code↔English for snippet F (`test/smoke.js` header) plus a step-cards list of what the smoke test walks through (inbound email → order form → ship → received → QR feedback → photo flagged for review → report). Then the **quiz**.

### Code snippets (copy EXACTLY)

Snippet A — File: `src/db.js` (lines 9–10, 17–18 and 45–48)
```
const url = process.env.TIGER_DATABASE_URL;
export const dbBackend = url ? 'tiger' : 'pglite';
```
```
if (url) {
  const pg = (await import('pg')).default;
```
```
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const pgl = new PGlite(process.env.PGLITE_DIR || undefined);
  await pgl.waitReady;
```

Snippet B — File: `src/db.js` (lines 223–229)
```
-- New columns (also applied to databases created before this version)
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS token TEXT;
UPDATE programs SET token = replace(gen_random_uuid()::text,'-','') WHERE token IS NULL;
ALTER TABLE programs ALTER COLUMN token SET DEFAULT replace(gen_random_uuid()::text,'-','');
ALTER TABLE programs ALTER COLUMN token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS programs_token_key ON programs(token);
```

Snippet C — File: `src/db.js` (lines 271–280)
```
// feedback: a TimescaleDB hypertable needs the time column in every unique index, so on Timescale the
// primary key is (id, created_at). `id` is still generated and unique in practice, so lookups by id work.
await exec(`
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL, program_id INTEGER REFERENCES programs(id), source TEXT,
  rating INTEGER, would_recommend BOOLEAN, most_valued TEXT, suggestions TEXT,
  raw_text TEXT, image_path TEXT, needs_review BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (${timescaleAvailable ? 'id, created_at' : 'id'})
);
```

Snippet D — File: `src/routes/dashboard.js` (lines 109–121, inside GET /api/trends)
```
  let perDay;
  let source = 'sql';
  if (isTimescale && hasDailyAggregate) {
    try {
      perDay = await query(`SELECT (day AT TIME ZONE 'UTC')::date::text AS day, SUM(responses)::int AS responses,
          (SUM(avg_rating*rated)/NULLIF(SUM(rated),0))::float8 AS avg_rating
        FROM feedback_daily WHERE day >= now() - make_interval(days => $1) GROUP BY 1 ORDER BY 1`, [days]);
      source = 'continuous_aggregate';
    } catch (e) { console.warn('[trends] aggregate query failed, using plain SQL:', e.message); }
  }
  perDay ??= await query(`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, COUNT(*)::int AS responses,
      AVG(rating)::float8 AS avg_rating
    FROM feedback WHERE created_at >= now() - make_interval(days => $1) GROUP BY 1 ORDER BY 1`, [days]);
```

Snippet E — File: `src/report.js` (lines 41–47)
```
/** One CSV cell: neutralises spreadsheet formulas (=, +, -, @, tab, CR prefixes) and quotes safely. */
export function csvCell(v) {
  if (v == null) return '';
  if (v instanceof Date) v = v.toISOString();
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
```

Snippet F — File: `test/smoke.js` (lines 4–11)
```
delete process.env.TIGER_DATABASE_URL; // in-memory PGlite
delete process.env.PGLITE_DIR;
delete process.env.GEMINI_API_KEY; // exercise the no-AI path
delete process.env.CLOUDINARY_URL;
delete process.env.SMTP_HOST;
process.env.REQUIRE_AUTH = '1'; // these tests exercise the login-protected mode
process.env.AUTH_DEV_LOGIN = '1';
process.env.STAFF_ADMIN_EMAILS = 'staff@example.org';
```

### Interactive elements
- [x] **Layer toggle demo** (`.layer-demo`, tabs call `showLayer('layer-m6-a', this)` etc.; layer ids `layer-m6-a`, `layer-m6-b`, `layer-m6-c`). Title: "Responses per day, three ways". Tab 1 "PGlite (laptop)": plain SQL GROUP BY over `feedback`, `source: "sql"`. Tab 2 "Tiger Data, plain Postgres": the identical SQL, same answer, over the network. Tab 3 "Tiger Data + TimescaleDB": reads `feedback_daily`, a view refreshed hourly by a policy, `source: "continuous_aggregate"`. Each layer: a small badge list or 2–3 lines, not a paragraph. Use a `<p class="layer-description">` with one sentence.
- [x] **Code↔English** ×6 (A–F).
- [x] **Pattern cards** (two soils), **icon rows** (four db functions), **step cards** (smoke test walk).
- [x] **Quiz** `id="quiz-module6"`, 4 questions, decision/debugging style:
  1. "You add a `phone` column to `partners`. What do you write and where?" Correct: **one `ALTER TABLE partners ADD COLUMN IF NOT EXISTS phone TEXT;` line inside the schema block in db.js; it runs safely on every start.** Distractors: a numbered migration file; edit the CREATE TABLE only (old databases would miss it).
  2. "The Insights tab shows the same numbers on Tiger Data as on your laptop, but the response says `source: "sql"`. Is something wrong?" Correct: **not necessarily: the aggregate is only used when the TimescaleDB extension is available and the view was created; otherwise the identical plain SQL answers.**
  3. "A funder opens feedback.csv in Excel and a comment that began with =HYPERLINK(...) shows as text, not a link. Why?" Correct: **csvCell prefixes a quote to cells starting with =, +, -, @, so spreadsheets do not run them as formulas.**
  4. "A judge asks how you tested the handwriting pipeline without spending on Gemini. Answer?" Correct: **tests delete every key and assert the no-AI path: the photo row is saved and flagged needs_review, then a staff PATCH fixes it; Gemini itself is injected as a fake in other tests.**
- [x] **Callouts:** accent (idempotent), warning (CSV injection). Optional info callout: honesty note that the hypertable and continuous-aggregate code paths have not yet run against a live Timescale server.

### Reference files to read
- `docs/course/briefs/00-course-wide.md`, `content-philosophy.md`, `gotchas.md`
- `interactive-elements.md` → Code ↔ English, Layer Toggle Demo, Multiple-Choice Quizzes, Pattern/Feature Cards, Icon-Label Rows, Numbered Step Cards, Callout Boxes, Glossary Tooltips
- `design-system.md` → Module Structure

### Connections
- **Previous:** Module 5 ended with "every source becomes the same feedback row". Open by showing where that row actually lives.
- **Next:** Module 7 "Talking about it" is the wrap-up: the full architecture on one diagram, the trade-offs, the known gaps, and a judge-question drill. Hand off in one line.
