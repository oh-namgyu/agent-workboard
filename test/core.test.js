import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { globToRegExp, findConflicts } from '../src/conflict.js'
import { createServer } from '../src/server.js'

test('glob matching', () => {
  assert.ok(globToRegExp('src/**').test('src/a/b.js'))
  assert.ok(globToRegExp('src/*.js').test('src/a.js'))
  assert.ok(!globToRegExp('src/*.js').test('src/a/b.js'))
  assert.ok(globToRegExp('?at.md').test('cat.md'))
})

test('conflict rules', () => {
  const active = [
    { agent: 'codex', resource: 'my-app', kind: 'project' },
    { agent: 'gemini', resource: 'src/api/**', kind: 'path' },
  ]
  assert.equal(findConflicts(active, { agent: 'claude', resource: 'my-app' }).length, 1)
  assert.equal(findConflicts(active, { agent: 'codex', resource: 'my-app' }).length, 0)
  assert.equal(findConflicts(active, { agent: 'claude', path: 'src/api/users.js' }).length, 1)
  assert.equal(findConflicts(active, { agent: 'claude', path: 'src/ui/app.js' }).length, 0)
})

test('HTTP claim lifecycle', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'workboard-'))
  const { app, store, close } = createServer({ dbFile: join(dir, 'test.db'), ttlMinutes: 30 })
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  t.after(() => (srv.close(), close(), rmSync(dir, { recursive: true, force: true })))

  const post = (url, body) =>
    fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  // claim
  let res = await post('/api/claims', { agent: 'claude', resource: 'demo-app', note: 'refactor' })
  assert.equal(res.status, 201)
  const { claim } = await res.json()

  // same agent re-claim is idempotent
  res = await post('/api/claims', { agent: 'claude', resource: 'demo-app' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).refreshed, true)

  // other agent conflicts
  res = await post('/api/claims', { agent: 'codex', resource: 'demo-app' })
  assert.equal(res.status, 409)

  // check endpoint mirrors the conflict
  res = await fetch(`${base}/api/check?agent=codex&resource=demo-app`)
  assert.equal((await res.json()).allowed, false)
  res = await fetch(`${base}/api/check?agent=claude&resource=demo-app`)
  assert.equal((await res.json()).allowed, true)

  // release frees the resource
  res = await post(`/api/claims/${claim.id}/release`, { by: 'claude' })
  assert.equal(res.status, 200)
  res = await post('/api/claims', { agent: 'codex', resource: 'demo-app' })
  assert.equal(res.status, 201)

  // stale claims are auto-expired past 2x TTL
  const old = new Date(Date.now() - 90 * 60_000).toISOString()
  store.db.prepare(`UPDATE claims SET heartbeat_at = ? WHERE status = 'active'`).run(old)
  const expired = store.expireStale()
  assert.equal(expired.length, 1)
  res = await fetch(`${base}/api/claims`)
  assert.equal((await res.json()).active.length, 0)
})
