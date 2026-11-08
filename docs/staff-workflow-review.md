# Staff workflow review (2026-11-07)

Goal: make the day of a Strong Start staff member as simple as possible. Everything below was found by reading every file in `src/`, `public/` and `test/` and running `npm test` (green on the current tree).

## How staff actually work today

A staff member opens the dashboard and has to visit five tabs to find out what needs doing:

| Question | Where the answer hides today |
|---|---|
| Did a new partner apply? | Partners tab, stage tile "Expression of Interest" |
| Which orders do I need to pack and ship? | Orders tab, scan the Status column for "ordered" |
| Which kits shipped a week ago and were never confirmed? | Nowhere in the UI (API exists: `POST /api/orders/send-reminders`) |
| Which parent forms need a human to check? | Programs tab, inside a collapsed "Review queue" box |
| Which programs ended without a completion report? | Nowhere |
| Did a partner pick a training time yet? | Open each partner, Training sub-tab |
| Who is registered for the next training and who finished? | Nowhere (API exists, no UI at all) |

There is no "what needs my attention today" view. That is the single biggest gap.

## Findings, ranked by impact on staff

### A. Missing or broken staff UI (highest impact)

1. **No Today / to-do view.** Every piece of work is scattered across tabs (table above).
2. **Training sessions have an API but zero dashboard UI.** `POST /api/training/sessions`, roster, and "mark completed, issue certificate" exist in `src/routes/training.js` and are tested, but nothing in `public/index.html` calls them. Staff cannot run step 2 of the business (train facilitators) from the dashboard.
3. **Orders tab exposes 1 of 5 order actions.** Only "Mark shipped" and "form link". Cancel, edit (address, date, notes, shipping cost) and "send overdue reminders" exist in `src/routes/orders.js` with tests but no buttons. Shipping address is not shown in the table, so staff open the packing-slip email to find it.
4. **"Forms & links" tab has 3 broken links out of 6.** `/order.html`, `/feedback.html` and `/completion.html` need a token in the path; opened bare they show "We could not load…". Only EOI form, training registration and knowledge centre are real public links.
5. **16 `alert()` / `confirm()` calls** in `index.html`. Every save, send and link action pops a modal that must be dismissed; "Partner updated successfully" interrupts flow. Inline status text exists elsewhere (`#npMsg`, `#stMsg`) so the pattern is already there.
6. **Emails tab prints the full body of 50 emails inline.** Hard to scan. Also says "To write an email, open a partner…" while a separate composer (`/compose.html`) exists but is linked from nowhere; it is the only way to email a facilitator who is not linked to a partner.
7. **Orders tab opens with a developer tool.** "Simulate an email from a facilitator" is really the staff action "start a kit order for a facilitator who phoned or emailed us". Rename and keep; it is useful.
8. **Programs filter fetches `/api/rollup`** (a heavy aggregate over all feedback) just to populate the facilitator dropdown. `GET /api/compose/facilitators` already returns the light list.
9. **Partner detail: stage can be changed in three places** (list dropdown, Email "advance stage", PATCH) and the PDSA panel is hidden unless stage is exactly `pdsa_review`, so once signed the dates cannot be seen or edited.

### B. Data-accuracy problems that create staff work

10. **`GET /received/:token` mutates state.** Email security scanners (Outlook Safe Links, Gmail prefetch) follow links in emails; a kit can be marked "received" and the parent-feedback links emailed before the box arrives. Staff then chase phantom deliveries. Should render a page with a "Yes, the kits arrived" button that POSTs.
11. **Partner documents (PDSA agreements) are publicly downloadable by sequential id.** `GET /api/partners/:partnerId/documents/:docId/download` is in `PUBLIC_API` so emailed links work, but `/api/partners/1/documents/1/download` is guessable. Needs a per-document random token.

### C. Dead and duplicated code (slows every future change)

12. **Two scheduling systems.** `src/msgraph.js` + `training_meeting_slots` table + four `/api/training/:sessionId/*slots*` routes (Outlook, client-credentials, env vars documented nowhere, no tests, no UI, routes not in `PUBLIC_API` despite "Public" comments) duplicate the working Google Meet flow in `src/routes/meet.js`. `scripts/add_training_meeting_slots.sql` is also dead.
13. **Duplicate routes in `training.js`:** `GET /api/training/:sessionId/slots` is registered twice (lines 163 and 202); `POST /api/training/sessions` is registered twice (249 and 276, second never runs).
14. **`training-register.html` lines 63-87:** a duplicated, unclosed "Admin: Manage Training Sessions" block with duplicate ids and no JavaScript behind it.
15. **Same six helpers copy-pasted into six route files:** `str`, `oneLine`, `isDate`, `dateOrNull`, `intId`, `validEmail` (and `esc` in three). Two different in-memory rate limiters (`feedback.js` and `voice.js`). `BASE_URL` computed three times (`auth.js`, `mailer.js`, `gcal.js`) with two different normalisations.
16. **`/api/overview` runs 8 sequential round trips** for 8 counts; one query does it.
17. **`mailer.js` tries `delivered=1` then catches and retries `delivered=true`** on every send; the column is always boolean now.
18. **`polishEmail` and `polishEmailStream`** duplicate the same system prompt and user prompt builder.
19. **Knowledge Centre links point at files that do not exist** (`public/resources/` is absent) and both videos embed the same placeholder YouTube id. Facilitators hit 404s. Content is out of scope for code, but the UI should not present dead links as live.
20. **`index.html` has 66 inline `style=""` attributes** and is 877 lines in one file. Not urgent, but every new feature copies the pattern.

### D. Things that are good and should stay

- Default-deny auth with an explicit public allow-list.
- Token-based public links, magic-byte image checks, formula-safe CSV.
- Voice typing on every text box (`dictate.js`), AI tidy-up, streaming.
- Test suite boots the real app on PGlite and covers the whole order → feedback → report loop.
- The verify-loop skill and gates.
