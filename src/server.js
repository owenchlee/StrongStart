import express from 'express';
import { orders } from './routes/orders.js';
import { feedback } from './routes/feedback.js';
import { dashboard } from './routes/dashboard.js';
import { voice } from './routes/voice.js';
import { compose } from './routes/compose.js';
import { partners } from './routes/partners.js';
import { programsRouter } from './routes/programs.js';
import { trainingRouter } from './routes/training.js';
import { resourcesRouter } from './routes/resources.js';
import { meetRouter } from './routes/meet.js';
import { aiEnabled } from './ai.js';
import { auth, requireStaff } from './auth.js';
import { dbBackend, isTimescale } from './db.js';

export const app = express();
// Behind a reverse proxy (Caddy, etc.) the client IP comes from X-Forwarded-For; needed for per-IP rate limits.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
else if ((process.env.BASE_URL || '').startsWith('https:')) app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false })); // inbound-email webhooks often post form data
app.use(auth);        // /auth/*, /api/me: must come before the gate
app.use(requireStaff); // default-deny for the dashboard page and /api (before static serves index.html)
app.use(express.static('public'));
app.use(orders, feedback, dashboard, voice, compose, partners, programsRouter, trainingRouter, resourcesRouter, meetRouter);

app.use((err, _req, res, _next) => {
  // Client mistakes (malformed JSON, body too large) are 4xx, not server errors.
  if (err?.expose && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.status === 413 ? 'Request too large' : 'Invalid request' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    const persisted = process.env.PGLITE_DIR ? ' (persisted)' : ' (in-memory, resets on restart)';
    console.log(`StrongStart running at http://localhost:${port}`);
    console.log(`  AI (Gemini): ${aiEnabled ? 'on' : 'OFF (set GEMINI_API_KEY)'}`);
    console.log(`  Database: ${dbBackend === 'tiger' ? 'Tiger Data / Postgres' : 'local PGlite' + persisted}${isTimescale ? ' + TimescaleDB' : ''}`);
  });
}
