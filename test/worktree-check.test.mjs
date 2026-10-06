import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inMainCheckout, portFor } from '../tools/worktree-check.mjs'
import { git, tempRepo } from './helpers.mjs'

const SCRIPT = fileURLToPath(
  new URL('../tools/worktree-check.mjs', import.meta.url),
)

test('the main checkout and a linked worktree are told apart, from any subdirectory', () => {
  const repo = tempRepo('main')
  const linked = `${repo}-wt`
  try {
    git(repo, 'worktree', 'add', '-q', '-b', 'fix-login', linked)
    mkdirSync(join(repo, 'sub'))
    mkdirSync(join(linked, 'sub'))
    assert.equal(inMainCheckout(repo), true)
    assert.equal(inMainCheckout(join(repo, 'sub')), true)
    assert.equal(inMainCheckout(linked), false)
    assert.equal(inMainCheckout(join(linked, 'sub')), false)
  } finally {
    rmSync(linked, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('each worktree gets its own stable port, the main checkout keeps 3000', () => {
  const repo = tempRepo('main')
  const a = `${repo}-a`
  const b = `${repo}-b`
  try {
    git(repo, 'worktree', 'add', '-q', '-b', 'a', a)
    git(repo, 'worktree', 'add', '-q', '-b', 'b', b)
    assert.equal(portFor(repo), 3000)
    assert.equal(portFor(a), portFor(a))
    assert.notEqual(portFor(a), portFor(b))
    for (const p of [portFor(a), portFor(b)])
      assert.ok(p > 3000 && p < 4000, String(p))
  } finally {
    for (const d of [a, b, repo])
      rmSync(d, { recursive: true, force: true })
  }
})

test('--require-linked: exit 1 in the main checkout, 0 in a worktree, 2 outside', () => {
  // A critic found that the exit code of --require-linked had no test.
  const repo = tempRepo('main')
  const linked = `${repo}-wt`
  const outside = mkdtempSync(join(tmpdir(), 'no-repo-'))
  const run = (cwd) =>
    spawnSync(process.execPath, [SCRIPT, '--require-linked'], {
      cwd,
      encoding: 'utf8',
    })
  try {
    git(repo, 'worktree', 'add', '-q', '-b', 'fix-login', linked)
    const main = run(repo)
    assert.equal(main.status, 1)
    assert.match(main.stderr, /claude --worktree <name>/)
    assert.equal(run(linked).status, 0)
    assert.equal(run(outside).status, 2)
  } finally {
    for (const d of [linked, repo, outside])
      rmSync(d, { recursive: true, force: true })
  }
})
