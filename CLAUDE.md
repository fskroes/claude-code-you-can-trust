# Shortlinks

A small link shortener: `app/server.mjs` (HTTP) and `app/store.mjs`
(one JSON file). Node 22 or later, no dependencies.

## Commands

- `npm test`: all gate tests, a few seconds. Run before you say a
  change is done.
- `node .claude/skills/verify-app/scripts/verify.mjs`: the app end to
  end, as a user would use it. Run after any change under `app/`.
- `npm run structure`: the structure rules for `app/`. Run after you
  add or move a file under `app/`.
- `node tools/mutate.mjs <file> --test "<command>"`: do the tests
  notice a wrong operator? Run after you add a test.

## Rules that code checks (read the file for the reason)

- No push to main, no `--no-verify`, no bare `--force`, no Edit or
  Write to `.env`: `.claude/hooks/guard.mjs`.
- No "done" while the tests fail after a change in this session:
  `.claude/hooks/stop-gate.mjs`.
- File size, imports and environment variables in `app/`:
  `tools/check-structure.mjs`.

## Rules that only you can follow

- A bug fix comes with a test that fails without the fix. Show that it
  fails.
- Store and return the parsed form of a URL (`new URL(x).href`), never
  the raw text.
- Do not change a test to make it pass. If a test is wrong, say why in
  the commit.
- When you find a problem next to your task, write it down as a
  follow-up. Do not fix it in the same change.
- In your last message, paste the summary line of `npm test` and of
  the verify script. "It should work" is not a result.
