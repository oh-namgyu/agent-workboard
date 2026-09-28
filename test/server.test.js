import test from 'node:test'
import assert from 'node:assert/strict'
import { networkInterfaces } from 'node:os'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { startApp, spawnServe, CLI, tempDir } from './helpers.js'

test('health endpoint', async (t) => {
  const { base } = await startApp(t)
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true, name: 'agent-workboard' })
})

test('claim → list → release round trip', async (t) => {
  const { base, post } = await startApp(t)
  let res = await post('/api/claims', { agent: 'claude', resource: 'app', kind: 'path', note: 'n' })
  assert.equal(res.status, 201)
  const { claim } = await res.json()
  assert.equal(claim.kind, 'path')
  let list = await (await fetch(`${base}/api/claims`)).json()
  assert.deepEqual(list.active.map((c) => c.id), [claim.id])
  assert.equal(list.history.length, 0)

  res = await post(`/api/claims/${claim.id}/release`, { by: 'human' })
  assert.equal(res.status, 200)
  list = await (await fetch(`${base}/api/claims`)).json()
  assert.equal(list.active.length, 0)
  assert.equal(list.history[0].released_by, 'human')

  assert.equal((await post(`/api/claims/${claim.id}/release`, {})).status, 404, 'double release')
  assert.equal((await post('/api/claims/nope/release', {})).status, 404)
})

