// A small link shortener. The subject every chapter of the book works
// on.
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openStore, isValidUrl } from './store.mjs'

const MAX_BODY = 4096

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size <= MAX_BODY) chunks.push(chunk)
    })
    req.on('end', () => {
      // Read to the end before answering: a reply sent mid-upload can
      // reach the client as a reset connection instead of a 413.
      if (size > MAX_BODY)
        reject(
          Object.assign(new Error('body too large'), { status: 413 }),
        )
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

// #region health
export function createApp({ dataDir, commit }) {
  const store = openStore(dataDir)
  const started = Date.now()

  async function route(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost')

    if (req.method === 'GET' && pathname === '/healthz') {
      return send(res, 200, {
        ok: true,
        commit,
        links: store.count(),
        uptime_s: Math.round((Date.now() - started) / 1000),
      })
    }
    // #endregion health

    if (req.method === 'POST' && pathname === '/links') {
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch (err) {
        return send(res, err.status ?? 400, {
          error: err.status ? 'too_large' : 'bad_json',
        })
      }
      if (!isValidUrl(body?.url))
        return send(res, 400, { error: 'bad_url' })
      // #region store-parsed
      // Store the parsed form. The parser drops line breaks that the
      // raw text keeps, and a line break in a Location header stops the
      // response.
      const url = new URL(body.url).href
      // #endregion store-parsed
      const code = store.add(url)
      return send(res, 201, { code, url, short: `/l/${code}` })
    }

    const match = pathname.match(/^\/l\/([a-z0-9]{6})$/)
    if (req.method === 'GET' && match) {
      const link = store.visit(match[1])
      if (!link) return send(res, 404, { error: 'not_found' })
      res.writeHead(302, { location: link.url })
      return res.end()
    }

    return send(res, 404, { error: 'not_found' })
  }

  // #region catch-all
  // One bad request must not stop the server for everyone. An error
  // inside a handler becomes a 500 for that request, and the error goes
  // to the log.
  return createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(err)
      if (!res.headersSent) send(res, 500, { error: 'internal' })
      else res.destroy()
    })
  })
  // #endregion catch-all
}

function currentCommit() {
  if (process.env.APP_COMMIT) return process.env.APP_COMMIT
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000)
  const app = createApp({
    dataDir: process.env.DATA_DIR ?? 'data',
    commit: currentCommit(),
  })
  app.listen(port, () =>
    console.log(`shortlinks on http://localhost:${app.address().port}`),
  )
}
