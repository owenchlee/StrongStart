import express from 'express';
import { orders } from './routes/orders.js';
import { feedback } from './routes/feedback.js';
import { dashboard } from './routes/dashboard.js';
import { aiEnabled } from './ai.js';

export const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false })); // inbound-email webhooks often post form data
app.use(express.static('public'));
app.use(orders, feedback, dashboard);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`StrongStart running at http://localhost:${port}  (AI handwriting: ${aiEnabled ? 'on' : 'OFF - set ANTHROPIC_API_KEY'})`));
}
