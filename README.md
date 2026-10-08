# Companion code for *Claude Code You Can Trust*

A small link shortener, and the tools around it that let a coding agent check its
own work. Every code block in the book is a part of a file here, or a command you
can run here. Lines such as `// #region checks` mark the parts the book prints.

The book is on Amazon: [*Claude Code You Can Trust*](https://www.amazon.com/dp/B0HMC322BL).
Chapter 10, "The builder does not grade its own work", is free to read at
https://1yc.dev/books/claude-code-you-can-trust/chapter-10.

Node.js 22 or later and git. No dependencies to install.

```bash
git clone https://github.com/fskroes/claude-code-you-can-trust
cd claude-code-you-can-trust
npm test                                             # the gate tests, about two seconds
node .claude/skills/verify-app/scripts/verify.mjs    # the app end to end
```

## What is where

| Path | What it is | Chapter |
|---|---|---|
| `app/server.mjs`, `app/store.mjs` | The link shortener: HTTP routes and a JSON-file store | all |
| `tools/mine-corrections.mjs` | Counts the prompts in which you corrected the agent | 1 |
| `tools/triage-inbox.mjs` | Runs `claude -p` once per new bug report, checks the answer, queues it | 2, 11 |
| `.claude/skills/verify-app/` | The verify skill: `SKILL.md` and the script it runs | 3, 4 |
| `tools/mutate.mjs` | Changes one operator at a time and reports the changes no test caught | 5 |
| `.claude/hooks/guard.mjs` | PreToolUse hook: no push to main, no `--no-verify`, no bare force push, no writes to `.env` | 6 |
| `.claude/hooks/stop-gate.mjs` | Stop hook: no "done" while the tests fail | 6 |
| `.claude/settings.json` | Permission rules and the wiring of both hooks | 6, 13 |
| `tools/check-structure.mjs` | Structure rules for `app/`, each with its reason | 7 |
| `CLAUDE.md` | Only the rules that code cannot check | 8 |
| `tools/worktree-check.mjs` | Main checkout or worktree, and a port per worktree | 9 |
| `.claude/agents/critic.md` | A subagent that judges finished work against a rubric | 10 |
| `tools/request.mjs` | A narrow tool: replay requests against a fresh copy of the app | 11 |
| `prompts/triage.md`, `inbox/` | The triage prompt and two sample bug reports | 11 |
| `tools/sample-landed.mjs` | Picks a random sample of last week's landed changes | 12 |
| `evals/run.mjs` | Evals that run the real Claude Code. They cost money | 12 |
| `evals/results/2026-10-05/` | The eval run the book quotes; new runs write to `latest/` | 11, 12 |
| `test/` | The gate tests, and fixtures in the shapes Claude Code uses | all |

## Two lanes of tests

- `npm test` is the gate: no network, no model, no cost. Run it on every change.
  `test/fixtures/fake-claude.mjs` stands in for `claude -p`.
- `node evals/run.mjs` runs the real Claude Code against a fresh copy of this
  repository. Each run costs some cents and the results can vary, so run it before a
  release, not on every change. `--only guard,triage` and `--repeat 3` are useful.

## Use it in your own repository

Copy what you need and change the app-specific parts: the checks in `verify.mjs`,
the rules in `check-structure.mjs`, the branch names in `guard.mjs`. Keep the tests
with them. A hook or a check without a test is the first thing to break silently.

## License

MIT. See `LICENSE`.
