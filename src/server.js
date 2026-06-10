import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { openStore } from './db.js'
import { findConflicts } from './conflict.js'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

export const defaults = {
  port: Number(process.env.WORKBOARD_PORT) || 5054,
  dbFile: process.env.WORKBOARD_DB || join(homedir(), '.agent-workboard', 'workboard.db'),
  ttlMinutes: Number(process.env.WORKBOARD_TTL_MIN) || 30,
}

export function createServer({ dbFile, ttlMinutes } = {}) {
  const store = openStore(dbFile ?? defaults.dbFile, { ttlMinutes: ttlMinutes ?? defaults.ttlMinutes })
  const app = express()
  app.use(express.json())
  app.use(express.static(PUBLIC_DIR))

  const sseClients = new Set()
  const broadcast = () => {
    for (const res of sseClients) res.write(`data: update\n\n`)
  }

  app.get('/api/health', (req, res) => res.json({ ok: true, name: 'agent-workboard' }))

  app.get('/api/claims', (req, res) => {
    store.expireStale()
    res.json({ active: store.active(), history: store.history() })
  })

  app.post('/api/claims', (req, res) => {
    const { agent, resource, kind, note } = req.body || {}
    if (!agent || !resource) return res.status(400).json({ error: 'agent and resource are required' })
    store.expireStale()
    const existing = store.findActive(agent, resource)
    if (existing) {
      store.heartbeat(existing.id)
      return res.json({ claim: store.get(existing.id), refreshed: true })
    }
    const conflicts = findConflicts(store.active(), { agent, resource })
    if (conflicts.length) return res.status(409).json({ error: 'resource is claimed by another agent', conflicts })
    const claim = store.create({ agent, resource, kind, note })
    broadcast()
    res.status(201).json({ claim })
  })

  app.post('/api/claims/:id/heartbeat', (req, res) => {
    if (!store.heartbeat(req.params.id)) return res.status(404).json({ error: 'no active claim with that id' })
    res.json({ ok: true })
  })

  app.post('/api/claims/:id/release', (req, res) => {
    if (!store.release(req.params.id, req.body?.by ?? null)) {
      return res.status(404).json({ error: 'no active claim with that id' })
    }
    broadcast()
    res.json({ ok: true })
  })

  // Conflict probe used by agent hooks: ?agent=claude&resource=<project>&path=<file>
  app.get('/api/check', (req, res) => {
    const { agent, resource, path } = req.query
    if (!agent) return res.status(400).json({ error: 'agent is required' })
    store.expireStale()
    const conflicts = findConflicts(store.active(), { agent, resource, path })
    res.json({ allowed: conflicts.length === 0, conflicts })
  })

  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.flushHeaders()
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
  })

  const reaper = setInterval(() => {
    if (store.expireStale().length) broadcast()
  }, 60_000)
  reaper.unref()

  return { app, store, close: () => (clearInterval(reaper), store.close()) }
}
