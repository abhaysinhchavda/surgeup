/** Starts the SurgeAPI provider: mainnet wallet, market, HTTP server on :3000, worker. */
import { createServer } from 'node:http'
import type { Wallet } from '@bsv/wallet-toolbox'
import { createAgentRunner } from './agentRuns'
import { OverlayClient } from './kit/client/overlayApi'
import { Market } from './market'
import { createPassService } from './pass'
import { MAX_HEADER_BYTES, createSurgeApp, mockRunJob, startWorker } from './server'
import { walletFromEnv } from './wallet'

const PORT = Number(process.env.PORT ?? 3000) // hosts inject PORT

const provider = await walletFromEnv('PROVIDER_KEY')
const { publicKey } = await provider.getPublicKey({ identityKey: true })
const market = new Market({ baseSats: 100, k: 0.5 })

// Passes stay disabled (501) until npm run deploy-pass puts PASS_TOKEN_ID in .env.
const tokenId = process.env.PASS_TOKEN_ID
const passes = tokenId === undefined || tokenId === ''
  ? undefined
  : await createPassService(provider, new OverlayClient(process.env.OVERLAY_URL ?? 'http://localhost:8080'), tokenId)

// Dashboard agent runs spend from AGENT_LLM_KEY's wallet, opened on first use.
let agentWallet: Promise<Wallet> | undefined
const agents = process.env.AGENT_LLM_KEY === undefined || process.env.AGENT_LLM_KEY === ''
  ? undefined
  : createAgentRunner({
    baseUrl: `http://localhost:${PORT}`,
    wallet: async () => await (agentWallet ??= walletFromEnv('AGENT_LLM_KEY')),
    llm: (process.env.ANTHROPIC_API_KEY ?? '') !== '',
    token: process.env.AGENT_RUN_TOKEN
  })

createServer({ maxHeaderSize: MAX_HEADER_BYTES }, createSurgeApp(provider, market, passes, agents)).listen(PORT, () => {
  console.log(`SurgeAPI on http://localhost:${PORT}`)
  console.log(`Provider identity key: ${publicKey}`)
  console.log(passes === undefined ? 'Passes disabled (no PASS_TOKEN_ID)' : `Passes enabled: ${tokenId}`)
  console.log(agents === undefined ? 'Agent console disabled (no AGENT_LLM_KEY)' : `Agent console enabled (Claude mode ${agents.llm ? 'on' : 'off: no ANTHROPIC_API_KEY'})`)
})
startWorker(market, mockRunJob(2000))
