#!/usr/bin/env node
// Static checks on an agent workflow graph. Zero dependencies.
// Input JSON: { nodes:[{id,type:"entry"|"exit"|"agent"|"human"|"gate"}], edges:[{from,to}],
//               requireHuman:[exitId,...] }   // exits that must pass through a human node
import { readFileSync } from 'node:fs';

const g = JSON.parse(readFileSync(process.argv[2] ?? 'workflow.json', 'utf8'));
const ids = new Set(g.nodes.map(n => n.id));
const type = Object.fromEntries(g.nodes.map(n => [n.id, n.type]));
const problems = [];
for (const e of g.edges) for (const k of [e.from, e.to]) if (!ids.has(k)) problems.push(`edge references unknown node "${k}"`);
const out = id => g.edges.filter(e => e.from === id && ids.has(e.to)).map(e => e.to);
const entries = g.nodes.filter(n => n.type === 'entry').map(n => n.id);
const exits = g.nodes.filter(n => n.type === 'exit').map(n => n.id);
if (entries.length !== 1) problems.push(`need exactly one entry node, found ${entries.length}`);

// Set of nodes reachable from start.
function reach(start) {
  const seen = new Set([start]), q = [start];
  while (q.length) for (const n of out(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); }
  return seen;
}
function path(start, goal, banned = new Set()) {
  const prev = new Map([[start, null]]), q = [start];
  while (q.length) { const c = q.shift(); if (c === goal) break;
    for (const n of out(c)) if (!prev.has(n) && !banned.has(n)) { prev.set(n, c); q.push(n); } }
  if (!prev.has(goal)) return null;
  const p = []; for (let c = goal; c !== null; c = prev.get(c)) p.unshift(c); return p;
}

if (entries.length === 1) {
  const seen = reach(entries[0]);
  for (const id of ids) if (!seen.has(id)) problems.push(`unreachable from entry: ${id}`);
  for (const x of exits) if (!seen.has(x)) problems.push(`exit never reachable: ${x}`);
  for (const id of seen) {
    if (type[id] !== 'exit' && out(id).length === 0) problems.push(`dead end (no outgoing edge, not an exit): ${id}`);
    if (type[id] !== 'exit' && !exits.some(x => path(id, x))) problems.push(`trapped (cannot reach any exit): ${id}`);
  }
  const humans = new Set(g.nodes.filter(n => n.type === 'human').map(n => n.id));
  for (const x of g.requireHuman ?? []) {
    if (!exits.includes(x)) { problems.push(`requireHuman names unknown exit "${x}"`); continue; }
    const bypass = path(entries[0], x, humans);
    if (bypass) problems.push(`human approval bypassed for exit "${x}": ${bypass.join(' -> ')}`);
  }
}
if (problems.length) { console.log(JSON.stringify({ ok: false, problems }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ ok: true, nodes: g.nodes.length, edges: g.edges.length }));
