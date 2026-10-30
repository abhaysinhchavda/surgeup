/**
 * Scripted bidding agent: reads the surge price, bids by urgency, pays the bid
 * from its own wallet over BRC-105 (AuthFetch answers the 402 itself).
 *   npm run agent -- A low 5
 */
import { pathToFileURL } from 'node:url'
import { AuthFetch, type WalletInterface } from '@bsv/sdk'
import { walletFromEnv } from './wallet'

export type Urgency = 'low' | 'medium' | 'high'
const MULTIPLIER: Record<Urgency, number> = { low: 1, medium: 1.5, high: 3 }

export const bidFor = (urgency: Urgency, surgeSats: number): number => Math.ceil(surgeSats * MULTIPLIER[urgency])

export async function submitJob (wallet: WalletInterface, baseUrl: string, prompt: string, bid: number, label: string): Promise<{ status: number, body: any }> {
  const res = await new AuthFetch(wallet).fetch(`${baseUrl}/job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, bid, label })
  })
  return { status: res.status, body: await res.json() }
}

const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

export async function runAgent (o: { name: string, urgency: Urgency, wallet: WalletInterface, baseUrl: string, jobs: number, gapMs: number }): Promise<void> {
  const label = `Agent ${o.name} (${o.urgency})`
  for (let i = 1; i <= o.jobs; i++) {
    const { priceSats } = await (await fetch(`${o.baseUrl}/price`)).json()
    const prompt = `${o.name} task ${i}`
    let r = await submitJob(o.wallet, o.baseUrl, prompt, bidFor(o.urgency, priceSats), label)
    // The surge rose between reading the price and bidding: one retry at the new price.
    if (r.status === 400 && r.body?.error === 'bid below surge price') {
      r = await submitJob(o.wallet, o.baseUrl, prompt, bidFor(o.urgency, r.body.priceSats), label)
    }
    if (r.status === 200) console.log(`${label}: paid ${r.body.paidSats} sats, position ${r.body.position}  https://whatsonchain.com/tx/${r.body.txid}`)
    else console.log(`${label}: refused ${r.status} ${JSON.stringify(r.body)}`)
    await sleep(o.gapMs)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [name = 'A', urgency = 'low', jobs = '5'] = process.argv.slice(2)
  if (!(urgency in MULTIPLIER) || !Number.isInteger(Number(jobs))) throw new Error('usage: npm run agent -- <A|B|C|LLM> <low|medium|high> <jobs>')
  const wallet = await walletFromEnv(`AGENT_${name.toUpperCase()}_KEY`)
  await runAgent({ name, urgency: urgency as Urgency, wallet, baseUrl: process.env.SURGE_URL ?? 'http://localhost:3000', jobs: Number(jobs), gapMs: 300 })
  process.exit(0) // wallet monitor keeps the event loop alive
}
