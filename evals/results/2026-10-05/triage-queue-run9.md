
## 2026-10-05 19:16 2026-10-05-links-expire.md: NOT REPRODUCED

NOT REPRODUCED

**What I ran:**
```
grep -i "expir|ttl|maxAge|86400|24 * 60|cleanup|prune" across the repo
npm test
node .claude/skills/verify-app/scripts/verify.mjs
node tools/request.mjs '[{"method":"POST","path":"/links","body":{"url":"https://example.com/flyer"}},{"method":"GET","path":"{short}"},{"method":"GET","path":"{short}"}]'
```

**What I saw:**
- `npm test`: `# pass 80`, `# fail 0`
- verify script: `verify: 7 passed, 0 failed`, including `PASS survives restart`
- request tool: `POST /links -> 201 … "/l/fcjs5n"`, then `GET /l/fcjs5n -> 302 location="https://example.com/flyer"` twice, and `app: still running`
- The search found nothing about expiry in `app/`. The only hits were the report itself and a triage test fixture.

**Where:** Nothing in the code expires links. `app/store.mjs:57-61` saves `created` with each link but never reads it again. `get` and `visit` (`app/store.mjs:65-73`) only check whether the code exists. `app/server.mjs:76-78` returns 404 only when `store.visit` finds no entry. Nothing deletes or prunes entries in `links.json`.

**Limits:** I couldn't make a day pass in a test. `tools/request.mjs` always starts with an empty data directory, so I confirmed "no expiry" by reading the code, not by waiting.

Something else could still cause the customer's 404. For example, the live server's `DATA_DIR` might get wiped on redeploy (it defaults to a relative `data`, `app/server.mjs:97`), or the link might be on a different host than the one they're visiting. To check that, the report would need three things it doesn't have:
- the short code
- the host they used
- the date and time they made the link, to compare with deploys on the live copy

## 2026-10-05 19:16 2026-10-05-site-down.md: REPRODUCED

REPRODUCED

**What you ran:**
```
node tools/request.mjs '[{"method":"POST","path":"/links","body":{"url":"https://example.com"}},{"method":"POST","path":"/links","body":{"url":"https://example.com/report\n2026.pdf"}},{"method":"GET","path":"{short}"},{"method":"GET","path":"/healthz"}]'
npm test
node .claude/skills/verify-app/scripts/verify.mjs
```

**What you saw:**
- Creating a link for a URL copied from a PDF (containing a literal newline, `https://example.com/report\n2026.pdf`) returns `201` — it is accepted and stored.
- Visiting that short link: `no response (UND_ERR_SOCKET)`, with the process throwing `ERR_INVALID_CHAR`.
- The next request, an unrelated `GET /healthz`: `no response (ECONNREFUSED)` — `app: NOT RUNNING`. The whole server is down, so every other short link also stops working. This matches the report exactly.
- `npm test`: `# pass 80 / # fail 0` and verify: `7 passed, 0 failed` — the existing gate does not exercise a URL with a control character, so it stays green.

**Where:** `app/server.mjs:76` — `res.writeHead(302, { location: link.url })`. The redirect puts the stored URL straight into the `Location` header; a newline (or other control char) in it makes Node throw `ERR_INVALID_CHAR` from `route`, which is an unhandled throw in the request handler and crashes the process.

Root cause upstream: `isValidUrl` in `app/store.mjs:19` accepts the URL because `new URL(...)` tolerates the embedded newline, so the bad value is persisted and detonates later on redirect rather than at creation.
