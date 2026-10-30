/**
 * Funds the agent wallets from BSV Desktop with BRC-29 payments.
 * Real mainnet money: run it yourself and approve each payment in BSV Desktop.
 *   npm run fund -- 10000
 */
import { WalletClient } from '@bsv/sdk'
import { acceptBrc29Payment, createBrc29Payment } from '../src/payments'
import { spendableSats, walletFromEnv } from '../src/wallet'

const ORIGINATOR = 'surgeapi.local'
const AGENTS = ['AGENT_A_KEY', 'AGENT_B_KEY', 'AGENT_C_KEY', 'AGENT_LLM_KEY']

const sats = Number(process.argv[2] ?? 10_000)
if (!Number.isInteger(sats) || sats <= 0) throw new Error('usage: npm run fund -- <sats per agent>')

const desktop = new WalletClient('auto', ORIGINATOR)
await desktop.waitForAuthentication({})
const { network } = await desktop.getNetwork({})
if (network !== 'mainnet') throw new Error(`BSV Desktop is on ${network}; switch it to mainnet`)

console.log(`Funding ${AGENTS.length} agents with ${sats} sats each (${AGENTS.length * sats} total). Approve each payment in BSV Desktop.`)
for (const envVar of AGENTS) {
  const agent = await walletFromEnv(envVar)
  const { publicKey } = await agent.getPublicKey({ identityKey: true })
  const payment = await createBrc29Payment(desktop, publicKey, sats, 'Fund SurgeAPI agent', ORIGINATOR)
  await acceptBrc29Payment(agent, payment)
  console.log(`${envVar.padEnd(14)} https://whatsonchain.com/tx/${payment.txid}  balance ${await spendableSats(agent)} sats`)
}
process.exit(0) // wallet monitors keep the event loop alive
