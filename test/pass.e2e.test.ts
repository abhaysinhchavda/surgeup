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
