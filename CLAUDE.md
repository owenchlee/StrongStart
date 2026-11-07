
<!-- verify-loop -->
## Verification (verify-loop)
Before saying a task is done, run the `verify-loop` skill: `node .claude/skills/verify-loop/scripts/verify.mjs`.
Do not weaken or skip gates in `.verify/verify.json`. If it exits 3 (stuck) or 4 (cap), stop and ask.
UI changes also need a screenshot check; multi-agent workflows need `graph-check.mjs`. Report what was not verified.
<!-- verify-loop -->
