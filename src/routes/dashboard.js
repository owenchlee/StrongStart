// Staff dashboard data API: overview, programs, reports, trends, rollups, exports, staff management.
// Everything here is behind the default-deny staff gate in auth.js.
import { Router } from 'express';
import { query, one, run, isTimescale, hasDailyAggregate } from '../db.js';
import { programReport, toCsv } from '../report.js';
import { aiEnabled } from '../ai.js';

export const dashboard = Router();

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const intOrNull = (s) => (/^\d+$/.test(String(s ?? '')) ? Number(s) : null);

dashboard.get('/api/overview', async (_req, res) => {
  const n = async (sql) => (await one(sql)).n;
  res.json({
    aiEnabled,
    partners: await n('SELECT COUNT(*)::int n FROM partners'),
    activePartners: await n("SELECT COUNT(*)::int n FROM partners WHERE stage='active'"),
    facilitators: await n('SELECT COUNT(*)::int n FROM facilitators'),
    openOrders: await n("SELECT COUNT(*)::int n FROM orders WHERE status IN ('ordered','shipped')"),
    programs: await n('SELECT COUNT(*)::int n FROM programs'),
    completedPrograms: await n("SELECT COUNT(*)::int n FROM programs WHERE status='completed'"),
    feedbackResponses: await n('SELECT COUNT(*)::int n FROM feedback'),
    needsReview: await n('SELECT COUNT(*)::int n FROM feedback WHERE needs_review=true'),
  });
});

// Programs, optionally filtered: ?from=YYYY-MM-DD&to=YYYY-MM-DD (program start date, falling back to
// when the program was created) and ?facilitator=<id>.
async function programRows(q) {
  const where = [], params = [];
  const when = "COALESCE(NULLIF(p.start_date,''), to_char(p.created_at,'YYYY-MM-DD'))";
  if (isDate(q.from)) { params.push(q.from); where.push(`${when} >= $${params.length}`); }
  if (isDate(q.to)) { params.push(q.to); where.push(`${when} <= $${params.length}`); }
  const fid = intOrNull(q.facilitator);
  if (fid != null) { params.push(fid); where.push(`p.facilitator_id = $${params.length}`); }
  const pid = intOrNull(q.partner);
  if (pid != null) { params.push(pid); where.push(`(p.partner_id = $${params.length} OR f.partner_id = $${params.length})`); }
  const status = typeof q.status === 'string' && ['scheduled', 'in_progress', 'completed', 'cancelled'].includes(q.status) ? q.status : null;
  if (status) { params.push(status); where.push(`p.status = $${params.length}`); }

  return query(`SELECT p.*, f.name AS facilitator, f.email, COALESCE(part.name, f.organization) AS partner_name,
      COALESCE(s.responses,0)::int AS responses, ROUND(s.avg_rating::numeric,2)::float8 AS avg_rating,
      COALESCE(s.needs_review,0)::int AS needs_review,
      pc.id AS completion_id, pc.families_served, pc.kits_distributed, pc.submitted_at AS completion_date
    FROM programs p
    JOIN facilitators f ON f.id=p.facilitator_id
    LEFT JOIN partners part ON part.id=COALESCE(p.partner_id, f.partner_id)
    LEFT JOIN program_completions pc ON pc.program_id=p.id
    LEFT JOIN (SELECT program_id, COUNT(*) AS responses, AVG(rating) AS avg_rating,
                      COUNT(*) FILTER (WHERE needs_review) AS needs_review
               FROM feedback GROUP BY program_id) s ON s.program_id=p.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC`, params);
}
dashboard.get('/api/programs', async (req, res) => res.json(await programRows(req.query)));

dashboard.get('/api/programs/:id/report', async (req, res) => {
  const r = await programReport(req.params.id);
  r ? res.json(r) : res.sendStatus(404);
});

