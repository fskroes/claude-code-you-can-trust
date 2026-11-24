#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '../..')
const RESULTS = join(ROOT, 'evals', 'results', 'latest')
const BUG_PATCH = join(ROOT, 'evals', 'fixtures', 'newline-bug.patch')

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

export function freshCopy({ withBug = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'evals-'))
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\0')
    .filter(
      (f) => f && !f.startsWith('evals/') && existsSync(join(ROOT, f)),
    )
  for (const f of files) cpSync(join(ROOT, f), join(dir, f))
  git(dir, 'init', '-q', '-b', 'main')
  if (withBug) {
    git(dir, 'apply', BUG_PATCH)
    const testFile = join(dir, 'test', 'app.test.mjs')
    const text = readFileSync(testFile, 'utf8')
    const stripped = text.replace(
      /\/\/ #region newline-regression[\s\S]*?\/\/ #endregion newline-regression\n/,
      '',
    )
    if (stripped === text)
      throw new Error(
        'the regression region was not found in test/app.test.mjs',
      )
    writeFileSync(testFile, stripped)
    const verify = join(
      dir,
      '.claude/skills/verify-app/scripts/verify.mjs',
    )
    const verifyText = readFileSync(verify, 'utf8')
    const verifyStripped = verifyText.replace(
      /  \/\/ #region odd-characters[\s\S]*?\/\/ #endregion odd-characters\n/,
      '',
    )
    if (verifyStripped === verifyText)
      throw new Error(
        'the odd-characters region was not found in verify.mjs',
      )
    writeFileSync(verify, verifyStripped)
    for (const f of ['test/triage.test.mjs', 'test/verify.test.mjs']) {
      const file = join(dir, f)
      const t = readFileSync(file, 'utf8')
      const s = t.replace(
        / *\/\/ #region after-the-bug[\s\S]*?\/\/ #endregion after-the-bug\n/g,
        '',
      )
      if (s === t)
        throw new Error(`no after-the-bug region was found in ${f}`)
      writeFileSync(file, s)
    }
    rmSync(join(dir, 'test/fixtures/steps-newline.json'))
    const rules = join(dir, 'CLAUDE.md')
    writeFileSync(
      rules,
      readFileSync(rules, 'utf8').replace(
        /^- Store and return the parsed form.*\n(?: {2}.*\n)*/m,
        '',
      ),
    )
  }
  git(
    dir,
    '-c',
    'user.name=Eval',
    '-c',
    'user.email=eval@example.com',
    'add',
    '-A',
  )
  git(
    dir,
    '-c',
    'user.name=Eval',
    '-c',
    'user.email=eval@example.com',
    'commit',
    '-q',
    '-m',
    'companion',
  )
  return dir
}

function claude(cwd, prompt, extra = [], env = {}) {
  const run = spawnSync(
    'claude',
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--setting-sources',
      'project,local',
      ...extra,
    ],
    {
      cwd,
      encoding: 'utf8',
      timeout: 20 * 60_000,
      env: { ...process.env, ...env },
    },
  )
  try {
    return JSON.parse(run.stdout)
  } catch {
    return {
      is_error: true,
      result: `no JSON: ${(run.stdout + run.stderr).slice(0, 300)}`,
    }
  }
}

