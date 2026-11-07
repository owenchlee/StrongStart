# StrongStart: Baby Connections dashboard

Connects Baby Connections facilitators with the Strong Start team: kit orders by email, order/delivery emails, parent feedback by QR code or photo (AI reads handwriting), and automatic program feedback reports.

```bash
npm install
cp .env.example .env   # optional: add ANTHROPIC_API_KEY, SMTP settings
npm run dev            # http://localhost:3000
npm test               # end-to-end smoke test
```

## The workflow
1. A facilitator emails in → `POST /api/inbound-email` (connect your email provider's inbound webhook here).
2. They get an emailed link to a personal **kit order form** (`/order/:token`).
3. Submitting it sends an **order confirmation**; staff click "Mark shipped" on the dashboard, the facilitator gets a **"confirm you received it"** link, and clicking it sends the **kits received** emails.
4. Parents give feedback by **scanning the program's QR code** (`/feedback/:programId`) or the facilitator **uploads photos of paper forms** (`/upload/:programId`); Claude transcribes the handwriting and anything unclear goes to the **Review queue**.
5. Everything is stored in SQLite (`data/`) and rolled into a **program report** on the dashboard.

Without SMTP configured, emails are logged to the dashboard's Emails tab instead of being sent. See [WORKLOAD.md](WORKLOAD.md) for how the work is split between three people.
