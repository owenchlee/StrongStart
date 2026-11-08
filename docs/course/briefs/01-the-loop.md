## Module 1: The loop — from one email to a parent's feedback

File to write: `docs/course/modules/01-the-loop.html` — `<section class="module" id="module-1" style="background: var(--color-bg-warm)">`. Module number "01".

### Teaching arc
- **Metaphor:** a **parcel tracking number**. One random code is minted when the facilitator's email arrives, and every later step (order form, shipping, delivery confirmation) looks the same code up and moves it to the next status. The learner has seen tracking pages; this is the same idea. Do not use any other metaphor in this module.
- **Opening hook:** "A facilitator at a library emails babyconnections@… saying 'we need 10 kits for our Fall Babies group'. Nobody at Strong Start touches a keyboard, yet within a second the facilitator has a personal order-form link in their inbox. Here is everything that happened."
- **Key insight:** the whole product is **one status machine** stored in a database row: `form_sent → ordered → shipped → received`, and each transition sends an email containing a link that carries the token. After `received`, the facilitator is emailed the three parent-feedback links (QR form, printable sheet, photo upload) and the completion-report link, which starts the *second* half of the loop (parents → staff dashboard).
- **"Why should I care?":** when the learner is asked "what does your app do?", this module is the answer in 60 seconds. When something is "stuck", the first question is always "what status is the row in?".

### Screens (suggested, 5)
1. **What StrongStart does** — 4 pattern cards for the business steps (kit request, training, run the program, parents report back). One sentence each. Then one paragraph: the app closes the loop.
2. **Follow the tracking number** — hero **data flow animation** (see below) through the order half of the loop.
3. **The row that remembers everything** — code↔English for the `orders` table (snippet A). Callout (accent): "A status column plus timestamps is how almost every workflow app models 'where are we?'. Engineers call it a state machine."
4. **Every step mails a link with the token in it** — code↔English for snippet B (the email with the order link). Then a `step-cards` list of the 5 emails the order half sends: order form link → order confirmation (+ packing-slip style staff email) → "kits have shipped, confirm here" → "thanks, kits received" with the 4 feedback links → staff "order received". Keep each to one line.
5. **Why clicking the link is not enough** — code↔English for snippet C (GET shows a button, POST changes status) with a `callout-warning`: email security scanners open every link in an email, so a GET that changed state would mark kits "received" before the box arrived. Then the **quiz**.

### Code snippets (pre-extracted; copy EXACTLY, do not trim)

Snippet A — File: `src/db.js` (lines 95–101)
```
-- status: form_sent -> ordered -> shipped -> received (or cancelled)
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY, token TEXT UNIQUE NOT NULL,
  facilitator_id INTEGER REFERENCES facilitators(id), program_id INTEGER REFERENCES programs(id),
  status TEXT DEFAULT 'form_sent', shipping_address TEXT, requested_date TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), ordered_at TIMESTAMPTZ, shipped_at TIMESTAMPTZ, received_at TIMESTAMPTZ
);
```

Snippet B — File: `src/routes/orders.js` (lines 124–126), inside the inbound-email handler; `t` is the freshly minted token, `fac` the facilitator row
```
  await sendMail(m.email, 'Your Baby Connections kit order form',
    `Hi ${fac.name || 'there'},\n\nThanks for getting in touch. Please fill out your kit order form here:\n${BASE_URL}/order/${t}\n\nIt takes a couple of minutes: tell us about your program and which kits you need.\n\nBaby Connections team`);
  res.json({ ok: true, orderId, orderLink: `${BASE_URL}/order/${t}` });
```

