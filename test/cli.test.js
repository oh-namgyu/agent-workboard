import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js')
const PORT = 5099

function cli(args, agent) {
  const env = { ...process.env, WORKBOARD_URL: `http://127.0.0.1:${PORT}`, WORKBOARD_AGENT: agent }
  return promisify(execFile)(process.execPath, [CLI, ...args], { env }).then(
    (r) => ({ code: 0, out: r.stdout + r.stderr }),
    (e) => ({ code: e.code, out: (e.stdout || '') + (e.stderr || '') })
  )
}

test('CLI e2e — two agents collide on one resource', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'workboard-cli-'))
  const server = spawn(process.execPath, [CLI, 'serve', '--port', String(PORT), '--db', join(dir, 'e2e.db')])
  t.after(() => (server.kill(), rmSync(dir, { recursive: true, force: true })))
  await new Promise((resolve, reject) => {
    server.stdout.on('data', resolve)
    server.on('error', reject)
    setTimeout(() => reject(new Error('server did not start')), 5000)
  })

  // codex claims the project
  let r = await cli(['claim', 'demo-app', '--note', 'api refactor'], 'codex')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /✓ claimed demo-app/)

  // claude tries the same project → blocked with exit 2
  r = await cli(['claim', 'demo-app'], 'claude')
  assert.equal(r.code, 2)
  assert.match(r.out, /conflict.*\[codex\] demo-app/)

  // claude probes before editing → blocked
  r = await cli(['check', '--resource', 'demo-app'], 'claude')
  assert.equal(r.code, 2)

  // path-glob claim blocks file edits under it
  r = await cli(['claim', 'src/api/**', '--kind', 'path'], 'gemini')
  assert.equal(r.code, 0, r.out)
  r = await cli(['check', '--path', 'src/api/users.js'], 'claude')
  assert.equal(r.code, 2)
  r = await cli(['check', '--path', 'src/ui/app.js', '--resource', 'other-app'], 'claude')
  assert.equal(r.code, 0, r.out)

  // list shows both claims
  r = await cli(['list'], 'claude')
  assert.match(r.out, /\[codex\] demo-app/)
  assert.match(r.out, /\[gemini\] src\/api\/\*\*/)

  // release frees it for claude
  r = await cli(['release', 'demo-app'], 'codex')
  assert.equal(r.code, 0, r.out)
  r = await cli(['claim', 'demo-app'], 'claude')
  assert.equal(r.code, 0, r.out)
})
