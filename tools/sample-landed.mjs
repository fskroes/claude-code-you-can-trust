#!/usr/bin/env node
// Pick a few changes that landed on the main branch in one ISO week, at
// random, to review by hand. The week is both the pool and the seed, so
// a week always gives the same sample, and anyone can run it again to
// see that the sample was not chosen by hand.
//
//   node tools/sample-landed.mjs                    5 changes from last week
//   node tools/sample-landed.mjs --week 2026-W41    that week, again
//   node tools/sample-landed.mjs --n 3 --base main
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function isoWeek(date) {
  const d = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    ),
  )
  const day = d.getUTCDay() || 7 // Monday 1 ... Sunday 7
  // the Thursday of this week decides the year
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// The Monday 00:00 UTC that starts an ISO week. Week 1 is the week
// that holds 4 January.
export function weekStart(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(week)
  if (!m) throw new Error(`not an ISO week: ${week}`)
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4))
  const monday = new Date(jan4)
  monday.setUTCDate(4 - ((jan4.getUTCDay() || 7) - 1))
  monday.setUTCDate(monday.getUTCDate() + (Number(m[2]) - 1) * 7)
  if (isoWeek(monday) !== week) throw new Error(`no such week: ${week}`)
  return monday
}

// #region shuffle
// A small seeded random generator (mulberry32), seeded from a hash of
// the text.
function random(seedText) {
  let h = 2166136261
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sample(items, n, seedText) {
  const next = random(seedText)
  const list = [...items]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list.slice(0, n)
}
// #endregion shuffle

// #region landed
// The changes that landed on base in one ISO week, by commit date.
// --first-parent gives one entry per merge into base, not every commit
// inside a branch. A first version took "the last 7 days": a commit
// that landed later changed the pool, and with it the whole sample.
export function landed({ repo = '.', base = 'main', week }) {
  const from = weekStart(week).getTime() / 1000
  const to = from + 7 * 86_400
  const out = execFileSync(
    'git',
    [
      '-C',
      repo,
      'log',
      '--first-parent',
      '--format=%h%x09%ct%x09%p%x09%cs%x09%s',
      base,
    ],
    { encoding: 'utf8' },
  )
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, time, parents, date, subject] = line.split('\t')
      return { sha, time: Number(time), parents, date, subject }
    })
    .filter((c) => c.time >= from && c.time < to)
    .filter((c) => c.parents !== '') // the first commit is no change
    .map(({ sha, date, subject }) => ({ sha, date, subject }))
}
// #endregion landed

function parseArgs(argv, now = new Date()) {
  const lastWeek = new Date(now.getTime() - 7 * 86_400_000)
  const opts = {
    n: 5,
    base: 'main',
    repo: '.',
    week: isoWeek(lastWeek),
  }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    if (!(key in opts) || argv[i + 1] === undefined)
      throw new Error(`bad argument: ${argv[i]}`)
    opts[key] = key === 'n' ? Number(argv[++i]) : argv[++i]
  }
  if (!Number.isInteger(opts.n) || opts.n < 1)
    throw new Error('--n must be a whole number above 0')
  weekStart(opts.week) // a bad week stops here
  return opts
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2))
    const all = landed(opts)
    const picked = sample(all, opts.n, opts.week)
    for (const c of picked)
      console.log(`${c.sha} ${c.date} ${c.subject}`)
    const noun = all.length === 1 ? 'change' : 'changes'
    console.log(
      `sampled ${picked.length} of ${all.length} ${noun}, week ${opts.week}`,
    )
  } catch (err) {
    console.error(`sample-landed: ${err.message}`)
    process.exitCode = 2
  }
}
