// Step 5: store everything in the database and generate program feedback reports.
import { Router } from 'express';
import { db } from '../db.js';
import { programReport } from '../report.js';
import { aiEnabled } from '../ai.js';

export const dashboard = Router();

dashboard.get('/api/overview', (_req, res) => {
  const n = (sql) => db.prepare(sql).get().n;
  res.json({
    aiEnabled,
    facilitators: n('SELECT COUNT(*) n FROM facilitators'),
    openOrders: n("SELECT COUNT(*) n FROM orders WHERE status IN ('ordered','shipped')"),
    programs: n('SELECT COUNT(*) n FROM programs'),
    feedbackResponses: n('SELECT COUNT(*) n FROM feedback'),
    needsReview: n('SELECT COUNT(*) n FROM feedback WHERE needs_review=1'),
  });
});

dashboard.get('/api/programs', (_req, res) => {
  res.json(db.prepare(`SELECT p.*, f.name AS facilitator, f.email,
      (SELECT COUNT(*) FROM feedback WHERE program_id=p.id) AS responses,
      (SELECT ROUND(AVG(rating),2) FROM feedback WHERE program_id=p.id) AS avg_rating,
      (SELECT COUNT(*) FROM feedback WHERE program_id=p.id AND needs_review=1) AS needs_review
    FROM programs p JOIN facilitators f ON f.id=p.facilitator_id ORDER BY p.id DESC`).all());
});

dashboard.get('/api/programs/:id/report', async (req, res) => {
  const r = await programReport(req.params.id);
  r ? res.json(r) : res.sendStatus(404);
});

dashboard.get('/api/review-queue', (_req, res) => {
  res.json(db.prepare('SELECT f.*, p.name AS program FROM feedback f JOIN programs p ON p.id=f.program_id WHERE needs_review=1 ORDER BY f.id').all());
});

dashboard.get('/api/emails', (_req, res) => {
  res.json({
    inbound: db.prepare('SELECT * FROM inbound_emails ORDER BY id DESC LIMIT 50').all(),
    outbox: db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 50').all(),
  });
});
