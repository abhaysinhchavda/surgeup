/**
 * Deploys the SURGEPASS token (100 passes, no decimals) from the provider wallet.
 * Real mainnet tx: team OK first, and `npm run overlay` must be running.
 *   npm run deploy-pass
 */
import { OverlayClient } from '../src/kit/client/overlayApi'
import { TokenKit } from '../src/kit/client/token'
import { walletFromEnv } from '../src/wallet'

const provider = await walletFromEnv('PROVIDER_KEY')
const kit = new TokenKit(provider, new OverlayClient(process.env.OVERLAY_URL ?? 'http://localhost:8080'))
const { txid, tokenId } = await kit.deploy({ sym: 'SURGEPASS', amt: 100n, dec: 0 })
console.log(`SURGEPASS deployed: https://whatsonchain.com/tx/${txid}`)
console.log(`Add this line to .env, then restart the server:\nPASS_TOKEN_ID=${tokenId}`)
process.exit(0) // wallet monitor keeps the event loop alive
