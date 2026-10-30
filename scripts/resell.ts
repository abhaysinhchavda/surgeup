/**
 * Resells one SURGEPASS between two agents: the buyer pays the seller
 * `priceSats` (BRC-29), then the seller sends the pass. Pay-then-transfer, not
 * atomic: if the transfer fails the buyer has paid (README "known limits").
 *   npm run resell -- A B 400
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { OverlayClient } from '../src/kit/client/overlayApi'
import { TokenKit } from '../src/kit/client/token'
import { acceptBrc29Payment, createBrc29Payment } from '../src/payments'
import { walletFromEnv } from '../src/wallet'

const PENDING = '.local/resell-pending'
const [from, to, price] = process.argv.slice(2)
const priceSats = Number(price)
const tokenId = process.env.PASS_TOKEN_ID
if (from === undefined || to === undefined || !Number.isInteger(priceSats) || priceSats <= 0) throw new Error('usage: npm run resell -- <seller A|B|C|LLM> <buyer A|B|C|LLM> <priceSats>')
if (tokenId === undefined || tokenId === '') throw new Error('PASS_TOKEN_ID missing in .env: run npm run deploy-pass first')

const overlay = new OverlayClient(process.env.OVERLAY_URL ?? 'http://localhost:8080')
const seller = await walletFromEnv(`AGENT_${from.toUpperCase()}_KEY`)
const buyer = await walletFromEnv(`AGENT_${to.toUpperCase()}_KEY`)
const sellerKit = new TokenKit(seller, overlay)
const buyerKit = new TokenKit(buyer, overlay)

// Check the seller really holds a pass before the buyer pays anything.
await sellerKit.sync()
if (!(await sellerKit.utxos(tokenId)).some(u => u.inOverlay && u.amount >= 1n)) throw new Error(`Agent ${from} holds no SURGEPASS`)

const payment = await createBrc29Payment(buyer, await sellerKit.identityKey(), priceSats, 'Buy SURGEPASS')
// Saved before accepting so a failed accept leaves the derivation data to recover the sats.
mkdirSync(PENDING, { recursive: true })
writeFileSync(`${PENDING}/${payment.txid}.json`, JSON.stringify(payment))
await acceptBrc29Payment(seller, payment)
rmSync(`${PENDING}/${payment.txid}.json`)
console.log(`Agent ${to} paid Agent ${from} ${priceSats} sats: https://whatsonchain.com/tx/${payment.txid}`)

const { txid } = await sellerKit.send(tokenId, 1n, await buyerKit.identityKey())
await buyerKit.sync()
console.log(`Agent ${from} sent the pass to Agent ${to}: https://whatsonchain.com/tx/${txid}`)
process.exit(0) // wallet monitors keep the event loop alive
