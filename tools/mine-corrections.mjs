#!/usr/bin/env node
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
export function typedText(entry) {
  if (entry?.type !== 'user' || entry.isMeta || entry.isSidechain)
    return null
  if (entry.isCompactSummary || entry.isVisibleInTranscriptOnly)
    return null
  if (entry.origin && entry.origin.kind !== 'human') return null
  if (entry.entrypoint === 'sdk-cli') return null
  const content = entry.message?.content
  let text = null
  if (typeof content === 'string') text = content
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
export function classify(text) {
  if (text.startsWith('[Request interrupted by user'))
    return 'interrupt'
  const start = text.slice(0, 120)
  return PATTERNS.find((p) => p.re.test(start))?.id ?? null
}
// #endregion classify

function transcriptFiles(dir) {
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
