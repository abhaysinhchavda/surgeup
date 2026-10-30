/**
 * An agent buys a SURGEPASS, or uses one to jump the queue.
 *   npm run pass -- buy A
 *   npm run pass -- use B "Urgent incident summary"
 * Using a pass sends it back to the provider, then POST /job/pass with that txid.
 */
import { AuthFetch } from '@bsv/sdk'
import { OverlayClient } from '../src/kit/client/overlayApi'
import { TokenKit } from '../src/kit/client/token'
import { walletFromEnv } from '../src/wallet'

const [cmd, name, prompt = 'Pass holder task'] = process.argv.slice(2)
const tokenId = process.env.PASS_TOKEN_ID
const baseUrl = process.env.SURGE_URL ?? 'http://localhost:3000'
if ((cmd !== 'buy' && cmd !== 'use') || name === undefined) throw new Error('usage: npm run pass -- buy <A|B|C|LLM>  |  npm run pass -- use <A|B|C|LLM> "<prompt>"')
if (tokenId === undefined || tokenId === '') throw new Error('PASS_TOKEN_ID missing in .env: run npm run deploy-pass first')

const wallet = await walletFromEnv(`AGENT_${name.toUpperCase()}_KEY`)
const kit = new TokenKit(wallet, new OverlayClient(process.env.OVERLAY_URL ?? 'http://localhost:8080'))
const label = `Agent ${name} (pass)`
const post = async (path: string, body: object): Promise<{ status: number, body: any }> => {
  const res = await new AuthFetch(wallet).fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

if (cmd === 'buy') {
  const r = await post('/pass', {})
  if (r.status !== 200) throw new Error(`buying a pass failed: ${r.status} ${JSON.stringify(r.body)}`)
  await kit.sync()
  console.log(`${label}: bought a pass  https://whatsonchain.com/tx/${r.body.passTxid}`)
} else {
  await kit.sync()
  const { identityKey: providerKey } = await (await fetch(`${baseUrl}/provider`)).json()
  const { txid } = await kit.send(tokenId, 1n, providerKey)
  console.log(`${label}: sent the pass back  https://whatsonchain.com/tx/${txid}`)
  const r = await post('/job/pass', { prompt, passTxid: txid, label })
  if (r.status !== 200) throw new Error(`redeeming the pass failed: ${r.status} ${JSON.stringify(r.body)}`)
  console.log(`${label}: queued at position ${r.body.position}`)
}
process.exit(0) // wallet monitor keeps the event loop alive
