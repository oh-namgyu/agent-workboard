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

const WILD = /[*?]/
const segments = (glob) => {
  const n = normalizePath(glob)
  return n === '.' || n === '/' ? [] : n.split('/')
}

/** Literal leading directory of a glob: segments before the first one containing `*` or `?` (`src/api/**` → `src/api`). */
export function staticPrefix(glob) {
  const segs = segments(glob)
  const i = segs.findIndex((s) => WILD.test(s))
  return (i === -1 ? segs : segs.slice(0, i)).join('/')
}

/**
 * Could two path claims ever cover the same file? Conservative: false positives over false negatives.
 * Disjoint when their static prefixes diverge (neither is equal to / an ancestor of the other).
 * Otherwise walk both globs segment by segment: literal vs literal must be equal, literal vs wildcard
 * must match, wildcard vs wildcard is assumed to overlap, and a `**` segment or either glob ending
 * (a claim covers everything beneath it) means overlap.
 */
export function pathClaimsOverlap(a, b) {
  const pa = staticPrefix(a)
  const pb = staticPrefix(b)
  const nested = (p, q) => p === '' || pathClaimCovers(p, q)
  if (!nested(pa, pb) && !nested(pb, pa)) return false
  const sa = segments(a)
  const sb = segments(b)
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const [x, y] = [sa[i], sb[i]]
    if (x.includes('**') || y.includes('**')) return true
    const wx = WILD.test(x)
    const wy = WILD.test(y)
    if (wx && wy) continue
    if (wx ? !globToRegExp(x).test(y) : wy ? !globToRegExp(y).test(x) : x !== y) return false
  }
  return true
}

/**
 * Find active claims held by OTHER agents that collide with the request.
 * - resource collision: exact same resource string (typically a project name)
 * - path collision: a 'path' claim that covers the given file path
 * - path-claim overlap: when claiming with kind 'path', another 'path' claim that could cover the same files
 */
export function findConflicts(activeClaims, { agent, resource, path, kind }) {
  const file = path ? normalizePath(path) : ''
  return activeClaims.filter((c) => {
    if (c.agent === agent) return false
    if (resource && c.resource === resource) return true
    if (file && c.kind === 'path' && pathClaimCovers(c.resource, file)) return true
    if (kind === 'path' && resource && c.kind === 'path' && pathClaimsOverlap(c.resource, resource)) return true
    return false
  })
}
