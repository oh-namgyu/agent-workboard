import test from 'node:test'
import assert from 'node:assert/strict'
import { globToRegExp, findConflicts } from '../src/conflict.js'

const pathClaim = (resource, agent = 'gemini') => ({ agent, resource, kind: 'path' })
const blocks = (resource, path) => findConflicts([pathClaim(resource)], { agent: 'claude', path }).length === 1

test('glob: regex metacharacters in the glob are literal', () => {
  assert.ok(globToRegExp('a.b(c)+[d].js').test('a.b(c)+[d].js'))
  assert.ok(!globToRegExp('a.js').test('abjs'))
  assert.ok(!globToRegExp('file?.md').test('file/.md'), '? never matches a slash')
})

test('glob: ** also matches zero directories', () => {
  assert.ok(globToRegExp('src/**/*.js').test('src/a.js'))
  assert.ok(globToRegExp('src/**/*.js').test('src/x/y/a.js'))
  assert.ok(globToRegExp('**/*.test.js').test('a.test.js'))
  assert.ok(globToRegExp('**/*.test.js').test('deep/dir/a.test.js'))
  assert.ok(!globToRegExp('src/**/*.js').test('srcx/a.js'))
})

test('path claim: sibling sharing a name prefix is NOT covered', () => {
  assert.ok(!blocks('src/a', 'src/ab'))
  assert.ok(!blocks('src/a', 'src/ab/x.js'))
  assert.ok(!blocks('src/a/**', 'src/ab/x.js'))
  assert.ok(!blocks('src/api/**', 'src/api-v2/users.js'))
})

test('path claim: a directory claim covers everything beneath it', () => {
  assert.ok(blocks('src/a', 'src/a'))
  assert.ok(blocks('src/a', 'src/a/x.js'))
  assert.ok(blocks('src/a/**', 'src/a/deep/x.js'))
})

test('path claim: trailing slash on the claim means the directory', () => {
  assert.ok(blocks('src/api/', 'src/api/users.js'))
  assert.ok(blocks('src/api//', 'src/api/users.js'))
  assert.ok(!blocks('src/api/', 'src/apix.js'))
})

test('path probe is normalized before matching (./, //, .., backslashes)', () => {
  assert.ok(blocks('src/api/**', './src/api/users.js'))
  assert.ok(blocks('src/api/**', 'src//api/users.js'))
  assert.ok(blocks('src/api/**', 'src/ui/../api/users.js'))
  assert.ok(blocks('src/api/**', 'src\\api\\users.js'))
})

test('matching is case-sensitive (documented behavior)', () => {
  assert.ok(!blocks('src/api/**', 'SRC/api/users.js'))
  assert.equal(findConflicts([{ agent: 'codex', resource: 'My-App', kind: 'project' }], { agent: 'claude', resource: 'my-app' }).length, 0)
})

test('project claims: exact resource only, same agent never conflicts with itself', () => {
  const active = [{ agent: 'codex', resource: 'my-app', kind: 'project' }]
  assert.equal(findConflicts(active, { agent: 'claude', resource: 'my-app-2' }).length, 0)
  assert.equal(findConflicts(active, { agent: 'claude', resource: 'my' }).length, 0)
  assert.equal(findConflicts(active, { agent: 'codex', resource: 'my-app', path: 'my-app' }).length, 0)
})

test('project claims are not treated as path globs', () => {
  const active = [{ agent: 'codex', resource: 'src/**', kind: 'project' }]
  assert.equal(findConflicts(active, { agent: 'claude', path: 'src/a.js' }).length, 0)
})

test('same project, different location: a path claim elsewhere does not block', () => {
  const active = [pathClaim('src/api/**'), pathClaim('docs/**', 'codex')]
  assert.equal(findConflicts(active, { agent: 'claude', resource: 'my-app', path: 'src/ui/app.js' }).length, 0)
  const hit = findConflicts(active, { agent: 'claude', resource: 'my-app', path: 'docs/a.md' })
  assert.deepEqual(hit.map((c) => c.agent), ['codex'])
})

test('no resource and no path → never a conflict', () => {
  assert.equal(findConflicts([pathClaim('**')], { agent: 'claude' }).length, 0)
})

const claimBlocked = (held, wanted, holder = 'gemini') =>
  findConflicts([pathClaim(held, holder)], { agent: 'claude', resource: wanted, kind: 'path' }).length === 1

test('path claim vs path claim: nested or overlapping claims conflict (both directions)', () => {
  const overlapping = [
    ['src/**', 'src/api/**'],
    ['src/api', 'src/api/users.js'],
    ['src/api/', 'src/api/**'],
    ['src', 'src/**/*.js'],
    ['**', 'docs/a.md'],
    ['**/*.md', 'docs'],
    ['*.md', 'README.md'],
    ['src/*/users.js', 'src/api'],
    ['./src//api/', 'src/api/x.js'],
    ['src/*.js', 'src/*.ts'], // two wildcard segments: conservatively treated as overlapping
  ]
  for (const [a, b] of overlapping) {
    assert.ok(claimBlocked(a, b), `${a} vs ${b}`)
    assert.ok(claimBlocked(b, a), `${b} vs ${a}`)
  }
})

test('path claim vs path claim: disjoint claims do not conflict', () => {
  const disjoint = [
    ['src/api', 'src/api-v2'],
    ['src/api/**', 'src/api-v2/**'],
    ['src/a', 'src/ab/x.js'],
    ['*.md', 'src/x.js'],
    ['*.md', 'src'],
    ['src/*/users.js', 'src/api/orders.js'],
    ['docs/**', 'src/**'],
  ]
  for (const [a, b] of disjoint) {
    assert.ok(!claimBlocked(a, b), `${a} vs ${b}`)
    assert.ok(!claimBlocked(b, a), `${b} vs ${a}`)
  }
})

test('path claim vs path claim: same agent never conflicts with itself', () => {
  assert.equal(findConflicts([pathClaim('src/**', 'claude')], { agent: 'claude', resource: 'src/api/**', kind: 'path' }).length, 0)
})

test('path claim overlap only applies between path claims', () => {
  // a project claim named like a directory does not block a path claim beneath it
  assert.equal(findConflicts([{ agent: 'codex', resource: 'src', kind: 'project' }], { agent: 'claude', resource: 'src/api', kind: 'path' }).length, 0)
  // a new project claim is still exact-match only
  assert.equal(findConflicts([pathClaim('src/**')], { agent: 'claude', resource: 'src' }).length, 0)
})
