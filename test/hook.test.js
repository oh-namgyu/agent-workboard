import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { CLI, spawnServe, freePort } from './helpers.js'

function runHook(url, event, payload, agent) {
  return new Promise((resolve) => {
    const env = { ...process.env, WORKBOARD_URL: url, WORKBOARD_AGENT: agent }
    const p = spawn(process.execPath, [CLI, 'hook', event], { env })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code, out }))
    p.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
  })
}

const claim = (url, body) =>
  fetch(`${url}/api/claims`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const active = async (url) => (await (await fetch(`${url}/api/claims`)).json()).active

test('pretooluse hook gate: blocks a held resource, ignores non-gated tools', async (t) => {
  const { url } = await spawnServe(t)
  assert.equal((await claim(url, { agent: 'codex', resource: 'demo-app' })).status, 201)

  // an Edit by "claude" under that project is blocked (exit 2, the hook contract)
  const blocked = await runHook(url, 'pretooluse', { tool_name: 'Edit', tool_input: { file_path: 'src/x.js' }, cwd: '/tmp/demo-app' }, 'claude')
  assert.equal(blocked.code, 2, blocked.out)
  assert.match(blocked.out, /blocked.*codex/)

  // a non-gated tool (Read) is never blocked
  const allowed = await runHook(url, 'pretooluse', { tool_name: 'Read', tool_input: { file_path: 'src/x.js' }, cwd: '/tmp/demo-app' }, 'claude')
  assert.equal(allowed.code, 0, allowed.out)

  // the holder itself is allowed
  const own = await runHook(url, 'pretooluse', { tool_name: 'Write', tool_input: { file_path: 'src/x.js' }, cwd: '/tmp/demo-app' }, 'codex')
  assert.equal(own.code, 0, own.out)
})

test('pretooluse: path claims gate every edit tool, absolute paths are made relative to cwd', async (t) => {
  const { url } = await spawnServe(t)
  assert.equal((await claim(url, { agent: 'gemini', resource: 'notebooks/**', kind: 'path' })).status, 201)
  const cwd = '/tmp/split-app'
  const cases = [
    ['Edit', { file_path: `${cwd}/notebooks/a.py` }, 2],
    ['MultiEdit', { file_path: 'notebooks/a.py' }, 2],
    ['Write', { file_path: './notebooks/new.py' }, 2],
    ['NotebookEdit', { notebook_path: `${cwd}/notebooks/a.ipynb` }, 2],
    ['Edit', { file_path: `${cwd}/src/a.py` }, 0],
    ['Edit', { file_path: '/elsewhere/notebooks/a.py' }, 0], // outside the project: only the project claim counts
  ]
  for (const [tool_name, tool_input, want] of cases) {
    const r = await runHook(url, 'pretooluse', { tool_name, tool_input, cwd }, 'claude')
    assert.equal(r.code, want, `${tool_name} ${JSON.stringify(tool_input)}: ${r.out}`)
  }
})

test('pretooluse fails open when the board is unreachable', async () => {
  const url = `http://127.0.0.1:${await freePort()}`
  const r = await runHook(url, 'pretooluse', { tool_name: 'Edit', tool_input: { file_path: 'a.js' }, cwd: '/tmp/x' }, 'claude')
  assert.equal(r.code, 0, r.out)
})

test('session-start claims the project; on conflict it warns but never blocks', async (t) => {
  const { url } = await spawnServe(t)
  let r = await runHook(url, 'session-start', { cwd: '/tmp/demo-app' }, 'codex')
  assert.equal(r.code, 0)
  assert.match(r.out, /claimed "demo-app" as codex/)

  r = await runHook(url, 'session-start', { cwd: '/tmp/demo-app' }, 'claude')
  assert.equal(r.code, 0)
  assert.match(r.out, /WARNING.*already claimed by codex/)
  const claims = await active(url)
  assert.deepEqual(claims.map((c) => c.agent), ['codex'], 'the loser must not get a claim')

  // re-running for the holder refreshes, no duplicate
  r = await runHook(url, 'session-start', { cwd: '/tmp/demo-app' }, 'codex')
  assert.equal(r.code, 0)
  assert.equal((await active(url)).length, 1)
})

test('session-end releases only this agent\'s claim on this project', async (t) => {
  const { url } = await spawnServe(t)
  await claim(url, { agent: 'claude', resource: 'demo-app' })
  await claim(url, { agent: 'claude', resource: 'other-app' })
  await claim(url, { agent: 'codex', resource: 'third-app' })
  const r = await runHook(url, 'session-end', { cwd: '/tmp/demo-app' }, 'claude')
  assert.equal(r.code, 0, r.out)
  assert.deepEqual((await active(url)).map((c) => c.resource).sort(), ['other-app', 'third-app'])
  // nothing to release → still a clean exit
  assert.equal((await runHook(url, 'session-end', { cwd: '/tmp/demo-app' }, 'claude')).code, 0)
})

test('hook tolerates non-JSON stdin and rejects unknown events', async (t) => {
  const { url } = await spawnServe(t)
  assert.equal((await runHook(url, 'pretooluse', 'not json', 'claude')).code, 0)
  const bad = await runHook(url, 'bogus', {}, 'claude')
  assert.equal(bad.code, 1)
  assert.match(bad.out, /unknown hook event/)
})
