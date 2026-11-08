#!/usr/bin/env node
// Proof graph: every completion claim must trace to fresh, machine-checked evidence.
// .verify/proof.json: { claims:[{id,text,evidence:[ids],dependsOn:[claimIds]}],
//   evidence:[{id,kind:"command"|"file",cmd?,path?,expectExit?,canary?:{file,find,replace}, canaries?:[...]}] }
// Usage: node proof.mjs [proof.json]    Writes .verify/proof-report.json and .verify/proof.md (Mermaid).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';

const file = process.argv[2] ?? '.verify/proof.json';
if (!existsSync(file)) { console.error(`No ${file}. Write claims and evidence first (see examples/proof.json).`); process.exit(2); }
const p = JSON.parse(readFileSync(file, 'utf8'));
const claims = p.claims ?? [], evidence = p.evidence ?? [];
const E = Object.fromEntries(evidence.map(e => [e.id, e])), C = Object.fromEntries(claims.map(c => [c.id, c]));
const problems = [];

// Newest changed source file, so older evidence files count as stale.
const changed = spawnSync('git', ['ls-files', '-m', '-o', '--exclude-standard'], { encoding: 'utf8' }).stdout
  .split('\n').filter(f => f && !f.startsWith('.verify/') && existsSync(f));
const newestSrc = Math.max(0, ...changed.map(f => statSync(f).mtimeMs));
const RUBBER = /^\s*(true|:|exit\s+0|echo\b)/;

const ev = {};
for (const e of evidence) {
  let ok = false, note = '';
  if (e.kind === 'command') {
    if (!e.cmd || RUBBER.test(e.cmd)) note = 'rubber-stamp command (cannot fail)';
    else {
      const r = spawnSync(e.cmd, { shell: true, encoding: 'utf8', timeout: 600000 });
      ok = r.status === (e.expectExit ?? 0);
      note = ok ? 'exit ok' : `exit ${r.status}, expected ${e.expectExit ?? 0}`;
      // Canaries: deliberately break the code; a meaningful check must then FAIL every time.
      const canaries = [].concat(e.canaries ?? e.canary ?? []);
      for (let i = 0; ok && i < canaries.length; i++) {
        const { file, find, replace } = canaries[i];
        if (!existsSync(file)) { ok = false; note = `canary file missing: ${file}`; break; }
        const orig = readFileSync(file, 'utf8');
        if (!orig.includes(find)) { ok = false; note = `canary text not found in ${file}`; break; }
        const restore = () => writeFileSync(file, orig);
        process.once('exit', restore);
        try {
          writeFileSync(file, orig.replace(find, replace));
          const b = spawnSync(e.cmd, { shell: true, encoding: 'utf8', timeout: 600000 });
          if (b.status === (e.expectExit ?? 0)) { ok = false; note = `canary ${i + 1}/${canaries.length} survived: check still passes on broken code (vacuous)`; }
        } finally { restore(); process.removeListener('exit', restore); }
      }
      if (ok && canaries.length) note = `exit ok, ${canaries.length} canar${canaries.length > 1 ? 'ies' : 'y'} killed (check detects breakage)`;
    }
  } else if (e.kind === 'file') {
    if (!e.path || !existsSync(e.path)) note = 'file missing';
    else if (statSync(e.path).size === 0) note = 'file empty';
    else if (statSync(e.path).mtimeMs < newestSrc) note = 'stale (older than latest source change)';
    else { ok = true; note = 'fresh'; }
  } else note = `unknown kind "${e.kind}"`;
  ev[e.id] = { ok, note };
}
const used = new Set(claims.flatMap(c => c.evidence ?? []));
for (const e of evidence) if (!used.has(e.id)) problems.push(`orphan evidence (supports no claim): ${e.id}`);

// Claims in dependency order; a claim passes only if its evidence and dependencies pass.
const res = {}, visiting = new Set();
function judge(id) {
  if (res[id]) return res[id].ok;
  if (visiting.has(id)) { problems.push(`dependency cycle at claim ${id}`); return false; }
  visiting.add(id);
  const c = C[id], why = [];
  if (!c.evidence?.length) why.push('ungrounded: no evidence');
  for (const eid of c.evidence ?? []) {
    if (!E[eid]) why.push(`unknown evidence ${eid}`);
    else if (!ev[eid].ok) why.push(`${eid}: ${ev[eid].note}`);
  }
  for (const d of c.dependsOn ?? []) {
    if (!C[d]) why.push(`unknown dependency ${d}`);
    else if (!judge(d)) why.push(`depends on failed claim ${d}`);
  }
  visiting.delete(id);
  res[id] = { ok: why.length === 0, why };
  return res[id].ok;
}
claims.forEach(c => judge(c.id));
if (!claims.length) problems.push('no claims: nothing is being proven');

// Mermaid diagram: evidence -> claim -> dependent claim.
const q = s => `"${String(s).replace(/"/g, "'").slice(0, 60)}"`;
let m = 'flowchart LR\n';
for (const e of evidence) m += `  ${e.id}[${q(e.kind + ': ' + (e.cmd ?? e.path ?? ''))}]:::${ev[e.id].ok ? 'ok' : 'bad'}\n`;
for (const c of claims) m += `  ${c.id}(${q(c.text)}):::${res[c.id].ok ? 'ok' : 'bad'}\n`;
for (const c of claims) {
  for (const eid of c.evidence ?? []) if (E[eid]) m += `  ${eid} --> ${c.id}\n`;
  for (const d of c.dependsOn ?? []) if (C[d]) m += `  ${d} --> ${c.id}\n`;
}
m += '  classDef ok fill:#d4f5dd,stroke:#2a8a4a\n  classDef bad fill:#fbd5d5,stroke:#c0392b\n';
mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/proof.md', '```mermaid\n' + m + '```\n');
const failed = claims.filter(c => !res[c.id].ok);
const report = { ok: !failed.length && !problems.length, claims: res, problems };
writeFileSync('.verify/proof-report.json', JSON.stringify(report, null, 2));
for (const c of claims) console.log(`${res[c.id].ok ? 'PROVEN ' : 'FAILED '} ${c.id}: ${c.text}${res[c.id].why.length ? '\n         ' + res[c.id].why.join('\n         ') : ''}`);
problems.forEach(x => console.log('PROBLEM ' + x));
console.log(report.ok ? '\nAll claims proven. Graph: .verify/proof.md' : '\nNot proven. Do not claim done. Graph: .verify/proof.md');
process.exit(report.ok ? 0 : 1);
