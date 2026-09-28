import { createServer as createNetServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '../src/server.js'

export const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js')

/** Fresh temp dir, removed when the test ends. */
export function tempDir(t, prefix = 'workboard-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Ask the OS for an unused loopback port. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

/** In-process board on an ephemeral loopback port with a temp DB. */
export async function startApp(t, { ttlMinutes = 30 } = {}) {
  const dir = tempDir(t)
  const { app, store, close } = createServer({ dbFile: join(dir, 'test.db'), ttlMinutes })
  const srv = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => srv.on('listening', resolve))
  t.after(() => new Promise((resolve) => srv.close(() => (close(), resolve()))))
  const base = `http://127.0.0.1:${srv.address().port}`
  const post = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(base + url, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { base, store, post }
}

/** `workboard serve` as a child process with a temp DB; resolves once it is listening. */
export async function spawnServe(t, extraArgs = [], env = process.env) {
  const dir = tempDir(t, 'workboard-serve-')
  const port = await freePort()
  const child = spawn(process.execPath, [CLI, 'serve', '--port', String(port), '--db', join(dir, 's.db'), ...extraArgs], { env })
  t.after(() => child.kill())
  const banner = await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => resolve(String(d)))
    child.on('error', reject)
    child.on('exit', (code) => reject(new Error(`server exited early (${code})`)))
    setTimeout(() => reject(new Error('server did not start')), 5000)
  })
  return { port, url: `http://127.0.0.1:${port}`, banner, dir }
}
