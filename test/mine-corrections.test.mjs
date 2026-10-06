import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import {
  classify,
  mine,
  typedText,
} from '../tools/mine-corrections.mjs'

const FIXTURES = fileURLToPath(
  new URL('./fixtures/transcripts', import.meta.url),
)

test('only text a person typed counts as a prompt', () => {
  const user = (extra, content = 'hello') => ({
    type: 'user',
    message: { content },
    ...extra,
  })
  assert.equal(typedText(user({})), 'hello')
  assert.equal(
    typedText(user({}, [{ type: 'text', text: 'hi' }])),
    'hi',
  )
  assert.equal(
    typedText(user({}, [{ type: 'tool_result', content: 'x' }])),
    null,
  )
  assert.equal(typedText(user({ isMeta: true })), null)
  assert.equal(typedText(user({ isSidechain: true })), null)
  assert.equal(typedText(user({ isCompactSummary: true })), null)
  assert.equal(
    typedText(user({ origin: { kind: 'task-notification' } })),
    null,
  )
  assert.equal(typedText(user({ origin: { kind: 'human' } })), 'hello')
  assert.equal(typedText(user({ entrypoint: 'cli' })), 'hello')
  assert.equal(typedText(user({ entrypoint: 'sdk-cli' })), null)
  assert.equal(
    typedText(user({}, '<command-name>/clear</command-name>')),
    null,
  )
  assert.equal(
    typedText({ type: 'assistant', message: { content: 'hello' } }),
    null,
  )
})

test('a prompt with a pasted image counts by its text', () => {
  // A first version needed every part to be text, so these were lost.
  const user = (content) => ({ type: 'user', message: { content } })
  const image = { type: 'image', source: { type: 'base64' } }
  const text = { type: 'text', text: 'No, this one' }
  assert.equal(typedText(user([image, text])), 'No, this one')
  assert.equal(typedText(user([image])), null)
  const result = { type: 'tool_result', content: 'x' }
  assert.equal(typedText(user([result, text])), null)
})

test('a correction is found at the start of a message, not deep inside it', () => {
  assert.equal(classify('No, use the store.'), 'no')
  assert.equal(classify("Don't touch the tests"), 'dont')
  assert.equal(
    classify('[Request interrupted by user for tool use]'),
    'interrupt',
  )
  assert.equal(classify('Again, use the store'), 'again')
  assert.equal(classify('Add a counter'), null)
  assert.equal(classify('x'.repeat(200) + ' that is wrong'), null)
})

test('the fixture transcripts give the counts the book prints', () => {
  const result = mine([FIXTURES])
  assert.equal(result.prompts, 7)
  assert.equal(result.unreadable, 1)
  assert.deepEqual(result.counts, {
    no: 1,
    interrupt: 1,
    dont: 1,
    stop: 1,
    wrong: 1,
  })
})

test('known false positive: a log line that says "wrong" near the start', () => {
  // The script finds candidates. A person, or a model, reads them.
  const [example] = mine([FIXTURES]).examples.wrong
  assert.match(example, /^Here is the log/)
})

test('subagent transcripts are not read', () => {
  // The fixture line has no isSidechain flag and reads as a correction,
  // so only the rule "top-level files only" keeps it out of the count.
  const all = Object.values(mine([FIXTURES]).examples).flat()
  assert.equal(
    all.some((t) => t.includes('No tests cover')),
    false,
  )
})
