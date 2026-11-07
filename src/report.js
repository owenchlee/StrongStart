import { one, query } from './db.js';
import { summarizeComments } from './ai.js';

export async function programReport(programId) {
  const id = Number(programId);
  if (!Number.isInteger(id)) return null;
  const program = await one('SELECT * FROM programs WHERE id=$1', [id]);
  if (!program) return null;
  const rows = await query('SELECT * FROM feedback WHERE program_id=$1 ORDER BY id', [id]);

  const rated = rows.filter((r) => r.rating != null);
  const rec = rows.filter((r) => r.would_recommend != null);
  const comments = rows.flatMap((r) => [r.most_valued, r.suggestions]).filter((t) => t && t.trim());

  const dist = [1, 2, 3, 4, 5].map((n) => ({ rating: n, count: rated.filter((r) => r.rating === n).length }));

  let summary = null;
  if (comments.length) summary = await Promise.resolve(summarizeComments(program.name, comments)).catch(() => null);

  return {
    program,
    responses: rows.length,
    bySource: {
      qr: rows.filter((r) => r.source === 'qr').length,
      photo: rows.filter((r) => r.source === 'photo').length,
      voice: rows.filter((r) => r.source === 'voice').length,
    },
    needsReview: rows.filter((r) => r.needs_review).length,
    responseRate: program.projected_participants ? Math.round((rows.length / program.projected_participants) * 100) : null,
    avgRating: rated.length ? +(rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(2) : null,
    ratingDistribution: dist,
    recommendPct: rec.length ? Math.round((rec.filter((r) => r.would_recommend).length / rec.length) * 100) : null,
    comments: rows
      .filter((r) => (r.most_valued && r.most_valued.trim()) || (r.suggestions && r.suggestions.trim()))
      .map((r) => ({ id: r.id, source: r.source, most_valued: r.most_valued, suggestions: r.suggestions, needs_review: !!r.needs_review, translated_text: r.translated_text, language: r.language })),
    summary: summary || null,
  };
}

// ---- CSV helpers ------------------------------------------------------------------------------
/** One CSV cell: neutralises spreadsheet formulas (=, +, -, @, tab, CR prefixes) and quotes safely. */
export function csvCell(v) {
  if (v == null) return '';
  if (v instanceof Date) v = v.toISOString();
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (columns, rows) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
