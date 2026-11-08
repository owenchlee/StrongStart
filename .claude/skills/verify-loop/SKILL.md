---
name: verify-loop
description: Use before declaring any coding or agent-workflow task done. Runs a layered verification loop (deterministic gates, visual check for UI, static graph check for multi-agent workflows, advisory LLM referee) with attempt caps and stuck detection. Trigger on "done", "finished", "ship", "verify", or after any change to code, UI, or an agent workflow.
---

# verify-loop

You do not decide you are done. The checks do. Work in this order and stop at the first failing layer.

## 0. Contract
Read `.verify/verify.json`. If missing, run `node <skill>/scripts/verify.mjs --init` and review the detected gates with the user. Add a gate for anything the task changes that no gate covers.

## 1. Deterministic gates (always)
Run `node <skill>/scripts/verify.mjs`. It runs gates in order (tests, lint, types, build), stops at the first failure, and records the attempt in `.verify/state.json`.

Exit codes: `0` pass, `1` a gate failed (fix and rerun), `3` stuck (same failure 3 times: change approach or ask the human), `4` attempt cap reached (stop and report).
Never weaken, skip, or delete a gate to make it pass. If a gate is wrong, say so and ask.

## 2. Visual gate (UI changes only)
Start the app, then `node <skill>/scripts/shot.mjs <url> .verify/shots/<name>.png`. It saves a screenshot and prints console errors and failed requests as JSON (exit 1 if any). If a baseline exists, run `node <skill>/scripts/shotdiff.mjs .verify/shots/baseline/<name>.png .verify/shots/<name>.png --threshold 0.5` (exit 1 means the page changed more than the threshold; exit 2 means it could not compare, so say so). Then open the PNG and compare it to the design or the user's description; the diff only tells you something changed, not whether it is right. Save an approved screenshot as the new baseline only when the user agrees. Check layout, empty and error states, and one narrow viewport (`--width 390`). Say what you saw. If you cannot see the page, say the visual check was not done.

## 3. Graph gate (multi-agent workflows only)
Describe the workflow as JSON (see `examples/workflow.json`), or export it as Mermaid (LangGraph: `graph.get_graph().draw_mermaid()`, save as `.mmd`, add `--require-human <exitId>`), and run `node <skill>/scripts/graph-check.mjs workflow.json`. It reports dead-end nodes, nodes and exits unreachable from entry, loops with no way out, and any path from entry to a protected exit that skips a required human approval, with a witness path.

## 4. Proof graph (always, before claiming done)
List every claim you are about to make ("tests pass", "login works") in `.verify/proof.json`, each linked to evidence a script can check: a command that can fail, or a fresh non-empty file such as a screenshot. Claims may depend on other claims. Run `node <skill>/scripts/proof.mjs`.

It re-runs command evidence, rejects rubber-stamp commands (`true`, `echo`), flags files older than your latest source change as stale, fails ungrounded claims and claims whose dependencies failed, and writes `.verify/proof.md`, a green/red Mermaid graph. Paste that graph in your final report. For a test you suspect is weak, add a canary to its evidence: `"canary": {"file": "src/x.js", "find": "a + b", "replace": "a - b"}`. For several mutations use `"canaries": [...]`; every one must be killed. The script breaks that code on purpose and requires the check to then FAIL; if it still passes, the check is vacuous and the claim fails. The file is always restored.
Never edit evidence to make a claim pass; fix the work.

## 5. LLM referee (last, advisory)
Only after layers 1-4 pass: re-read the diff against the user's request and list anything unmet. This layer can add work but can never override a failed gate.

## Reporting
Finish with a short table: layer, command, result. State plainly what was not verified. Do not claim done on a partial pass.

## Enforcement (opt-in)
`node <skill>/scripts/enable-hook.mjs <repo>` adds a Stop hook that blocks stopping while gates fail and feeds the failure back. It allows stopping on chat-only turns, when stuck, or at the attempt cap, so it never traps the agent. Remove with `--remove`.
