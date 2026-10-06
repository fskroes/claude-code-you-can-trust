import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../app/server.mjs'
import { isValidUrl, newCode } from '../app/store.mjs'

async function withApp(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'shortlinks-'))
  const app = createApp({ dataDir, commit: 'abc1234' })
  await new Promise((resolve) => app.listen(0, resolve))
  const base = `http://127.0.0.1:${app.address().port}`
  try {
    await fn(base, dataDir)
  } finally {
    // Without this, a response that never finished keeps close()
    // waiting, and a failing test hangs instead of failing.
    app.closeAllConnections()
    await new Promise((resolve) => app.close(resolve))
    rmSync(dataDir, { recursive: true, force: true })
  }
}

test('healthz reports the commit the process was started with', async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/healthz`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.commit, 'abc1234')
    assert.equal(body.links, 0)
  })
})

test('a created link redirects and counts the visit', async () => {
  await withApp(async (base, dataDir) => {
    const created = await fetch(`${base}/links`, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/a' }),
    })
    assert.equal(created.status, 201)
    const { code, short } = await created.json()
    assert.match(code, /^[a-z2-9]{6}$/)

    const visit = await fetch(`${base}${short}`, { redirect: 'manual' })
    assert.equal(visit.status, 302)
    assert.equal(visit.headers.get('location'), 'https://example.com/a')

    const saved = JSON.parse(
      readFileSync(join(dataDir, 'links.json'), 'utf8'),
    )
    assert.equal(saved[code].visits, 1)
  })
})

test('bad input gets a 4xx, not a crash', async () => {
  await withApp(async (base) => {
    const post = (body) =>
      fetch(`${base}/links`, { method: 'POST', body })
    assert.equal((await post('not json')).status, 400)
    assert.equal(
      (await post(JSON.stringify({ url: 'javascript:alert(1)' })))
        .status,
      400,
    )
    assert.equal((await post('x'.repeat(5000))).status, 413)
    assert.equal((await fetch(`${base}/l/zzzzzz`)).status, 404)
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
  })
})

// #region newline-regression
// Found by the outer loop: a report said "the whole site is down" after
// someone shortened a URL copied from a PDF. The URL held a line break.
test('a line break in a URL: stored parsed, redirects', async () => {
  await withApp(async (base) => {
    const created = await fetch(`${base}/links`, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/a\nb' }),
    })
    assert.equal(created.status, 201)
    const { short, url } = await created.json()
    assert.equal(url, 'https://example.com/ab')
    const visit = await fetch(`${base}${short}`, { redirect: 'manual' })
    assert.equal(visit.status, 302)
    assert.equal(
      visit.headers.get('location'),
      'https://example.com/ab',
    )
  })
})

// The triage run found a second way to the same crash: an en dash,
// which PDFs put where a hyphen was. Node refuses a header character
// above U+00FF.
test('an en dash in a URL: stored encoded, redirects', async () => {
  await withApp(async (base) => {
    const created = await fetch(`${base}/links`, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/2026–report' }),
    })
    const { short, url } = await created.json()
    assert.equal(url, 'https://example.com/2026%E2%80%93report')
    const visit = await fetch(`${base}${short}`, { redirect: 'manual' })
    assert.equal(visit.status, 302)
  })
})

test(
  'an error in one request gives a 500; the server runs on',
  { skip: process.getuid?.() === 0 },
  async () => {
    await withApp(async (base, dataDir) => {
      chmodSync(dataDir, 0o555) // the next write fails
      try {
        const created = await fetch(`${base}/links`, {
          method: 'POST',
          body: JSON.stringify({ url: 'https://example.com/x' }),
        })
        assert.equal(created.status, 500)
        assert.equal((await fetch(`${base}/healthz`)).status, 200)
      } finally {
        chmodSync(dataDir, 0o755)
      }
    })
  },
)
// #endregion newline-regression

test('isValidUrl accepts http and https only', () => {
  assert.equal(isValidUrl('https://example.com'), true)
  assert.equal(isValidUrl('http://example.com/x?y=1'), true)
  assert.equal(isValidUrl('ftp://example.com'), false)
  assert.equal(isValidUrl('example.com'), false)
  assert.equal(isValidUrl(42), false)
  assert.equal(
    isValidUrl('https://example.com/' + 'a'.repeat(2048)),
    false,
  )
})

test('newCode uses only the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++)
    assert.match(newCode(), /^[a-km-np-z2-9]{6}$/)
})
