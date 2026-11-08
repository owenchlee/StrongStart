# Plan: simplify the staff workflow

Companion to `staff-workflow-review.md` (numbers in brackets refer to its findings). Two phases run in order; each ends with `npm test` green and `node .claude/skills/verify-loop/scripts/verify.mjs` passing. Do not weaken `.verify/verify.json`.

Ground rules for whoever executes this:
- Keep the existing style: plain ESM, no new dependencies, no build step, small helpers, SQL in the route files.
- Every new staff route is automatically protected by `requireStaff`; add a route to `PUBLIC_API` in `src/auth.js` only when a non-staff person must reach it.
- Every user-visible string is plain English for a non-technical charity employee.
- New UI uses CSS classes in `public/style.css`, not inline `style=""`.
- Update tests in the same change when behaviour changes; add a test for each new endpoint.
- Do not commit. Leave the working tree for review.

---

## Phase A: backend (cleanup, safety, data for the new UI)

### A1. Shared helpers [15]
Create `src/util.js` exporting: `str`, `oneLine`, `isDate`, `dateOrNull`, `intId`, `validEmail`, `escapeHtml`, `rateLimit` (take the `feedback.js` version, which keys on IP + token and sweeps itself; give it the `(bucket, max, windowMs)` call shape used by `voice.js` via an options object that accepts either), and `BASE_URL` (strip trailing slashes). Replace the copies in `orders.js`, `partners.js`, `training.js`, `programs.js`, `meet.js`, `feedback.js`, `voice.js`, `compose.js`, `dashboard.js`, `mailer.js`, `auth.js`, `gcal.js`. `mailer.js` keeps re-exporting `BASE_URL`, `STAFF_EMAIL`, `escapeHtml` so existing imports still work.

### A2. Remove the dead Outlook scheduler [12, 13, 14]
- Delete `src/msgraph.js` and `scripts/add_training_meeting_slots.sql`.
- In `src/routes/training.js` remove `generateSlotsForSession`, the `createOutlookEvent` import, all four `/slots` and `book-slot` routes, and the second (duplicate) `POST /api/training/sessions`.
- In `src/db.js` replace the `training_meeting_slots` CREATE/INDEX with `DROP TABLE IF EXISTS training_meeting_slots;` and drop the comment that references the SQL script.
- In `public/training-register.html` delete lines 63-87 (the two "Admin: Manage Training Sessions" blocks and the stray `</section>`).
- Add a `PATCH /api/training/sessions/:id` (title, trainer_name, session_date, session_time, delivery_type, location_details, capacity) and `DELETE /api/training/sessions/:id` (refuse with 409 when registrations exist) so the dashboard can manage sessions.

### A3. Kits-received confirmation must be a POST [10]
- `GET /received/:token`: if the order is `shipped`, render a small page (reuse the `page()` helper style) with the order summary and a form `<button>Yes, the kits arrived</button>` that POSTs to `/received/:token`. If already `received`, show the thank-you page. Otherwise 404.
- `POST /received/:token`: do what the GET does today (claim, emails, thank-you page).
- Add `['POST', /^\/received\/[^/]+\/?$/]` is not needed (not under `/api`), but confirm `requireStaff` lets it through.
- Update `test/smoke.js`, `test/a.js`, `test/site-source.js` wherever they `fetch(/received/…)` expecting a state change: GET should return 200 and leave status `shipped`; POST flips it.

### A4. Tokenised document downloads [11]
- `db.js`: `ALTER TABLE partner_documents ADD COLUMN IF NOT EXISTS token TEXT; UPDATE … SET token = replace(gen_random_uuid()::text,'-','') WHERE token IS NULL; ALTER … SET DEFAULT …; CREATE UNIQUE INDEX IF NOT EXISTS partner_documents_token_key …`.
- New public route `GET /api/documents/:token/download` (token regex `^[A-Za-z0-9_-]{16,64}$`). Put it in `PUBLIC_API`; remove the `partners/\d+/documents/\d+/download` entry.
- Keep `GET /api/partners/:id/documents/:docId/download` for staff (now protected automatically).
- Emails in `POST /api/partners/:id/reply` and the `attachments` JSON use the token URL.
- Update `test/site-source.js` if it asserts on the old URL.

