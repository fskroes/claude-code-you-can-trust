#!/usr/bin/env node
// Start the app with an empty data directory, send a list of requests,
// and report what came back, including a crash. A narrow tool for an
// agent that must reproduce a report without the right to run any code
// it likes.
//
//   node tools/request.mjs '[{"method":"POST","path":"/links","body":{"url":"https://example.com"}},
//                            {"method":"GET","path":"{short}"}]'
//
// "{short}" is replaced with the "short" field of the last response
// that had one.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startApp } from '../.claude/skills/verify-app/scripts/verify.mjs'

export async function replay(steps) {
  const dataDir = mkdtempSync(join(tmpdir(), 'request-'))
  const app = await startApp(dataDir)
  const lines = []
  let short = null
  try {
    for (const step of steps) {
      const path = step.path.replace('{short}', short ?? '{short}')
      const init = { method: step.method ?? 'GET', redirect: 'manual' }
      if (step.body !== undefined)
        init.body =
          typeof step.body === 'string'
            ? step.body
            : JSON.stringify(step.body)
      // #region same-origin
      // Only the local copy. "app.base + path" with a path such as
      // "@evil.example/x" made the local address a user name and sent
      // the request to another host. An agent that read this code
      // found it.
      const url = new URL(path, app.base)
      if (
        !path.startsWith('/') ||
        url.origin !== new URL(app.base).origin
      ) {
        const why = 'a path must start with / and stay on the app'
        lines.push(`${init.method} ${path} -> refused: ${why}`)
        continue
      }
      // #endregion same-origin
      try {
        const res = await fetch(url, init)
        const text = await res.text()
        const location = res.headers.get('location')
        try {
          short = JSON.parse(text).short ?? short
        } catch {}
        lines.push(
          `${init.method} ${path} -> ${res.status}${location ? ` location=${JSON.stringify(location)}` : ''} ${text.slice(0, 200)}`.trim(),
        )
      } catch (err) {
        lines.push(
          `${init.method} ${path} -> no response (${err.cause?.code ?? err.message})`,
        )
      }
    }
    const alive = await fetch(`${app.base}/healthz`).then(
      () => true,
      () => false,
    )
    lines.push(
      alive
        ? 'app: still running'
        : `app: NOT RUNNING after the requests\n${app.output().trim().split('\n').slice(-8).join('\n')}`,
    )
    return lines
  } finally {
    await app.stop()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let steps
  try {
    steps = JSON.parse(process.argv[2] ?? '')
    if (!Array.isArray(steps)) throw new Error('not a list')
  } catch {
    console.error(
      'request: pass one JSON list of steps, see the comment at the top of this file',
    )
    process.exit(2)
  }
  for (const line of await replay(steps)) console.log(line)
}
