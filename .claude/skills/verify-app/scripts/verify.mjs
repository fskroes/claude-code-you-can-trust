#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
)

export function parseArgs(argv) {
  const opts = { url: null, expectCommit: null, allowRemote: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow-remote') {
      opts.allowRemote = true
      continue
    }
    if (argv[i] === '--url') opts.url = argv[++i]
    else if (argv[i] === '--expect-commit')
      opts.expectCommit = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
    if (opts.url === undefined || opts.expectCommit === undefined)
      throw new Error(`${argv[i - 1]} needs a value`)
  }
  if (opts.expectCommit && !opts.url)
    throw new Error('--expect-commit needs --url')
  // #region local-only
  if (opts.url && !opts.allowRemote) {
    const host = new URL(opts.url).hostname
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
      throw new Error(`${host} is not this machine: add --allow-remote`)
  }
  // #endregion local-only
  return opts
}

export function startApp(dataDir, commit = 'local') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['app/server.mjs'], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        PORT: '0',
        DATA_DIR: dataDir,
        APP_COMMIT: commit,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(
        new Error(`the app did not start in 10 s. Output:\n${output}`),
      )
    }, 10_000)
    const onData = (chunk) => {
      output += chunk
      const match = output.match(/http:\/\/localhost:(\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve({
          base: `http://127.0.0.1:${match[1]}`,
          stop: () => stop(child),
          output: () => output,
        })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(
        new Error(
          `the app exited with code ${code}. Output:\n${output}`,
        ),
      )
    })
  })
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null)
      return resolve()
    child.removeAllListeners('exit')
    child.on('exit', resolve)
    child.kill()
  })
}

// #region checks
const shown = (url) => JSON.stringify(url)

export async function runChecks(
  base,
  { expectCommit, dataDir, timeoutMs = 5000 } = {},
) {
  const results = []
  const get = (url, init = {}) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  const check = async (name, fn) => {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (err) {
      const why =
        err.name === 'TimeoutError'
          ? `no answer in ${timeoutMs} ms`
          : err.message
      results.push({ name, ok: false, why })
    }
  }
  const expect = (cond, why) => {
    if (!cond) throw new Error(why)
  }

  let created
  await check('health', async () => {
    const res = await get(`${base}/healthz`)
    expect(res.status === 200, `expected 200, got ${res.status}`)
    const body = await res.json()
    expect(body.ok === true, 'ok is not true')
    if (expectCommit) {
      expect(
        body.commit === expectCommit,
        `serves ${body.commit}, expected ${expectCommit}`,
      )
    }
  })
  await check('create', async () => {
    const res = await get(`${base}/links`, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/verify' }),
    })
    expect(res.status === 201, `expected 201, got ${res.status}`)
    created = await res.json()
  })
  if (dataDir) {
    await check('stores in DATA_DIR', async () => {
      const file = join(dataDir, 'links.json')
      expect(existsSync(file), `nothing written to ${file}`)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      expect(
        created && saved[created.code],
        'the new link is not in it',
      )
    })
  }
  await check('redirect', async () => {
    expect(created, 'no link was created')
    const res = await get(`${base}${created.short}`, {
      redirect: 'manual',
    })
    expect(res.status === 302, `expected 302, got ${res.status}`)
    const location = res.headers.get('location')
    expect(
      location === 'https://example.com/verify',
      `redirects to ${location}`,
    )
  })
  // #region odd-characters
  await check('odd characters', async () => {
    for (const url of [
      'https://example.com/a\nb',
      'https://example.com/2026–report',
    ]) {
      const res = await get(`${base}/links`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      })
      expect(
        res.status === 201,
        `create ${shown(url)}: expected 201, got ${res.status}`,
      )
      const { short } = await res.json()
      const visit = await get(`${base}${short}`, {
        redirect: 'manual',
      })
      expect(
        visit.status === 302,
        `open ${shown(url)}: expected 302, got ${visit.status}`,
      )
    }
    const health = await get(`${base}/healthz`)
    expect(health.status === 200, 'the app stopped answering')
  })
  // #endregion odd-characters
  await check('reject bad url', async () => {
    const res = await get(`${base}/links`, {
      method: 'POST',
      body: '{"url":"ftp://x"}',
    })
    expect(res.status === 400, `expected 400, got ${res.status}`)
  })
  await check('unknown code', async () => {
    const res = await get(`${base}/l/zzzzzz`)
    expect(res.status === 404, `expected 404, got ${res.status}`)
  })
  return { results, created }
}
// #endregion checks

export function report(results, print = console.log) {
  for (const r of results)
    print(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.why}`)
  const failed = results.filter((r) => !r.ok).length
  print(`verify: ${results.length - failed} passed, ${failed} failed`)
  return failed === 0 ? 0 : 1
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`verify: ${err.message}`)
    return 2
  }
  if (opts.url) {
    const { results } = await runChecks(
      opts.url.replace(/\/$/, ''),
      opts,
    )
    return report(results)
  }

  const dataDir = mkdtempSync(join(tmpdir(), 'verify-'))
  try {
    let app = await startApp(dataDir)
    const { results, created } = await runChecks(app.base, { dataDir })
    await app.stop()

    // #region restart
    app = await startApp(dataDir)
    try {
      const res = await fetch(
        `${app.base}${created?.short ?? '/l/none00'}`,
        { redirect: 'manual', signal: AbortSignal.timeout(5000) },
      )
      results.push(
        res.status === 302
          ? { name: 'survives restart', ok: true }
          : {
              name: 'survives restart',
              ok: false,
              why: `expected 302 after restart, got ${res.status}`,
            },
      )
    } finally {
      await app.stop()
    }
    // #endregion restart
    return report(results)
  } catch (err) {
    console.error(`verify: could not run the checks: ${err.message}`)
    return 2
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = await main()
