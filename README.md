# Baby Connections Program Hub (dashboard prototype)

Front-end prototype of the operational dashboard for Strong Start's **Baby Connections** program, built from the SiTE SOURCE business requirements. Mock data only. No backend in this phase.

Read this whole file before writing code. Every agent working in this repo is bound by it.

- Requirements (the contract): [`docs/requirements.md`](docs/requirements.md)
- Brand reference screenshots: [`docs/brand/`](docs/brand/)
- Source sites: https://strongstart.ca/ and https://strongstart.ca/programs/baby-connections/

---

## 1. What this is and is not

Baby Connections is a free community program for parents and caring adults with babies aged **6 to 12 months**. Families attend a **minimum of four** group or individual sessions led by trained Facilitators and get a take-home literacy kit per baby (books, a sensory ball or puppet, a *Tips and Resources* booklet, a *Fun Every Day* reminder card, two pamphlets on speech and language milestones). It runs at 25+ sites across **Ontario**, delivered by Program Partners (community organizations). Strong Start is a children's literacy charity.

The dashboard serves the people who run that network: Strong Start staff, Partner administrators, Site Coordinators and Facilitators. It covers the lifecycle in the BRD:

Partner acquisition, then PDSA (agreement), then facilitator onboarding and training, then program setup and approval, then kit fulfillment, then delivery, then completion reporting, then parent feedback, then reporting.

**Hard scope rules**

1. **No family registration.** Programs carry a `registrationUrl` pointing to the partner's own system. Never build a family signup form or store family PII (names, emails). Only counts.
2. The dashboard promotes programs and supports reporting. It is not a CRM for families.
3. Phase 1 is a clickable, realistic prototype on mock data. Do not build auth, a server or a database. Do build the seams that let them be added (section 6).

---

## 2. Stack (decided, do not relitigate)

| Concern | Choice |
|---|---|
| Build | Vite + React 18 + TypeScript (strict) |
| Routing | React Router v6 |
| Styling | Plain CSS with design tokens (CSS variables), CSS Modules per component. No Tailwind, no UI kit. |
| Charts | Recharts |
| Tables | Hand-rolled `DataTable` component (sort, filter, empty state). No grid library. |
| State | React context + `useReducer` for the mock store. No Redux. |
| Dates | `date-fns` |
| Tests | Vitest + React Testing Library for logic and key components. Playwright for 1 smoke test per page. |
| Lint | ESLint + Prettier, `tsc --noEmit` must pass |

Rationale: the shipping target is a hackathon-speed prototype. Plain CSS tokens make the brand easy to apply and change. Skip anything that adds config.

Commands (create these scripts in `package.json`): `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`.

---

## 3. Brand and visual design

Measured from the live site (computed styles and screenshots). Match it. The site is clean, white, institutional, with Strong Start blue as the anchor and three warm accent colours used as audience pillars.

### Tokens (put in `src/styles/tokens.css`, nothing hardcodes hex elsewhere)

