import { basename, relative, isAbsolute } from 'node:path'
import { api, baseUrl } from './cli.js'

const GATED_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/

async function readStdin() {
  if (process.stdin.isTTY) return ''
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data
}

/**
 * Claude Code hook entry points. Exit codes follow the hook contract:
 * 0 = allow / continue, 2 = block the tool call (stderr is fed back to Claude).
 * Server unreachable = fail-open: never break the user's session over the board.
 */
export async function runHook(event) {
  let payload = {}
  try {
    payload = JSON.parse(await readStdin())
  } catch {
    /* manual invocation without JSON — fall through with defaults */
  }
  const agent = process.env.WORKBOARD_AGENT || 'claude'
  const cwd = payload.cwd || process.cwd()
  const project = basename(cwd)

  if (event === 'pretooluse') {
    if (!GATED_TOOLS.test(payload.tool_name || '')) return 0
    const file = payload.tool_input?.file_path || ''
    const rel = isAbsolute(file) ? relative(cwd, file) : file
    const q = new URLSearchParams({ agent, resource: project })
    if (rel && !rel.startsWith('..')) q.set('path', rel)
    let data
    try {
      data = (await api(`/api/check?${q}`)).data
    } catch {
      return 0
    }
    if (data.allowed) return 0
    const held = data.conflicts.map((c) => `${c.agent} (since ${c.claimed_at})`).join(', ')
    console.error(
      `agent-workboard: edit blocked — this resource is claimed by ${held}. ` +
        `Coordinate with that agent or wait for the release. Board: ${baseUrl()}`
    )
    return 2
  }

  if (event === 'session-start') {
    try {
      const { status, data } = await api('/api/claims', {
        method: 'POST',
        body: { agent, resource: project, note: 'Claude Code session' },
      })
      if (status === 409) {
        const holders = data.conflicts.map((c) => c.agent).join(', ')
        console.log(
          `agent-workboard WARNING: "${project}" is already claimed by ${holders}. ` +
            `Edits here will be blocked until that claim is released. Board: ${baseUrl()}`
        )
      } else {
        console.log(`agent-workboard: claimed "${project}" as ${agent}.`)
      }
    } catch {
      /* board offline — stay silent */
    }
    return 0
  }

  if (event === 'session-end') {
    try {
      const { data } = await api('/api/claims')
      const mine = data.active?.find((c) => c.agent === agent && c.resource === project)
      if (mine) await api(`/api/claims/${mine.id}/release`, { method: 'POST', body: { by: agent } })
    } catch {
      /* board offline — stay silent */
    }
    return 0
  }

  console.error(`unknown hook event: ${event} (expected pretooluse | session-start | session-end)`)
  return 1
}
