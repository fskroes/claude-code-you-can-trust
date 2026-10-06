
## 2026-10-05 17:16 2026-10-05-links-expire.md: NOT REPRODUCED

**NOT REPRODUCED**

The current code has no expiry, so a link can't stop working because of its age. I couldn't actually wait a day, though, and the report doesn't include what would be needed to explain why this user saw "not found" (see the end).

**What you ran:**
```
npm test
node .claude/skills/verify-app/scripts/verify.mjs
node tools/request.mjs '[{"method":"POST","path":"/links","body":{"url":"https://example.com/flyer"}},{"method":"GET","path":"{short}"},{"method":"GET","path":"{short}"},{"method":"GET","path":"/healthz"}]'
```

**What you saw:**
- `npm test`: `# tests 60  # pass 60  # fail 0`
- verify: `verify: 6 passed, 0 failed`, including `PASS survives restart`.
- request: `POST /links -> 201 … "short":"/l/xsvsay"`, then `GET /l/xsvsay -> 302` twice, then `links:1`, then `app: still running`.
- The only time value in the store is the `created` timestamp, which is written once (`app/store.mjs:48`). Nothing else reads it. Lookup is just `links[code]` (`app/store.mjs:53-60`), and the server returns 404 only when that lookup finds nothing (`app/server.mjs:64-65`). No code anywhere checks a link's age or deletes links.

**Where:** There is no cause for time-based expiry in `app/`.

**What's missing to explain this user's 404:**
- The short code they made, and the exact URL they opened, including which host or deployment. A mistyped 6-character code also returns `not_found`.
- Whether that deployment was redeployed or restarted in the last day, and whether its data survived. Links live in one file, `$DATA_DIR/links.json`. `DATA_DIR` defaults to the relative path `data` (`app/server.mjs:85`), so a deploy that changes the working directory or doesn't keep that directory would lose every link. That would look like "expired after a day". This is a guess about the deployment, not something I could test from here.

I didn't edit any files.

## 2026-10-05 17:16 2026-10-05-site-down.md: REPRODUCED

REPRODUCED

**What you ran:**
```
npm test
node .claude/skills/verify-app/scripts/verify.mjs
node tools/request.mjs '[{"method":"POST","path":"/links","body":{"url":"https://example.com/ok"}},{"method":"GET","path":"{short}"},{"method":"POST","path":"/links","body":{"url":"https://example.com/report\nfinal.pdf"}},{"method":"GET","path":"{short}"},{"method":"GET","path":"/healthz"}]'
node tools/request.mjs '[{"method":"POST","path":"/links","body":{"url":"https://example.com/2026–report"}},{"method":"GET","path":"{short}"}]'
```

**What you saw:**
- `npm test`: `# tests 60 / # pass 60 / # fail 0`. Verify: `verify: 6 passed, 0 failed`. Neither one sends a URL like this, so both pass.
- A URL with a line break in it, which is common when you copy across a line break in a PDF:
  ```
  POST /links -> 201 {"code":"baqr3t","url":"https://example.com/report\nfinal.pdf",...}
  GET /l/baqr3t -> no response (UND_ERR_SOCKET)
  GET /healthz -> no response (ECONNREFUSED)
  app: NOT RUNNING after the requests
      at Server.<anonymous> (.../app/server.mjs:66:11)
    code: 'ERR_INVALID_CHAR'
  ```
- A URL with an en dash `–`, which PDFs often put in place of a hyphen, does the same: it gets 201, then opening it gives no response, then `app: NOT RUNNING`, `ERR_INVALID_CHAR` at server.mjs:66.

This matches the report: "It said created", then "nothing loaded", then "none of my other short links work", because the whole process has stopped.

The report does not give the actual URL. I tested two common PDF copy errors and both crash the app. I can't confirm which one this user had.

**Where:**
- `app/server.mjs:66`: `res.writeHead(302, { location: link.url })` puts the raw stored string in the header. Node throws `ERR_INVALID_CHAR` for a newline or any character above U+00FF. The throw happens inside the `async` request handler (server.mjs:37), nothing catches it, and the process exits.
- `app/store.mjs:16-25`: `isValidUrl` accepts the string because `new URL()` quietly removes newlines and tabs and percent-encodes non-ASCII characters. `app/server.mjs:58` then stores `body.url` as it was sent, not the cleaned-up `url.href`.

**Follow-ups (not fixed, as asked):**
- The bad link is saved to `links.json`, so after a restart every new visit to it crashes the app again.
- Nothing in the request handler catches a thrown error, so any exception in it takes the whole site down.
- Neither the verify script nor `npm test` sends a URL with a control character or a non-Latin-1 character.
