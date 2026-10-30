/**
 * Burst demo: A (low) and B (medium) fill the queue and push the surge up,
 * then C (high) arrives late and jumps ahead of the older A/B jobs.
 * Real mainnet money (~11 calls): start the server first, then npm run demo
 */
import { runAgent } from '../src/agent'
import { walletFromEnv } from '../src/wallet'

const baseUrl = process.env.SURGE_URL ?? 'http://localhost:3000'
const [a, b, c] = await Promise.all(['AGENT_A_KEY', 'AGENT_B_KEY', 'AGENT_C_KEY'].map(walletFromEnv))
const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

await Promise.all([
  runAgent({ name: 'A', urgency: 'low', wallet: a, baseUrl, jobs: 6, gapMs: 200 }),
  runAgent({ name: 'B', urgency: 'medium', wallet: b, baseUrl, jobs: 4, gapMs: 300 }),
  sleep(3000).then(async () => await runAgent({ name: 'C', urgency: 'high', wallet: c, baseUrl, jobs: 1, gapMs: 0 }))
])
process.exit(0) // wallet monitors keep the event loop alive
