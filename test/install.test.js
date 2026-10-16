import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureHook } from '../src/install.js'

const entry = (clone, sub) => ({ hooks: [{ type: 'command', command: `node "${clone}/src/cli.js" hook ${sub}` }] })

test('ensureHook is idempotent whatever the clone directory is called', () => {
  const settings = {}
  assert.equal(ensureHook(settings, 'SessionStart', entry('/w', 'session-start')), true)
  assert.equal(ensureHook(settings, 'SessionStart', entry('/w', 'session-start')), false)
  assert.equal(settings.hooks.SessionStart.length, 1)
})

test('ensureHook repoints an existing hook when the clone moved', () => {
  const settings = { hooks: { SessionEnd: [entry('/old/place', 'session-end')] } }
  assert.equal(ensureHook(settings, 'SessionEnd', entry('/new/place', 'session-end')), false)
  assert.equal(settings.hooks.SessionEnd.length, 1)
  assert.equal(settings.hooks.SessionEnd[0].hooks[0].command, 'node "/new/place/src/cli.js" hook session-end')
})

test("ensureHook leaves other tools' hooks alone and adds its own", () => {
  const foreign = { hooks: [{ type: 'command', command: 'node "/x/other/cli.js" lint' }] }
  const settings = { hooks: { PreToolUse: [foreign] } }
  assert.equal(ensureHook(settings, 'PreToolUse', entry('C:\\clones\\wb', 'pretooluse')), true)
  assert.equal(settings.hooks.PreToolUse.length, 2)
  assert.equal(settings.hooks.PreToolUse[0], foreign)
})
