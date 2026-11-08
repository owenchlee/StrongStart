// Availability maths for the "let us meet" scheduler. No dependencies: time zones go through Intl.

export const SLOT_MINUTES = 30;     // length of a training meeting and the step between start times
export const HORIZON_DAYS = 14;     // how far ahead a link offers times
export const LEAD_MS = 2 * 3600e3;  // never offer a time that starts sooner than this

export const validTimeZone = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length > 0; } catch { return false; }
};

/** Offset (local minus UTC, in ms) of `tz` at the UTC instant `utcMs`. */
function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads y-m-d plus `min` minutes (month is 0-based). */
export function zonedToUtc(y, m, d, min, tz) {
  const guess = Date.UTC(y, m, d, 0, min);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz); // second pass settles DST edges
}

const localYmd = (ms, tz) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return [g('year'), g('month') - 1, g('day')];
};

export const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
/** Today's calendar date ('YYYY-MM-DD') in time zone `tz`. */
export function localDate(tz, now = Date.now()) { const [y, m, d] = localYmd(now, tz); return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10); }

/**
 * Every start time (ISO, UTC) the host is free for a meeting.
 * windows: [{ weekday: 0-6 (Sun=0), start_min, end_min }] in the host's time zone `tz`.
 * busy: [{ start: Date|ms, end: Date|ms }] meetings the host already has.
 */
export function generateSlots({ windows, tz, now = Date.now(), busy = [], days = HORIZON_DAYS, overrides = {} }) { // overrides: { 'YYYY-MM-DD': [{ weekday, start_min, end_min }] }
  const [y, m, d] = localYmd(now, tz);
  const busyMs = busy.map((b) => [+new Date(b.start), +new Date(b.end)]);
  const out = [];
  for (let i = 0; i <= days; i++) {
    const day = new Date(Date.UTC(y, m, d + i));
    const weekday = day.getUTCDay();
    // a custom day replaces the standard week's windows for that date
    for (const w of overrides[day.toISOString().slice(0, 10)] ?? windows) {
      if (w.weekday !== weekday) continue;
      for (let min = w.start_min; min + SLOT_MINUTES <= w.end_min; min += SLOT_MINUTES) {
        const start = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), min, tz);
        const end = start + SLOT_MINUTES * 60e3;
        if (start < now + LEAD_MS) continue;
        if (busyMs.some(([bs, be]) => start < be && end > bs)) continue;
        out.push(new Date(start).toISOString());
      }
    }
  }
  return [...new Set(out)].sort();
}

export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const parseHhmm = (s) => {
  if (s === '24:00') return 1440; // end of day
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
