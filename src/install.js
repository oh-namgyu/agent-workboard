import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'src', 'cli.js')
const COMMANDS_SRC = join(ROOT, 'integrations', 'claude-code', 'commands')

function ensureHook(settings, event, entry) {
  settings.hooks ??= {}
  settings.hooks[event] ??= []
  const already = JSON.stringify(settings.hooks[event]).includes('agent-workboard')
  if (!already) settings.hooks[event].push(entry)
  return !already
}

/** Wire hooks + slash commands into a project's .claude/ directory. Idempotent. */
export async function installClaude(args) {
  const target = resolve(args.project || process.cwd())
  const hookCmd = (sub) => `node "${CLI}" hook ${sub}`

  const settingsPath = join(target, '.claude', 'settings.local.json')
  mkdirSync(dirname(settingsPath), { recursive: true })
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}

  const added = [
    ensureHook(settings, 'PreToolUse', {
      matcher: 'Edit|Write|MultiEdit|NotebookEdit',
      hooks: [{ type: 'command', command: hookCmd('pretooluse') }],
    }),
    ensureHook(settings, 'SessionStart', {
      hooks: [{ type: 'command', command: hookCmd('session-start') }],
    }),
    ensureHook(settings, 'SessionEnd', {
      hooks: [{ type: 'command', command: hookCmd('session-end') }],
    }),
  ].filter(Boolean).length

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')

  const commandsDir = join(target, '.claude', 'commands')
  mkdirSync(commandsDir, { recursive: true })
  const copied = []
  for (const file of readdirSync(COMMANDS_SRC)) {
    const body = readFileSync(join(COMMANDS_SRC, file), 'utf8').replaceAll('{{WORKBOARD}}', `node "${CLI}"`)
    writeFileSync(join(commandsDir, file), body)
    copied.push(file.replace(/\.md$/, ''))
  }

  console.log(`✓ agent-workboard installed for ${target}`)
  console.log(`  hooks added: ${added} (PreToolUse gate, SessionStart claim, SessionEnd release)`)
  console.log(`  slash commands: ${copied.map((c) => '/' + c).join(', ')}`)
  console.log(`  settings: ${settingsPath}`)
  console.log(`Start the board with: workboard serve  (or: node "${CLI}" serve)`)
  return 0
}
