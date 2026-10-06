#!/usr/bin/env node
// Stands in for "claude -p" in the gate tests: no model, no network, no
// cost. FAKE_CLAUDE_MODE picks the answer. FAKE_CLAUDE_ARGS, when set,
// is a file that receives the arguments, so a test can check what the
// script asked for.
import { appendFileSync } from 'node:fs'

if (process.env.FAKE_CLAUDE_ARGS)
  appendFileSync(
    process.env.FAKE_CLAUDE_ARGS,
    JSON.stringify(process.argv.slice(2)) + '\n',
  )

const answers = {
  reproduced: {
    subtype: 'success',
    is_error: false,
    result:
      'REPRODUCED\nWhat you ran: node tools/request.mjs ...\nWhat you saw: app: NOT RUNNING',
  },
  'no-verdict': {
    subtype: 'success',
    is_error: false,
    result: 'I looked at it and it seems fine.',
  },
  'max-turns': {
    subtype: 'error_max_turns',
    is_error: true,
    result: '',
  },
}
const mode = process.env.FAKE_CLAUDE_MODE ?? 'reproduced'
if (mode === 'not-json') {
  console.log('Error: something went wrong')
} else {
  console.log(
    JSON.stringify({
      type: 'result',
      num_turns: 4,
      total_cost_usd: 0.42,
      ...answers[mode],
    }),
  )
}
