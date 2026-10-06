
## 2026-10-05 18:48 2026-10-05-links-expire.md: NOT REPRODUCED

NOT REPRODUCED

The current code has no expiry. Links do not time out, and they survive a restart.

What you ran:
```
npm test
node .claude/skills/verify-app/scripts/verify.mjs
node tools/request.mjs '[{"method":"POST","path":"/links","body":{"url":"https://example.com/flyer"}},{"method":"GET","path":"{short}"},{"method":"GET","path":"{short}"}]'
grep -i 'expir|ttl|maxAge|86400|24 * 60|Date.now|created'   (with the Grep tool, over the repo)
```

What you saw:
- `npm test`: `# tests 68 … # pass 68 # fail 0`
- verify: `PASS survives restart` … `verify: 7 passed, 0 failed`
- request: `POST /links -> 201`, then both `GET /l/pfdzuj -> 302 location="https://example.com/flyer"`, `app: still running`
- grep: nothing about expiry or TTL. `Date.now` is only used for the `/healthz` uptime. `created` is written to each link but nothing ever reads it.

Where (why there is no expiry):
- `app/store.mjs:55-61`: `add()` stores `{url, created, visits}` with no expiry field.
- `app/store.mjs:65-71`: `visit()` returns null only when the code isn't in the file. It never checks the age.
- `app/server.mjs:76-78`: a 404 `not_found` on `/l/<code>` therefore means the code isn't in the store at all.

What's missing to go further: I couldn't wait a real day, so this rests on reading the code plus the restart check. The report doesn't give:
- the short code or link they used, to check it exists in the live `links.json`
- which host they used

So the "after a day" pattern could come from something outside the code that I can't see here. For example, the live deployment's `DATA_DIR` might not be on persistent storage, so a daily restart or redeploy would start with an empty store. That is a lead to check on the live host, not a finding.

I didn't edit any files.

## 2026-10-05 18:48 2026-10-05-site-down.md: REPRODUCED

REPRODUCED

**What you ran:**
```
node tools/request.mjs '[{"method":"POST","path":"/links","body":{"url":"https://example.com/a"}},{"method":"GET","path":"{short}"},{"method":"POST","path":"/links","body":{"url":"https://example.com/report-\n2026.pdf"}},{"method":"GET","path":"{short}"},{"method":"GET","path":"/healthz"}]'
npm test
node .claude/skills/verify-app/scripts/verify.mjs
```

**What you saw:**
- A normal link worked: `GET /l/cscts9 -> 302`.
- A URL with a line break inside it, which is what you often get when copying from a PDF, was accepted: `POST /links -> 201 {"url":"https://example.com/report-\n2026.pdf", ...}`. That matches "It said created."
- Opening that short link got no answer: `GET /l/biiiwc -> no response (UND_ERR_SOCKET)`.
- After that the whole app was down: `GET /healthz -> no response (ECONNREFUSED)` and `app: NOT RUNNING after the requests`, with `code: 'ERR_INVALID_CHAR'` at `app/server.mjs:76`. So every other short link stopped working too.
- The tests and the verify script both pass, so neither one covers this case: `# pass 68 / # fail 0` and `verify: 7 passed, 0 failed`.

**Where:**
- `app/store.mjs:22-31`: `isValidUrl` checks the URL with `new URL(text)`, which quietly drops tabs and line breaks. The check passes, but the raw text, line break included, is what gets saved (`app/server.mjs:68`).
- `app/server.mjs:76`: `res.writeHead(302, { location: link.url })` throws `ERR_INVALID_CHAR` because the redirect address contains a line break. The request handler is `async` and nothing catches the error, so the whole Node process exits.
- The bad link is saved to disk, so after a restart the site works until someone opens that link again, then it crashes again.

I didn't fix or edit anything, as asked. A fix would need a test that fails without it.
