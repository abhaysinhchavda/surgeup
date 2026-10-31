/**
 * SurgeAPI server end to end on the mock chain: real wallet-toolbox wallets,
 * real BRC-103/104 auth and BRC-105 payments.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { AuthFetch, P2PKH, PublicKey, Random, Utils } from '@bsv/sdk'
import type { Wallet } from '@bsv/wallet-toolbox'
import { runAgent } from '../src/agent'
import { runLlmAgent } from '../src/llmAgent'
import { createAgentRunner } from '../src/agentRuns'
import { Market } from '../src/market'
import { createSurgeApp, mockRunJob, startWorker } from '../src/server'
import type { PassService } from '../src/pass'
import { createMockChain, type MockChain } from './helpers/mockchain'
import { createBrc29Payment } from '../src/payments'

const PORT = 18100
const url = `http://localhost:${PORT}`
const GOOD_PASS = 'a'.repeat(64)
const fakePasses: PassService = {
  issue: async () => ({ txid: 'f'.repeat(64) }),
  redeem: async txid => txid === GOOD_PASS
}

let chain: MockChain
let provider: Wallet, alice: Wallet, bob: Wallet
let market: Market, server: Server, worker: { stop: () => void } | undefined

const spendableSats = async (w: Wallet): Promise<number> =>
  (await w.listOutputs({ basket: 'default', limit: 1000 })).outputs.filter(o => o.spendable).reduce((s, o) => s + o.satoshis, 0)
const post = async (wallet: Wallet, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  await new AuthFetch(wallet).fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const getJson = async (path: string): Promise<any> => await (await fetch(url + path)).json()
const waitDone = async (id: string): Promise<any> => {
  for (let i = 0; i < 100; i++) {
    const job = await getJson(`/job/${id}`)
    if (job.status === 'done') return job
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`job ${id} never finished`)
}

// One long-lived server; each test swaps in a fresh app (restarting the server
// per test leaves fetch's keep-alive sockets dangling → ECONNRESET).
let app: (req: any, res: any) => void

beforeAll(async () => {
  server = await new Promise(resolve => { const s = createServer((req, res) => app(req, res)).listen(PORT, () => resolve(s)) })
  chain = await createMockChain()
  ;[provider, alice, bob] = await Promise.all([chain.makeWallet(), chain.makeWallet(), chain.makeWallet()])
  await chain.fund(alice) // sequential: parallel funding mines two identical mock blocks
  await chain.fund(bob)
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await chain?.close()
})

beforeEach(() => {
  market = new Market({ baseSats: 100, k: 0.5 })
  app = createSurgeApp(provider, market, fakePasses)
})
afterEach(() => {
  worker?.stop()
  worker = undefined
})

describe('pricing and validation', () => {
  it('price endpoint starts at base', async () => {
    expect(await getJson('/price')).toEqual({ priceSats: 100, queueDepth: 0, passSats: 500 })
    expect(await getJson('/provider')).toEqual({ identityKey: (await provider.getPublicKey({ identityKey: true })).publicKey })
  })

  it('rejects a bid below surge without charging', async () => {
    const before = await spendableSats(provider)
    const res = await post(alice, '/job', { prompt: 'x', bid: 50 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bid below surge price', priceSats: 100 })
    expect(await spendableSats(provider)).toBe(before)
  })

  it('rejects malformed bids', async () => {
    const before = await spendableSats(provider)
    for (const bid of ['abc', -5, 150.5, '200', undefined]) {
      const res = await post(alice, '/job', { prompt: 'x', bid })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad bid' })
    }
    expect(await spendableSats(provider)).toBe(before)
  })

  it('rejects bad prompts', async () => {
    for (const prompt of ['', 'a'.repeat(2001), undefined]) {
      const res = await post(alice, '/job', { prompt, bid: 150 })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad prompt' })
    }
  })

  it('unknown job is 404', async () => {
    const res = await fetch(`${url}/job/nope`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })
})

describe('paid jobs', () => {
  it('charges the bid and returns a job', async () => {
    worker = startWorker(market, mockRunJob(50), 10)
    const before = await spendableSats(provider)
    const res = await post(alice, '/job', { prompt: 'hello', bid: 150 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.paidSats).toBe(150)
    expect(body.txid).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof body.jobId).toBe('string')
    expect(await spendableSats(provider)).toBe(before + 150)
    const done = await waitDone(body.jobId)
    expect(done.result).toContain('hello')
  })

  it('higher later bid is served first', async () => {
    const a = await (await post(alice, '/job', { prompt: 'A', bid: 100 })).json()
    const b = await (await post(bob, '/job', { prompt: 'B', bid: 400 })).json()
    const state = await getJson('/state')
    expect(state.queue.map((j: any) => j.id)).toEqual([b.jobId, a.jobId])
    worker = startWorker(market, mockRunJob(50), 10)
    const [doneA, doneB] = [await waitDone(a.jobId), await waitDone(b.jobId)]
    expect(market.get(doneB.id)!.doneAt!).toBeLessThan(market.get(doneA.id)!.doneAt!)
  })

  /** Get the 402 challenge without letting AuthFetch pay it (as in the kit's replay test). */
  const challengeFor = async (body: object): Promise<{ derivationPrefix: string, serverKey: string }> => {
    const probe = new AuthFetch(alice)
    ;(probe as any).handlePaymentAndRetry = async (_u: string, _c: unknown, r: Response) => r
    const challenge = await probe.fetch(`${url}/job`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect(challenge.status).toBe(402)
    return { derivationPrefix: challenge.headers.get('x-bsv-payment-derivation-prefix')!, serverKey: challenge.headers.get('x-bsv-auth-identity-key')! }
  }
  /** Pay a challenge by hand and retry with the payment header. */
  const payRetry = async (body: { bid: number }, c: { derivationPrefix: string, serverKey: string }): Promise<Response> => {
    const derivationSuffix = Utils.toBase64(Random(32))
    const { publicKey } = await alice.getPublicKey({ protocolID: [2, '3241645161d8'], keyID: `${c.derivationPrefix} ${derivationSuffix}`, counterparty: c.serverKey })
    const created = await alice.createAction({
      description: 'Pay for a SurgeAPI job',
      outputs: [{ satoshis: body.bid, lockingScript: new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(), outputDescription: 'HTTP request payment' }],
      options: { randomizeOutputs: false }
    })
    const header = JSON.stringify({ derivationPrefix: c.derivationPrefix, derivationSuffix, transaction: Utils.toBase64(Array.from(created.tx!)) })
    return await post(alice, '/job', body, { 'x-bsv-payment': header })
  }
  const raiseSurge = (): void => {
    market.enqueue({ caller: 'x', label: 'x', prompt: 'x', paidSats: 1, txid: 'x' })
    market.enqueue({ caller: 'x', label: 'x', prompt: 'x', paidSats: 1, txid: 'x' })
    expect(market.price()).toBeGreaterThanOrEqual(200)
  }

  it('paid retry is accepted after surge rises', async () => {
    const body = { prompt: 'x', bid: 100 }
    const c = await challengeFor(body)
    raiseSurge() // while the caller is paying
    const res = await payRetry(body, c)
    expect(res.status).toBe(200)
    expect((await res.json()).paidSats).toBe(100)
  })

  it('a used cheap challenge cannot skip a later surge', async () => {
    const body = { prompt: 'x', bid: 100 }
    const c = await challengeFor(body)
    expect((await payRetry(body, c)).status).toBe(200)
    raiseSurge()
    // Same prefix again, below the live price. Refused before payment is read, so
    // no real tx (a real one would leave alice's wallet with an unaccepted parent).
    const header = JSON.stringify({ derivationPrefix: c.derivationPrefix, derivationSuffix: 'AAAA', transaction: 'AAAA' })
    const res = await post(alice, '/job', body, { 'x-bsv-payment': header })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('bid below surge price')
  })

  it('a high-urgency agent pays 3× the live surge', async () => {
    raiseSurge()
    const price = market.price()
    await runAgent({ name: 'T', urgency: 'high', wallet: alice, baseUrl: url, jobs: 1, gapMs: 0 })
    const s = market.snapshot()
    const job = [...s.queue, ...(s.running === undefined ? [] : [s.running]), ...s.served].find(j => j.label === 'Agent T (high)')
    expect(job?.paidSats).toBe(price * 3)
  })

  it('the LLM agent cannot spend past its budget', async () => {
    // Scripted stand-in for Claude: two 300-sat purchases against a 500-sat budget.
    const replies = [
      { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Urgent, buying now.' }, { type: 'tool_use', id: 't1', name: 'submit_job', input: { prompt: 'a', bid: 300 } }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'submit_job', input: { prompt: 'b', bid: 300 } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }
    ]
    const sent: any[] = []
    const client = { messages: { create: async (p: any) => { sent.push(JSON.parse(JSON.stringify(p.messages))); return replies.shift() } } }
    await runLlmAgent({ wallet: alice, baseUrl: url, tasks: [{ prompt: 'a', deadlineSec: 10, valueSats: 300 }], budgetSats: 500, client: client as any })

    const s = market.snapshot()
    const llmJobs = [...s.queue, ...(s.running === undefined ? [] : [s.running]), ...s.served].filter(j => j.label === 'LLM agent')
    expect(llmJobs.map(j => j.paidSats)).toEqual([300])
    const refused = sent[2].at(-1).content[0]
    expect(refused.is_error).toBe(true)
    expect(refused.content).toContain('over budget')
  })
})