```css
:root {
  /* Core brand */
  --ss-blue:        #0458A6; /* h1/h2, links in body, primary actions text */
  --ss-blue-deep:   #0055A5; /* footer band, Donate button, primary buttons, active nav */
  --ss-blue-navy:   #1B2A6B; /* "Strong Start" wordmark navy, dark panels (approx, sampled from logo) */
  --ss-blue-link:   #428BCA; /* hover/secondary links, active sidebar item bg */
  --ss-blue-cta:    #00A3E8; /* bright cyan CTA button ("Get Started"), use sparingly */
  --ss-sky-grad:    linear-gradient(180deg,#8FCBFF 0%,#4FB1FF 100%); /* testimonial band, hero accents */

  /* Audience pillar accents (from For Families / Partners / Volunteers tiles) */
  --ss-red:    #E71B3B;  /* families */
  --ss-orange: #F5951D;  /* partners */
  --ss-green:  #6CB33F;  /* volunteers */

  /* Baby Connections sub-brand (from its logo) */
  --bc-lime:   #8CC63F;
  --bc-teal:   #2E9BC6;

  /* Neutrals */
  --ink:       #333333;  /* body text */
  --ink-soft:  #555555;
  --ink-mute:  #6B6B6B;
  --line:      #E5E5E5;
  --surface:   #FFFFFF;
  --surface-2: #F5F5F5;  /* breadcrumb / panel bg */
  --surface-3: #EFEFEF;

  /* Semantic (derive from brand, tinted backgrounds for pills) */
  --ok:    #3F8F2A;  --ok-bg:   #EAF5E3;
  --warn:  #B8650A;  --warn-bg: #FDF0DC;
  --bad:   #C4122F;  --bad-bg:  #FCE6EA;
  --info:  #0458A6;  --info-bg: #E5EFF9;

  /* Shape and type */
  --radius-sm: 4px;  --radius-md: 8px;  --radius-lg: 16px;
  --font-body: "Adventor", "TeX Gyre Adventor", "Questrial", "Avant Garde", "Century Gothic", Arial, sans-serif;
  --font-strong: var(--font-body);
}
```

### Typography

- The site uses **Adventor** (a geometric Avant Garde style face, loaded via Typekit) at 400, 500 and bold. Headings are light and regular weight in `--ss-blue`; emphasis words inside headings go bold ("Our **Programs**").
- We cannot load their Typekit kit. Use **Questrial** from Google Fonts as the loaded stand-in (closest free match), with `TeX Gyre Adventor` earlier in the stack if installed. Montserrat is also used on the site for a few thin display elements; do not use it for UI.
- Sizes: body 16px (site body is 14px, too small for a dense dashboard), table text 14px, h1 36px/500, h2 28px/400, h3 20px/500, nav 14px. Line height 1.5.
- Body text `--ink`. Never pure black for text.

### Components and look

