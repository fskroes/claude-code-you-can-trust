#!/usr/bin/env node
// Stop hook. When the agent says it is done and this session changed
// something (a file, or a commit), run the tests. If they fail, exit 2:
// Claude Code keeps the agent working and shows it the failure. A
// session that changed nothing is not judged.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_COMMAND = process.env.STOP_GATE_CMD ?? 'npm test --silent'
const LIMIT_MS = Number(process.env.STOP_GATE_LIMIT_MS ?? 120_000)

// #region gate
export function gate(event, run = shell, mark = startMark) {
  // No early exit on stop_hook_active. A first version let the agent
  // stop on the second try, and an eval caught it stopping with red
  // tests. Claude Code ends the loop itself: after 8 continuations in
  // a row, it overrides the next block.
  // The cwd in the input follows the agent into a worktree.
  const cwd = event.cwd
  const now = treeState(cwd, run)
  if (now === null) return { block: false, why: 'not a git repository' }
  // The same commit and the same files as at the start: this session
  // changed nothing here, so it is not judged, even when the tests are
  // red for a reason it must not touch.
  if (mark.read(event) === now)
    return { block: false, why: 'this session changed nothing' }

  const tests = run(TEST_COMMAND, cwd)
  // A suite that runs past the limit is not a failure the agent can
  // fix by trying again. Let it stop, and say why in the log.
  if (tests.timedOut)
    return { block: false, why: `tests ran over ${LIMIT_MS} ms` }
  if (tests.code === 0) return { block: false, why: 'tests pass' }
  const tail = tests.out.trim().split('\n').slice(-20).join('\n')
  return {
    block: true,
    reason:
      `The tests fail (${TEST_COMMAND}). ` +
      `Fix them before you stop.\n${tail}`,
  }
}
// #endregion gate

// #region tree-state
// The commit plus a hash of every change on top of it: staged,
// unstaged and untracked, file contents included. Two equal states
// mean nothing changed in between. Outside a repository: null.
export function treeState(cwd, run = shell) {
  const status = run(
    'git status --porcelain --untracked-files=all',
    cwd,
  )
  if (status.code !== 0) return null
  const head = run('git rev-parse HEAD', cwd).out.trim()
  const hash = createHash('sha256')
  hash.update(status.out)
  hash.update(run('git diff HEAD --binary', cwd).out)
  const untracked = run(
    'git ls-files --others --exclude-standard -z',
    cwd,
  ).out
  for (const file of untracked.split('\0').filter(Boolean)) {
    hash.update(file)
    try {
      hash.update(readFileSync(join(cwd, file)))
    } catch {
      hash.update('unreadable')
    }
  }
  return `${head} ${hash.digest('hex')}`
}
// #endregion tree-state

// The state a session started at, written by the SessionStart hook
// into this worktree's own git directory: never committed. A missing
// record reads as null, so the gate runs the tests.
export const startMark = {
  file({ cwd, session_id }) {
    const dir = shell(
      'git rev-parse --absolute-git-dir',
      cwd,
    ).out.trim()
    const id = String(session_id).replace(/[^\w-]/g, '')
    return dir && id ? join(dir, `session-start-${id}`) : null
  },
  read(event) {
    try {
      return readFileSync(this.file(event), 'utf8').trim()
    } catch {
      return null
    }
  },
  writeOnce(event) {
    const file = this.file(event)
    if (!file || existsSync(file)) return
    const state = treeState(event.cwd)
    if (state !== null) writeFileSync(file, state + '\n')
  },
}

function shell(command, cwd) {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: LIMIT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    code: r.status ?? 1,
    out: (r.stdout ?? '') + (r.stderr ?? ''),
    timedOut: r.error?.code === 'ETIMEDOUT',
  }
}

export async function readStdinJson() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

async function main() {
  const event = await readStdinJson()
  // Unreadable input: do not trap the agent in a loop.
  if (!event) process.exit(0)
  const result = gate(event)
  if (process.env.STOP_GATE_LOG) {
    // A trace of every decision, so an eval can show what the gate did.
    const line =
      `${new Date().toISOString()} ${result.block ? 'block' : 'pass'}` +
      ` active=${!!event.stop_hook_active} ${result.why ?? ''}\n`
    appendFileSync(process.env.STOP_GATE_LOG, line)
  }
  if (result.block) {
    console.error(result.reason)
    process.exit(2)
  }
  process.exit(0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
