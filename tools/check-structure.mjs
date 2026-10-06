#!/usr/bin/env node
// Structure rules for app/. Each rule exists because an agent broke it
// once. Output: one line per problem, "file:line rule: message". Exit 1
// on any problem.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// #region rules
export const RULES = [
  {
    id: 'max-lines',
    why: 'A long file collects every change. Split it early.',
    check(file, lines) {
      const n = lines.length
      return n > 200
        ? [
            {
              line: 201,
              message: `${n} lines, the limit is 200: split it`,
            },
          ]
        : []
    },
  },
  {
    id: 'no-reach-out',
    why: 'App code must not depend on tests, tools or agent config.',
    check(file, lines) {
      return lines.flatMap((text, i) =>
        /from\s+['"][./]*(test|tools|\.claude)\//.test(text)
          ? [
              {
                line: i + 1,
                message: 'import from outside app/: move it to app/',
              },
            ]
          : [],
      )
    },
  },
  {
    id: 'env-in-one-place',
    why: 'Config is read in one file: one place to look.',
    check(file, lines) {
      if (file === 'app/server.mjs') return []
      return lines.flatMap((text, i) =>
        text.includes('process.env')
          ? [
              {
                line: i + 1,
                message: 'process.env: read it in app/server.mjs',
              },
            ]
          : [],
      )
    },
  },
]
// #endregion rules

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory()
      ? filesUnder(path)
      : /\.[cm]?js$/.test(path) // .js, .mjs and .cjs
        ? [path]
        : []
  })
}

export function checkTree(root) {
  const problems = []
  for (const path of filesUnder(join(root, 'app'))) {
    const file = relative(root, path).split('\\').join('/')
    // A final newline ends the last line; it does not start one more.
    const lines = readFileSync(path, 'utf8')
      .replace(/\n$/, '')
      .split('\n')
    for (const rule of RULES) {
      for (const p of rule.check(file, lines))
        problems.push({ file, rule: rule.id, ...p })
    }
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root =
    process.argv[2] ?? join(fileURLToPath(import.meta.url), '../..')
  const problems = checkTree(root)
  for (const p of problems)
    console.log(`${p.file}:${p.line} ${p.rule}: ${p.message}`)
  console.log(
    `structure: ${problems.length} problem${problems.length === 1 ? '' : 's'}`,
  )
  process.exitCode = problems.length ? 1 : 0
}
