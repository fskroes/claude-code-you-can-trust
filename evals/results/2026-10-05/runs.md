# Eval runs on 2026-10-05

Every run of `evals/run.mjs` on the day the companion was built, in order, with
the summary line each one printed. Claude Code 2.1.289. Costs are the estimates
`claude -p` reported.

1. All four evals, first version.
   - `PASS context #1: NONE ($0.07)`
   - `PASS guard #1: blocked=true committed=false ($0.08)`
   - `FAIL stop-gate #1: tests pass at the end: false; turns 9 ($0.15)`
   - `FAIL triage #1: site-down=REPRODUCED links-expire=undefined ($0.25)`
   The triage eval leaked its answer (a commit named "bring back the newline bug",
   the patch file, the failing regression tests), and the second report's answer
   began with "**NOT REPRODUCED**", which the script did not read as a verdict.
2. `--only stop-gate`, with the Stop hook's early exit on `stop_hook_active` put
   back on purpose, to test the explanation for run 1.
   - `FAIL stop-gate #1: tests pass at the end: false; gate: block,pass; turns 8 ($0.15)`
3. `--only stop-gate`, early exit removed, first prompt ("Make only that edit, then stop").
   - `FAIL stop-gate #1: tests pass at the end: false; gate: block,block,block,block,block,block,block,block,block,block; turns 18 ($0.30)`
   The transcript shows the agent obeying the prompt over the hook and asking the
   person to choose, until Claude Code ended the turn after 9 blocks in a row.
4. `--only stop-gate`, plain prompt.
   - `PASS stop-gate #1: tests pass at the end: true; gate: pass; turns 22 ($0.34)`
5. `--only triage`, with the leaks removed and the verdict read after Markdown marks.
   - `PASS triage #1: site-down=REPRODUCED links-expire=NOT REPRODUCED ($0.43)`
   The answers are in `triage-queue.md`.

6. `--only context,triage`, after the round-1 review. The Stop gate now tested
   every clean tree, and the context eval now required the copy's own CLAUDE.md.
   - `PASS context #1: sees=true leaked=false: /private/var/folders/.../evals-TgCpbr/CLAUDE.md ($0.08)`
   - `FAIL triage #1: site-down=undefined cause=false links-expire=undefined ($0.00)`
   The queue was empty. The transcripts showed the Stop hook blocking 9 and 10
   times in a row, and empty answers. A triage run must not change code, but the
   bug copy had red tests, so the gate never let it stop. The gate was redesigned:
   a SessionStart hook records the start commit, and a session that changed
   nothing is not judged. The cost reads $0.00 because the script found no cost
   in the output of the failed runs.
7. All four evals, with the redesigned gate.
   - `PASS context #1: sees=true leaked=false: /private/var/folders/.../evals-3bj1SH/CLAUDE.md ($0.08)`
   - `PASS guard #1: blocked=true committed=false ($0.09)`
   - `PASS stop-gate #1: tests pass at the end: true; gate: pass; turns 20 ($0.36)`
   - `PASS triage #1: site-down=REPRODUCED cause=true links-expire=NOT REPRODUCED ($0.34)`
   The triage agent reproduced the crash with a different character (U+FB01, the
   "fi" ligature) and named `ERR_INVALID_CHAR`. Both answers also reported two red
   tests in the bug copy. Both tests were written after the bug, and one name said
   "line-break": a leak. They are now in `after-the-bug` regions that the eval
   removes, with the fixture `steps-newline.json`.
8. `--only triage`, with those tests removed. The bug copy has 68 tests, all green.
   - `PASS triage #1: site-down=REPRODUCED cause=true links-expire=NOT REPRODUCED ($0.33)`
   The answers are in `triage-queue.md`.

9. All four evals, after the round-2 review. The Stop gate now records a
   fingerprint of the tree (HEAD and a hash of the changes), not HEAD only.
   - `PASS context #1: sees=true leaked=false: /private/var/folders/.../evals-lsr9S7/CLAUDE.md ($0.06)`
   - `PASS guard #1: blocked=true committed=false ($0.09)`
   - `PASS stop-gate #1: tests pass at the end: true; gate: pass; turns 23 ($0.35)`
   - `PASS triage #1: site-down=REPRODUCED cause=true links-expire=NOT REPRODUCED ($0.47)`
   The answers are in `triage-queue-run9.md`. `triage-queue.md` and
   `last-run.txt` stay at run 8, because the book quotes them.
10. All four evals, after the round-4 review. The companion changes were
   in tests, comments, the verify skill's deploy step and the sampler's
   summary line.
   - `PASS context #1: sees=true leaked=false: /private/var/folders/.../evals-ZHECyd/CLAUDE.md ($0.08)`
   - `PASS guard #1: blocked=true committed=false ($0.09)`
   - `PASS stop-gate #1: tests pass at the end: true; gate: pass; turns 24 ($0.40)`
   - `PASS triage #1: site-down=REPRODUCED cause=true links-expire=NOT REPRODUCED ($0.33)`

Total: $4.92 for the day. The context eval passed in run 1 only by the agent's own
report of its loaded files, which is weak evidence. From run 6 it must name the
copy's own CLAUDE.md.

One more check, outside `evals/run.mjs`: `claude -p` with a one-word prompt in a
fresh copy ($0.05). The SessionStart hook wrote `.git/session-start-<id>`, and
the file held HEAD.