dashboard.get('/api/review-queue', async (_req, res) => {
  res.json(await query(`SELECT f.id, f.program_id, f.source, f.rating, f.would_recommend, f.most_valued, f.suggestions,
      f.raw_text, f.image_path, f.image_url, f.language, f.translated_text, f.summary, f.audio_transcript, f.needs_review, f.created_at,
      p.name AS program
    FROM feedback f JOIN programs p ON p.id=f.program_id WHERE f.needs_review=true ORDER BY f.id`));
});

dashboard.get('/api/emails', async (_req, res) => {
  res.json({
    inbound: await query('SELECT * FROM inbound_emails ORDER BY id DESC LIMIT 50'),
    outbox: await query('SELECT * FROM outbox ORDER BY id DESC LIMIT 50'),
  });
});

// ---- trends -----------------------------------------------------------------------------------
dashboard.get('/api/trends', async (req, res) => {
  const days = Math.min(730, Math.max(1, intOrNull(req.query.days) ?? 90));
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
  const delivery = await query(`SELECT (received_at AT TIME ZONE 'UTC')::date::text AS day, COUNT(*)::int AS orders,
      AVG(EXTRACT(EPOCH FROM (received_at - ordered_at))/86400)::float8 AS avg_days
    FROM orders WHERE received_at IS NOT NULL AND ordered_at IS NOT NULL AND received_at >= now() - make_interval(days => $1)
    GROUP BY 1 ORDER BY 1`, [days]);
  const overall = await one(`SELECT AVG(EXTRACT(EPOCH FROM (received_at - ordered_at))/86400)::float8 AS avg_days, COUNT(*)::int AS orders
    FROM orders WHERE received_at IS NOT NULL AND ordered_at IS NOT NULL`);
  const byStatus = await query('SELECT status, COUNT(*)::int AS orders FROM orders GROUP BY status ORDER BY status');
  res.json({
    days, source,
    responsesPerDay: perDay.map((d) => ({ day: d.day, responses: d.responses })),
    avgRatingPerDay: perDay.filter((d) => d.avg_rating != null).map((d) => ({ day: d.day, avg_rating: +d.avg_rating.toFixed(2) })),
    orderToDelivery: { avgDays: overall.avg_days == null ? null : +overall.avg_days.toFixed(2), orders: overall.orders,
      perDay: delivery.map((d) => ({ day: d.day, orders: d.orders, avg_days: +d.avg_days.toFixed(2) })) },
    ordersByStatus: byStatus,
  });
});

// ---- rollup & outstanding ---------------------------------------------------------------------
dashboard.get('/api/rollup', async (_req, res) => {
  const byFacilitator = await query(`SELECT f.id, f.name, f.email, f.organization,
      COALESCE(pr.programs,0)::int AS programs, COALESCE(pr.projected,0)::int AS projected_participants,
      COALESCE(fb.responses,0)::int AS responses, ROUND(fb.avg_rating::numeric,2)::float8 AS avg_rating,
      ROUND(fb.recommend_pct::numeric)::int AS recommend_pct
    FROM facilitators f
    LEFT JOIN (SELECT facilitator_id, COUNT(*) AS programs, SUM(projected_participants) AS projected
               FROM programs GROUP BY facilitator_id) pr ON pr.facilitator_id=f.id
    LEFT JOIN (SELECT p.facilitator_id, COUNT(*) AS responses, AVG(x.rating) AS avg_rating,
                      100.0*COUNT(*) FILTER (WHERE x.would_recommend)/NULLIF(COUNT(x.would_recommend),0) AS recommend_pct
               FROM feedback x JOIN programs p ON p.id=x.program_id GROUP BY p.facilitator_id) fb ON fb.facilitator_id=f.id
    ORDER BY responses DESC, f.name`);
  const t = await one(`SELECT (SELECT COUNT(*)::int FROM programs) AS programs,
      (SELECT COALESCE(SUM(projected_participants),0)::int FROM programs) AS projected_participants,
      (SELECT COUNT(*)::int FROM facilitators) AS facilitators,
      COUNT(*)::int AS responses, ROUND(AVG(rating)::numeric,2)::float8 AS avg_rating,
      ROUND((100.0*COUNT(*) FILTER (WHERE would_recommend)/NULLIF(COUNT(would_recommend),0))::numeric)::int AS recommend_pct
    FROM feedback`);
  res.json({ totals: t, byFacilitator });
});

