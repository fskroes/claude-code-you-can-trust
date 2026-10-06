import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidUrl } from '../app/store.mjs'

// #region boundary
// Added after tools/mutate.mjs showed that "length > 2048" could become
// "length >= 2048" and every test still passed.
test('a URL of 2048 characters is accepted, 2049 is not', () => {
  const base = 'https://example.com/'
  const url = (length) => base + 'a'.repeat(length - base.length)
  assert.equal(url(2048).length, 2048)
  assert.equal(isValidUrl(url(2048)), true)
  assert.equal(isValidUrl(url(2049)), false)
})
// #endregion boundary
