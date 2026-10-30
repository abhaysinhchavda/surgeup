/**
 * Spike: BRC-105 can charge a price taken from the JSON body. SurgeAPI's
 * whole pricing model (charged price = caller's bid) depends on the body being
 * visible to calculateRequestPrice on both the challenge and the paid retry.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Server } from 'node:http'
import express from 'express'
import { AuthFetch } from '@bsv/sdk'
import type { Wallet } from '@bsv/wallet-toolbox'
import { createAuthMiddleware } from '@bsv/auth-express-middleware'
import { createPaymentMiddleware, type PaymentRequest } from '@bsv/payment-express-middleware'
import { createMockChain, type MockChain } from './helpers/mockchain'

let chain: MockChain
let merchant: Wallet, alice: Wallet, server: Server
const url = 'http://localhost:18099'
const spendableSats = async (w: Wallet): Promise<number> =>
  (await w.listOutputs({ basket: 'default', limit: 1000 })).outputs.filter(o => o.spendable).reduce((s, o) => s + o.satoshis, 0)
const listen = async (app: any, port: number): Promise<Server> => await new Promise(resolve => { const s = app.listen(port, () => resolve(s)) })

beforeAll(async () => {
  chain = await createMockChain()
  ;[merchant, alice] = await Promise.all([chain.makeWallet(), chain.makeWallet()])
  await chain.fund(alice)
  const app = express()
  app.use(express.json())
  app.use(createAuthMiddleware({ wallet: merchant }))
  app.use(createPaymentMiddleware({
    wallet: merchant,
    calculateRequestPrice: req => req.method === 'POST' && req.path === '/job' ? Number(req.body?.bid ?? 0) : 0
  }))
  app.post('/job', (req: PaymentRequest, res) => { res.json({ receipt: req.payment, body: req.body }) })
  server = await listen(app, 18099)
})
afterAll(async () => {
  await new Promise(resolve => server?.close(resolve))
  await chain?.close()
})

it('body bid sets the charged price', async () => {
  const before = await spendableSats(merchant)
  const res = await new AuthFetch(alice).fetch(`${url}/job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'hi', bid: 333 })
  })
  expect(res.status).toBe(200)
  const json = await res.json()
  expect(json.receipt).toMatchObject({ accepted: true, satoshisPaid: 333 })
  expect(json.receipt.txid).toMatch(/^[0-9a-f]{64}$/)
  expect(json.body.bid).toBe(333)
  expect(await spendableSats(merchant)).toBe(before + 333)
})
