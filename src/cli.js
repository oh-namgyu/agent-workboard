#!/usr/bin/env node
import { basename } from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HELP = `agent-workboard — claim board for multiple AI coding agents

Usage:
  workboard serve [--port N] [--host H] [--db FILE] [--ttl MINUTES]
  workboard claim <resource> [--agent NAME] [--note TEXT] [--kind project|path]
  workboard release <resource> [--agent NAME] | --id ID
  workboard list [--json]
  workboard check [--resource R] [--path FILE] [--agent NAME]   (exit 2 on conflict)
  workboard watch [--interval SECONDS]
  workboard hook <pretooluse|session-start|session-end>          (Claude Code hook entry)
  workboard install-claude [--project DIR]                       (write hooks + slash commands)

Environment:
  WORKBOARD_URL    server base URL    (default http://127.0.0.1:5054)
  WORKBOARD_AGENT  agent identity     (default "agent")
  WORKBOARD_PORT / WORKBOARD_DB / WORKBOARD_TTL_MIN  server settings
`

export function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) args[key] = true
      else (args[key] = next), i++
    } else args._.push(argv[i])
  }
  return args
}

export const baseUrl = () => process.env.WORKBOARD_URL || 'http://127.0.0.1:5054'
export const agentName = (args) => args.agent || process.env.WORKBOARD_AGENT || 'agent'
export const projectName = () => basename(process.cwd())

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(baseUrl() + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

const fmtClaim = (c) =>
  `${c.stale ? '⚠ ' : '• '}[${c.agent}] ${c.resource} (${c.kind}) since ${c.claimed_at}${c.note ? ` — ${c.note}` : ''} id=${c.id}`

async function findClaimId(agent, resource) {
  const { data } = await api('/api/claims')
  return data.active?.find((c) => c.agent === agent && c.resource === resource)?.id
}

async function run(cmd, args) {
  if (cmd === 'serve') {
    const { createServer, defaults } = await import('./server.js')
    const port = Number(args.port) || defaults.port
    const host = args.host || process.env.WORKBOARD_HOST || '127.0.0.1'
    const { app } = createServer({ dbFile: args.db, ttlMinutes: args.ttl ? Number(args.ttl) : undefined })
    app.listen(port, host, () => console.log(`agent-workboard listening on http://${host}:${port}`))
    return null // keep process alive
  }

  if (cmd === 'claim') {
    const resource = args._[1] || projectName()
    const { status, data } = await api('/api/claims', {
      method: 'POST',
      body: { agent: agentName(args), resource, kind: args.kind || 'project', note: args.note || '' },
    })
    if (status === 409) {
      console.error(`✗ conflict — held by: ${data.conflicts.map(fmtClaim).join('; ')}`)
      return 2
    }
    console.log(`✓ claimed ${resource} (id=${data.claim.id}${data.refreshed ? ', refreshed' : ''})`)
    return 0
  }

  if (cmd === 'release') {
    const id = args.id || (await findClaimId(agentName(args), args._[1] || projectName()))
    if (!id) return console.error('✗ no matching active claim'), 1
    const { status } = await api(`/api/claims/${id}/release`, { method: 'POST', body: { by: agentName(args) } })
    console.log(status === 200 ? `✓ released (id=${id})` : '✗ release failed')
    return status === 200 ? 0 : 1
  }

  if (cmd === 'list') {
    const { data } = await api('/api/claims')
    if (args.json) return console.log(JSON.stringify(data, null, 2)), 0
    if (!data.active?.length) return console.log('(no active claims)'), 0
    data.active.forEach((c) => console.log(fmtClaim(c)))
    return 0
  }

  if (cmd === 'check') {
    const q = new URLSearchParams({ agent: agentName(args), resource: args.resource || projectName() })
    if (args.path) q.set('path', args.path)
    const { data } = await api(`/api/check?${q}`)
    if (data.allowed) return console.log('✓ allowed'), 0
    console.error(`✗ blocked — ${data.conflicts.map(fmtClaim).join('; ')}`)
    return 2
  }

  if (cmd === 'watch') {
    const interval = (Number(args.interval) || 3) * 1000
    for (;;) {
      const { data } = await api('/api/claims')
      console.clear()
      console.log(`agent-workboard @ ${baseUrl()} — ${new Date().toLocaleTimeString()}\n`)
      data.active?.length ? data.active.forEach((c) => console.log(fmtClaim(c))) : console.log('(no active claims)')
      await new Promise((r) => setTimeout(r, interval))
    }
  }

  if (cmd === 'hook') {
    const { runHook } = await import('./hooks.js')
    return runHook(args._[1], args)
  }

  if (cmd === 'install-claude') {
    const { installClaude } = await import('./install.js')
    return installClaude(args)
  }

  console.log(HELP)
  return cmd && cmd !== 'help' ? 1 : 0
}

let isMain = false
try {
  isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
} catch {
  /* argv[1] missing or unreadable — not a CLI invocation */
}
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  run(args._[0], args)
    .then((code) => code !== null && process.exit(code))
    .catch((err) => {
      console.error(`✗ ${err.message} (is the server running? try: workboard serve)`)
      process.exit(1)
    })
}
