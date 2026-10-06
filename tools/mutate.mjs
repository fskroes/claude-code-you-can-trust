#!/usr/bin/env node
// Does any test notice when the code is wrong? Change one operator at a
// time in a copy of the project, run the tests, and count the changes
// nobody noticed.
//
//   node tools/mutate.mjs app/store.mjs
//   node tools/mutate.mjs app/store.mjs --test "node --test test/app.test.mjs"
//   node tools/mutate.mjs lib.mjs --root ../other-project
//   node tools/mutate.mjs lib.mjs --timeout 900     a slow suite
//
// A "survivor" is a change the tests did not catch. Exit 1 when any
// survive.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// #region operators
const SWAPS = [
  [/(?<![=!<>])===(?!=)/g, '!=='],
  [/!==(?!=)/g, '==='],
  [/(?<![=<>!-])>(?![=>])/g, '>='],
  [/(?<![<=])>=/g, '>'],
  [/(?<![<=])<(?![=<])/g, '<='],
  [/<=/g, '<'],
  [/&&/g, '||'],
  [/\|\|/g, '&&'],
  [/\btrue\b/g, 'false'],
  [/\bfalse\b/g, 'true'],
]
// #endregion operators

export function mutants(source) {
  const out = []
  source.split('\n').forEach((text, i) => {
    const trimmed = text.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('import '))
      return
    for (const [pattern, to] of SWAPS) {
      for (const m of text.matchAll(pattern)) {
        const mutated =
          text.slice(0, m.index) +
          to +
          text.slice(m.index + m[0].length)
        out.push({ line: i + 1, from: m[0], to, text: mutated })
      }
    }
  })
  return out
}

// The copy holds what git would publish, or, outside a repository,
// everything but .git and node_modules. node_modules is linked, not
// copied, so a project with dependencies runs. A first version left it
// out, and with it every project that has a dependency.
function copyProject(root, work) {
  let files = null
  try {
    files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
      .split('\0')
      .filter((f) => f && existsSync(join(root, f)))
  } catch {}
  if (files)
    for (const f of files) {
      mkdirSync(join(work, f, '..'), { recursive: true })
      cpSync(join(root, f), join(work, f))
    }
  else
    cpSync(root, work, {
      recursive: true,
      filter: (src) =>
        !/(^|\/)(node_modules|\.git)(\/|$)/.test(
          src.slice(root.length),
        ),
    })
  if (existsSync(join(root, 'node_modules')))
    symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'))
}

export function run({ root, target, test, timeout = 600 }) {
  // In TypeScript and JSX, < and > are also brackets. A swap there
  // breaks the build, the tests fail, and the mutant counts as caught.
  if (!/\.[cm]?js$/.test(target))
    throw new Error(`${target}: only .js, .mjs and .cjs files`)
  const work = mkdtempSync(join(tmpdir(), 'mutate-'))
  try {
    copyProject(root, work)
    const file = join(work, target)
    const original = readFileSync(file, 'utf8')
    const lines = original.split('\n')
    // Inside a node --test run, NODE_TEST_CONTEXT makes a nested node
    // --test report to the parent and exit 0 even when it fails. Remove
    // it.
    const { NODE_TEST_CONTEXT, ...env } = process.env
    const tests = (limitMs) =>
      spawnSync(test, {
        cwd: work,
        env,
        shell: true,
        encoding: 'utf8',
        timeout: limitMs,
        maxBuffer: 64 * 1024 * 1024,
      })
    const started = Date.now()
    const baseline = tests(timeout * 1000)
    if (baseline.status !== 0) {
      const out = (baseline.stdout ?? '') + (baseline.stderr ?? '')
      const tail = out.trim().split('\n').slice(-40).join('\n')
      throw new Error(
        baseline.error?.code === 'ETIMEDOUT'
          ? `the tests ran over ${timeout} s before any change; ` +
              'raise --timeout'
          : `the tests fail before any change; fix them first\n${tail}`,
      )
    }
    // A mutant that makes the suite hang is caught when it runs three
    // times as long as the clean suite, and at least 10 s.
    const limitMs = Math.max(10_000, 3 * (Date.now() - started))

    const results = []
    for (const m of mutants(original)) {
      const changed = [...lines]
      changed[m.line - 1] = m.text
      writeFileSync(file, changed.join('\n'))
      results.push({ ...m, survived: tests(limitMs).status === 0 })
    }
    writeFileSync(file, original)
    return results
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function parseArgs(argv) {
  const opts = {
    target: null,
    test: 'npm test --silent',
    timeout: 600,
    root: join(fileURLToPath(import.meta.url), '../..'),
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--test') opts.test = argv[++i]
    else if (argv[i] === '--timeout') opts.timeout = Number(argv[++i])
    else if (argv[i] === '--root') opts.root = resolve(argv[++i])
    else if (!opts.target) opts.target = argv[i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (!opts.target)
    throw new Error(
      'name the file to mutate, for example app/store.mjs',
    )
  return opts
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2))
    const results = run(opts)
    const survivors = results.filter((r) => r.survived)
    for (const s of survivors)
      console.log(
        `survived ${opts.target}:${s.line} ${s.from} -> ${s.to}`,
      )
    console.log(
      `mutants: ${results.length}, caught ${results.length - survivors.length}, survived ${survivors.length}`,
    )
    process.exitCode = survivors.length ? 1 : 0
  } catch (err) {
    console.error(`mutate: ${err.message}`)
    process.exitCode = 2
  }
}
