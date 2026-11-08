# Course-wide notes (read first, every module writer)

**Course:** "Inside StrongStart" — an interactive course that teaches the owner of this codebase how it works so they can talk about it fluently and answer questions from hackathon judges and engineers. Seven modules. Output directory: `docs/course/`.

**The learner:** built this app with AI coding tools during a hackathon (Nov 2026). Knows the *product* well, has a vague picture of the code. Zero CS assumed: tooltip every technical term on first use in your module. The learner will use this course to *explain the project out loud*, so favour sentences they could repeat to a judge.

**What the app is (use these words):** StrongStart is a charity. Its **Baby Connections** program works through a kit-and-training pipeline:
1. A **facilitator** (someone at a partner organisation such as a library or community centre) emails Strong Start to ask for a **kit** (physical materials plus tutorial classes).
2. The facilitator gets **trained** (self-service training registration, a scheduled Google Meet, a digital certificate).
3. The facilitator runs the program with children and their parents, using the kit.
4. When a child finishes the lesson, the **parents report how it went**: by scanning a QR code and filling a short form, by speaking an answer, or by handing in a paper form that the facilitator photographs. AI reads the handwriting and translates it.
5. **Strong Start staff** see all of it on one dashboard: orders to ship, forms to review, trends and rollup reports for funders.

The pitch angle: the site *closes the loop*, getting parent-reported outcomes back to Strong Start with very little effort from anyone.

**Tech stack (one line each, tooltip them in your module):** Node.js 22 (JavaScript on the server), Express 5 (web framework), plain HTML pages with vanilla JavaScript (no React, no build step), PostgreSQL via **PGlite** locally (an in-process Postgres) or **Tiger Data** in production (hosted Postgres with the TimescaleDB extension), Google **Gemini** for all AI, **ElevenLabs** for all audio, **Cloudinary** for all images, nodemailer for email, multer for file uploads, sharp for image maths, qrcode for QR codes.

**Actor colours (use consistently in chats, flows and diagrams):**
- `--color-actor-1` (vermillion) = **Facilitator / Parent** (the people outside the building, using links)
- `--color-actor-2` (teal) = **The server** (Express, `src/server.js` and `src/routes/*`)
- `--color-actor-3` (plum) = **The database** (PGlite or Tiger Data, `src/db.js`)
- `--color-actor-4` (gold) = **Outside services** (Gemini, ElevenLabs, Cloudinary, Google, email)
- `--color-actor-5` (forest) = **Staff dashboard** (`public/index.html`)

**Accent colour:** teal (`--color-accent` is `#2A7B9B`). Module backgrounds: odd modules `var(--color-bg-warm)`, even modules `var(--color-bg)`.

**Metaphors already taken (do NOT reuse):** parcel tracking number (M1), telephone switchboard (M2), museum wristband vs staff badge (M3), pharmacist reading a prescription (M4), orchestra where each instrument has one part (M5), seedlings in a windowsill pot vs the same seeds in a field (M6), a tour guide's answer sheet (M7). Never use "restaurant" or "kitchen".

**Hard rules (from gotchas.md):**
- Code snippets are copied EXACTLY from the brief, never shortened or tidied. Keep the file path and line numbers visible as a small label above or inside each translation block (e.g. a `<p class="screen-heading">`-adjacent `<small>` or inside the `translation-label`), so the learner can open the real file.
- Every `.flow-animation` needs `data-steps='[...]'` JSON with NO single quotes inside labels (use double quotes delimiting the attribute only once; write "do not" instead of "don't").
- Every `.chat-window` needs a unique `id`. Quiz containers need unique ids. Drag-and-drop containers need unique ids (checkDnD(id)).
- Module file contains only `<section class="module" id="module-N" style="background: var(--color-bg-warm)">…</section>`. No html/head/body/style/script.
- Max 2–3 sentences per paragraph; every screen ≥ 50% visual.
- Tooltips: `<span class="term" data-definition="…">word</span>`; every technical term, first use per module, including: server, route, endpoint, API, token, database, SQL, table, row, column, JSON, HTTP, GET/POST, cookie, session, middleware, webhook, environment variable, async/await, regex, OCR, prompt, schema, transaction, hypertable, continuous aggregate, CSV, rate limit, hash, OAuth, etc.
- HTML-escape code: `<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;` inside `<code>`.
- Quizzes test application (scenarios, debugging, decisions), never definitions or file-name recall. 3–4 questions, encouraging feedback.
