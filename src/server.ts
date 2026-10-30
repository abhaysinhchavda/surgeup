/**
 * SurgeAPI HTTP server: free read routes, then BRC-103/104 auth and BRC-105
 * payment in front of POST /job (price = the caller's bid) and POST /pass.
 * Requests that would be refused are rejected after auth but BEFORE the payment
 * middleware, so nobody is charged for a request that cannot be served.
 */
import express, { type Express, type Request, type Response } from 'express'
import type { WalletInterface } from '@bsv/sdk'
import { createAuthMiddleware, type AuthRequest } from '@bsv/auth-express-middleware'
import { createPaymentMiddleware, type PaymentRequest } from '@bsv/payment-express-middleware'
import type { Market } from './market'
import type { PassService } from './pass'

export const MAX_PROMPT = 2000
export const PASS_SATS = 500

const isPrompt = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && p.length <= MAX_PROMPT
const isBid = (b: unknown): b is number => typeof b === 'number' && Number.isInteger(b) && b > 0
const isTxid = (t: unknown): t is string => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t)
/** The auth middleware runs without allowUnauthenticated, so every handler after it has a caller. */
const callerOf = (req: Request): string => (req as AuthRequest).auth!.identityKey
const labelFor = (body: any, identityKey: string): string =>
  typeof body?.label === 'string' && body.label.length > 0 ? body.label.slice(0, 24) : identityKey.slice(0, 8)

export function createSurgeApp (provider: WalletInterface, market: Market, passes?: PassService): Express {
  const app = express()
  app.use(express.json())

  // Free routes: plain fetch works (dashboard, agents reading the price).
  app.get('/price', (_req, res) => {
    res.json({ priceSats: market.price(), queueDepth: market.snapshot().queueDepth, passSats: PASS_SATS })
  })
  app.get('/state', (_req, res) => { res.json(market.snapshot()) })
  app.get('/job/:id', (req, res) => {
    const job = market.get(req.params.id)
    if (job === undefined) return res.status(404).json({ error: 'not found' })
    res.json({
      id: job.id,
      status: job.status,
      position: market.position(job.id),
      result: job.result,
      waitedMs: job.startedAt === undefined ? undefined : job.startedAt - job.enqueuedAt,
      paidSats: job.paidSats,
      txid: job.txid,
      label: job.label,
      viaPass: job.viaPass
    })
  })

  // Auth before the checks: AuthFetch rejects any unsigned response, so even a
  // 400 must pass through the auth middleware to reach the caller.
  app.use(createAuthMiddleware({ wallet: provider }))

  // Pre-payment checks.
  app.post('/job', (req, res, next) => {
    const { prompt, bid } = req.body ?? {}
    if (!isPrompt(prompt)) return res.status(400).json({ error: 'bad prompt' })
    if (!isBid(bid)) return res.status(400).json({ error: 'bad bid' })
    // The challenge must meet the live surge price; the paid retry only the base,
    // because the surge may have risen while the caller was paying.
    const floor = req.headers['x-bsv-payment'] === undefined ? market.price() : market.cfg.baseSats
    if (bid < floor) return res.status(400).json({ error: 'bid below surge price', priceSats: market.price() })
    next()
  })
  app.post(['/pass', '/job/pass'], (_req, res, next) => {
    if (passes === undefined) return res.status(501).json({ error: 'passes disabled' })
    next()
  })
  app.post('/job/pass', (req, res, next) => {
    const { prompt, passTxid } = req.body ?? {}
    if (!isPrompt(prompt)) return res.status(400).json({ error: 'bad prompt' })
    if (!isTxid(passTxid)) return res.status(400).json({ error: 'invalid pass' })
    next()
  })

  app.use(createPaymentMiddleware({
    wallet: provider,
    calculateRequestPrice: req => {
      if (req.method !== 'POST') return 0
      if (req.path === '/job') return req.body.bid
      if (req.path === '/pass') return PASS_SATS
      return 0
    }
  }))

  app.post('/job', (req: PaymentRequest, res: Response) => {
    const caller = callerOf(req)
    const payment = req.payment!
    const job = market.enqueue({ caller, label: labelFor(req.body, caller), prompt: req.body.prompt, paidSats: payment.satoshisPaid, txid: payment.txid })
    res.json({ jobId: job.id, paidSats: job.paidSats, txid: job.txid, position: market.position(job.id) })
  })

  app.post('/pass', async (req: Request, res: Response) => {
    const caller = callerOf(req)
    try {
      const { txid } = await passes!.issue(caller)
      res.json({ passTxid: txid })
    } catch (e) {
      // ponytail: paid but pass not sent — no automatic refund; operator resends by hand
      res.status(500).json({ error: 'pass issue failed', detail: String(e) })
    }
  })

  app.post('/job/pass', async (req: Request, res: Response) => {
    const caller = callerOf(req)
    if (!(await passes!.redeem(req.body.passTxid, caller))) return res.status(400).json({ error: 'invalid pass' })
    const job = market.enqueue({ caller, label: labelFor(req.body, caller), prompt: req.body.prompt, paidSats: 0, txid: req.body.passTxid, viaPass: true })
    res.json({ jobId: job.id, position: market.position(job.id) })
  })

  return app
}

const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

/** One job at a time, highest priority first. */
export function startWorker (market: Market, runJob: (prompt: string) => Promise<string>, idleMs = 100): { stop: () => void } {
  let running = true
  void (async () => {
    while (running) {
      const job = market.next()
      if (job === undefined) { await sleep(idleMs); continue }
      let result: string
      try { result = await runJob(job.prompt) } catch (e) { result = `error: ${String(e)}` }
      market.complete(job.id, result)
    }
  })()
  return { stop: () => { running = false } }
}

/** Stand-in for a real model: fixed service time so the queue visibly builds. */
export function mockRunJob (serviceMs: number): (prompt: string) => Promise<string> {
  return async prompt => { await sleep(serviceMs); return `[mock AI] ${prompt.slice(0, 60)}` }
}
