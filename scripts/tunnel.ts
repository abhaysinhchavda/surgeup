/**
 * Starts a Cloudflare quick tunnel to the local server and points vercel.json at
 * it. Quick tunnels get a new URL on every start, so when the URL changed this
 * commits and pushes vercel.json (Vercel redeploys from main). Keeps running
 * while the tunnel is up; Ctrl+C stops it.
 *   npm run tunnel
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const PORT = Number(process.env.PORT ?? 3000)
const WINDOWS_PATH = 'C:/Program Files (x86)/cloudflared/cloudflared.exe'
const bin = process.env.CLOUDFLARED ?? (existsSync(WINDOWS_PATH) ? WINDOWS_PATH : 'cloudflared')

const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`])
let done = false
const onOutput = (chunk: Buffer): void => {
  process.stderr.write(chunk)
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0]
  if (url === undefined || done) return
  done = true
  const before = readFileSync('vercel.json', 'utf8')
  const after = before.replace(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g, url)
  if (after === before) { console.log(`\nTunnel ${url} already in vercel.json`); return }
  writeFileSync('vercel.json', after)
  execFileSync('git', ['add', 'vercel.json'], { stdio: 'inherit' })
  execFileSync('git', ['commit', '-m', `Point vercel.json at tunnel ${url}`], { stdio: 'inherit' })
  execFileSync('git', ['push', 'origin', 'HEAD'], { stdio: 'inherit' })
  console.log(`\nvercel.json → ${url}, pushed. https://surgeapi.vercel.app/ is live again in about a minute.`)
}
child.stdout.on('data', onOutput)
child.stderr.on('data', onOutput)
child.on('exit', code => { process.exit(code ?? 0) })
