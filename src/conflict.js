import { posix } from 'node:path'

/** Glob with *, ** and ? — no dependency, anchored full-match. `**` also matches zero directories. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/'
        re += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

/** Canonical relative form: forward slashes, no `./`, `//` or `..` segments, no trailing slash. */
export function normalizePath(p) {
  const n = posix.normalize(p.replaceAll('\\', '/'))
  return n.length > 1 ? n.replace(/\/+$/, '') : n
}

/** A path claim covers what its glob matches plus everything beneath it (`src/a` covers `src/a/x`, not `src/ab`). */
export function pathClaimCovers(glob, path) {
  const g = glob.replace(/\/+$/, '')
  return globToRegExp(g).test(path) || globToRegExp(`${g}/**`).test(path)
}

/**
 * Find active claims held by OTHER agents that collide with the request.
 * - resource collision: exact same resource string (typically a project name)
 * - path collision: a 'path' claim that covers the given file path
 */
export function findConflicts(activeClaims, { agent, resource, path }) {
  const file = path ? normalizePath(path) : ''
  return activeClaims.filter((c) => {
    if (c.agent === agent) return false
    if (resource && c.resource === resource) return true
    if (file && c.kind === 'path' && pathClaimCovers(c.resource, file)) return true
    return false
  })
}
