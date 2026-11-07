# Workload split: three people

The app is split by **lane**, so each person owns separate files and merge conflicts stay rare. Branch off `main` (`git checkout -b a/<feature>`, `b/...`, `c/...`), keep PRs small, and merge often.

The dashboard is **for Strong Start staff only**. Parents and facilitators never log in; they only use emailed or QR links (see [Who can access what](#who-can-access-what)).

## Status (Nov 7)

**Built and covered by `npm test`:** all of lanes A, B and C in code (frontend and backend), including staff login, the Postgres/Tiger Data database layer, Gemini AI, Cloudinary photo pipeline with local fallback, ElevenLabs read-aloud / voice feedback / email dictation, trends, rollups, CSV export, and the design pass.

**Staff login is currently OFF** (temporary, so it's easy to test): the dashboard and staff API are open to anyone who can reach the server. Set `REQUIRE_AUTH=1` to turn it back on; do this before any public deploy. Person C owns re-enabling and Google sign-in setup.

**Still needs a human:** (1) add the real keys to `.env` and try each service live (tests use fakes); ElevenLabs needs `ELEVENLABS_VOICE_ID`; (2) the Tiger Data hypertable/aggregate paths have not run against a real Timescale server; (3) match the questions to the real paper form; (4) Vultr deployment, domain, real inbound-email provider and SMTP; (5) DEV post and Devpost entry; (6) try the mic and photo flows on real phones.

## At a glance

| | Lane | Files they own | Sponsor tracks | Main deliverables |
|---|---|---|---|---|
| **A** | **Email, orders & audio** | `src/routes/orders.js`, `src/mailer.js`, `public/order.html`, new `src/routes/voice.js`, `src/routes/compose.js`, `public/compose.html` | ElevenLabs, Vultr, domain | Real email in/out, order flow polish, voice feedback, **dictate emails**, live deployment |
| **B** | **Feedback capture & AI** | `src/routes/feedback.js`, `src/ai.js`, new `src/cloudinary.js`, `public/feedback.html`, `public/upload.html` | Cloudinary, Gemini | Photo pipeline, handwriting reading, languages, QR sheet |
| **C** | **Data, access & dashboard** | `src/db.js`, `src/report.js`, `src/routes/dashboard.js`, new `src/auth.js`, `public/index.html`, `public/style.css`, `test/` | Tiger Data, DEV post | **Staff login**, database, reports and trends, tests |

**Shared contract:** the tables in `src/db.js`. Need a schema change? Ask Person C (or open a tiny separate PR and tag them) before merging. Everything else is independent.

## Decide in the first hour (before anyone builds much)

- [ ] **Tiger Data: yes or no?** Yes means Person C replaces SQLite with Postgres early and A and B rebase onto it (about 3-4 h of work). No means we skip that track and keep SQLite. Don't do it half-way.
- [ ] **Staff login method:** shared staff password (fastest) or Google sign-in limited to the Strong Start email domain (nicer). Person C.
- [ ] **The real paper form:** get the actual Baby Connections feedback form so B can match the questions. Until then the questions are a placeholder.
- [ ] **Gemini replaces Claude** for all AI (decided: one tool per job). B does the swap first, because A's voice feature and C's report summary depend on it.

## Suggested timeline (event schedule)

| When | What |
|---|---|
| Sat 11:30 AM - 12:30 PM | Decisions above; everyone runs the app locally (`npm install && npm run dev`) |
| Sat 12:30 - 4:30 PM | **Must-haves:** C staff login, B Gemini swap + real form questions, A real email in/out |
| Sat 4:30 PM | B grabs the Gemini key at the Google AI Studio workshop (or earlier at mlh.link/aistudio) |
| Sat 5 PM - midnight | **Sponsor features:** Cloudinary (B), ElevenLabs voice + email dictation (A), Tiger Data / trends (C) |
| Midnight - 9 AM | Deploy to Vultr + domain (A), bug fixes, DEV post draft (C), sleep in shifts |
| Sun 9 - 11:30 AM | **Feature freeze.** Demo script, screenshots, Devpost entry, final deploy |

## Person A: Email, orders & audio

Already working: inbound email webhook, tokenized order form, confirmation / shipped / received emails.

**Core (do first)**
- [ ] A1. Connect a real inbound-email provider (Postmark, SendGrid Inbound Parse or Mailgun Routes) to `POST /api/inbound-email` (it already accepts their field names). **Verify a shared secret or signature** so only the provider can call it.
- [ ] A2. Real SMTP in `.env` (see `.env.example`); HTML versions and branding for the emails.
- [ ] A3. Parse the facilitator's email body for hints (program name, quantity) and pre-fill the order form.
- [ ] A4. Order edit/cancel, shipping cost field, packing-slip email to staff (requirements doc §7), reminder if a shipped order isn't confirmed after N days.

**ElevenLabs: all audio** (needs Gemini from B for the structuring step)
- [ ] A5. **Voice feedback in:** `POST /api/feedback/:id/voice` in new `src/routes/voice.js`. ElevenLabs speech-to-text, then Gemini fills the form fields, insert with `source='voice'`.
- [ ] A6. **Read aloud:** `GET /api/tts` reads each question aloud (cached on disk), in the languages B supports.
- [ ] A7. **Dictate emails (staff):** new `public/compose.html` + `src/routes/compose.js`. Pick a facilitator, press the microphone, speak, ElevenLabs transcribes into the box, staff review and edit, then send through the existing `sendMail()` (it shows in the Emails tab). Never auto-send. Staff-only (needs C's login).
- [ ] A8. Add "Listen" and "Record your answer" buttons to `public/feedback.html` (one small PR; B owns the file).

**Deploy (Vultr + domain)**
- [ ] A9. Vultr Ubuntu instance, Node 22+, `pm2` or systemd, Caddy for HTTPS, `.env` with the real `BASE_URL`, backup of `data/`.
- [ ] A10. Register a domain (eligible endings on the GoDaddy Registry sponsor page *(verify)*), point an `A` record at the server, update `BASE_URL`, point the email webhook at it.

## Person B: Feedback capture & AI

Already working: QR code per program, online parent form, multi-photo upload, AI handwriting reading, human-review flag.

**Core (do first)**
- [ ] B1. **Switch `src/ai.js` to Gemini** (key from mlh.link/aistudio). `npm i @google/genai`, remove `@anthropic-ai/sdk`. Use a response schema so output is always valid JSON. Keep the same exports (`transcribeFeedbackPhoto`, `summarizeComments`) so nothing else changes. *(verify current model names)*
- [ ] B2. Match the extraction and the online form to the **real** paper form's questions; test on 10+ real handwritten forms and tune `FORM_PROMPT`.
- [ ] B3. Other languages: keep the original text and add an English translation (store both).
- [ ] B4. Make public links hard to guess: replace sequential `/feedback/:id` and `/upload/:id` with random program tokens (coordinate the `programs.token` column with C), and add rate limiting to the public POST endpoints.

**Cloudinary: all images**
- [ ] B5. Create account, `CLOUDINARY_URL` in `.env`, `npm i cloudinary`; new `src/cloudinary.js`.
- [ ] B6. Upload straight from the phone browser into a folder per program (tagged with the program ID). Transformations to make handwriting readable: auto-rotate, straighten/crop to the page, improve contrast, sharpen, size limit, `q_auto` *(verify names)*. Keep the original too. **Do not** use Cloudinary's OCR add-on (Gemini reads text).
- [ ] B7. Gemini reads the Cloudinary URL; the review queue shows the same image. Store `image_url` on `feedback` (ask C for the column). Drop the local-file path once this works.
- [ ] B8. Printable QR sheet per program (name + QR + "Scan to share your feedback") built with Cloudinary overlays and hosted there.

## Person C: Data, access & dashboard

Already working: SQLite storage, program report, dashboard with orders / programs / review queue / email log.

**Core (do first)**
- [ ] C1. **Staff-only login** in new `src/auth.js` (see [Who can access what](#who-can-access-what)): signed session cookie, middleware protecting every staff route, login page. Facilitators and parents get no login.
- [ ] C2. Schema work for the others, quickly: `programs.token`, `feedback.image_url`, `feedback.source` allowing `'voice'`, translation fields. Use `ALTER TABLE` in a try/catch so existing databases keep working.
- [ ] C3. Tests: staff routes return 401 without login, public routes still work, plus the existing end-to-end `npm test`.

**Tiger Data: the one database** (only if decided "yes" in the first hour)
- [ ] C4. Free Tiger Data service, `TIGER_DATABASE_URL`, `npm i pg`. Convert `src/db.js` and every route to async `pg` queries; make `feedback` and order events hypertables.
- [ ] C5. Continuous aggregates (responses and average rating per day, order-to-delivery time) and a **Trends** tab on the dashboard.
- *If "no": skip C4-C5 and keep SQLite; do C6-C7 and help A with deployment instead.*

**Reports and write-up**
- [ ] C6. Partner-level and all-programs rollup reports, CSV/PDF export for funders, filters, and an "outstanding surveys" view.
- [ ] C7. **DEV post**: problem, workflow, how each sponsor tool does its one job, what's next; 3-4 screenshots; publish per dev.to/mlh-hackathon *(verify tag and deadline)*.
- [ ] C8. Final: Devpost entry, demo script, screenshots.

## Hand-offs between people

| Who needs it | From | What |
|---|---|---|
| B, A | C (C2) | New columns: `programs.token`, `feedback.image_url`, voice source, translations |
| A (A5, A7), C (reports) | B (B1) | Gemini in `src/ai.js` |
| A (A7), everyone | C (C1) | Staff login, so new staff pages are protected |
| B (B4, B7) | C (C2) | Schema changes |
| A (A8) | B | OK to edit `public/feedback.html` |
| Everyone | C (C4) | If Tiger Data is a yes, async DB; do this first so others rebase once |

## Who can access what

The **dashboard is for Strong Start staff only.** Parents and facilitators never see it. These are the only public pages:

| Public (no login, reached by link) | Used by |
|---|---|
| `/order/:token`, `/api/order-form/:token` | Facilitator: kit order form from their email |
| `/received/:token` | Facilitator: "kits arrived" link |
| `/feedback/:id`, `POST /api/feedback/:id`, `/api/programs/:id/public` | Parent: QR code feedback form |
| `/upload/:id`, `POST /api/feedback/:id/photos` | Facilitator: upload photos of paper forms |
| `POST /api/inbound-email` | Email provider webhook (shared secret or signature, not a login) |

**Staff only (needs login):** `/` (dashboard), `/api/overview`, `/api/orders*`, `/api/programs` and its reports, `/api/review-queue`, `/api/emails`, `PATCH /api/feedback/:id`, `/api/feedback/:id/image` (parents' handwriting), and the compose page and endpoints. Roles from the requirements doc (Program Partner Administrator, Site Coordinator) are out of scope for now.

## Sponsor tracks: one tool per job, go deep on a few

Judges reward the **best** use of a specific tool, so we target four tracks and give each one job. No two tools do the same thing, and no data is copied into two databases. Check each sponsor's own page for judging criteria; *(verify)* means it's from general knowledge, not read from the sponsor.

| Track | Its one job | Owner | What it does in OUR project |
|---|---|---|---|
| **Cloudinary** (Community Impact: $1,200 / $400) | All images | B | Cleans up and stores phone photos of paper forms; hosts the printable QR sheet |
| **Gemini API** | All AI | B | Reads handwriting, translates, structures voice answers, writes report summaries |
| **ElevenLabs** | All audio | A | Parents hear questions and speak answers; staff dictate emails |
| **Tiger Data** | The one database | C | Holds orders, programs and feedback; powers the Trends tab |

Logistics: **Vultr** hosts the app (A), a **GoDaddy Registry domain** is the web address (A), the **DEV post** is the write-up (C).
**Not used:** Chatforce (makes games, no natural fit, no published prize), Solana (no payments), Entire (a tool for sharing coding sessions, adds nothing to the product), Copilot/AI Studio workshops (only to get the Gemini key).

## Submission checklist

- [ ] Devpost entry names each sponsor and the *one job* it does, and why it's the best fit.
- [ ] Demo: email in → order form → emails → QR + photo + voice feedback → report with trends; and staff dictating an email.
- [ ] Staff login works; public links work without one.
- [ ] Live URL and domain work on a phone.
- [ ] README lists the new env vars (`CLOUDINARY_URL`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `TIGER_DATABASE_URL`, staff password or Google client settings).
- [ ] DEV post published.

## Working agreements

- Run locally: `npm install && npm run dev`, then open http://localhost:3000. No API keys are needed for most things; AI features need `GEMINI_API_KEY` once switched.
- Never commit `.env` or `data/` (both are in `.gitignore`).
- Small PRs, one lane each. Each lane should run and demo on its own.
- If you must touch someone else's file, tell them first and keep the change to a few lines.
