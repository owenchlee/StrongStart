// Google Calendar: connect a staff member's calendar (OAuth, offline access) and create events with a Google Meet link.
// Uses the same OAuth client as staff login (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) with the Calendar API enabled.
import { randomUUID } from 'node:crypto';
import { BASE_URL } from './util.js';

export const CAL_REDIRECT_URI = `${BASE_URL}/api/google/calendar/callback`;
export const calendarConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function calendarAuthUrl(state, loginHint) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: CAL_REDIRECT_URI, response_type: 'code', state,
    scope: 'openid email https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google token error: ${data.error_description || data.error || r.status}`);
  return data;
}

/** Exchange the OAuth code; returns { refreshToken, account } (account = the Google email that was connected). */
export async function exchangeCalendarCode(code) {
  const data = await tokenRequest({ code, redirect_uri: CAL_REDIRECT_URI, grant_type: 'authorization_code' });
  if (!data.refresh_token) throw new Error('Google did not return a refresh token');
  let account = null;
  try { account = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString()).email || null; } catch { /* optional */ }
  return { refreshToken: data.refresh_token, account };
}

/** Creates the event on the connected account's primary calendar. Google emails the invitation to the attendees. */
export async function createMeetEvent({ refreshToken, summary, description, startIso, endIso, attendeeEmails }) {
  const { access_token } = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary, description,
      start: { dateTime: startIso }, end: { dateTime: endIso },
      attendees: attendeeEmails.map((email) => ({ email })),
      conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      reminders: { useDefault: true },
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Calendar error: ${data.error?.message || r.status}`);
  const meetLink = data.hangoutLink || data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null;
  return { eventId: data.id, meetLink };
}
