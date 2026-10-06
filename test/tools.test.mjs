import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mutants, run } from '../tools/mutate.mjs'
import { checkTree } from '../tools/check-structure.mjs'

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'tools-test-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

test('mutants: one per operator, arrows and comments left alone', () => {
  const list = mutants(
    '// a > b\nexport const adult = (age) => age >= 18 && true\n',
  )
  assert.deepEqual(
    list.map((m) => `${m.line} ${m.from}->${m.to}`),
    ['2 >=->>', '2 &&->||', '2 true->false'],
  )
})

// #region tautology
const LIB = 'export const isAdult = (age) => age >= 18\n'
const TAUTOLOGY = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAdult } from './lib.mjs'
test('isAdult', () => assert.equal(isAdult(30), isAdult(30)))
`
const EDGE = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAdult } from './lib.mjs'
test('18 is adult, 17 is not', () => {
  assert.equal(isAdult(18), true)
  assert.equal(isAdult(17), false)
})
`

test('comparing a result with itself catches no mutant', () => {
  const dir = project({ 'lib.mjs': LIB, 'lib.test.mjs': TAUTOLOGY })
  try {
    const results = run({
      root: dir,
      target: 'lib.mjs',
      test: 'node --test lib.test.mjs',
    })
    assert.equal(results.length, 1)
    assert.equal(results[0].survived, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a test at the edge catches it', () => {
  const dir = project({ 'lib.mjs': LIB, 'lib.test.mjs': EDGE })
  try {
    const results = run({
      root: dir,
      target: 'lib.mjs',
      test: 'node --test lib.test.mjs',
    })
    assert.equal(results.filter((r) => r.survived).length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
// #endregion tautology

test('mutate refuses to start when the tests already fail', () => {
  const dir = project({
    'lib.mjs': LIB,
    'lib.test.mjs': "throw new Error('broken')\n",
  })
  try {
    assert.throws(
      () =>
        run({
          root: dir,
          target: 'lib.mjs',
          test: 'node --test lib.test.mjs',
        }),
      /fail before/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mutate refuses TypeScript, where < can be a bracket', () => {
  // A first version swapped Array<string> to Array<=string>. The build
  // broke, and a weak test scored 4 caught of 4.
  for (const target of ['lib.ts', 'view.tsx', 'view.jsx'])
    assert.throws(
      () => run({ root: '.', target, test: 'true' }),
      /only \.js, \.mjs and \.cjs/,
    )
})

// #region structure-test
test('structure: each rule reports file and line', () => {
  const dir = project({
    'app/server.mjs': 'const port = process.env.PORT\n',
    'app/store.mjs':
      'const dir = process.env.DATA_DIR\n' +
      "import { x } from '../test/helpers.mjs'\n",
    'app/big.mjs': 'x\n'.repeat(201),
    // A first version read only .mjs files. A reviewer found it.
    'app/old.js': 'const a = process.env.A\n',
    'app/old.cjs': 'const b = process.env.B\n',
  })
  try {
    const found = checkTree(dir).map(
      (p) => `${p.file}:${p.line} ${p.rule}`,
    )
    assert.deepEqual(found.sort(), [
      'app/big.mjs:201 max-lines',
      'app/old.cjs:1 env-in-one-place',
      'app/old.js:1 env-in-one-place',
      'app/store.mjs:1 env-in-one-place',
      'app/store.mjs:2 no-reach-out',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('structure: the companion app passes its own rules', () => {
  assert.deepEqual(
    checkTree(fileURLToPath(new URL('..', import.meta.url))),
    [],
  )
})
// #endregion structure-test

test('folder with a space: the structure test passes', () => {
  // A first version used .pathname, which keeps %20 for a space, so
  // this test failed in "my dir". The copy runs only the one test.
  const dir = mkdtempSync(join(tmpdir(), 'tools-test-'))
  try {
    const root = join(dir, 'my dir', 'c')
    const here = fileURLToPath(new URL('..', import.meta.url))
    for (const part of ['app', 'tools', 'test/tools.test.mjs'])
      cpSync(join(here, part), join(root, part), { recursive: true })
    const r = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-name-pattern=the companion app passes its own rules',
        'test/tools.test.mjs',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        // Under node --test this variable would make the child silent.
        env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      },
    )
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /# pass 1\n/, 'the copy ran one test')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('structure: exactly 200 lines is allowed, 201 is not', () => {
  // A first version counted the empty string after the final newline as
  // a line, so a file of exactly 200 lines failed. The sub-agent that
  // wrote chapter 7 found it.
  const dir = project({
    'app/a.mjs': 'x\n'.repeat(200),
    'app/b.mjs': 'x\n'.repeat(201),
  })
  try {
    assert.deepEqual(
      checkTree(dir).map((p) => `${p.file} ${p.message}`),
      ['app/b.mjs 201 lines, the limit is 200: split it'],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mutate runs a project that has dependencies and a data folder', () => {
  // A first version copied neither node_modules nor any folder named
  // data, so the clean run of such a project failed. A reviewer found
  // it.
  const dir = project({
    'node_modules/age-limit/package.json':
      '{"name":"age-limit","type":"module","main":"index.mjs"}',
    'node_modules/age-limit/index.mjs': 'export const LIMIT = 18\n',
    'src/data/limit.mjs': "export { LIMIT } from 'age-limit'\n",
    'lib.mjs':
      "import { LIMIT } from './src/data/limit.mjs'\n" +
      'export const isAdult = (age) => age >= LIMIT\n',
    'lib.test.mjs': EDGE,
  })
  try {
    const results = run({
      root: dir,
      target: 'lib.mjs',
      test: 'node --test lib.test.mjs',
    })
    assert.ok(results.length > 0)
    assert.equal(results.filter((r) => r.survived).length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('when the clean run fails, mutate shows why', () => {
  const dir = project({
    'lib.mjs': LIB,
    'lib.test.mjs': "throw new Error('the real reason')\n",
  })
  try {
    assert.throws(
      () =>
        run({
          root: dir,
          target: 'lib.mjs',
          test: 'node --test lib.test.mjs',
        }),
      /the real reason/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
