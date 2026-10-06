#!/usr/bin/env node
// Where do you correct the agent? Read your Claude Code transcripts,
// keep the prompts you typed, and count the ones that correct or stop
// the agent.
//
//   node tools/mine-corrections.mjs                       every project in ~/.claude/projects
//   node tools/mine-corrections.mjs ~/.claude/projects/-home-you-shortlinks
//   node tools/mine-corrections.mjs <dir> --json
//
// The transcript format is internal to Claude Code and can change in
// any release. This script reads only a few fields and skips every line
// it does not understand.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// #region patterns
export const PATTERNS = [
  { id: 'no', re: /^(no|nope)\b/i },
  { id: 'stop', re: /^(stop|wait|hold on)\b/i },
  { id: 'dont', re: /^(don'?t|do not|never)\b/i },
  { id: 'wrong', re: /\b(that'?s wrong|is wrong|not what i)\b/i },
  { id: 'wrong', re: /\b(that is not|that'?s not)\b/i },
  { id: 'why', re: /^why (did|do|are|is) /i },
  {
    id: 'again',
    re: /\b(i (already )?said|as i said|once again)\b|\bagain,/i,
  },
  { id: 'instead', re: /\binstead\b/i },
  { id: 'undo', re: /^(undo|revert|roll back)\b/i },
]
// #endregion patterns

// #region typed-text
// The text a person typed, or null for anything else: tool results,
// system notes, slash command wrappers, subagent prompts.
export function typedText(entry) {
  if (entry?.type !== 'user' || entry.isMeta || entry.isSidechain)
    return null
  // A compaction summary is stored as a user turn. So are notifications
  // and subagent reports; origin.kind says who sent those. Many typed
  // prompts have no origin at all, so a missing origin counts as you.
  if (entry.isCompactSummary || entry.isVisibleInTranscriptOnly)
    return null
  if (entry.origin && entry.origin.kind !== 'human') return null
  // A claude -p run writes its prompt as a user turn too, with the
  // entrypoint sdk-cli. A script wrote that prompt, not you.
  if (entry.entrypoint === 'sdk-cli') return null
  const content = entry.message?.content
  let text = null
  if (typeof content === 'string') text = content
  // A list of parts counts when every part is text or an image (a
  // pasted image). A tool_result part means the turn is not a prompt.
  else if (
    Array.isArray(content) &&
    content.every((p) => p?.type === 'text' || p?.type === 'image')
  ) {
    const parts = content.filter((p) => p.type === 'text')
    if (parts.length) text = parts.map((p) => p.text).join('\n')
  }
  if (text === null) return null
  text = text.trim()
  if (!text || text.startsWith('<')) return null
  return text
}
// #endregion typed-text

// #region classify
// A correction comes first in a message. Look at the start only, so a
// long pasted log that contains "wrong" somewhere is not counted.
export function classify(text) {
  if (text.startsWith('[Request interrupted by user'))
    return 'interrupt'
  const start = text.slice(0, 120)
  return PATTERNS.find((p) => p.re.test(start))?.id ?? null
}
// #endregion classify

function transcriptFiles(dir) {
  // Top-level .jsonl files only: subagent transcripts live in
  // subdirectories, and their "user" turns were written by the main
  // agent, not by you.
  const own = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(dir, f))
  if (own.length) return own
  return readdirSync(dir)
    .map((d) => join(dir, d))
    .filter((d) => statSync(d).isDirectory())
    .flatMap((d) =>
      readdirSync(d)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(d, f)),
    )
}

export function mine(dirs) {
  const result = { prompts: 0, unreadable: 0, counts: {}, examples: {} }
  for (const dir of dirs) {
    for (const file of transcriptFiles(dir)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        let entry
        try {
          entry = JSON.parse(line)
        } catch {
          result.unreadable++
          continue
        }
        const text = typedText(entry)
        if (text === null) continue
        result.prompts++
        const kind = classify(text)
        if (!kind) continue
        result.counts[kind] = (result.counts[kind] ?? 0) + 1
        const list = (result.examples[kind] ??= [])
        if (list.length < 3)
          list.push(text.replace(/\s+/g, ' ').slice(0, 60))
      }
    }
  }
  return result
}

// #region report
export function format(result) {
  const lines = []
  const total = Object.values(result.counts).reduce((a, b) => a + b, 0)
  const share = result.prompts
    ? Math.round((100 * total) / result.prompts)
    : 0
  lines.push(`prompts you typed: ${result.prompts}`)
  lines.push(`corrections and interrupts: ${total} (${share}%)`)
  const kinds = Object.entries(result.counts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
  for (const [kind, n] of kinds) {
    lines.push(`  ${kind}: ${n}`)
    for (const ex of result.examples[kind]) lines.push(`    "${ex}"`)
  }
  if (result.unreadable)
    lines.push(`lines skipped (not JSON): ${result.unreadable}`)
  return lines.join('\n')
}
// #endregion report

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const dirs = args.filter((a) => a !== '--json')
  if (!dirs.length) dirs.push(join(homedir(), '.claude', 'projects'))
  const result = mine(dirs)
  console.log(json ? JSON.stringify(result, null, 2) : format(result))
}
