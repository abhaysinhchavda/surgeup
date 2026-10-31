/**
 * Priority pass (BSV-21 SURGEPASS). The overlay is the source of truth for who
 * holds which pass; the server only depends on the PassService interface.
 */
import type { WalletInterface } from '@bsv/sdk'
import type { OverlayClient } from './kit/client/overlayApi'
import { TokenKit } from './kit/client/token'

// The swap: sats → SURGEPASS on a linear bonding curve over passes in circulation.
export const PASS_SUPPLY = 100
export const PASS_BASE_SATS = 300
export const PASS_STEP_SATS = 50
export const passPrice = (outstanding: number): number => PASS_BASE_SATS + PASS_STEP_SATS * outstanding

export interface PassQuote { priceSats: number, outstanding: number, supply: number, soldOut: boolean }

export interface PassService {
  /** Live curve price. Passes in circulation = supply − the provider's balance on the overlay. */
  quote: () => Promise<PassQuote>
  /** Send 1 pass to the buyer. */
  issue: (toIdentityKey: string) => Promise<{ txid: string }>
  /** True once per valid pass the caller sent back to the provider in `passTxid`. */
  redeem: (passTxid: string, fromIdentityKey: string) => Promise<boolean>
}

export async function createPassService (provider: WalletInterface, overlay: OverlayClient, tokenId: string): Promise<PassService> {
  const kit = new TokenKit(provider, overlay)
  const providerKey = await kit.identityKey()
  // ponytail: issued/redeemed sets lost on restart, persist if passes outlive a demo
  const issued = new Set<string>() // our own issue txs: their change can be exactly 1 pass, never redeemable
  const redeemed = new Set<string>()
  let cached: { q: Promise<PassQuote>, at: number } | undefined
  return {
    quote: async () => {
      if (cached === undefined || Date.now() - cached.at > 2000) {
        const q = (async () => {
          await kit.sync()
          const balance = (await kit.overlayUtxos(providerKey, tokenId)).reduce((s, o) => s + BigInt(o.ctx.amt), 0n)
          const outstanding = Math.max(0, PASS_SUPPLY - Number(balance))
          return { priceSats: passPrice(outstanding), outstanding, supply: PASS_SUPPLY, soldOut: balance === 0n }
        })()
        cached = { q, at: Date.now() }
        q.catch(() => { cached = undefined })
      }
      return await cached.q
    },
    issue: async to => {
      const { txid } = await kit.send(tokenId, 1n, to)
      issued.add(txid)
      cached = undefined
      return { txid }
    },
    redeem: async passTxid => {
      if (issued.has(passTxid) || redeemed.has(passTxid)) return false
      redeemed.add(passTxid) // claim first so two concurrent redeems of one pass cannot both pass
      try {
        await kit.sync()
        const ok = (await kit.overlayUtxos(providerKey, tokenId)).some(o => o.txid === passTxid && BigInt(o.ctx.amt) === 1n)
        if (!ok) redeemed.delete(passTxid)
        cached = undefined
        return ok
      } catch (e) {
        redeemed.delete(passTxid)
        throw e
      }
    }
  }
}
