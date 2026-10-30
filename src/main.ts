/** Starts the SurgeAPI provider: mainnet wallet, market, HTTP server on :3000, worker. */
import { Market } from './market'
import { createSurgeApp, mockRunJob, startWorker } from './server'
import { walletFromEnv } from './wallet'

const PORT = 3000

const provider = await walletFromEnv('PROVIDER_KEY')
const { publicKey } = await provider.getPublicKey({ identityKey: true })
const market = new Market({ baseSats: 100, k: 0.5 })

// Passes stay disabled (501) until T8 provides createPassService and PASS_TOKEN_ID.
createSurgeApp(provider, market).listen(PORT, () => {
  console.log(`SurgeAPI on http://localhost:${PORT}`)
  console.log(`Provider identity key: ${publicKey}`)
})
startWorker(market, mockRunJob(2000))
