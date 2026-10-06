import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import {
  isoWeek,
  landed,
  sample,
  weekStart,
} from '../tools/sample-landed.mjs'
import { git, tempRepo } from './helpers.mjs'

test('isoWeek follows ISO 8601, including the turn of the year', () => {
  assert.equal(isoWeek(new Date('2026-10-05T12:00:00Z')), '2026-W41')
  // a Thursday
  assert.equal(isoWeek(new Date('2026-01-01T12:00:00Z')), '2026-W01')
  // a Friday
  assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), '2026-W53')
  // a Monday
  assert.equal(isoWeek(new Date('2024-12-30T12:00:00Z')), '2025-W01')
})

test('the same seed gives the same sample, in the same order', () => {
  const items = Array.from({ length: 40 }, (_, i) => i)
  assert.deepEqual(
    sample(items, 5, '2026-W41'),
    sample(items, 5, '2026-W41'),
  )
  assert.notDeepEqual(
    sample(items, 5, '2026-W41'),
    sample(items, 5, '2026-W42'),
  )
})

test('a sample has no repeats and never more items than exist', () => {
  const items = ['a', 'b', 'c']
  const picked = sample(items, 10, 'x')
  assert.equal(picked.length, 3)
  assert.deepEqual([...picked].sort(), items)
})

// Commit with a fixed date, so the test gives the same answer in any
// week it runs.
function commitAt(repo, when, message) {
  process.env.GIT_COMMITTER_DATE = when
  try {
    git(repo, 'commit', '-q', '--allow-empty', '-m', message)
  } finally {
    delete process.env.GIT_COMMITTER_DATE
  }
}

test('weekStart is the Monday of the ISO week, and isoWeek agrees', () => {
  assert.equal(
    weekStart('2026-W41').toISOString(),
    '2026-10-05T00:00:00.000Z',
  )
  assert.equal(
    weekStart('2025-W01').toISOString(),
    '2024-12-30T00:00:00.000Z',
  )
  for (const w of ['2026-W01', '2026-W53', '2027-W01', '2028-W52'])
    assert.equal(isoWeek(weekStart(w)), w)
  assert.throws(() => weekStart('2026-W54'), /no such week/)
  assert.throws(() => weekStart('2026-41'), /not an ISO week/)
})

test('only changes on the base branch in that week, one per merge', () => {
  const repo = tempRepo('main')
  try {
    commitAt(repo, '2026-10-04T23:59:59Z', 'Sunday of week 40')
    commitAt(repo, '2026-10-05T00:00:00Z', 'second on main')
    git(repo, 'switch', '-q', '-c', 'feature')
    commitAt(repo, '2026-10-06T10:00:00Z', 'inside the branch 1')
    commitAt(repo, '2026-10-06T11:00:00Z', 'inside the branch 2')
    git(repo, 'switch', '-q', 'main')
    process.env.GIT_COMMITTER_DATE = '2026-10-07T09:00:00Z'
    try {
      git(
        repo,
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge feature',
        'feature',
      )
    } finally {
      delete process.env.GIT_COMMITTER_DATE
    }
    commitAt(repo, '2026-10-12T00:00:00Z', 'Monday of week 42')
    const subjects = (week) =>
      landed({ repo, base: 'main', week }).map((c) => c.subject)
    assert.deepEqual(subjects('2026-W41'), [
      'Merge feature',
      'second on main',
    ])
    assert.deepEqual(subjects('2026-W40'), ['Sunday of week 40'])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a commit that lands later does not change an earlier sample', () => {
  // A first version took "the last 7 days". A reviewer landed one more
  // commit and the same seed picked other changes.
  const repo = tempRepo('main')
  try {
    for (let i = 1; i <= 8; i++)
      commitAt(repo, `2026-10-0${6 + (i % 3)}T12:00:00Z`, `change ${i}`)
    const pick = () =>
      sample(landed({ repo, week: '2026-W41' }), 3, '2026-W41').map(
        (c) => c.subject,
      )
    const before = pick()
    commitAt(repo, '2026-10-13T12:00:00Z', 'change 9')
    assert.deepEqual(pick(), before)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
