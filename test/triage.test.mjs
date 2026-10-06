import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALLOWED_TOOLS,
  parseResult,
  triage,
} from '../tools/triage-inbox.mjs'
import { replay } from '../tools/request.mjs'

const FAKE = fileURLToPath(
  new URL('./fixtures/fake-claude.mjs', import.meta.url),
)

function workspace(reports) {
  const root = mkdtempSync(join(tmpdir(), 'triage-'))
  mkdirSync(join(root, 'prompts'))
  mkdirSync(join(root, 'inbox'))
  writeFileSync(
    join(root, 'prompts', 'triage.md'),
    'Triage this report.',
  )
  for (const [name, text] of Object.entries(reports))
    writeFileSync(join(root, 'inbox', name), text)
  return root
}

function withMode(mode, fn) {
  const before = process.env.FAKE_CLAUDE_MODE
  process.env.FAKE_CLAUDE_MODE = mode
  try {
    return fn()
  } finally {
    if (before === undefined) delete process.env.FAKE_CLAUDE_MODE
    else process.env.FAKE_CLAUDE_MODE = before
  }
}

test('each new report is triaged once and lands in the queue', () => {
  const root = workspace({
    'a.md': 'Site down',
    'b.md': 'Links expire',
  })
  try {
    const first = withMode('reproduced', () =>
      triage(root, { claude: FAKE }),
    )
    assert.equal(first.done, 2)
    const queue = readFileSync(join(root, 'triage', 'queue.md'), 'utf8')
    assert.match(queue, /a\.md: REPRODUCED/)
    assert.match(queue, /b\.md: REPRODUCED/)
    const again = withMode('reproduced', () =>
      triage(root, { claude: FAKE }),
    )
    assert.equal(again.done, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an edited report is triaged again', () => {
  const root = workspace({ 'a.md': 'Site down' })
  try {
    withMode('reproduced', () => triage(root, { claude: FAKE }))
    writeFileSync(
      join(root, 'inbox', 'a.md'),
      'Site down. Steps: make a short link, then open it.',
    )
    assert.equal(
      withMode('reproduced', () => triage(root, { claude: FAKE })).done,
      1,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// #region verdict-tests
test('a failed run is logged and retried next time, not queued', () => {
  for (const mode of ['no-verdict', 'max-turns', 'not-json']) {
    const root = workspace({ 'a.md': 'Site down' })
    try {
      const summary = withMode(mode, () =>
        triage(root, { claude: FAKE }),
      )
      assert.equal(summary.failed, 1, mode)
      assert.match(
        readFileSync(join(root, 'triage', 'log.txt'), 'utf8'),
        /FAILED a\.md/,
      )
      assert.equal(
        withMode('reproduced', () => triage(root, { claude: FAKE }))
          .done,
        1,
        mode,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})
// #endregion verdict-tests

test('the run asks for JSON, no prompts, and only the narrow tools', () => {
  const root = workspace({ 'a.md': 'Site down' })
  const argsFile = join(root, 'args.jsonl')
  process.env.FAKE_CLAUDE_ARGS = argsFile
  try {
    withMode('reproduced', () => triage(root, { claude: FAKE }))
    const args = JSON.parse(readFileSync(argsFile, 'utf8').trim())
    assert.equal(args[args.indexOf('--output-format') + 1], 'json')
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk')
    assert.equal(
      args[args.indexOf('--setting-sources') + 1],
      'project,local',
    )
    assert.equal(
      args[args.indexOf('--allowedTools') + 1],
      ALLOWED_TOOLS,
    )
    assert.match(
      args[args.indexOf('-p') + 1],
      /## The report \(a\.md\)\n\nSite down/,
    )
    assert.doesNotMatch(
      ALLOWED_TOOLS,
      /curl|node -e|Edit|Write|Skill|verify\.mjs \*/,
    )
  } finally {
    delete process.env.FAKE_CLAUDE_ARGS
    rmSync(root, { recursive: true, force: true })
  }
})

test('parseResult accepts only an answer that starts with a verdict', () => {
  const json = (result) =>
    JSON.stringify({
      subtype: 'success',
      is_error: false,
      result,
      num_turns: 1,
    })
  assert.equal(
    parseResult(json('NOT REPRODUCED\nRan npm test')).verdict,
    'NOT REPRODUCED',
  )
  assert.equal(
    parseResult(json('UNCLEAR: no URL in the report')).verdict,
    'UNCLEAR',
  )
  assert.equal(parseResult(json('Reproduced it!')).ok, false)
  // A reviewer found that these passed: the word must end where the
  // verdict ends.
  assert.equal(parseResult(json('REPRODUCEDX nonsense')).ok, false)
  assert.equal(parseResult(json('UNCLEARLY')).ok, false)
  assert.equal(parseResult(json('REPRODUCED.')).verdict, 'REPRODUCED')
})

test('parseResult: JSON that is not an object is a failed run', () => {
  for (const stdout of ['null', '42', '"REPRODUCED"', '[1]']) {
    const out = parseResult(stdout)
    assert.equal(out.ok, false, stdout)
    assert.equal(out.why, 'claude did not print a JSON object', stdout)
  }
})

test('parseResult: is_error fails the run and says so', () => {
  const stdout = JSON.stringify({
    subtype: 'success',
    is_error: true,
    result: 'REPRODUCED',
  })
  assert.deepEqual(parseResult(stdout), {
    ok: false,
    why: 'run ended with an error (success)',
  })
})

test('a verdict in Markdown bold is still read (a real run answered this way)', () => {
  const json = (result) =>
    JSON.stringify({
      subtype: 'success',
      is_error: false,
      result,
      num_turns: 1,
    })
  assert.equal(
    parseResult(json('**NOT REPRODUCED**\n\nThe code has no expiry.'))
      .verdict,
    'NOT REPRODUCED',
  )
  assert.equal(parseResult(json('## REPRODUCED')).verdict, 'REPRODUCED')
})

test('request.mjs refuses a path that would leave the app', async () => {
  const lines = await replay([
    { method: 'GET', path: '@example.com/x' },
    { method: 'GET', path: '//example.com/x' },
    { method: 'GET', path: 'http://example.com/x' },
  ])
  assert.equal(lines.filter((l) => l.includes('-> refused')).length, 3)
})

// #region after-the-bug
// Written after the newline bug. The triage eval removes it from the
// copy that has the bug back.
test('the line-break steps redirect and the app keeps running', async () => {
  const steps = JSON.parse(
    readFileSync(
      new URL('./fixtures/steps-newline.json', import.meta.url),
      'utf8',
    ),
  )
  const lines = await replay(steps)
  assert.match(lines[1], /-> 302 location="https:\/\/example\.com\/ab"/)
  assert.equal(lines.at(-1), 'app: still running')
})
// #endregion after-the-bug

test('request.mjs: a normal redirect, a running app', async () => {
  const lines = await replay([
    {
      method: 'POST',
      path: '/links',
      body: { url: 'https://example.com/ok' },
    },
    { method: 'GET', path: '{short}' },
  ])
  assert.match(lines[1], /-> 302 location="https:\/\/example\.com\/ok"/)
  assert.equal(lines.at(-1), 'app: still running')
})
