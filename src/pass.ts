/**
 * Priority pass (BSV-21 SURGEPASS). The server only depends on this interface;
 * the token-backed implementation (createPassService) is task T8.
 */
export interface PassService {
  /** Send 1 pass to the buyer. */
  issue: (toIdentityKey: string) => Promise<{ txid: string }>
  /** True once per valid pass the caller sent back to the provider in `passTxid`. */
  redeem: (passTxid: string, fromIdentityKey: string) => Promise<boolean>
}
