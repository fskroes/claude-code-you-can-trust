#!/usr/bin/env node
// SessionStart hook. Writes down the commit the session started at, so
// the Stop gate can tell what this session changed. The first record
// for a session id wins: a resume or a compaction does not move it.
import { readStdinJson, startMark } from './stop-gate.mjs'

const event = await readStdinJson()
if (event?.session_id && event.cwd) startMark.writeOnce(event)
process.exit(0)
