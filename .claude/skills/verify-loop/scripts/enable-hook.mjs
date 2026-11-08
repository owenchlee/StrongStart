#!/usr/bin/env node
// Opt-in: adds the Stop hook to <repo>/.claude/settings.json. Usage: node enable-hook.mjs <repo> [--remove]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const repo = process.argv[2];
if (!repo) { console.error('usage: enable-hook.mjs <repo> [--remove]'); process.exit(2); }
const f = join(repo, '.claude', 'settings.json');
const cmd = 'node "$CLAUDE_PROJECT_DIR/.claude/skills/verify-loop/scripts/stop-gate.mjs"';
let s = {}; if (existsSync(f)) s = JSON.parse(readFileSync(f, 'utf8'));
s.hooks ??= {}; s.hooks.Stop ??= [];
s.hooks.Stop = s.hooks.Stop.filter(g => !g.hooks?.some(h => h.command?.includes('verify-loop')));
if (!process.argv.includes('--remove')) s.hooks.Stop.push({ hooks: [{ type: 'command', command: cmd }] });
if (!s.hooks.Stop.length) delete s.hooks.Stop; if (!Object.keys(s.hooks).length) delete s.hooks;
mkdirSync(join(repo, '.claude'), { recursive: true });
writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
console.log(process.argv.includes('--remove') ? 'hook removed' : `hook enabled in ${f}`);
