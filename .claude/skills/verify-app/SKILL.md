---
name: verify-app
description: >-
  Check the link shortener end to end, as a user would. Use after any
  change under app/, before you say a task is done, and after a deploy
  to check that the live copy serves the new commit.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/verify.mjs *)
---

# Verify the app

Run the check. Do not write your own curl commands for this: the
script is the same check every time, and its result is what the person
trusts.

1. After a change under `app/`, run:

   `node ${CLAUDE_SKILL_DIR}/scripts/verify.mjs`

   It starts the app from this working tree on a free port, with an
   empty data directory, and stops it at the end.
2. After a deploy, run it against the live copy and name the commit
   you deployed. Add `--url <base-url> --expect-commit <sha>` to the
   same command. A copy that answers with an older commit fails. A
   pulled checkout does not restart a running process. The run adds
   three test links to that copy, so ask the person first.
3. Read the result:
   - Exit 0 and `verify: N passed, 0 failed`: report the summary line
     as it is.
   - Exit 1: a `FAIL` line names the check and what it got. Fix the
     cause and run the check again. Do not change the script to make
     it pass.
   - Exit 2: the check could not run (the app did not start, a bad
     argument). Read the message. This is not a pass.
4. In your final message, paste the summary line. "It should work" is
   not a result.

When a check is missing for the change you made, say so and propose
the check. Adding it to `scripts/verify.mjs` is a change of its own,
with its own test.
