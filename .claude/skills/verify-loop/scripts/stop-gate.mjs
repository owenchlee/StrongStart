#!/usr/bin/env node
// Claude Code Stop hook: blocks the agent from stopping while verification fails.
// Exit 2 + stderr = block and feed the failure back. Exit 0 = allow stop.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let input = {};
try { input = JSON.parse(await new Promise(r => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => r(d || '{}')); })); } catch {}
const cwd = input.cwd || process.cwd();
process.chdir(cwd);
if (!existsSync('.verify/verify.json')) process.exit(0);
// Chat-only turn (no changes outside .verify): nothing to verify.
const st = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (st.status === 0 && !st.stdout.split('\n').some(l => l.trim() && !l.slice(3).startsWith('.verify/'))) process.exit(0);

const r = spawnSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'verify.mjs')], { encoding: 'utf8' });
if (r.status === 0) process.exit(0);
if (r.status === 3 || r.status === 4) { // stuck or capped: do not trap the agent; the human must step in
  console.error('verify-loop: ' + (r.status === 3 ? 'stuck' : 'attempt cap reached') + '. Allowing stop. Tell the user plainly that verification is failing.');
  process.exit(0);
}
console.error('verify-loop: verification failed, you are not done.\n' + (r.stdout + r.stderr).slice(-3000));
process.exit(2);