### A5. One-query overview and a Today feed [1, 16]
- Rewrite `GET /api/overview` as a single `SELECT (SELECT COUNT(*) …) AS partners, …`.
- New `GET /api/todo` in `dashboard.js` returning, each as an array of small objects sorted oldest first and capped at 50:
  - `newPartners`: partners with `stage='expression_of_interest'` → `{id, name, contact_email, created_at}`
  - `ordersToShip`: orders `status='ordered'` → `{id, facilitator, email, program, program_id, ordered_at, shipping_address, items:[{item,qty}]}`
  - `unconfirmedShipments`: `status='shipped' AND shipped_at < now() - interval '7 days'` → `{id, facilitator, email, program, shipped_at, reminder_sent_at}`
  - `feedbackToReview`: `needs_review=true` → `{id, program, program_id, source, created_at}`
  - `programsMissingCompletion`: programs with `end_date` in the past (compare as text date), `status <> 'completed'`, no `program_completions` row → `{id, name, token, facilitator, email, end_date}`
  - `trainingWaiting`: `training_invites` with `status='pending'` → `{id, partner_id, partner, invitee_email, created_at}`
  - `counts`: `{ key: length }` for each list, plus `total`.
- Add `test/todo.js` (register in `package.json` `test` script) that seeds one item of each kind through the public API and asserts the lists and counts.

### A6. Small fixes
- `mailer.js`: `UPDATE outbox SET delivered=true` only; delete the try/catch fallback [17].
- `ai.js`: factor `emailPolishPrompt(text, recipientName)` returning `{system, contents}`; both polish functions use it [18].
- `orders.js`: `POST /api/orders/send-reminders` accepts an optional `order_id`; when given, remind only that shipped, unconfirmed order (ignore the `days` cutoff) and return `{ok, sent}`. Add an assertion in `test/a.js`.
- `resources.js`: add `available: false` to every item whose `url` starts with `/resources/` (the files do not exist) and to the two placeholder videos; `resources.html` renders those as "Coming soon" text without a link [19].

Phase A exit: `npm test` green (including the new `test/todo.js`), `verify.mjs` exit 0.

---

## Phase B: dashboard (`public/index.html`, `public/style.css`, `public/compose.html`)

### B1. Today tab [1]
- New first tab `today`, the default when nothing is stored in `localStorage`. Nav order: Today, Partners, Orders, Programs & feedback, Training, Insights, Emails, Staff, Links.
- Renders `GET /api/todo` as a stack of cards, one per non-empty list, each with a count in the heading and one row per item with a single primary action:
  - New partner → "Open" (opens partner detail) and "Email" (detail with email focused).
  - Order to ship → shows items and address inline; "Mark shipped" (existing `ship()`), "Edit" (opens the order editor from B3).
  - Unconfirmed shipment → "Send reminder" calls `POST /api/orders/send-reminders` for that one order (add an optional `order_id` body param to the existing route in Phase A if missing; otherwise call with `days: 7`), shows "reminder sent on …" when `reminder_sent_at` is set.
  - Feedback to review → "Review" switches to Programs and opens the review box scrolled to that card.
  - Program missing completion → "Copy completion link" (`/complete/:token`) and "Email facilitator" (opens compose with the facilitator preselected, see B5).
  - Training waiting → "Open partner".
- Empty state: one friendly line "Nothing needs your attention right now."
- Header badge: show `counts.total` next to the Today tab label when > 0.

