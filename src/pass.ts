/**
 * Priority pass (BSV-21 SURGEPASS). The overlay is the source of truth for who
 * holds which pass; the server only depends on the PassService interface.
 */
import type { WalletInterface } from '@bsv/sdk'
import type { OverlayClient } from './kit/client/overlayApi'
import { TokenKit } from './kit/client/token'

export interface PassService {
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
  return {
    issue: async to => {
      const { txid } = await kit.send(tokenId, 1n, to)
      issued.add(txid)
      return { txid }
    },
    redeem: async passTxid => {
      if (issued.has(passTxid) || redeemed.has(passTxid)) return false
      redeemed.add(passTxid) // claim first so two concurrent redeems of one pass cannot both pass
      try {
        await kit.sync()
        const ok = (await kit.overlayUtxos(providerKey, tokenId)).some(o => o.txid === passTxid && BigInt(o.ctx.amt) === 1n)
        if (!ok) redeemed.delete(passTxid)
        return ok
      } catch (e) {
        redeemed.delete(passTxid)
        throw e
      }
    }
  }
}
