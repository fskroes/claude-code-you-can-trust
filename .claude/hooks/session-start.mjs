#!/usr/bin/env node
import { readStdinJson, startMark } from './stop-gate.mjs'

const event = await readStdinJson()
if (event?.session_id && event.cwd) startMark.writeOnce(event)
process.exit(0)
