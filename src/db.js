import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export function openStore(file, { ttlMinutes = 30 } = {}) {
  mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    resource TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'project',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    claimed_at TEXT NOT NULL,
    heartbeat_at TEXT NOT NULL,
    released_at TEXT,
    released_by TEXT
  )`)
  return new Store(db, ttlMinutes)
}

class Store {
  constructor(db, ttlMinutes) {
    this.db = db
    this.ttlMs = ttlMinutes * 60_000
  }

  decorate(row, now = Date.now()) {
    if (!row) return row
    const stale = row.status === 'active' && now - Date.parse(row.heartbeat_at) > this.ttlMs
    return { ...row, stale }
  }

  active(now = Date.now()) {
    return this.db
      .prepare(`SELECT * FROM claims WHERE status = 'active' ORDER BY claimed_at`)
      .all()
      .map((r) => this.decorate(r, now))
  }

  history(limit = 100) {
    return this.db
      .prepare(`SELECT * FROM claims WHERE status != 'active' ORDER BY released_at DESC LIMIT ?`)
      .all(limit)
  }

  get(id) {
    return this.decorate(this.db.prepare(`SELECT * FROM claims WHERE id = ?`).get(id))
  }

  findActive(agent, resource) {
    return this.db
      .prepare(`SELECT * FROM claims WHERE status = 'active' AND agent = ? AND resource = ?`)
      .get(agent, resource)
  }

  create({ agent, resource, kind = 'project', note = '' }) {
    const now = new Date().toISOString()
    const claim = {
      id: randomUUID().slice(0, 12),
      agent,
      resource,
      kind,
      note,
      status: 'active',
      claimed_at: now,
      heartbeat_at: now,
      released_at: null,
      released_by: null,
    }
    this.db
      .prepare(`INSERT INTO claims (id, agent, resource, kind, note, status, claimed_at, heartbeat_at)
                VALUES (@id, @agent, @resource, @kind, @note, @status, @claimed_at, @heartbeat_at)`)
      .run(claim)
    return this.decorate(claim)
  }

  heartbeat(id) {
    const res = this.db
      .prepare(`UPDATE claims SET heartbeat_at = ? WHERE id = ? AND status = 'active'`)
      .run(new Date().toISOString(), id)
    return res.changes > 0
  }

  release(id, by = null, status = 'released') {
    const res = this.db
      .prepare(`UPDATE claims SET status = ?, released_at = ?, released_by = ? WHERE id = ? AND status = 'active'`)
      .run(status, new Date().toISOString(), by, id)
    return res.changes > 0
  }

  /** Auto-release active claims whose heartbeat is older than 2x TTL. Returns expired ids. */
  expireStale(now = Date.now()) {
    const cutoff = new Date(now - this.ttlMs * 2).toISOString()
    const dead = this.db
      .prepare(`SELECT id FROM claims WHERE status = 'active' AND heartbeat_at < ?`)
      .all(cutoff)
    for (const { id } of dead) this.release(id, 'ttl-reaper', 'expired')
    return dead.map((d) => d.id)
  }

  close() {
    this.db.close()
  }
}
