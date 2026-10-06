#!/usr/bin/env node
// The outer loop. Bug reports arrive in inbox/ (from a form, an email
// rule, a chat bot: anything that can write a file). For each new
// report, run Claude Code once, headless, with read-only tools, and
// append its verdict to triage/queue.md. A person reads the queue and
// decides what to fix. Nothing here edits code.
//
//   node tools/triage-inbox.mjs
//   node tools/triage-inbox.mjs --claude ./path/to/claude
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERDICTS = ['REPRODUCED', 'NOT REPRODUCED', 'UNCLEAR']

// #region tools
// Read, and run three checks. No general "node -e" or "curl": either
// one can run any code or send data anywhere. The verify rule has no
// "*": with arguments, --url could point the checks at another host.
// No Skill rule either: the skill's own allowed-tools is that wider
// rule. tools/request.mjs is the narrow way to make other requests.
export const ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash(npm test)',
  'Bash(node .claude/skills/verify-app/scripts/verify.mjs)',
  'Bash(node tools/request.mjs *)',
].join(',')
// #endregion tools

// #region new-reports
const hash = (text) =>
  createHash('sha256').update(text).digest('hex').slice(0, 16)

export function newReports(root, seen) {
  const dir = join(root, 'inbox')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((name) => ({
      name,
      text: readFileSync(join(dir, name), 'utf8'),
    }))
    .filter((r) => seen[r.name] !== hash(r.text))
}
// #endregion new-reports

// #region verdict
// The model's answer is checked by code before anyone trusts it.
export function parseResult(stdout) {
  let out
  try {
    out = JSON.parse(stdout)
  } catch {
    return { ok: false, why: 'claude did not print JSON' }
  }
  // "null", "42" and "[1]" are JSON too, but not a result object.
  if (typeof out !== 'object' || out === null || Array.isArray(out))
    return { ok: false, why: 'claude did not print a JSON object' }
  if (out.is_error)
    return {
      ok: false,
      why: `run ended with an error (${out.subtype})`,
    }
  if (out.subtype !== 'success')
    return { ok: false, why: `run ended with ${out.subtype}` }
  const text = String(out.result ?? '').trim()
  // The prompt asks for the verdict as the first word. A real run
  // answered "**NOT REPRODUCED**", in bold. Strip Markdown marks before
  // reading it.
  const start = text.replace(/^[\s*#_>`]+/, '')
  // The whole word, in capitals: "REPRODUCEDX" and "Reproduced" are
  // not verdicts.
  const verdict = VERDICTS.find(
    (v) => start.startsWith(v) && !/^\w/.test(start.slice(v.length)),
  )
  if (!verdict)
    return {
      ok: false,
      why: `no verdict at the start: "${text.slice(0, 30)}"`,
    }
  return {
    ok: true,
    verdict,
    text,
    turns: out.num_turns,
    cost: out.total_cost_usd ?? 0,
  }
}
// #endregion verdict

export function triage(
  root,
  { claude = 'claude', now = new Date() } = {},
) {
  const statePath = join(root, 'triage', 'seen.json')
  mkdirSync(join(root, 'triage'), { recursive: true })
  const seen = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, 'utf8'))
    : {}
  const prompt = readFileSync(
    join(root, 'prompts', 'triage.md'),
    'utf8',
  )
  const summary = { done: 0, failed: 0, lines: [] }

  for (const report of newReports(root, seen)) {
    // #region run
    const run = spawnSync(
      claude,
      [
        '-p',
        `${prompt}\n\n## The report (${report.name})\n\n${report.text}`,
        '--output-format',
        'json',
        '--permission-mode',
        'dontAsk',
        '--allowedTools',
        ALLOWED_TOOLS,
        '--max-turns',
        '25',
        // Load this repository's settings, not the user's, so the job
        // depends less on the machine it runs on.
        '--setting-sources',
        'project,local',
      ],
      { cwd: root, encoding: 'utf8', timeout: 15 * 60_000 },
    )
    // #endregion run
    const result = parseResult(run.stdout ?? '')
    const stamp = now.toISOString().slice(0, 16).replace('T', ' ')
    if (!result.ok) {
      // Not marked as seen: the next run tries this report again.
      summary.failed++
      summary.lines.push(
        `${stamp} FAILED ${report.name}: ${result.why}`,
      )
      continue
    }
    appendFileSync(
      join(root, 'triage', 'queue.md'),
      `\n## ${stamp} ${report.name}: ${result.verdict}\n\n${result.text}\n`,
    )
    seen[report.name] = hash(report.text)
    writeFileSync(statePath, JSON.stringify(seen, null, 2) + '\n')
    summary.done++
    summary.lines.push(
      `${stamp} ${result.verdict} ${report.name} (${result.turns} turns, $${result.cost.toFixed(2)})`,
    )
  }
  appendFileSync(
    join(root, 'triage', 'log.txt'),
    summary.lines.map((l) => l + '\n').join(''),
  )
  return summary
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--claude')
  const claude = i > 0 ? process.argv[i + 1] : 'claude'
  const root = join(fileURLToPath(import.meta.url), '../..')
  const summary = triage(root, { claude })
  for (const line of summary.lines) console.log(line)
  console.log(`triage: ${summary.done} done, ${summary.failed} failed`)
  process.exitCode = summary.failed ? 1 : 0
}