Snippet C — File: `src/routes/orders.js` (lines 329–337 and 344–349)
```
// Facilitator clicks the link in the shipped email. GET only shows a confirm button: email scanners
// follow links, so the state change happens on POST.
const thanks = (res) => res.send(page('Thank you!', 'Your kit delivery is confirmed. We just emailed you the parent feedback links for your program.'));
const notShipped = (res) => res.status(404).send(page('Not found', 'We could not find a shipped order for this link.'));

orders.get('/received/:token', async (req, res) => {
  const o = await one('SELECT o.*, p.name AS program FROM orders o LEFT JOIN programs p ON p.id=o.program_id WHERE o.token=$1', [req.params.token]);
  if (!o || !['shipped', 'received'].includes(o.status)) return notShipped(res);
  if (o.status === 'received') return thanks(res);
```
```
orders.post('/received/:token', async (req, res) => {
  const o = await one('SELECT * FROM orders WHERE token=$1', [req.params.token]);
  if (!o || !['shipped', 'received'].includes(o.status)) return notShipped(res);
  if (o.status === 'shipped') {
    const claim = await run("UPDATE orders SET status='received', received_at=now() WHERE id=$1 AND status='shipped' RETURNING id", [o.id]);
    if (claim.rows.length) {
```
(Point out in English: the UPDATE has `AND status='shipped'` so two clicks cannot both "win". Engineers call this an atomic claim.)

### Interactive elements
- [x] **Data flow animation** (hero). Actors (ids flow-actor-1..5): 1 "Facilitator" (actor-1 colour), 2 "Email" (actor-4), 3 "Server" (actor-2), 4 "Database" (actor-3), 5 "Staff dashboard" (actor-5). Steps (write as data-steps JSON, no apostrophes):
  1. highlight Facilitator: "Facilitator emails Strong Start asking for kits"
  2. packet Email→Server: "The email provider forwards it to POST /api/inbound-email (a webhook)"
  3. packet Server→Database: "Server creates a facilitator row and an order row with a random token, status form_sent"
  4. packet Server→Email: "Server emails back a personal link: /order/TOKEN"
  5. packet Facilitator→Server: "Facilitator fills in the order form; program and kit lines are saved, status becomes ordered"
  6. highlight Staff dashboard: "Staff see the order on the dashboard and click Mark shipped; status becomes shipped"
  7. packet Server→Email: "Facilitator gets a shipped email with a confirm link; staff get a packing slip with the QR sheet link"
  8. packet Facilitator→Server: "Facilitator presses Yes, the kits arrived (a POST); status becomes received"
  9. packet Server→Email: "Server emails the parent feedback QR link, printable sheet, photo upload and completion report links"
  10. highlight Staff dashboard: "From here on, parent feedback flows into the Programs tab and Insights"
- [x] **Code↔English translation** ×3 (snippets A, B, C).
- [x] **Pattern cards** (4 business steps) and **step cards** (the emails).
- [x] **Quiz** `id="quiz-module1"`, 3 questions, scenario/debugging style:
  1. "A facilitator says: I filled in the order form but nothing happened and now the link says 'This order was already submitted'. What most likely happened?" Options: (a) the database lost the row; (b) **the form had already been submitted once, so the row is in status `ordered` and the server refuses a second submit (409)** — correct; (c) the token expired. Explain: tokens do not expire; the state machine protects against double orders.
  2. "Strong Start wants to add a 'kits returned' step after received. Where does the change start?" Options: (a) **add a new status value and a route that moves `received → returned`, then an email** — correct; (b) a new table; (c) only the dashboard HTML. Explain the state-machine idea.
  3. "An email security scanner at a school district opens every link in every email. Which link in this app is safe for it to open, and why?" Options: (a) none of them; (b) **all of them: links only show pages, and the one that changes state needs a button press (POST)** — correct; (c) only the order form. 
- [x] **Callouts:** one accent (state machine), one warning (GET vs POST).

### Reference files to read
- `docs/course/briefs/00-course-wide.md` (always)
- `docs/course/briefs/content-philosophy.md`, `docs/course/briefs/gotchas.md`
- `docs/course/briefs/interactive-elements.md` → sections: Code ↔ English Translation Blocks, Message Flow / Data Flow Animation, Multiple-Choice Quizzes, Callout Boxes, Pattern/Feature Cards, Numbered Step Cards, Glossary Tooltips
- `docs/course/briefs/design-system.md` → Module Structure only

### Connections
- **Previous:** none; this is the opening module. Start with "what this app does" before any code.
- **Next:** Module 2 "Meet the cast" introduces the files: one Express server, ten routers, one database module, plain HTML pages. End with one line setting that up: "Next: who are the characters that did all this work?"
