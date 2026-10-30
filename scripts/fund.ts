/**
 * Funds the agent wallets from BSV Desktop with BRC-29 payments.
 * Real mainnet money: run it yourself and approve each payment in BSV Desktop.
 *   npm run fund -- 10000
 * Each payment is saved to .local/fund-pending/ before the agent accepts it, so
 * if accepting fails the sats are not stranded: re-run and it is accepted
 * first, without paying again.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { WalletClient } from '@bsv/sdk'
import { acceptBrc29Payment, createBrc29Payment, type Brc29Payment } from '../src/payments'
import { spendableSats, walletFromEnv } from '../src/wallet'

const ORIGINATOR = 'surgeapi.local'
const AGENTS = ['AGENT_A_KEY', 'AGENT_B_KEY', 'AGENT_C_KEY', 'AGENT_LLM_KEY']
const PENDING = '.local/fund-pending'

const sats = Number(process.argv[2] ?? 10_000)
if (!Number.isInteger(sats) || sats <= 0) throw new Error('usage: npm run fund -- <sats per agent>')

const desktop = new WalletClient('auto', ORIGINATOR)
await desktop.waitForAuthentication({})
const { network } = await desktop.getNetwork({})
if (network !== 'mainnet') throw new Error(`BSV Desktop is on ${network}; switch it to mainnet`)

mkdirSync(PENDING, { recursive: true })
console.log(`Funding ${AGENTS.length} agents with ${sats} sats each (${AGENTS.length * sats} total). Approve each payment in BSV Desktop.`)
for (const envVar of AGENTS) {
  const agent = await walletFromEnv(envVar)
  const file = `${PENDING}/${envVar}.json`
  const recovered = existsSync(file)
  let payment: Brc29Payment
  if (recovered) {
    payment = JSON.parse(readFileSync(file, 'utf8'))
  } else {
    const { publicKey } = await agent.getPublicKey({ identityKey: true })
    payment = await createBrc29Payment(desktop, publicKey, sats, 'Fund SurgeAPI agent', ORIGINATOR)
    writeFileSync(file, JSON.stringify(payment))
  }
  await acceptBrc29Payment(agent, payment)
  rmSync(file)
  console.log(`${envVar.padEnd(14)} https://whatsonchain.com/tx/${payment.txid}  balance ${await spendableSats(agent)} sats${recovered ? '  (recovered earlier payment)' : ''}`)
}
process.exit(0) // wallet monitors keep the event loop alive
