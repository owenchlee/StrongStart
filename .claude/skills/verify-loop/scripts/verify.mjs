#!/usr/bin/env node
// verify-loop runner: ordered deterministic gates, attempt cap, stuck detection.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), '.verify');
const cfgPath = join(dir, 'verify.json');
const statePath = join(dir, 'state.json');

if (process.argv.includes('--init')) {
  if (existsSync(cfgPath)) { console.log('verify.json already exists, leaving it alone'); process.exit(0); }
  const gates = [];
  if (existsSync('package.json')) {
    const s = JSON.parse(readFileSync('package.json', 'utf8')).scripts || {};
    for (const n of ['lint', 'typecheck', 'test', 'build']) if (s[n]) gates.push({ name: n, cmd: `npm run ${n}` });
  }
  if (!gates.length) console.log('No gates detected. Edit .verify/verify.json and add your own.');
  mkdirSync(dir, { recursive: true });
  writeFileSync(cfgPath, JSON.stringify({ maxAttempts: 5, stuckAfter: 3, gates }, null, 2) + '\n');
  writeFileSync(join(dir, '.gitignore'), 'state.json\nshots/\n');
  console.log(`Wrote ${cfgPath} with ${gates.length} gate(s).`);
  process.exit(0);
}

if (!existsSync(cfgPath)) { console.error('No .verify/verify.json. Run with --init.'); process.exit(2); }
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const maxAttempts = cfg.maxAttempts ?? 5, stuckAfter = cfg.stuckAfter ?? 3;
if (!cfg.gates?.length) { console.error('No gates configured: nothing is being verified.'); process.exit(2); }

let state = { attempts: 0, lastFingerprint: null, repeats: 0 };
try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch {}
if (state.attempts >= maxAttempts) {
  console.error(`Attempt cap (${maxAttempts}) reached. Stop and report to the human. Delete .verify/state.json to reset.`);
  process.exit(4);
}
state.attempts++;

for (const g of cfg.gates) {
  process.stdout.write(`gate ${g.name}: ${g.cmd}\n`);
  const r = spawnSync(g.cmd, { shell: true, encoding: 'utf8', timeout: (g.timeoutSec ?? 600) * 1000 });
  if (r.status === 0) { console.log('  pass'); continue; }
  const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-40).join('\n');
  // Fingerprint ignores digits so timings and line counters don't hide a repeat.
  const fp = createHash('sha1').update(g.name + out.replace(/\d+/g, '#')).digest('hex');
  state.repeats = fp === state.lastFingerprint ? state.repeats + 1 : 1;
  state.lastFingerprint = fp;
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state));
  console.log(`  FAIL (exit ${r.status}). Last output:\n${out}`);
  if (state.repeats >= stuckAfter) {
    console.error(`\nSTUCK: same failure ${state.repeats} times. Change approach or ask the human.`);
    process.exit(3);
  }
  console.error(`\nAttempt ${state.attempts}/${maxAttempts}. Fix the failure and rerun.`);
  process.exit(1);
}
rmSync(statePath, { force: true });
console.log('\nAll gates passed.');
