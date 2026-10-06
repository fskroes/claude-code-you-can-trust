// #region header
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const settings = JSON.parse(
  readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'),
)
// #endregion header

import { rmSync, writeFileSync } from 'node:fs'
import {
  gate,
  startMark,
  treeState,
} from '../.claude/hooks/stop-gate.mjs'
import { git, tempRepo } from './helpers.mjs'

// #region paths-exist
// A mistyped hook path does not fail loudly: the hook cannot start,
// Claude Code reports a non-blocking error, and the tool call goes
// through. Check every path.
test('every hook in settings.json points at a file that exists', () => {
  let count = 0
  for (const groups of Object.values(settings.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        for (const arg of hook.args ?? []) {
          const path = arg.replace('${CLAUDE_PROJECT_DIR}', ROOT)
          assert.ok(existsSync(path), `missing hook script: ${arg}`)
          count++
        }
      }
    }
  }
  assert.equal(count, 3)
})
// #endregion paths-exist

test('the guard runs before Bash, Edit and Write', () => {
  const [group] = settings.hooks.PreToolUse
  assert.deepEqual(group.matcher.split('|').sort(), [
    'Bash',
    'Edit',
    'Write',
  ])
})

// #region deny-rules
// Pin every list whole. A first version did not pin the ask rule:
// deleting it left the test passing.
test('the permission lists are exactly these', () => {
  const { allow, ask, deny } = settings.permissions
  assert.deepEqual(ask, ['Bash(git push *)'])
  assert.deepEqual(deny, [
    'Read(./.env)',
    'Read(./.env.*)',
    'Read(!.env.example)', // a carve-out applies to rules above it
    'Edit(./.env)', // Edit rules also stop "echo >> .env" and sed -i
    'Edit(./.env.*)',
    'Edit(!.env.example)',
  ])
  assert.deepEqual(allow, [
    'Bash(npm test)',
    'Bash(npm run verify)',
    'Bash(npm run structure)',
    'Bash(git status)',
    'Bash(git diff *)',
  ])
})
// #endregion deny-rules

// A stand-in for the shell: git answers from the arguments, and the
// test command answers with `tests`.
function fakeRun({
  status = '',
  head = 'abc123',
  diff = '',
  tests = null,
}) {
  const calls = []
  const run = (command) => {
    calls.push(command)
    if (command.startsWith('git status'))
      return { code: status === null ? 128 : 0, out: status ?? '' }
    if (command === 'git rev-parse HEAD') return { code: 0, out: head }
    if (command.startsWith('git diff')) return { code: 0, out: diff }
    if (command.startsWith('git ls-files')) return { code: 0, out: '' }
    return tests
  }
  return { run, calls }
}

// The state the session started at, as the SessionStart hook wrote it.
const startedAt = (state) => ({ read: () => state })
const stateOf = (opts) => treeState('/x', fakeRun(opts).run)

const RED = { code: 1, out: 'not ok 2 - redirect\n' }
const GREEN = { code: 0, out: '' }

test('stop gate: red tests after a change keep the agent working', () => {
  const start = stateOf({})
  const { run } = fakeRun({ status: ' M app/server.mjs\n', tests: RED })
  const result = gate({ cwd: '/x' }, run, startedAt(start))
  assert.equal(result.block, true)
  assert.match(result.reason, /not ok 2 - redirect/)
})

test('stop gate: a commit made in this session is tested', () => {
  // The second version skipped every clean tree, so an agent that
  // committed red code and then stopped passed. A reviewer found it.
  const start = stateOf({ head: 'abc123' })
  const { run } = fakeRun({ head: 'def456', tests: RED })
  assert.equal(gate({ cwd: '/x' }, run, startedAt(start)).block, true)
})

test('stop gate: a session that changed nothing is not judged', () => {
  // The third version tested every clean tree. A triage run, which
  // must not fix anything, met red tests in its copy and was blocked
  // until Claude Code ended the turn.
  for (const before of [{}, { status: ' M a\n', diff: 'x' }]) {
    const { run, calls } = fakeRun({ ...before, tests: RED })
    const result = gate({ cwd: '/x' }, run, startedAt(stateOf(before)))
    assert.equal(result.block, false)
    assert.equal(calls.includes('npm test --silent'), false)
  }
})

test('stop gate: a change on top of a dirty start is tested', () => {
  // The fourth version compared only the commit, so a session that
  // started dirty was always tested. A reviewer found it.
  const start = stateOf({ status: ' M a\n', diff: 'x' })
  const { run } = fakeRun({ status: ' M a\n', diff: 'y', tests: RED })
  assert.equal(gate({ cwd: '/x' }, run, startedAt(start)).block, true)
})

test('stop gate: with no record of the start, the tests run', () => {
  const { run } = fakeRun({ tests: RED })
  assert.equal(gate({ cwd: '/x' }, run, startedAt(null)).block, true)
})

test('stop gate: a second stop with red tests is still blocked', () => {
  // The first version let this through. The stop-gate eval caught the
  // agent stopping with failing tests on its second try.
  const { run } = fakeRun({ status: ' M app/store.mjs\n', tests: RED })
  const event = { cwd: '/x', stop_hook_active: true }
  assert.equal(gate(event, run, startedAt(stateOf({}))).block, true)
})

test('stop gate: green tests let the agent stop', () => {
  const { run } = fakeRun({ status: ' M a\n', tests: GREEN })
  assert.equal(gate({ cwd: '/x' }, run, startedAt(null)).block, false)
})

test('stop gate: a test run over the time limit lets the agent stop', () => {
  // Blocking here sent the agent back with an empty reason, again and
  // again: no change it can make shortens the suite.
  const slow = { code: 1, out: '', timedOut: true }
  const { run } = fakeRun({ status: ' M a\n', tests: slow })
  const result = gate({ cwd: '/x' }, run, startedAt(null))
  assert.equal(result.block, false)
  assert.match(result.why, /tests ran over/)
})

test('stop gate: outside a git repository it lets the agent stop', () => {
  const { run, calls } = fakeRun({ status: null })
  assert.equal(gate({ cwd: '/x' }, run, startedAt(null)).block, false)
  assert.equal(calls.length, 1)
})

test('stop gate: a real repository and the SessionStart record', () => {
  const repo = tempRepo('fix-login')
  const event = { cwd: repo, session_id: 'session-1' }
  const pkg = (cmd) =>
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ scripts: { test: cmd } }),
    )
  try {
    pkg('exit 1')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'red before the session')
    writeFileSync(join(repo, 'notes.txt'), 'left from yesterday\n')
    startMark.writeOnce(event)
    assert.equal(gate(event).block, false) // nothing changed yet
    writeFileSync(join(repo, 'notes.txt'), 'edited\n')
    assert.equal(gate(event).block, true) // an untracked file changed
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'still red')
    assert.equal(gate(event).block, true) // committed in this session
    const first = startMark.read(event)
    startMark.writeOnce(event) // the first record wins
    assert.equal(startMark.read(event), first)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
