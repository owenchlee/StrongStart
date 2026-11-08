# StrongStart: Baby Connections dashboard

Connects Baby Connections facilitators with the Strong Start team: kit orders by email, order/delivery emails, parent feedback by QR code, photo or voice (AI reads handwriting and translates), and program reports, trends and rollups for staff.

## Run it locally (zero setup)

```bash
npm install
AUTH_DEV_LOGIN=1 STAFF_ADMIN_EMAILS=you@example.org npm run dev   # http://localhost:3000
npm test                                                          # all tests
```

With no database setting the app uses **PGlite**, an in-process Postgres, in memory (data resets on restart). Set `PGLITE_DIR=data/pglite` to keep it on disk. Sign in at `/login.html` with the dev login (any email in `STAFF_ADMIN_EMAILS`). Nothing else is needed: email is logged to the Emails tab, and AI, audio and photo hosting switch on when their keys are present.

## Use Tiger Data (Postgres / TimescaleDB)

Create a service at Tiger Data, then set `TIGER_DATABASE_URL` to its connection string (SSL is used automatically for non-local hosts). Tables are created on startup and existing databases are upgraded in place. When the `timescaledb` extension is available, `feedback` becomes a hypertable (primary key `(id, created_at)`) and a daily continuous aggregate feeds the Trends tab; on plain Postgres or PGlite the same charts use ordinary SQL.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT`, `BASE_URL` | Port, and public URL used in emailed links and QR codes |
| `TIGER_DATABASE_URL` | Tiger Data / Postgres URL (otherwise local PGlite) |
| `PGLITE_DIR` | Persist the local PGlite database in this folder |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini: handwriting, translation, summaries (default model `gemini-3.8-flash`). A free-tier key allows only about 20 requests a day (one per photographed form): use a paid key before a real program. Forms read while over quota are saved for staff review, not lost. Reading one photo takes up to a minute |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Read-aloud, voice feedback, email dictation |
| `CLOUDINARY_URL` | Photo storage |
| `INBOUND_EMAIL_SECRET` | Shared secret for the inbound-email webhook |
| `ENABLE_JOBS` | `1` runs background jobs such as order reminders |
| `TRUST_PROXY` | Reverse-proxy hops to trust (e.g. `1`) so rate limits see real client IPs; defaults to 1 when `BASE_URL` is https |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Staff "Sign in with Google" |
| `STAFF_ADMIN_EMAILS` | Comma-separated admins added on startup |
| `REQUIRE_AUTH` | Staff login is **off** unless this is `1`. Turn it on before exposing the server publicly |
| `AUTH_DEV_LOGIN` | `1` enables email-only login for local use (never in production) |
| `STAFF_EMAIL`, `MAIL_FROM`, `SMTP_*` | Outgoing email (without `SMTP_HOST` emails are only logged) |

## Public pages vs staff pages

Parents and facilitators never log in; they use links. **Public** (no login): `/order/:token`, `/feedback/:programToken`, `/upload/:programToken`, `/sheet/:programToken` (printable QR sheet), the matching `/api/feedback/:token...`, `/api/programs/:token/public`, `/api/programs/:token/qr.png`, `/api/order-form/:token`, `/api/tts`, `/api/inbound-email` (webhook), and `/login.html`. Program links use a random token, never the numeric id.

**Staff only** (Google sign-in, and the email must be an active row in the `staff` table): the dashboard at `/`, `/compose.html`, and every other `/api/*` route (default-deny; the public list is in `src/auth.js`). The dashboard has Orders, Programs and feedback (date/facilitator filters, CSV export), Review queue and Outstanding surveys (both inside Programs), Insights (trends and rollup), Emails and, for admins, Staff management. Emails are written from the Partners tab (voice dictation and AI tidy-up included).

## Staff accounts
1. Create a Google OAuth client (Web application) with redirect URI `BASE_URL/auth/google/callback` and put the id and secret in `.env`.
2. Add staff: `STAFF_ADMIN_EMAILS=you@org.org` (on startup), the Staff tab (admins), or `npm run staff -- add jo@org.org "Jo" [admin]`, `-- remove jo@org.org`, `-- list`. Deactivating someone ends their sessions at once.

See [WORKLOAD.md](WORKLOAD.md) for how the work is split.