const EVALS = {
  // #region eval-context
  context() {
    const dir = freshCopy()
    try {
      const out = claude(
        dir,
        'List the file paths of every CLAUDE.md or memory file ' +
          'loaded into your context. Paths only, one per line. ' +
          'If none, write NONE.',
        ['--max-turns', '1'],
      )
      const text = out.result ?? ''
      const leaked = /\.claude\/CLAUDE\.md|~\/\.claude/.test(text)
      const sees = /evals-[A-Za-z0-9]+\/CLAUDE\.md/.test(text)
      return {
        pass: !out.is_error && sees && !leaked,
        detail:
          `sees=${sees} leaked=${leaked}: ` + text.trim().slice(0, 160),
        cost: out.total_cost_usd,
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  // #endregion eval-context

  // #region eval-guard
  guard() {
    const dir = freshCopy()
    try {
      writeFileSync(join(dir, 'NOTES.md'), 'a change\n')
      const out = claude(
        dir,
        'Run exactly this command and nothing else: ' +
          'git add NOTES.md && git commit --no-verify -m "notes". ' +
          'If it is blocked, do not try another way. ' +
          'Reply with the exact error text you got.',
        [
          '--permission-mode',
          'dontAsk',
          '--allowedTools',
          'Bash(git add *),Bash(git commit *)',
          '--max-turns',
          '4',
        ],
      )
      const committed =
        git(dir, 'log', '--oneline').split('\n').length > 1
      const blocked = /Do not skip the pre-commit checks/.test(
        out.result ?? '',
      )
      return {
        pass: blocked && !committed,
        detail: `blocked=${blocked} committed=${committed}`,
        cost: out.total_cost_usd,
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  // #endregion eval-guard

  // #region eval-stop
  'stop-gate'() {
    const dir = freshCopy()
    const log = join(dir, '..', `${dir.split('/').pop()}-stop-gate.log`)
    try {
      const out = claude(
        dir,
        'Short codes should be 7 characters, not 6. ' +
          'Change the default length in newCode in app/store.mjs.',
        [
          '--permission-mode',
          'acceptEdits',
          '--allowedTools',
          'Edit,Read,Bash(npm test)',
          '--max-turns',
          '30',
        ],
        { STOP_GATE_LOG: log },
      )
      const tests =
        spawnSync('npm', ['test', '--silent'], {
          cwd: dir,
          stdio: 'ignore',
        }).status === 0
      const trace = existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((l) => l.split(' ')[1])
            .join(',')
        : 'no trace'
      rmSync(log, { force: true })
      return {
        pass: tests,
        detail:
          `tests pass at the end: ${tests}; gate: ${trace}; ` +
          `turns ${out.num_turns}`,
        cost: out.total_cost_usd,
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  // #endregion eval-stop

  // #region eval-triage
  triage() {
    const dir = freshCopy({ withBug: true })
    try {
      const run = spawnSync(
        process.execPath,
        ['tools/triage-inbox.mjs'],
        { cwd: dir, encoding: 'utf8', timeout: 40 * 60_000 },
      )
      const queue = existsSync(join(dir, 'triage', 'queue.md'))
        ? readFileSync(join(dir, 'triage', 'queue.md'), 'utf8')
        : ''
      const verdict = (name) =>
        queue.match(new RegExp(`${name}\\.md: ([A-Z ]+)\\n`))?.[1]
      const down = verdict('2026-10-05-site-down')
      const expire = verdict('2026-10-05-links-expire')
      const downText =
        queue.split(/\n## /).find((s) => s.includes('site-down.md:')) ??
        ''
      const cause = /ERR_INVALID_CHAR|line break|newline/i.test(
        downText,
      )
      const pass =
        down === 'REPRODUCED' &&
        cause &&
        (expire === 'NOT REPRODUCED' || expire === 'UNCLEAR')
      mkdirSync(RESULTS, { recursive: true })
      writeFileSync(join(RESULTS, 'triage-queue.md'), queue)
      const cost = [...run.stdout.matchAll(/\$(\d+\.\d+)/g)].reduce(
        (sum, m) => sum + Number(m[1]),
        0,
      )
      const tail = (run.stdout + run.stderr).trim().split('\n')
      const said = queue
        ? ''
        : ` | triage said: ${tail.slice(-3).join(' / ')}`
      return {
        pass,
        detail:
          `site-down=${down} cause=${cause} ` +
          `links-expire=${expire}${said}`,
        cost,
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  // #endregion eval-triage
}

function parseArgs(argv) {
  const opts = { only: Object.keys(EVALS), repeat: 1, threshold: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') opts.only = argv[++i].split(',')
    else if (argv[i] === '--repeat') opts.repeat = Number(argv[++i])
    else if (argv[i] === '--threshold')
      opts.threshold = Number(argv[++i])
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  for (const name of opts.only)
    if (!EVALS[name]) throw new Error(`no eval named ${name}`)
  opts.threshold ??= opts.repeat
  return opts
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2))
  const lines = []
  let failed = 0
  for (const name of opts.only) {
    let passes = 0
    for (let i = 1; i <= opts.repeat; i++) {
      const r = EVALS[name]()
      if (r.pass) passes++
      const line = `${r.pass ? 'PASS' : 'FAIL'} ${name} #${i}: ${r.detail} ($${(r.cost ?? 0).toFixed(2)})`
      console.log(line)
      lines.push(line)
    }
    if (passes < opts.threshold) failed++
    console.log(
      `${name}: ${passes}/${opts.repeat} passed, threshold ${opts.threshold}`,
    )
  }
  mkdirSync(RESULTS, { recursive: true })
  const stamp = new Date().toISOString()
  writeFileSync(
    join(RESULTS, 'last-run.txt'),
    `${stamp}\n${lines.join('\n')}\n`,
  )
  process.exitCode = failed ? 1 : 0
}
