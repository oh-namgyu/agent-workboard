import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js')
const PORT = 5097
const URL = `http://127.0.0.1:${PORT}`

function runHook(event, payload, agent) {
  return new Promise((resolve) => {
    const env = { ...process.env, WORKBOARD_URL: URL, WORKBOARD_AGENT: agent }
    const p = spawn(process.execPath, [CLI, 'hook', event], { env })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code, out }))
    p.stdin.end(JSON.stringify(payload))
  })
}

test('pretooluse hook gate: blocks a held resource, ignores non-gated tools', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'workboard-hook-'))
  const server = spawn(process.execPath, [CLI, 'serve', '--port', String(PORT), '--db', join(dir, 'h.db')])
  t.after(() => (server.kill(), rmSync(dir, { recursive: true, force: true })))
  await new Promise((resolve, reject) => {
    server.stdout.on('data', resolve)
    server.on('error', reject)
    setTimeout(() => reject(new Error('server did not start')), 5000)
  })

  // "codex" claims project "demo-app"
  const claim = await fetch(`${URL}/api/claims`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: 'codex', resource: 'demo-app' }),
  })
  assert.equal(claim.status, 201)

  // an Edit by "claude" under that project is blocked (exit 2, the hook contract)
  const blocked = await runHook(
    'pretooluse',
    { tool_name: 'Edit', tool_input: { file_path: 'src/x.js' }, cwd: '/tmp/demo-app' },
    'claude',
  )
  assert.equal(blocked.code, 2, blocked.out)
  assert.match(blocked.out, /blocked/)

  // a non-gated tool (Read) is never blocked
  const allowed = await runHook(
    'pretooluse',
    { tool_name: 'Read', tool_input: { file_path: 'src/x.js' }, cwd: '/tmp/demo-app' },
    'claude',
  )
  assert.equal(allowed.code, 0, allowed.out)

  // an invalid claim "kind" is rejected
  const bad = await fetch(`${URL}/api/claims`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: 'x', resource: 'y', kind: 'bogus' }),
  })
  assert.equal(bad.status, 400)
})
