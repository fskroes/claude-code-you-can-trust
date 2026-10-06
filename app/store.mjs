// The link store: one JSON file, read at start and written after each
// change.
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

// no l, o, 0, 1: they look alike
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

export function newCode(length = 6) {
  const bytes = randomBytes(length)
  let code = ''
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length]
  return code
}

// #region valid-url
export function isValidUrl(text) {
  if (typeof text !== 'string' || text.length > 2048) return false
  let url
  try {
    url = new URL(text)
  } catch {
    return false
  }
  return url.protocol === 'https:' || url.protocol === 'http:'
}
// #endregion valid-url

export function openStore(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  const file = join(dataDir, 'links.json')
  let links = {}
  try {
    links = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  function save() {
    // Write a temporary file, then rename: a crash never leaves half a
    // file.
    writeFileSync(file + '.tmp', JSON.stringify(links, null, 2))
    renameSync(file + '.tmp', file)
  }

  return {
    add(url) {
      let code = newCode()
      while (links[code]) code = newCode()
      links[code] = {
        url,
        created: new Date().toISOString(),
        visits: 0,
      }
      save()
      return code
    },
    get(code) {
      return links[code] ?? null
    },
    visit(code) {
      const link = links[code]
      if (!link) return null
      link.visits += 1
      save()
      return link
    },
    count() {
      return Object.keys(links).length
    },
  }
}