test('same agent + same resource refreshes instead of duplicating', async (t) => {
  const { base, post, store } = await startApp(t)
  const { claim } = await (await post('/api/claims', { agent: 'claude', resource: 'app' })).json()
  store.db.prepare(`UPDATE claims SET heartbeat_at = ?`).run(new Date(Date.now() - 40 * 60_000).toISOString())
  const res = await post('/api/claims', { agent: 'claude', resource: 'app' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.refreshed, true)
  assert.equal(body.claim.id, claim.id)
  assert.equal(body.claim.stale, false, 'refresh clears the stale flag')
  const { active } = await (await fetch(`${base}/api/claims`)).json()
  assert.equal(active.length, 1)
  // a different resource by the same agent is a separate claim
  assert.equal((await post('/api/claims', { agent: 'claude', resource: 'other' })).status, 201)
})

test('heartbeat endpoint', async (t) => {
  const { post } = await startApp(t)
  const { claim } = await (await post('/api/claims', { agent: 'a', resource: 'r' })).json()
  assert.equal((await post(`/api/claims/${claim.id}/heartbeat`, {})).status, 200)
  assert.equal((await post('/api/claims/missing/heartbeat', {})).status, 404)
})

test('a claim past 2x TTL no longer blocks a new claimant', async (t) => {
  const { post, store } = await startApp(t, { ttlMinutes: 1 })
  await post('/api/claims', { agent: 'codex', resource: 'app' })
  store.db.prepare(`UPDATE claims SET heartbeat_at = ?`).run(new Date(Date.now() - 3 * 60_000).toISOString())
  assert.equal((await post('/api/claims', { agent: 'claude', resource: 'app' })).status, 201)
})

test('stale-but-unexpired claim still blocks and is flagged in the list', async (t) => {
  const { base, post, store } = await startApp(t, { ttlMinutes: 10 })
  await post('/api/claims', { agent: 'codex', resource: 'app' })
  store.db.prepare(`UPDATE claims SET heartbeat_at = ?`).run(new Date(Date.now() - 15 * 60_000).toISOString())
  assert.equal((await post('/api/claims', { agent: 'claude', resource: 'app' })).status, 409)
  const { active } = await (await fetch(`${base}/api/claims`)).json()
  assert.equal(active[0].stale, true)
})

test('409 body names the holder', async (t) => {
  const { post } = await startApp(t)
  await post('/api/claims', { agent: 'codex', resource: 'app' })
  const res = await post('/api/claims', { agent: 'claude', resource: 'app' })
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.deepEqual(body.conflicts.map((c) => c.agent), ['codex'])
})

test('check endpoint: path claims, normalization, and missing agent', async (t) => {
  const { base, post } = await startApp(t)
  await post('/api/claims', { agent: 'gemini', resource: 'src/api/', kind: 'path' })
  const check = async (q) => (await fetch(`${base}/api/check?${new URLSearchParams(q)}`)).json()
  assert.equal((await check({ agent: 'claude', path: './src/api/users.js' })).allowed, false)
  assert.equal((await check({ agent: 'claude', path: 'src/apix/users.js' })).allowed, true)
  assert.equal((await check({ agent: 'gemini', path: 'src/api/users.js' })).allowed, true)
  const res = await fetch(`${base}/api/check?path=x`)
  assert.equal(res.status, 400)
})

test('malformed input → 4xx JSON, never a 500 or a stack trace', async (t) => {
  const { post } = await startApp(t)
  const cases = [
    ['invalid JSON', '{bad', 400],
    ['missing agent', { resource: 'x' }, 400],
    ['missing resource', { agent: 'x' }, 400],
    ['empty strings', { agent: '', resource: '' }, 400],
    ['object agent', { agent: { a: 1 }, resource: 'x' }, 400],
    ['numeric resource', { agent: 'x', resource: 5 }, 400],
    ['array resource', { agent: 'x', resource: ['a'] }, 400],
    ['object note', { agent: 'x', resource: 'y', note: {} }, 400],
    ['bad kind', { agent: 'x', resource: 'y', kind: 'bogus' }, 400],
    ['JSON array body', [1, 2], 400],
  ]
  for (const [name, body, status] of cases) {
    const res = await post('/api/claims', body)
    assert.equal(res.status, status, name)
    assert.match(res.headers.get('content-type'), /application\/json/, name)
    const text = await res.text()
    assert.doesNotMatch(text, /\s+at\s+\S+\s+\(/, `${name}: stack trace leaked`)
    assert.ok(JSON.parse(text).error, name)
  }
  // no body / wrong content type is treated as missing fields, not a crash
  assert.equal((await post('/api/claims', 'agent=x', { 'Content-Type': 'text/plain' })).status, 400)
})

test('CLI serve binds loopback by default', async (t) => {
  const { port, banner } = await spawnServe(t)
  assert.match(banner, new RegExp(`http://127\\.0\\.0\\.1:${port}`))
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200)
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)
  if (!lan) return t.diagnostic('no non-loopback IPv4 interface; skipped LAN reachability check')
  const reachable = await new Promise((resolve) => {
    const sock = connect({ host: lan.address, port }, () => (sock.destroy(), resolve(true)))
    sock.on('error', () => resolve(false))
    sock.setTimeout(1000, () => (sock.destroy(), resolve(false)))
  })
  assert.equal(reachable, false, `board must not be reachable on ${lan.address}`)
})

test('POST /api/claims: overlapping path claim by another agent → 409', async (t) => {
  const { post } = await startApp(t)
  assert.equal((await post('/api/claims', { agent: 'codex', resource: 'src/**', kind: 'path' })).status, 201)
  const res = await post('/api/claims', { agent: 'claude', resource: 'src/api/users.js', kind: 'path' })
  assert.equal(res.status, 409)
  assert.deepEqual((await res.json()).conflicts.map((c) => c.resource), ['src/**'])
  assert.equal((await post('/api/claims', { agent: 'claude', resource: 'src-v2/**', kind: 'path' })).status, 201)
  assert.equal((await post('/api/claims', { agent: 'codex', resource: 'src/api/**', kind: 'path' })).status, 201, 'same agent')
})

test('serve --port 0 binds an ephemeral port and prints it', async (t) => {
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0', '--db', join(tempDir(t), 's.db')])
  t.after(() => child.kill())
  const banner = await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => resolve(String(d)))
    child.on('exit', (code) => reject(new Error(`server exited early (${code})`)))
    setTimeout(() => reject(new Error('server did not start')), 5000)
  })
  const port = Number(banner.match(/:(\d+)\s*$/)?.[1])
  assert.ok(port > 0 && port !== 5054, banner)
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200)
})
