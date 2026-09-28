import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { openStore } from '../src/db.js'
import { tempDir } from './helpers.js'

const MIN = 60_000

function store(t, ttlMinutes = 30) {
  const s = openStore(join(tempDir(t), 'nested', 'dir', 'wb.db'), { ttlMinutes })
  t.after(() => s.close())
  return s
}
const ageHeartbeat = (s, id, minutes) =>
  s.db.prepare(`UPDATE claims SET heartbeat_at = ? WHERE id = ?`).run(new Date(Date.now() - minutes * MIN).toISOString(), id)

test('openStore creates missing parent directories and persists across reopen', (t) => {
  const dir = tempDir(t)
  const file = join(dir, 'a', 'b', 'wb.db')
  const s1 = openStore(file)
  const c = s1.create({ agent: 'claude', resource: 'app' })
  s1.close()
  assert.ok(existsSync(file))
  const s2 = openStore(file)
  t.after(() => s2.close())
  assert.equal(s2.get(c.id).agent, 'claude')
})

test('create: defaults and shape', (t) => {
  const s = store(t)
  const c = s.create({ agent: 'claude', resource: 'app' })
  assert.equal(c.kind, 'project')
  assert.equal(c.note, '')
  assert.equal(c.status, 'active')
  assert.equal(c.stale, false)
  assert.equal(c.claimed_at, c.heartbeat_at)
  assert.equal(s.findActive('claude', 'app').id, c.id)
  assert.equal(s.findActive('codex', 'app'), undefined)
})

test('heartbeat refreshes in place — no duplicate row', (t) => {
  const s = store(t)
  const c = s.create({ agent: 'claude', resource: 'app' })
  ageHeartbeat(s, c.id, 45)
  assert.equal(s.get(c.id).stale, true)
  assert.ok(s.heartbeat(c.id))
  assert.equal(s.get(c.id).stale, false)
  assert.equal(s.active().length, 1)
  assert.equal(s.heartbeat('nope'), false)
})

test('stale flag flips exactly after TTL; expiry only after 2x TTL', (t) => {
  const s = store(t, 10)
  const c = s.create({ agent: 'claude', resource: 'app' })
  const hb = Date.parse(s.get(c.id).heartbeat_at)
  assert.equal(s.active(hb + 10 * MIN)[0].stale, false, 'at exactly TTL: not yet stale')
  assert.equal(s.active(hb + 10 * MIN + 1)[0].stale, true)
  assert.deepEqual(s.expireStale(hb + 19 * MIN), [], 'stale but under 2x TTL: kept')
  assert.equal(s.active().length, 1)
  assert.deepEqual(s.expireStale(hb + 21 * MIN), [c.id])
  assert.equal(s.active().length, 0)
  const [h] = s.history()
  assert.equal(h.status, 'expired')
  assert.equal(h.released_by, 'ttl-reaper')
})

test('release: once only, recorded in history, frees findActive', (t) => {
  const s = store(t)
  const c = s.create({ agent: 'claude', resource: 'app' })
  assert.ok(s.release(c.id, 'claude'))
  assert.equal(s.release(c.id, 'claude'), false, 'second release is a no-op')
  assert.equal(s.heartbeat(c.id), false, 'released claims cannot be revived')
  assert.equal(s.findActive('claude', 'app'), undefined)
  const got = s.get(c.id)
  assert.equal(got.status, 'released')
  assert.equal(got.released_by, 'claude')
  assert.equal(got.stale, false, 'released claims are never stale')
  assert.equal(s.history()[0].id, c.id)
  assert.equal(s.get('missing'), undefined)
})

test('history is newest-first and honors the limit', (t) => {
  const s = store(t)
  const ids = ['a', 'b', 'c'].map((r) => s.create({ agent: 'x', resource: r }).id)
  ids.forEach((id, i) => s.db.prepare(`UPDATE claims SET status='released', released_at=? WHERE id=?`).run(`2026-01-0${i + 1}T00:00:00.000Z`, id))
  assert.deepEqual(s.history().map((h) => h.id), ids.slice().reverse())
  assert.equal(s.history(2).length, 2)
})
