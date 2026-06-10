/** Glob with *, ** and ? — no dependency, anchored full-match. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
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

/**
 * Find active claims held by OTHER agents that collide with the request.
 * - resource collision: exact same resource string (typically a project name)
 * - path collision: a 'path' claim whose glob matches the given file path
 */
export function findConflicts(activeClaims, { agent, resource, path }) {
  return activeClaims.filter((c) => {
    if (c.agent === agent) return false
    if (resource && c.resource === resource) return true
    if (path && c.kind === 'path' && globToRegExp(c.resource).test(path)) return true
    return false
  })
}