### B2. Training tab [2]
- Lists sessions from `GET /api/training/sessions` (title, date, time, format, trainer, `registered_count / capacity`), "New session" form (title, date, time, format, location, trainer, capacity) posting to `POST /api/training/sessions`, Edit (PATCH) and Delete (DELETE, inline confirm only when the server returns 409).
- Clicking a session loads `GET /api/training/sessions/:id/roster`: table of facilitators with status pill and, for anyone not `completed`, a "Mark completed, send certificate" button → `POST /api/training/registrations/:id/complete`. After success show the certificate code and a link to `/certificate/:code`.
- "Copy registration link" button copies `${location.origin}/training/register`.

### B3. Orders tab [3, 7]
- Rename the simulate box to "Start a kit order for a facilitator" with helper text "Use this when a facilitator asks by phone or in person. They get the order-form link by email." Keep the fields.
- Table: add a Ship-to column (address, requested date) and show shipping cost when set.
- Per-row actions by status: `form_sent` → copy form link, Cancel; `ordered` → Mark shipped, Edit, Cancel; `shipped` → Send reminder (disabled with "sent …" when `reminder_sent_at`), Cancel; `received` → none.
- Edit opens an inline editor row (address, requested date, notes, shipping cost, kit quantities) saving with `PATCH /api/orders/:id`.
- Cancel asks once inline ("Cancel order #12? The facilitator is emailed.") with Yes/No buttons, not `confirm()`.
- Page-level "Send all overdue reminders" button calling `POST /api/orders/send-reminders` and reporting "Sent N reminders."

### B4. Replace alerts [5]
- Add `notice(el, text, kind)` that writes into a nearby `role="status"` element (`.notice.ok` / `.notice.err`, auto-clears after 6s for ok). Replace every `alert()` in `index.html`. Keep a confirmation only for: delete document, deactivate staff, cancel order, send email to a facilitator; implement these as inline Yes/No, not `confirm()`.
- After "Start training" show the link inline with a Copy button instead of alerting it.

### B5. Emails tab and composer [6]
- Outbox and inbound rows show date, to/from, subject, status; the body is inside a `<details>` per row.
- Add a "Write an email" button that opens `/compose.html`, and support `/compose.html?facilitator=<id>` preselecting the recipient (used by Today and Programs).
- `compose.html`: use the streaming tidy-up (`/api/compose/polish-stream`) like the partner page does, so both composers behave the same.

### B6. Links tab [4]
- Rename "Forms & links" to "Links". Keep only links that work without a token: Partner interest form (`/partner-interest.html`), Training registration (`/training/register`), Knowledge Centre (`/resources`). Each has Open and Copy buttons. Add one line: "Program-specific links (feedback form, QR sheet, photo upload, completion form) are on each program's row under Programs."

### B7. Programs and Partners tidy-ups [8, 9]
- Programs: load the facilitator dropdown from `GET /api/compose/facilitators` instead of `/api/rollup`. Collapse the four per-row links into one "Links ▾" `<details>` with Copy buttons, plus "Email facilitator" (→ compose with `?facilitator=`).
- Partners detail: always show the PDSA panel (status and three dates). Remove the "Advance stage to" select from the email box; stage is changed in one place, the Overview panel, which gets a Stage select saved with the same Save button.

### B8. Styles
- Add to `style.css`: `.todo-card`, `.todo-row`, `.badge` (count next to nav label), `.notice`, `.inline-confirm`, `.links-menu`, and classes for the training table. Move the 66 inline styles that the touched sections use into these classes; untouched sections may keep theirs.

Phase B exit: `npm test` green; start the app (`AUTH_DEV_LOGIN=1 STAFF_ADMIN_EMAILS=you@example.org npm run dev`) and screenshot with `node .claude/skills/verify-loop/scripts/shot.mjs http://localhost:3000/ .verify/shots/today.png` plus `--width 390`; no console errors; `verify.mjs` exit 0; `proof.mjs` graph in the report.

---

## Out of scope (note for later)
- Real knowledge-centre files and videos (content, not code).
- Moving the remaining inline styles out of `index.html`.
- Splitting `index.html` into modules.