- **Header:** white, 1px `--line` bottom border, Strong Start logo left, nav right, one filled blue button (like Donate: `--ss-blue-deep` bg, white bold text, square corners, 50px tall). The dashboard top bar should echo this: logo area, role switcher, user menu.
- **Sidebar nav** (mirror the site's "In This Section" list): stacked items, 1px borders, white bg, `--ink-soft` text, active item filled `--ss-blue-link` with white text. Rounded 4px on first and last.
- **Breadcrumbs:** `--surface-2` bar, blue links, `/` separators, current page in ink.
- **Page title:** large light blue `h1` at the top of every page, breadcrumb under it.
- **Cards:** white, 1px `--line`, 8px radius, no heavy shadows. Imagery on the site uses large rounded corners (16px) on photos.
- **Buttons:** primary = `--ss-blue-deep` fill, white text, 4px radius. Secondary = white with blue border and text. Destructive = `--bad`. The cyan `--ss-blue-cta` is for one hero action per page at most.
- **Footer band:** solid `--ss-blue-deep`, white text. Use for the app footer with the program contact line.
- **Logos:** the Strong Start and Baby Connections logos are trademarks owned by the client. Do not recreate or redraw them. Use a text wordmark placeholder `Strong Start` in navy with a TODO comment, and a slot at `src/assets/brand/` for the real files the owner will supply. Header text reads "Baby Connections Program Hub".
- **Pillar colour use:** red, orange, green are accents only (KPI tile top borders, chart series, avatars). Never full-page backgrounds.

### Accessibility (the site ships contrast and font-size toggles, so this audience cares)

- WCAG 2.1 AA. `--ss-blue-link` (#428BCA) on white is only about 3.4:1: use it for large text, borders and fills with white text at 18px+ or bold, never for small body text. Body-size links use `--ss-blue`.
- `--ss-orange` and `--ss-green` fail AA as text on white. Use them as fills with dark text, or as chart colours paired with labels and patterns. Status never relies on colour alone (icon or text in every pill).
- Include a **high-contrast toggle** and **text size toggle** in the top bar (they persist to localStorage and set `data-contrast` and `data-text` on `<html>`). Visible focus rings (2px `--ss-blue`, 2px offset). Full keyboard navigation. Tables have proper `th scope`.
- Respect `prefers-reduced-motion`. Light theme is the default and the reference. Dark mode is out of scope for phase 1.

Reference screenshots: [home hero](docs/brand/strongstart-home-hero.png), [programs band](docs/brand/strongstart-home-programs.png), [Baby Connections page](docs/brand/baby-connections-page.png), [sidebar and CTA](docs/brand/baby-connections-sidebar-cta.png).

Voice: plain, warm, Canadian English (colour, centre, cheque; "program", not "programme"). Dates `YYYY-MM-DD` in tables, "Nov 7, 2026" in prose. Currency CAD, `$1,234.00`. Metric units.

---

## 4. Roles and permissions

Five roles from the BRD. A **role switcher** in the top bar (prototype only) swaps the active user. All data access goes through scoped selectors (section 6) so switching roles visibly changes what is shown.

| Role | Sees | Can do |
|---|---|---|
| Root User | Everything | Everything, manage roles, edit agreement templates |
| Support (internal) | Everything except role admin | Manage partners, PDSAs, approve programs, fulfill kits, run reports |
| Program Partner Administrator | Own partner only | Manage own facilitators and coordinators, view own agreement, view own programs, kits, feedback |
| Site Coordinator | Own partner (and their facilitators) | Manage facilitators, review partner activity, order kits, coordinate notifications |
| Facilitator | Own profile and own programs | Submit programs, completion reports, feedback entries, view resources after training |

Navigation is filtered per role. Hitting a forbidden route shows a clear "You do not have access" page, not a blank screen. Matrix lives in `src/auth/permissions.ts` as a typed `can(role, action, resource)` function with unit tests.

---

## 5. Pages and features (map 1:1 to BRD sections)

Route list and what each page must contain. "Seed" means it must look alive with the mock data.

### 5.1 Overview `/` (BRD 11, 8)
Role-aware home. Staff view:
- KPI row: Active partners, Partners in pipeline, Facilitators certified, Programs in progress, Families reached (YTD), Kits distributed (YTD), Parent survey response rate. Each tile: value, label, delta vs previous period, links to its detail page.
- **Needs attention** panel (the most valuable widget): agreements expiring within 90 days or lapsed, PDSAs awaiting signature over 7 days, EOIs unassigned or untouched over 5 days, programs awaiting approval, kit orders in `Requested`, completed programs missing a report over 14 days, trainings starting within 14 days with low registration. Each row links to the record.
- Programs timeline strip (current, upcoming, completed) and a map or list of communities served (a stylized Ontario list is fine; no map library required).
- Partner and facilitator views show the same shape scoped to them, with their own next actions.

### 5.2 Partner pipeline `/partners` and `/partners/:id` (BRD 1)
- Kanban board with the seven stages, in order: Expression of Interest, Initial Contact, Discovery, PDSA Review, PDSA Issued/Signed, Active Partner, Inactive Partner. Drag to advance (also a keyboard-accessible "Move to" menu). Table view toggle.
- Filters: stage, owner, community, search. Follow-up reminders and tasks list with due dates, overdue highlighted.
- "Add prospective partner" simulates the public Expression of Interest form and fires the notification to Director of Programs and Baby Connections Program Coordinator (show in a notifications log).
- **Partner profile:** organization info, key contacts, communities served, notes and communications timeline, agreements, facilitators, programs, kit history, relationship history (stage changes with timestamps). Tabs: Overview, Contacts, Agreement, People, Programs, Kits, Activity.

### 5.3 Agreements (PDSA) `/agreements` (BRD 2)
- Table: partner, version, status, issued, executed, term, expiry, renewal status, associated contacts.
- Statuses: `Draft`, `Issued`, `Awaiting signature`, `Executed`, `Expiring soon`, `Expired`, `Terminated`.
- "Generate from template" modal shows merge fields (org name, address, contacts, term) and a live preview, version number bump, then "Send via DocuSign" (simulated, writes status events).
- Simulated DocuSign completion button on an agreement triggers the automations in 6.3.
- Expiry timeline and renewal reminder list (90, 60, 30 days).
- Show the "partner listing updates on strongstart.ca" integration as a status chip (Published / Pending / Hidden) on each Active partner.

### 5.4 People `/people` (BRD 3)
- Facilitators and Site Coordinators across partners (scoped by role). Profile drawer: contact, partner, role, active/inactive, **training history**, **delivery history**.
- Org structure view: one Site Coordinator over many facilitators.
- Invite facilitator flow (simulated email) which hands off to training registration.

### 5.5 Training `/training` (BRD 4)
- Sessions list and calendar: date, format (in person, virtual, online modular), location, trainer, capacity, registered, attended, completed.
- Facilitator onboarding pipeline: Invited, Registered, Onboarding info submitted, Attended / module in progress, Completed (certified).
- Mark attendance and completion per person. On completion trigger the post-training automations in 6.3.
- Certificate preview (PDF-style card) and a "Share on LinkedIn" button (simulated, opens a preview of the post text).
- Cohort stats: completion rate, time to certification.

### 5.6 Resources `/resources` (BRD 5)
- Knowledge centre: Promotional Resources, Templates, Evaluation Tools, Supplemental Training Videos, FAQs, Program Updates. Search and category filters.
- **Locked until training complete** for facilitators (show locked state with the reason). Role-based visibility per item. Placeholder files only.

### 5.7 Programs `/programs` and `/programs/new` (BRD 6, 8)
- List with tabs: Current, Upcoming, Completed, Needs review. Calendar toggle.
- **Facilitator submission form** with every BRD field: program name, location, delivery format (in person, virtual, hybrid), start and end dates, session schedule (at least four sessions, enforce), facilitators, registration link (URL, validated), community served, projected participants.
- **Staff review queue:** approve, request changes (with comment), reject. Status flow `Draft`, `Submitted`, `Needs changes`, `Approved`, `In progress`, `Completed`, `Cancelled`.
- On approval show "Published to strongstart.ca program finder" state (simulated API) with an unpublish control.
- Detail page: all fields, facilitators, linked kit orders, completion report, survey progress, cost summary.

### 5.8 Kit orders `/kits` (BRD 7)
- Order types: Participant Kits, Facilitator Kits, Facilitator Manuals, Replacement Materials.
- New order form: type, quantity, shipping address, requested delivery date, program association. **Recommended quantity** auto-fills from the program's projected participants (plus a configurable buffer, default 10%, rounded up) and shows why.
- Status flow: `Requested`, `Approved`, `Packed`, `Shipped`, `Delivered`, `Invoiced`. Staff can edit **shipping cost** (CAD). Packing slip preview. Invoice preview with line items and HST (13% for Ontario) as a clearly labelled mock.
- "Sync to finance system" shows a simulated API status.
- Queue view for fulfillment staff: what to pack this week.

### 5.9 Completion and delivery reports `/reports/completions` (BRD 8, 9)
- Facilitator completion form: families served, kits distributed, program dates, completion confirmation, reflections, success stories, challenges, number of completed feedback surveys. Validate that kits and families are non-negative integers and that dates fall inside the program.
- Staff list of reports with outstanding ones flagged. Stories can be starred for funder reporting.
- Delivery tracking table: program, facilitator, partner, families, kits distributed, delivery model, completion status, associated cost (kits plus shipping).

### 5.10 Parent feedback `/feedback` (BRD 10)
- Three intake models, all mocked: direct online survey link (copy link and QR placeholder), facilitator-assisted entry (form), batch CSV upload (parse in browser, preview, validate, import).
- Dashboards: response rate per program and partner (completed surveys divided by families served), outstanding surveys list, program-level and partner-level results (a few summary questions on a 1 to 5 scale, no individual responses visible). Low response (under 50%) flagged.

### 5.11 Reporting `/reports` (BRD 11)
- **Operational** tab: active partners, agreements, training completion, programs scheduled, programs delivered, kit orders.
- **Strategic** tab: communities served, facilitators trained, families reached, kits distributed, program growth (12-month trend), evaluation outcomes.
- Date range and partner filters, CSV export of any table, "Export for Power BI" button that downloads the normalized dataset as JSON (the future integration point).
- Annual impact summary page (print stylesheet) as the automated annual report preview.

### 5.12 Settings and admin `/admin` (BRD 12, Roadmap)
- Users and roles (Root only), notification log (every simulated email, DocuSign and API event with timestamp), integration status board (DocuSign, strongstart.ca listing API, finance system, Power BI), business rules (auto-send facilitator kit after training: on/off).

### Out of scope for phase 1
Real auth, real email, real DocuSign, real finance API, Power BI itself, inventory integration, partner community portal, dark mode, i18n.

---

## 6. Architecture

```
src/
  main.tsx, App.tsx, routes.tsx
  styles/        tokens.css, global.css, a11y.css
  auth/          roles.ts, permissions.ts, CurrentUserContext.tsx
  domain/        types.ts, enums.ts, rules.ts, selectors.ts, automations.ts, kpis.ts
  mock/          seed.ts, factories.ts, ids.ts     (the only place with literal sample data)
  data/          repository.ts (interface), mockRepository.ts, StoreProvider.tsx
  components/    ui/ (Button, Card, DataTable, Pill, Tabs, Drawer, Modal, EmptyState, KpiTile, ...),
                 charts/, layout/ (AppShell, Sidebar, TopBar, Breadcrumbs)
  features/      overview/, partners/, agreements/, people/, training/, resources/,
                 programs/, kits/, reports/, feedback/, admin/
  lib/           format.ts (dates, CAD), csv.ts, id.ts
tests/           unit/, e2e/
docs/            requirements.md, brand/
```

Rules that keep this clean:

1. **Pages never import `mock/`.** They call hooks (`usePartners()`, `useProgramsForUser()`) backed by `data/repository.ts`. The mock repo implements the interface. Swapping in a real API later means one new file.
2. **All permission scoping lives in `domain/selectors.ts`** (`visiblePartners(user, store)` and so on). Components do not filter by role themselves.
3. **All business logic is pure functions in `domain/`** with unit tests. Components render, they do not decide.
4. **Automations** (6.3) are functions `(store, event) => store'` in `domain/automations.ts`, each appending to the notification log. This keeps "simulated integrations" visible and testable.
5. Seed data is generated from a fixed seed with relative dates from a single `NOW` constant so the dashboard never looks stale and tests are deterministic.
6. One source of truth for enums (`StageId`, `AgreementStatus`, ...) with a label and tone (colour) map. Pills read from it.

### 6.1 Domain types (starting point, refine as needed)

```ts
type Role = 'root' | 'support' | 'partnerAdmin' | 'siteCoordinator' | 'facilitator';

interface Partner {
  id: string; name: string; stage: PartnerStage; ownerId: string; // staff owner
  address: Address; communities: string[]; contacts: Contact[];
  notes: Note[]; stageHistory: { stage: PartnerStage; at: string; byId: string }[];
  listingStatus: 'published' | 'pending' | 'hidden'; createdAt: string;
}
interface Agreement {
  id: string; partnerId: string; version: number; status: AgreementStatus;
  issuedAt?: string; executedAt?: string; termMonths: number; expiresAt?: string;
  renewal: 'notDue' | 'dueSoon' | 'renewed' | 'lapsed'; contactIds: string[]; docusignEnvelopeId?: string;
}
interface Person { id: string; partnerId: string; name: string; email: string; phone?: string;
  role: 'facilitator' | 'siteCoordinator'; active: boolean; coordinatorId?: string;
  onboarding: 'invited'|'registered'|'infoSubmitted'|'inTraining'|'certified'; certifiedAt?: string; }
interface TrainingSession { id: string; format: 'inPerson'|'virtual'|'onlineModular'; date: string;
  location: string; trainer: string; capacity: number; registrations: Registration[]; }
interface Program { id: string; partnerId: string; name: string; location: string; format: 'inPerson'|'virtual'|'hybrid';
  start: string; end: string; sessions: { date: string; start: string; end: string }[]; facilitatorIds: string[];
  registrationUrl: string; community: string; projectedParticipants: number; status: ProgramStatus;
  reviewComments: Comment[]; published: boolean; }
interface KitOrder { id: string; partnerId: string; programId?: string; type: KitType; quantity: number;
  shippingAddress: Address; requestedBy: string; requestedDeliveryDate: string; status: KitStatus;
  shippingCostCad?: number; unitCostCad: number; recommendedQuantity?: number; }
interface CompletionReport { programId: string; families: number; kits: number; surveysCompleted: number;
  confirmed: boolean; reflections: string; successStory?: string; challenges?: string; submittedAt: string; starred: boolean; }
interface SurveyResponseSummary { programId: string; responses: number; avgScores: Record<string, number>; source: 'online'|'assisted'|'batch'; }
interface NotificationLogEntry { id: string; at: string; channel: 'email'|'docusign'|'api'|'finance'; to: string; subject: string; related: { type: string; id: string } }
```

### 6.2 Key calculations (put in `domain/kpis.ts` and `rules.ts`, test each)

- Active partners: stage is `Active Partner` and has an `Executed` agreement not `Expired`.
- Pipeline: partners in stages 1 to 5.
- Families reached: sum of `CompletionReport.families` for completed programs in the period.
- Kits distributed: sum of `CompletionReport.kits`.
- Survey response rate: `surveysCompleted / families` per program, partner, overall.
- Agreement state "Expiring soon": expires within 90 days. Renewal reminders at 90, 60, 30.
- Recommended kit quantity: `ceil(projectedParticipants * (1 + buffer))` where buffer defaults to 0.10.
- Program growth: programs started per month, trailing 12 months.
- Overdue: follow-up tasks past due, completion reports over 14 days after program end.

### 6.3 Automations to simulate (each writes a notification log entry)

1. EOI submitted: create partner at stage EOI, notify Director of Programs and BC Program Coordinator.
2. Agreement executed (DocuSign callback): set partner to Active Partner, store signed PDF reference on the profile, set listing to `pending`, notify program staff.
3. Agreement within 90, 60, 30 days of expiry: create reminder and notify owner.
4. Facilitator invited: send invite, create person at `invited`.
5. Training completed: set `certified`, generate certificate, unlock resources, send welcome and next steps, record permanently, and if the business rule is on, create a Facilitator Kit and Manual order as `Requested`.
6. Program approved: set `published`, call (mock) website API, notify facilitator.
7. Program completed and report submitted: update delivery tracking, flag surveys outstanding.
8. Kit order shipped or delivered: notify requester. Delivered: eligible for invoicing, sync to finance (mock).

### 6.4 Mock data requirements

Make it feel like Ontario, not generic. No real people. Use **fictional** partner names tied to real Ontario communities (Guelph, Waterloo, Brantford, Norfolk County, Sudbury, Thunder Bay, Peterborough, Kingston, Windsor, Ottawa, Barrie, Sault Ste. Marie, London, Hamilton). Seed at least:

- 18 partners spread across all seven stages (about 8 active, 2 inactive).
- 10 agreements covering every status including 2 expiring within 90 days and 1 lapsed.
- 30 people (facilitators and coordinators) with a mix of onboarding states and some inactive.
- 8 training sessions, past and future, mixed formats.
- 25 programs across all statuses, 4 to 12 sessions each (never fewer than 4), participant counts 6 to 18 (babies 6 to 12 months).
- 20 kit orders across all types and statuses, CAD costs.
- Completion reports for completed programs, with deliberate gaps for 2 so the "missing report" alert fires. Survey response rates from 20% to 100%.
- 12 months of history so trend charts have shape.
- Every "Needs attention" rule has at least one live example.

Contact line for the program: `babyconnections@strongstart.ca`, 1-833-419-READ (7323) ext. 100.

---

## 7. Work packages for parallel agents

Do WP0 first, alone, and merge. Then WPs 1 to 8 can run in parallel; each owns its `features/<name>/` folder and may only touch shared files via the listed extension points. WP9 last.

| WP | Owner scope | Depends on | Done when |
|---|---|---|---|
| **0 Foundation** | Vite scaffold, tokens, global CSS, fonts, AppShell, Sidebar, TopBar (role switcher, contrast and text toggles), Breadcrumbs, routing with role guards, all `components/ui/*`, `domain/types.ts` and enums, `data/` repository and provider, `mock/seed.ts` per 6.4, `permissions.ts` with tests | none | `npm run dev` shows the shell with every nav item routing to a stub page, role switch changes nav, typecheck and lint pass |
| 1 Overview and KPIs | `features/overview`, `domain/kpis.ts`, `components/charts` | 0 | Overview per 5.1 incl. Needs attention panel, all roles |
| 2 Partners and pipeline | `features/partners` | 0 | 5.2 complete incl. drag and keyboard move, profile tabs, EOI form |
| 3 Agreements | `features/agreements` | 0 | 5.3 incl. generate, simulated DocuSign, automation 2 and 3 |
| 4 People and training | `features/people`, `features/training` | 0 | 5.4 and 5.5 incl. certificate and automation 5 |
| 5 Resources | `features/resources` | 0, 4 for lock state | 5.6 with role and training gating |
| 6 Programs | `features/programs` | 0 | 5.7 incl. submission validation, review queue, publish state |
| 7 Kits | `features/kits` | 0 | 5.8 incl. recommended quantity, status flow, invoice and packing slip |
| 8 Completion, feedback, reporting | `features/reports`, `features/feedback` | 0 | 5.9 to 5.11 incl. CSV import, exports |
| 9 Admin, polish, QA | `features/admin`, a11y pass, e2e smoke tests, README screenshots | all | 5.12, axe checks clean, every page has loading/empty/error states, all acceptance criteria below met |

Agent etiquette: small commits, one PR per WP, do not reformat files you do not own, do not rename shared tokens or enums without updating every usage, and add or update unit tests for any `domain/` change.

---

## 8. Acceptance criteria (whole product)

1. Every BRD section 1 to 12 has a visible, working page or panel (traceability table in `docs/TRACEABILITY.md`, one row per BRD bullet, linking to the route and file).
2. Switching to each of the five roles changes navigation and data scope; a Partner Admin can never see another partner's records anywhere, including search, exports and notification log.
3. The Needs attention panel shows live items for every rule and each deep-links to the record.
4. Moving a partner to Active, completing a training, approving a program and executing an agreement each trigger their automation and produce a notification log entry.
5. No family PII exists anywhere in types, seed data or UI. Programs link out to registration URLs.
6. Looks like Strong Start: tokens only, the typography and component rules in section 3 followed, no hardcoded colours outside `tokens.css`.
7. WCAG 2.1 AA: axe reports no serious or critical issues on any route, keyboard-only walkthrough works, contrast and text size toggles work.
8. Responsive down to 360px wide (tables scroll horizontally inside their card; sidebar collapses to a menu). Primary use is desktop.
9. `npm run typecheck`, `lint`, `test` and `build` pass. Page loads with no console errors.
10. Seed data and numbers are internally consistent (KPI on Overview equals the sum on its detail page).

---

## 9. Open questions for the product owner (assumptions made so work is not blocked)

- Geography: the public site says Ontario, so mock data is Ontario with HST at 13%. Confirm.
- Minimum sessions per program: the public site says four, so the form enforces at least four. Confirm.
- Real logo files, Adventor font licence (or Typekit kit ID) and any brand guidelines document: not available to the build. Placeholders in place.
- Survey question set for Parent Feedback is not in the BRD. Mock uses five generic 1 to 5 items.
- Whether the Support role can edit agreement templates (assumed no, Root only).
- Unit costs for kits and the shipping rate card are invented.
