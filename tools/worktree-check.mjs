#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const gitPath = (cwd, flag) =>
  execFileSync(
    'git',
    ['-C', cwd, 'rev-parse', '--path-format=absolute', flag],
    { encoding: 'utf8' },
  ).trim()

// #region shared
export function inMainCheckout(cwd) {
  return gitPath(cwd, '--git-dir') === gitPath(cwd, '--git-common-dir')
}
// #endregion shared

// #region port-for
export function portFor(cwd, base = 3000) {
  if (inMainCheckout(cwd)) return base
  const top = gitPath(cwd, '--show-toplevel')
  let h = 2166136261
  for (const c of top) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return base + 1 + ((h >>> 0) % 999)
}
// #endregion port-for

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = process.cwd()
  try {
    const main = inMainCheckout(cwd)
    console.log(`checkout: ${main ? 'main' : 'linked worktree'}`)
    console.log(`port: ${portFor(cwd)}`)
    if (main && process.argv.includes('--require-linked')) {
      console.error(
        'You are in the main checkout.\n' +
          'Start the session with: claude --worktree <name>',
      )
      process.exitCode = 1
    }
  } catch {
    console.error('worktree-check: not inside a git repository')
    process.exitCode = 2
  }
}
