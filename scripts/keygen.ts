/**
 * Creates any missing wallet keys in .env. Never overwrites an existing value
 * and never prints a private key — only the public identity keys.
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { PrivateKey } from '@bsv/sdk'

const ENV = '.env'
const KEYS = ['PROVIDER_KEY', 'AGENT_A_KEY', 'AGENT_B_KEY', 'AGENT_C_KEY', 'AGENT_LLM_KEY']
const DEFAULTS: Record<string, string> = { SURGE_URL: 'http://localhost:3000', OVERLAY_URL: 'http://localhost:8080' }

const text = existsSync(ENV) ? readFileSync(ENV, 'utf8') : ''
const current = new Map(text.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const lines: string[] = []
for (const name of KEYS) {
  if ((current.get(name) ?? '') === '') {
    const hex = PrivateKey.fromRandom().toHex()
    current.set(name, hex)
    lines.push(`${name}=${hex}`)
  }
}
for (const [name, value] of Object.entries(DEFAULTS)) {
  if (!current.has(name)) lines.push(`${name}=${value}`)
}
if (lines.length > 0) appendFileSync(ENV, (text === '' || text.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n')

console.log(lines.length > 0 ? `Updated ${ENV} (${lines.length} new entries). Keys are not printed.` : `${ENV} already complete.`)
for (const name of KEYS) {
  console.log(`${name.padEnd(14)} identity key: ${PrivateKey.fromHex(current.get(name)!).toPublicKey().toString()}`)
}
