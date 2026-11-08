// Verify database connectivity, schema creation, and TimescaleDB status.
// Usage: node --env-file-if-exists=.env src/scripts/test-db.js
import { dbBackend, isTimescale, hasDailyAggregate, query, one, close } from '../db.js';

console.log('='.repeat(60));
console.log(`Database Backend:   ${dbBackend.toUpperCase()}`);
console.log(`TimescaleDB Active: ${isTimescale ? 'YES' : 'NO'}`);
console.log(`Daily Aggregate:    ${hasDailyAggregate ? 'YES (feedback_daily)' : 'NO'}`);
console.log('='.repeat(60));

try {
  // Query table summary
  const tables = ['facilitators', 'programs', 'orders', 'order_items', 'feedback', 'staff', 'inbound_emails', 'outbox'];
  console.log('\nTable Status:');
  for (const tbl of tables) {
    try {
      const res = await one(`SELECT COUNT(*)::int AS count FROM ${tbl}`);
      console.log(`  ✓ ${tbl.padEnd(16)} (rows: ${res.count})`);
    } catch (err) {
      console.log(`  ✗ ${tbl.padEnd(16)} (error: ${err.message})`);
    }
  }

  if (isTimescale) {
    console.log('\nTimescale Hypertables:');
    try {
      const ht = await query('SELECT hypertable_name FROM timescaledb_information.hypertables');
      ht.forEach((h) => console.log(`  ✓ ${h.hypertable_name}`));
    } catch (err) {
      console.log(`  Unable to query hypertables: ${err.message}`);
    }
  }

  console.log('\nDatabase connection and schema verification successful!\n');
} catch (e) {
  console.error('\nDatabase verification failed:', e.message);
  process.exitCode = 1;
} finally {
  await close();
}