dashboard.get('/api/outstanding', async (_req, res) => {
  res.json(await query(`SELECT p.id, p.token, p.name, p.location, p.start_date, p.end_date, p.projected_participants,
      f.name AS facilitator, f.email, COUNT(fb.id)::int AS responses,
      (p.projected_participants - COUNT(fb.id))::int AS gap
    FROM programs p JOIN facilitators f ON f.id=p.facilitator_id LEFT JOIN feedback fb ON fb.program_id=p.id
    WHERE p.projected_participants IS NOT NULL AND p.projected_participants > 0
    GROUP BY p.id, f.id HAVING COUNT(fb.id) < p.projected_participants
    ORDER BY (p.projected_participants - COUNT(fb.id)) DESC, p.id`));
});

// ---- CSV exports ------------------------------------------------------------------------------
function sendCsv(res, name, body) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
  res.send(body);
}
dashboard.get('/api/export/programs.csv', async (req, res) => {
  const rows = await programRows(req.query);
  sendCsv(res, 'programs.csv', toCsv(
    ['id', 'name', 'location', 'facilitator', 'email', 'partner_name', 'delivery_format', 'status', 'start_date', 'end_date', 'projected_participants', 'families_served', 'kits_distributed', 'responses', 'avg_rating', 'needs_review', 'created_at'], rows));
});
dashboard.get('/api/export/feedback.csv', async (_req, res) => {
  const rows = await query(`SELECT fb.id, p.name AS program, f.name AS facilitator, fb.source, fb.rating, fb.would_recommend,
      fb.most_valued, fb.suggestions, fb.language, fb.translated_text, fb.needs_review, fb.created_at
    FROM feedback fb JOIN programs p ON p.id=fb.program_id JOIN facilitators f ON f.id=p.facilitator_id ORDER BY fb.id`);
  sendCsv(res, 'feedback.csv', toCsv(
    ['id', 'program', 'facilitator', 'source', 'rating', 'would_recommend', 'most_valued', 'suggestions', 'language', 'translated_text', 'needs_review', 'created_at'], rows));
});

// ---- staff management (admins only) -----------------------------------------------------------
const adminOnly = (req, res, next) =>
  req.staff?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' });

dashboard.get('/api/staff', adminOnly, async (_req, res) => {
  res.json(await query('SELECT id, email, name, role, active, last_login_at, created_at FROM staff ORDER BY active DESC, lower(email)'));
});

dashboard.post('/api/staff', adminOnly, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 200) || null;
  const role = req.body?.role === 'admin' ? 'admin' : 'staff';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address' });
  const row = await one(`INSERT INTO staff (email, name, role) VALUES ($1,$2,$3)
    ON CONFLICT (lower(email)) DO UPDATE SET active=true, role=excluded.role, name=COALESCE(excluded.name, staff.name)
    RETURNING id, email, name, role, active`, [email, name, role]);
  res.json(row);
});

dashboard.post('/api/staff/:id/deactivate', adminOnly, async (req, res) => {
  const id = intOrNull(req.params.id);
  if (id == null) return res.status(404).json({ error: 'No such staff member' });
  if (id === req.staff.id) return res.status(400).json({ error: "You can't deactivate yourself" });
  const r = await run('UPDATE staff SET active=false WHERE id=$1', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'No such staff member' });
  await run('DELETE FROM sessions WHERE staff_id=$1', [id]);
  res.json({ ok: true });
});
