/**
 * SURGEPASS on the mock chain with the real overlay (same setup as the kit's
 * e2e.mockchain test): issue, send back, redeem once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Wallet } from '@bsv/wallet-toolbox'
import { startOverlay, type RunningOverlay } from '../src/kit/overlay/server'
import { OverlayClient } from '../src/kit/client/overlayApi'
import { TokenKit } from '../src/kit/client/token'
import { createPassService, type PassService } from '../src/pass'
import { createServer } from 'node:http'
import { Market } from '../src/market'
import { createSurgeApp } from '../src/server'
import { runScripted, type LogKind } from '../src/agentRuns'
import type { AgentCase } from '../src/cases'
import { createMockChain, type MockChain } from './helpers/mockchain'

let chain: MockChain
let overlay: RunningOverlay
let provider: Wallet, alice: Wallet
let kitP: TokenKit, kitA: TokenKit
let providerKey: string, aliceKey: string
let tokenId: string
let passes: PassService

beforeAll(async () => {
  chain = await createMockChain()
  overlay = await startOverlay({ port: 18110, dbFile: join(mkdtempSync(join(tmpdir(), 'surgepass-')), 'overlay.db'), chainTracker: chain.chainTracker, quiet: true })
  provider = await chain.makeWallet()
  alice = await chain.makeWallet()
  await chain.fund(provider)
  await chain.fund(alice)
  kitP = new TokenKit(provider, new OverlayClient(overlay.url))
  kitA = new TokenKit(alice, new OverlayClient(overlay.url))
  providerKey = await kitP.identityKey()
  aliceKey = await kitA.identityKey()
  ;({ tokenId } = await kitP.deploy({ sym: 'SURGEPASS', amt: 100n, dec: 0 }))
  passes = await createPassService(provider, new OverlayClient(overlay.url), tokenId)
}, 120_000)

afterAll(async () => {
  await overlay?.close()
  await chain?.close()
})

describe('priority pass (BSV-21)', () => {
  it('quotes the curve price from passes in circulation', async () => {
    expect(await passes.quote()).toEqual({ priceSats: 300, outstanding: 0, supply: 100, soldOut: false })
    await passes.issue(aliceKey)
    expect(await passes.quote()).toMatchObject({ priceSats: 350, outstanding: 1 })
    await kitA.sync()
    const { txid } = await kitA.send(tokenId, 1n, providerKey)
    expect(await passes.redeem(txid, aliceKey)).toBe(true)
    expect(await passes.quote()).toMatchObject({ priceSats: 300, outstanding: 0 })
  })

  it('issued pass can be redeemed once', async () => {
    await passes.issue(aliceKey)
    await kitA.sync()
    const { txid } = await kitA.send(tokenId, 1n, providerKey)
    expect(await passes.redeem(txid, aliceKey)).toBe(true)
    expect(await passes.redeem(txid, aliceKey)).toBe(false)
  })

  it('a non-pass txid is refused', async () => {
    expect(await passes.redeem('b'.repeat(64), aliceKey)).toBe(false)
  })

  it('the issue tx itself is refused when its change is exactly 1 pass', async () => {
    const { tokenId: small } = await kitP.deploy({ sym: 'SURGEPASS', amt: 2n, dec: 0 })
    const svc = await createPassService(provider, new OverlayClient(overlay.url), small)
    const { txid } = await svc.issue(aliceKey) // 1 to alice, change of exactly 1 back to the provider
    const change = await kitP.overlayUtxos(providerKey, small)
    expect(change.some(o => o.txid === txid && BigInt(o.ctx.amt) === 1n)).toBe(true)
    expect(await svc.redeem(txid, aliceKey)).toBe(false)
  })
})

describe('agents swap into SURGEPASS when it beats the surge', () => {
  const PORT = 18111
  const baseUrl = `http://localhost:${PORT}`
  const urgent: AgentCase = { id: 't', title: 't', brief: '', tasks: [{ prompt: 'urgent', deadlineSec: 30, valueSats: 2000 }] }
  let market: Market
  let server: ReturnType<typeof createServer>

  beforeAll(async () => {
    market = new Market({ baseSats: 100, k: 0.5 })
    for (let i = 0; i < 4; i++) market.enqueue({ caller: 'x', label: 'x', prompt: 'x', paidSats: 300, txid: 'c'.repeat(64) })
    const app = createSurgeApp(provider, market, passes)
    server = await new Promise(resolve => { const s = createServer(app).listen(PORT, () => resolve(s)) })
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })

  const run = async (limitSats: number): Promise<{ kinds: LogKind[], spentSats: number }> => {
    const kinds: LogKind[] = []
    const budget = { limitSats, spentSats: 0 }
    await runScripted({ wallet: alice, baseUrl, agentCase: urgent, budget, label: 'Agent T', log: k => { kinds.push(k) }, swap: { kit: kitA, tokenId } })
    return { kinds, spentSats: budget.spentSats }
  }

  it('surge bid 900 > pass 300: swaps and jumps the queue', async () => {
    expect(market.price()).toBe(300)
    const r = await run(1000)
    expect(r.kinds).toContain('swap')
    expect(r.kinds).not.toContain('error')
    expect(r.spentSats).toBe(300)
    expect(market.snapshot().queue.some((j: any) => j.viaPass === true)).toBe(true)
  })

  it('budget below the pass price: no swap, never overspends', async () => {
    const r = await run(200)
    expect(r.kinds).not.toContain('swap')
    expect(r.spentSats).toBeLessThanOrEqual(200)
  })
})

describe('idle queue: urgent bid equals the pass price', () => {
  const PORT = 18112
  let server: ReturnType<typeof createServer>
  beforeAll(async () => {
    const app = createSurgeApp(provider, new Market({ baseSats: 100, k: 0.5 }), passes)
    server = await new Promise(resolve => { const s = createServer(app).listen(PORT, () => resolve(s)) })
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })

  it('surge 100, bid 300 = pass 300: swaps, since the pass also jumps the queue', async () => {
    const kinds: LogKind[] = []
    const budget = { limitSats: 1000, spentSats: 0 }
    const agentCase: AgentCase = { id: 't', title: 't', brief: '', tasks: [{ prompt: 'tie', deadlineSec: 30, valueSats: 2000 }] }
    await runScripted({ wallet: alice, baseUrl: `http://localhost:${PORT}`, agentCase, budget, label: 'Agent T', log: k => { kinds.push(k) }, swap: { kit: kitA, tokenId } })
    expect(kinds).toContain('swap')
    expect(kinds).not.toContain('error')
    expect(budget.spentSats).toBe(300)
  })
})
