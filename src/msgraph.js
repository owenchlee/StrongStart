// Microsoft Graph Outlook integration helper
// Uses client‑credentials flow to obtain an access token and create calendar events.
// Requires environment variables:
//   MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_CALENDAR_ID

let tokenCache = { token: null, expires: 0 };

export async function getGraphToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expires > now + 60_000) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.MS_GRAPH_CLIENT_ID,
    client_secret: process.env.MS_GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  });

  const resp = await fetch(`https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Graph token error: ${data.error_description || data.error}`);
  tokenCache.token = data.access_token;
  tokenCache.expires = now + data.expires_in * 1000;
  return tokenCache.token;
}

/** Create an Outlook calendar event and return its id */
export async function createOutlookEvent({ subject, startUtc, endUtc, attendees }) {
  const token = await getGraphToken();
  const url = `https://graph.microsoft.com/v1.0/users/${process.env.MS_GRAPH_CALENDAR_ID}/calendar/events`;
  const body = {
    subject,
    start: { dateTime: startUtc, timeZone: 'UTC' },
    end: { dateTime: endUtc, timeZone: 'UTC' },
    attendees: attendees.map(a => ({ emailAddress: { address: a.email, name: a.name }, type: 'required' })),
    isReminderOn: true,
    reminderMinutesBeforeStart: 15,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Graph create event error: ${data.error?.message}`);
  return data.id;
}