describe('dashboard agent runs', () => {
  it('runs selected agents at once, each within its own budget', async () => {
    app = createSurgeApp(provider, market, fakePasses, createAgentRunner({ baseUrl: url, wallet: async () => bob, llm: false, token: 'secret' }))
    const agents = [
      { domain: 'finance', caseId: 'fraud', mode: 'scripted', budgetSats: 500 },
      { domain: 'logistics', caseId: 'lastmile', mode: 'scripted', budgetSats: 300 }
    ]
    const start = async (token: string, body: unknown = { agents }): Promise<Response> => await fetch(`${url}/agents/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-run-token': token }, body: JSON.stringify(body)
    })
    expect((await start('wrong')).status).toBe(401)
    expect((await start('secret', { agents: [agents[0], agents[0]] })).status).toBe(400) // one agent per domain
    expect((await start('secret')).status).toBe(200)
    expect((await start('secret')).status).toBe(409) // one batch at a time
    let runs: any[] = []
    for (let i = 0; i < 300 && !(runs.length === 2 && runs.every(r => r.status !== 'running')); i++) {
      runs = (await getJson('/agents')).runs
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(runs.map(r => r.status)).toEqual(['done', 'done'])
    const s = market.snapshot()
    const jobs = [...s.queue, ...(s.running === undefined ? [] : [s.running]), ...s.served]
    for (const [i, label] of ['Finance agent', 'Logistics agent'].entries()) {
      const paid = jobs.filter(j => j.label === label).reduce((sum, j) => sum + j.paidSats, 0)
      expect(runs[i].spentSats).toBe(paid)
      expect(paid).toBeGreaterThan(0)
      expect(paid).toBeLessThanOrEqual(agents[i].budgetSats)
    }
  })

  it('a dashboard top-up funds the agent wallet, and /network counts it', async () => {
    app = createSurgeApp(provider, market, fakePasses, createAgentRunner({ baseUrl: url, wallet: async () => bob, llm: false }))
    const fund = async (body: unknown): Promise<Response> => await fetch(`${url}/agents/fund`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    expect((await fund({ tx: [1] })).status).toBe(400)
    const before = await spendableSats(bob)
    const p = await createBrc29Payment(alice, (await bob.getPublicKey({ identityKey: true })).publicKey, 1234)
    expect((await fund(p)).status).toBe(200)
    expect(await spendableSats(bob)).toBe(before + 1234)
    expect((await post(alice, '/job', { prompt: 'hi', bid: 1000 })).status).toBe(200)
    const n = await getJson('/network')
    expect(n).toMatchObject({ txs: 2, providerSats: 1000, payers: 1, fundings: 1, fundedSats: 1234 })
    expect(n.avgFeeSats).toBeGreaterThan(0)
  })
})

describe('priority pass', () => {
  it('buying a pass charges PASS_SATS', async () => {
    const before = await spendableSats(provider)
    const res = await post(alice, '/pass', {})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ passTxid: 'f'.repeat(64) })
    expect(await spendableSats(provider)).toBe(before + 500)
  })

  it('a valid pass jumps the queue; a bad one is refused', async () => {
    await post(bob, '/job', { prompt: 'rich', bid: 900 })
    const ok = await post(alice, '/job/pass', { prompt: 'vip', passTxid: GOOD_PASS })
    expect(ok.status).toBe(200)
    expect((await ok.json()).position).toBe(1)
    const bad = await post(alice, '/job/pass', { prompt: 'vip', passTxid: 'b'.repeat(64) })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid pass' })
  })
})
