// #region claude-md-paths
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// The files in the git index: what the next commit publishes. A file
// that git ignores, or that was never added, is on your disk and not
// in anyone's clone. Outside a repository: null.
function published() {
  try {
    const out = execFileSync('git', ['ls-files', '--cached'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return new Set(out.split('\n').filter(Boolean))
  } catch {
    return null
  }
}

test('every file CLAUDE.md points at is in the repository', () => {
  // A rule that names a file the agent cannot find is a rule it cannot
  // follow. A path counts at the start of a code span or after "node".
  const text = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
  const POINTER = /`(?:node )?((?:app|tools|\.claude|test)\/[\w./-]+)/g
  const paths = [...text.matchAll(POINTER)].map((m) => m[1])
  assert.ok(paths.length >= 7, `only ${paths.length} paths found`)
  const files = published()
  for (const path of paths) {
    const there = files ? files.has(path) : existsSync(join(ROOT, path))
    assert.ok(there, `CLAUDE.md names ${path}, which is not published`)
  }
})
// #endregion claude-md-paths

import { readdirSync } from 'node:fs'

// #region frontmatter
// Enough YAML for these files: "key: value" lines between two ---
// lines, a block value ("key: >-", ">", "|" and so on, then indented
// lines) joined with spaces, and a list ("key:" then "  - item" lines).
// Any other line is an error: a file this parser cannot read may be one
// that Claude Code cannot read either.
export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!m) return null
  const meta = {}
  let last = null
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+- (.*)$/)
    if (item && last && Array.isArray(meta[last])) {
      meta[last].push(item[1].trim())
      continue
    }
    if (/^\s/.test(line) && last && !Array.isArray(meta[last])) {
      meta[last] = (meta[last] + ' ' + line.trim()).trim()
      continue
    }
    const kv = line.match(/^([\w-]+):(.*)$/)
    if (!kv) throw new Error(`frontmatter: cannot read "${line}"`)
    last = kv[1]
    const value = kv[2].trim()
    meta[last] =
      value === '' ? [] : /^[>|][+-]?$/.test(value) ? '' : value
  }
  return meta
}
// #endregion frontmatter

// A tools field as a list of names, in any of its three forms:
// "Read, Grep", "[Read, Grep]" or a YAML list. Quotes and a " # note"
// are removed: a reviewer found that "Edit" in quotes was not seen.
const unquote = (t) => t.trim().replace(/^(['"])(.*)\1$/, '$2')
export function toolList(value) {
  const items = Array.isArray(value)
    ? value
    : unquote(String(value ?? '').replace(/\s#.*$/, ''))
        .replace(/^\[|\]$/g, '')
        .split(',')
  return items
    .map((t) => unquote(t.replace(/\s#.*$/, '')))
    .filter(Boolean)
}

const skills = () =>
  readdirSync(join(ROOT, '.claude/skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

test('frontmatter reads plain, block and list values', () => {
  const text =
    '---\nname: a\ndescription: >\n  one\n  two\ntools:\n  - Read\n' +
    '  - Edit\n---\n'
  assert.deepEqual(frontmatter(text), {
    name: 'a',
    description: 'one two',
    tools: ['Read', 'Edit'],
  })
  assert.equal(frontmatter('no frontmatter'), null)
  assert.throws(() => frontmatter('---\nname a\n---\n'), /cannot read/)
})

test('skills: a matching name and a description that fits', () => {
  for (const name of skills()) {
    const file = join(ROOT, '.claude/skills', name, 'SKILL.md')
    const meta = frontmatter(readFileSync(file, 'utf8'))
    assert.ok(meta, `${name}: no frontmatter`)
    assert.equal(meta.name, name)
    assert.ok(meta.description, `${name}: no description`)
    assert.ok(
      meta.description.length > 40,
      `${name}: description too short to choose by`,
    )
    assert.ok(
      meta.description.length <= 1536,
      `${name}: description is over the 1,536-character cap`,
    )
  }
})

// #region skill-wiring
test('verify-app: Claude may load it and run its script', () => {
  const meta = frontmatter(
    readFileSync(
      join(ROOT, '.claude/skills/verify-app/SKILL.md'),
      'utf8',
    ),
  )
  // Most other fields change when or where the skill runs:
  // disable-model-invocation, paths, context, disallowed-tools. A
  // check for each bad value missed "True" and "true # x", so the test
  // allows these three fields and no other.
  assert.deepEqual(Object.keys(meta).sort(), [
    'allowed-tools',
    'description',
    'name',
  ])
  // Without the " *", a call with --url asks for permission.
  assert.equal(
    meta['allowed-tools'],
    'Bash(node ${CLAUDE_SKILL_DIR}/scripts/verify.mjs *)',
  )
})
// #endregion skill-wiring

test('every script a skill names exists', () => {
  for (const name of skills()) {
    const dir = join(ROOT, '.claude/skills', name)
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
    for (const [, path] of text.matchAll(
      /\$\{CLAUDE_SKILL_DIR\}\/([\w./-]+)/g,
    )) {
      assert.ok(
        existsSync(join(dir, path)),
        `${name}: ${path} is missing`,
      )
    }
  }
})

test('every subagent has the two required fields', () => {
  const dir = join(ROOT, '.claude/agents')
  for (const file of readdirSync(dir).filter((f) =>
    f.endsWith('.md'),
  )) {
    const meta = frontmatter(readFileSync(join(dir, file), 'utf8'))
    assert.ok(meta?.name, `${file}: no name`)
    assert.ok(meta?.description, `${file}: no description`)
  }
})

// #region critic-no-edit
test('the critic cannot edit files', () => {
  const meta = frontmatter(
    readFileSync(join(ROOT, '.claude/agents/critic.md'), 'utf8'),
  )
  // No tools field means every tool, Edit and Write included.
  const tools = toolList(meta.tools)
  assert.ok(tools.length > 0, 'critic.md must list its tools')
  for (const tool of ['Edit', 'Write', 'NotebookEdit'])
    assert.equal(tools.includes(tool), false, tool)
})

test('toolList reads all three forms of the tools field', () => {
  const want = ['Read', 'Edit']
  assert.deepEqual(toolList('Read, Edit'), want)
  assert.deepEqual(toolList('[Read, Edit]'), want)
  assert.deepEqual(toolList(['Read', 'Edit']), want)
  assert.deepEqual(toolList('"Read, Edit"'), want)
  assert.deepEqual(toolList("['Read', 'Edit']"), want)
  assert.deepEqual(toolList('Read, Edit # note'), want)
  assert.deepEqual(toolList(['Read', 'Edit # note']), want)
})
// #endregion critic-no-edit

// A cp -R copy of a linked worktree keeps the .git file, so git commands
// in the copy change the original. The critic must test in a clone.
test('the critic tests a change in a clone, not a cp -R copy', () => {
  const text = readFileSync(join(ROOT, '.claude/agents/critic.md'), 'utf8')
  assert.match(text, /git clone \. /)
  for (const line of text.split('\n'))
    if (/\bcp -R\b/.test(line)) assert.match(line, /Do not use `cp -R`/, line)
})
