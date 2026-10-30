/** Starts the SurgeAPI provider: mainnet wallet, market, HTTP server on :3000, worker. */
import { OverlayClient } from './kit/client/overlayApi'
import { Market } from './market'
import { createPassService } from './pass'
import { createSurgeApp, mockRunJob, startWorker } from './server'
import { walletFromEnv } from './wallet'

const PORT = 3000

const provider = await walletFromEnv('PROVIDER_KEY')
const { publicKey } = await provider.getPublicKey({ identityKey: true })
const market = new Market({ baseSats: 100, k: 0.5 })

// Passes stay disabled (501) until npm run deploy-pass puts PASS_TOKEN_ID in .env.
const tokenId = process.env.PASS_TOKEN_ID
const passes = tokenId === undefined || tokenId === ''
  ? undefined
  : await createPassService(provider, new OverlayClient(process.env.OVERLAY_URL ?? 'http://localhost:8080'), tokenId)

createSurgeApp(provider, market, passes).listen(PORT, () => {
  console.log(`SurgeAPI on http://localhost:${PORT}`)
  console.log(`Provider identity key: ${publicKey}`)
  console.log(passes === undefined ? 'Passes disabled (no PASS_TOKEN_ID)' : `Passes enabled: ${tokenId}`)
})
startWorker(market, mockRunJob(2000))
