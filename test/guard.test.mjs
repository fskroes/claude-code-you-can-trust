import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  decide,
  splitCommands,
  words,
} from '../.claude/hooks/guard.mjs'
import { git, tempRepo } from './helpers.mjs'

const GUARD = fileURLToPath(
  new URL('../.claude/hooks/guard.mjs', import.meta.url),
)
const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const bash = (command, cwd = '/nowhere') =>
  decide({ tool_name: 'Bash', tool_input: { command }, cwd })

// #region run-hook
// Run the hook the way Claude Code does: JSON on stdin, then read the
// exit code.
function runHook(input) {
  return spawnSync('node', [GUARD], { input, encoding: 'utf8' })
}

test('a push to main: exit 2, with the reason on stderr', () => {
  const result = runHook(fixture('pretooluse-push-main.json'))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Do not push to main/)
})
// #endregion run-hook

test('the hook blocks an edit to .env', () => {
  const result = runHook(fixture('pretooluse-edit-env.json'))
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Do not write \.env/)
})

test('the hook lets an ordinary call through with exit 0', () => {
  const input = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    cwd: '/',
  })
  assert.equal(runHook(input).status, 0)
})

test('input that is not JSON blocks: the guard fails closed', () => {
  const result = runHook('not json')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /could not read/)
})

test('a push to a protected branch is blocked in every form', () => {
  for (const command of [
    'git push origin main',
    'git push origin master',
    'git push origin feature:main',
    'git push origin HEAD:refs/heads/main',
    'git push origin :main',
    'FOO=1 git push origin main',
    'git -C /tmp/x push origin main',
    'npm test && git push origin main',
    'git status; git push origin main',
  ]) {
    assert.equal(bash(command).block, true, command)
  }
})

test('pushes to other branches pass', () => {
  for (const command of [
    'git push -u origin fix-login',
    'git push origin fix-login:fix-login',
  ]) {
    assert.equal(bash(command).block, false, command)
  }
})

test('a push with no branch named goes to the current branch', () => {
  const repo = tempRepo('main')
  try {
    assert.equal(bash('git push', repo).block, true)
    assert.equal(bash('git push -u origin HEAD', repo).block, true)
    git(repo, 'switch', '-q', '-c', 'fix-login')
    assert.equal(bash('git push', repo).block, false)
    assert.equal(bash('git push -u origin HEAD', repo).block, false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('skipping hooks and bare force pushes are blocked', () => {
  assert.equal(bash('git commit --no-verify -m "wip"').block, true)
  assert.equal(bash('git commit -n -m "wip"').block, true)
  assert.equal(bash('git push --no-verify origin fix').block, true)
  assert.equal(bash('git push --force origin fix').block, true)
  assert.equal(bash('git push -f origin fix').block, true)
  assert.equal(bash('git push origin +fix').block, true)
  assert.equal(
    bash('git push --force-with-lease origin fix').block,
    false,
  )
})

test('quoted text is not read as a flag or a separator', () => {
  assert.equal(
    bash('git commit -m "docs: never use --no-verify"').block,
    false,
  )
  assert.equal(
    bash('git commit -m "note; git push origin main; done"').block,
    false,
  )
  assert.deepEqual(splitCommands('a && b; "c; d"'), [
    'a',
    'b',
    '"c; d"',
  ])
  assert.deepEqual(words('git commit -m "two words"'), [
    'git',
    'commit',
    '-m',
    'two words',
  ])
})

test('commit messages are not checked for words', () => {
  // A word list in a hook blocked a plain message like this one. Word
  // choice stays a writing rule; the hook keeps only checks that are
  // never wrong.
  assert.equal(
    bash('git commit -m "support landscape mode"').block,
    false,
  )
})

test('secret files are blocked, the example file is not', () => {
  const edit = (file_path) =>
    decide({ tool_name: 'Edit', tool_input: { file_path } })
  assert.equal(edit('/x/.env').block, true)
  assert.equal(edit('/x/.env.local').block, true)
  assert.equal(edit('/x/.env.example').block, false)
  assert.equal(
    decide({ tool_name: 'Write', tool_input: { file_path: '/x/.env' } })
      .block,
    true,
  )
  assert.equal(edit('/x/app/env.mjs').block, false)
})

test('wrappers, subshells and flag clusters hide nothing', () => {
  // A reviewer got past the first version with each of these.
  for (const command of [
    'env git push origin main',
    'command git push origin main',
    'sudo git push origin main',
    'sudo -E git push origin main',
    'sudo -u deploy git push origin main',
    'env -i git push origin main',
    'env -u HOME FOO=1 git push origin main',
    'time -p git push origin main',
    '(git push origin main)',
    'git commit -nm "wip"',
    'git push -uf origin fix',
  ]) {
    assert.equal(bash(command).block, true, command)
  }
  assert.equal(bash('git commit -am "fix"').block, false)
})

// #region known-gaps
// Known gaps. The hook reads the command text, so another way to run
// the same program gets through. These tests pass on purpose: they
// record the limit.
test('known gap: a push inside sh -c is not seen', () => {
  assert.equal(bash('sh -c "git push origin main"').block, false)
  const result = runHook(fixture('pretooluse-push-sh-c.json'))
  assert.equal(result.status, 0)
})

test('known gap: a push behind xargs is not seen', () => {
  assert.equal(bash('echo main | xargs git push origin').block, false)
})

test('known gap: a script that pushes is not seen', () => {
  assert.equal(bash('./scripts/release.sh').block, false)
})
// #endregion known-gaps
