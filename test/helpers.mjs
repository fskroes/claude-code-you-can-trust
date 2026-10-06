// Shared test helpers. Every test that needs git makes its own
// repository in a temporary directory, so no test touches the reader's
// checkout.
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim()
}

export function tempRepo(branch = 'main') {
  const dir = mkdtempSync(join(tmpdir(), 'companion-repo-'))
  git(dir, 'init', '-q', '-b', branch)
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'first')
  return dir
}
