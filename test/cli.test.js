import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { CLI, spawnServe, tempDir } from './helpers.js'

let URL

function cli(args, agent) {
  const env = { ...process.env, WORKBOARD_URL: URL, WORKBOARD_AGENT: agent }
  return promisify(execFile)(process.execPath, [CLI, ...args], { env }).then(
    (r) => ({ code: 0, out: r.stdout + r.stderr }),
    (e) => ({ code: e.code, out: (e.stdout || '') + (e.stderr || '') })
  )
}

test('CLI e2e — two agents collide on one resource', async (t) => {
  URL = (await spawnServe(t)).url

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

test('install-claude writes only into the target project and is idempotent', async (t) => {
  const project = tempDir(t, 'workboard-install-')
  for (let i = 0; i < 2; i++) {
    const r = await cli(['install-claude', '--project', project], 'claude')
    assert.equal(r.code, 0, r.out)
  }
  const settings = JSON.parse(readFileSync(join(project, '.claude', 'settings.local.json'), 'utf8'))
  for (const event of ['PreToolUse', 'SessionStart', 'SessionEnd']) {
    assert.equal(settings.hooks[event].length, 1, `${event} hook duplicated on re-install`)
  }
  assert.match(settings.hooks.PreToolUse[0].matcher, /NotebookEdit/)
  const commands = readdirSync(join(project, '.claude', 'commands'))
  assert.ok(commands.length > 0)
  for (const f of commands) {
    assert.doesNotMatch(readFileSync(join(project, '.claude', 'commands', f), 'utf8'), /\{\{WORKBOARD\}\}/)
  }
})
