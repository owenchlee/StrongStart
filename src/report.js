import { db } from './db.js';
import { summarizeComments } from './ai.js';

export async function programReport(programId) {
  const program = db.prepare('SELECT * FROM programs WHERE id=?').get(programId);
  if (!program) return null;
  const rows = db.prepare('SELECT * FROM feedback WHERE program_id=? ORDER BY id').all(programId);

  const rated = rows.filter((r) => r.rating != null);
  const rec = rows.filter((r) => r.would_recommend != null);
  const comments = rows.flatMap((r) => [r.most_valued, r.suggestions]).filter((t) => t && t.trim());

  const dist = [1, 2, 3, 4, 5].map((n) => ({ rating: n, count: rated.filter((r) => r.rating === n).length }));

  return {
    program,
    responses: rows.length,
    bySource: { qr: rows.filter((r) => r.source === 'qr').length, photo: rows.filter((r) => r.source === 'photo').length },
    needsReview: rows.filter((r) => r.needs_review).length,
    responseRate: program.projected_participants ? Math.round((rows.length / program.projected_participants) * 100) : null,
    avgRating: rated.length ? +(rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(2) : null,
    ratingDistribution: dist,
    recommendPct: rec.length ? Math.round((rec.filter((r) => r.would_recommend).length / rec.length) * 100) : null,
    comments: rows
      .filter((r) => (r.most_valued && r.most_valued.trim()) || (r.suggestions && r.suggestions.trim()))
      .map((r) => ({ id: r.id, source: r.source, most_valued: r.most_valued, suggestions: r.suggestions, needs_review: !!r.needs_review })),
    summary: await summarizeComments(program.name, comments).catch(() => null),
  };
}
