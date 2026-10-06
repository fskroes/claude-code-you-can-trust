import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import {
  parseArgs,
  report,
  runChecks,
  startApp,
} from '../.claude/skills/verify-app/scripts/verify.mjs'

const VERIFY = fileURLToPath(
  new URL(
    '../.claude/skills/verify-app/scripts/verify.mjs',
    import.meta.url,
  ),
)

// Async on purpose: spawnSync would block the event loop that serves
// the app under test in the same process.
function run(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [VERIFY, ...args],
      (err, stdout, stderr) =>
        resolve({ code: err?.code ?? 0, stdout, stderr }),
    )
  })
}

test('a full local run passes every check, the restart included', () => {
  const result = spawnSync(process.execPath, [VERIFY], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /PASS survives restart/)
  // #region after-the-bug
  assert.match(result.stdout, /PASS odd characters/)
  // #endregion after-the-bug
  assert.match(result.stdout, /verify: \d+ passed, 0 failed/)
})

test('a deployed copy that serves an old commit fails the health check', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'verify-test-'))
  const app = await startApp(dataDir, 'old1234')
  try {
    const result = await run([
      '--url',
      app.base,
      '--expect-commit',
      'new5678',
    ])
    assert.equal(result.code, 1)
    assert.match(
      result.stdout,
      /FAIL health: serves old1234, expected new5678/,
    )
    const ok = await run([
      '--url',
      app.base,
      '--expect-commit',
      'old1234',
    ])
    assert.equal(ok.code, 0, ok.stdout)
  } finally {
    await app.stop()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('nothing listening at the URL is a failure, not a pass', async () => {
  const result = await run(['--url', 'http://127.0.0.1:9'])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /FAIL health/)
})

test('an app that never answers fails the check, it does not hang', async () => {
  // A reviewer made POST /links never answer, and the first version
  // waited for ever.
  const server = createServer((req, res) => {
    if (req.url === '/healthz') res.end('{"ok":true}')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const { results } = await runChecks(base, { timeoutMs: 300 })
    const create = results.find((r) => r.name === 'create')
    assert.equal(create.ok, false)
    assert.equal(create.why, 'no answer in 300 ms')
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('a bad argument exits 2', () => {
  assert.throws(() => parseArgs(['--colour']), /unknown argument/)
  assert.throws(() => parseArgs(['--url']), /needs a value/)
  // A reviewer found that an agent allowed to run this script could
  // point --url at any host.
  assert.throws(
    () => parseArgs(['--url', 'https://example.com']),
    /not this machine: add --allow-remote/,
  )
  assert.equal(
    parseArgs(['--url', 'https://example.com', '--allow-remote']).url,
    'https://example.com',
  )
  assert.equal(
    parseArgs(['--url', 'http://127.0.0.1:9']).url,
    'http://127.0.0.1:9',
  )
  // Found by a reviewer: without --url the flag was ignored and the run
  // passed.
  assert.throws(
    () => parseArgs(['--expect-commit', 'abc1234']),
    /needs --url/,
  )
  const result = spawnSync(process.execPath, [VERIFY, '--colour'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 2)
})

test('the report counts failures and sets the exit code', () => {
  const lines = []
  const code = report(
    [
      { name: 'a', ok: true },
      { name: 'b', ok: false, why: 'no' },
    ],
    (l) => lines.push(l),
  )
  assert.equal(code, 1)
  assert.deepEqual(lines, [
    'PASS a',
    'FAIL b: no',
    'verify: 1 passed, 1 failed',
  ])
})
