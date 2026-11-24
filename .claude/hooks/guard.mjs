#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROTECTED = new Set(['main', 'master'])
const WRAPPERS = new Set([
  'env',
  'command',
  'builtin',
  'exec',
  'nohup',
  'time',
  'sudo',
])
const TAKES_VALUE = {
  sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T'],
  env: ['-u', '-C'],
  time: ['-o', '-f'],
}

// #region split
export function splitCommands(command) {
  const parts = []
  let current = ''
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      current += c
    } else if (c === '"' || c === "'") {
      quote = c
      current += c
    } else if (c === ';' || c === '|' || c === '&' || c === '\n') {
      parts.push(current)
      current = ''
    } else {
      current += c
    }
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}
// #endregion split

export function words(command) {
  const out = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (const m of command.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3])
  if (out.length) {
    out[0] = out[0].replace(/^\(+/, '')
    out[out.length - 1] = out.at(-1).replace(/\)+$/, '')
  }
  let wrapper = null
  while (out.length) {
    const w = out[0]
    if (WRAPPERS.has(w)) wrapper = w
    else if (wrapper && w.startsWith('-')) {
      if (TAKES_VALUE[wrapper]?.includes(w)) out.shift()
    } else if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) break
    out.shift()
  }
  if (out[0] === 'git') {
    while (out[1] === '-C' || out[1] === '-c') out.splice(1, 2)
  }
  return out
}

function currentBranch(cwd) {
  try {
    return execFileSync(
      'git',
      ['-C', cwd, 'branch', '--show-current'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim()
  } catch {
    return ''
  }
}

// #region push-rules
function checkGit(words, cwd) {
  if (words[0] !== 'git') return null
  const sub = words[1]
  if (
    (sub === 'commit' || sub === 'push') &&
    words.includes('--no-verify')
  ) {
    return (
      'Do not skip the pre-commit checks (--no-verify). ' +
      'Fix what they report.'
    )
  }
  const short = (letter) =>
    words.some((w) =>
      new RegExp(`^-[a-zA-Z]*${letter}[a-zA-Z]*$`).test(w),
    )
  if (sub === 'commit' && short('n')) {
    return (
      'git commit -n skips the pre-commit checks. ' +
      'Fix what they report.'
    )
  }
  if (sub !== 'push') return null

  const force =
    short('f') || words.some((w) => w === '--force' || /^\+/.test(w))
  if (force && !words.some((w) => w.startsWith('--force-with-lease'))) {
    return 'Use --force-with-lease, never a bare --force.'
  }
  const targets = words.slice(2).filter((w) => !w.startsWith('-'))
  const refs = targets
    .slice(1)
    .map((r) => r.replace(/^\+/, '').split(':').pop())
  for (const ref of refs.length ? refs : ['HEAD']) {
    const name = (ref === 'HEAD' ? currentBranch(cwd) : ref).replace(
      /^refs\/heads\//,
      '',
    )
    if (PROTECTED.has(name)) {
      return (
        `Do not push to ${name}. ` +
        'Push a branch and open a pull request.'
      )
    }
  }
  return null
}
// #endregion push-rules

// #region env-rule
function checkFile(filePath) {
  const name = basename(filePath ?? '')
  if (
    name === '.env' ||
    (name.startsWith('.env.') && name !== '.env.example')
  ) {
    return (
      `Do not write ${name}: it holds secrets. ` +
      'Ask the person to change it.'
    )
  }
  return null
}
// #endregion env-rule

// #region decide
export function decide(event) {
  const {
    tool_name: tool,
    tool_input: input = {},
    cwd = process.cwd(),
  } = event
  if (tool === 'Bash') {
    for (const part of splitCommands(input.command ?? '')) {
      const reason = checkGit(words(part), cwd)
      if (reason) return { block: true, reason }
    }
  }
  if (tool === 'Write' || tool === 'Edit') {
    const reason = checkFile(input.file_path)
    if (reason) return { block: true, reason }
  }
  return { block: false }
}

async function main() {
  let event
  try {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    event = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    console.error('guard: could not read the hook input as JSON')
    process.exit(2)
  }
  const { block, reason } = decide(event)
  if (block) {
    console.error(reason)
    process.exit(2)
  }
  process.exit(0)
}
// #endregion decide

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
