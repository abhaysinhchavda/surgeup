/**
 * Agent runs started from the dashboard: one at a time, spending from one agent
 * wallet within a hard per-run budget. The run log lives in memory; the
 * dashboard polls it through GET /agents.
 */
import { AuthFetch, type WalletInterface } from '@bsv/sdk'
import { bidFor, submitJob, type Urgency } from './agent'
import { OverlayClient } from './kit/client/overlayApi'
import { TokenKit } from './kit/client/token'
import { DOMAINS, findCase, type AgentCase, type Domain } from './cases'
import { guardBid, runLlmAgent, type Budget } from './llmAgent'

export type Mode = 'scripted' | 'llm'
export type LogKind = 'info' | 'think' | 'pay' | 'swap' | 'skip' | 'error'
export interface LogLine { at: number, kind: LogKind, text: string, txid?: string }
export interface AgentRun {
  id: string
  domain: string
  caseId: string
  title: string
  mode: Mode
  status: 'running' | 'done' | 'error'
  budgetSats: number
  spentSats: number
  startedAt: number
  log: LogLine[]
}
export type Log = (kind: LogKind, text: string, txid?: string) => void

export const MAX_BUDGET = 2000
const MODES: Mode[] = ['scripted', 'llm']

export interface AgentSpec { domain: unknown, caseId: unknown, mode: unknown, budgetSats: unknown }
export interface AgentRunner {
  llm: boolean
  tokenRequired: boolean
  /** The latest batch: one run per selected agent. */
  current: () => AgentRun[]
  checkToken: (token: unknown) => boolean
  wallet: () => Promise<WalletInterface>
  /** Starts every agent in the batch at once, or returns why the batch cannot start. */
  start: (agents: unknown) => AgentRun[] | { error: string, status: number }
}

const urgencyFor = (deadlineSec: number): Urgency => deadlineSec <= 60 ? 'high' : deadlineSec <= 300 ? 'medium' : 'low'

export interface Swap { kit: TokenKit, tokenId: string }

const postAuth = async (wallet: WalletInterface, url: string, body: object): Promise<{ status: number, body: any }> => {
  const res = await new AuthFetch(wallet).fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

/** The swap route: buy a SURGEPASS with sats, send it back, redeem it for a queue-jumping job. */
async function swapAndRedeem (o: { wallet: WalletInterface, baseUrl: string, budget: Budget, label: string, log: Log, swap: Swap }, prompt: string, maxSats: number): Promise<void> {
  // maxSats caps the 402: the server refuses before payment if the curve moved past what this task may spend.
  const bought = await postAuth(o.wallet, `${o.baseUrl}/pass`, { maxSats: Math.min(maxSats, o.budget.limitSats - o.budget.spentSats) })
  o.budget.spentSats += bought.body?.paidSats ?? 0 // counted once, here: paid sats are gone whatever happens next
  if (bought.status !== 200) { o.log('error', `"${prompt}": pass purchase refused (${bought.status}) ${bought.body?.error ?? ''}`); return }
  o.log('pay', `bought SURGEPASS for ${bought.body.paidSats} sats`, bought.body.passTxid)
  let passTxid: string | undefined
  try {
    await o.swap.kit.sync()
    const { identityKey } = await (await fetch(`${o.baseUrl}/provider`)).json()
    passTxid = (await o.swap.kit.send(o.swap.tokenId, 1n, identityKey)).txid
    const r = await postAuth(o.wallet, `${o.baseUrl}/job/pass`, { prompt, passTxid, label: o.label })
    if (r.status !== 200) { o.log('error', `"${prompt}": pass ${passTxid} refused (${r.status}) ${r.body?.error ?? ''}`, passTxid); return }
    o.log('pay', `redeemed the pass, queue position ${r.body.position}`, passTxid)
  } catch (e) {
    o.log('error', `"${prompt}": pass ${passTxid ?? bought.body.passTxid} not redeemed: ${String(e)}`, passTxid ?? bought.body.passTxid)
  }
}

/** Rule-based agent: urgency from the deadline, bid capped at what the task is worth; swaps into a pass when it is cheaper. */
export async function runScripted (o: { wallet: WalletInterface, baseUrl: string, agentCase: AgentCase, budget: Budget, label: string, log: Log, swap?: Swap }): Promise<void> {
  for (const t of o.agentCase.tasks) {
    try {
      const urgency = urgencyFor(t.deadlineSec)
      const bidAt = (surge: number): number => Math.min(bidFor(urgency, surge), t.valueSats)
      const { priceSats, passSats } = await (await fetch(`${o.baseUrl}/price`)).json()
      let bid = bidAt(priceSats)
      if (bid < priceSats) { o.log('skip', `"${t.prompt}": surge ${priceSats} sats is above its worth (${t.valueSats}); skipped`); continue }
      if (o.swap !== undefined && typeof passSats === 'number' && passSats < bid && guardBid(o.budget, passSats).ok) {
        o.log('swap', `"${t.prompt}": surge bid ${bid} > pass ${passSats} → swapping sats into SURGEPASS`)
        await swapAndRedeem({ ...o, swap: o.swap }, t.prompt, bid)
        continue
      }
      const guard = guardBid(o.budget, bid)
      if (!guard.ok) { o.log('skip', `"${t.prompt}": ${guard.reason}; skipped`); continue }
      o.log('think', `"${t.prompt}": deadline ${t.deadlineSec}s → ${urgency} urgency; surge ${priceSats} → bid ${bid} sats`)
      let r = await submitJob(o.wallet, o.baseUrl, t.prompt, bid, o.label)
      // The surge rose between reading the price and bidding: one retry at the new price.
      if (r.status === 400 && r.body?.error === 'bid below surge price') {
        bid = bidAt(r.body.priceSats)
        if (bid < r.body.priceSats || !guardBid(o.budget, bid).ok) { o.log('skip', `"${t.prompt}": surge jumped to ${r.body.priceSats}; skipped`); continue }
        r = await submitJob(o.wallet, o.baseUrl, t.prompt, bid, o.label)
      }
      if (r.status !== 200) { o.log('error', `"${t.prompt}": refused (${r.status}) ${r.body?.error ?? r.body?.description ?? ''}`); continue }
      o.budget.spentSats += r.body.paidSats
      o.log('pay', `paid ${r.body.paidSats} sats, queue position ${r.body.position}`, r.body.txid)
    } catch (e) {
      o.log('error', `"${t.prompt}": ${String(e)}`)
    }
  }
}

/** Agents share one wallet: its createAction calls run one at a time so they never pick the same coins. */
function serialized (w: WalletInterface): WalletInterface {
  let tail: Promise<unknown> = Promise.resolve()
  return new Proxy(w, {
    get (target, prop) {
      const v = (target as any)[prop]
      if (typeof v !== 'function') return v
      if (prop !== 'createAction') return v.bind(target)
      return async (...args: unknown[]) => {
        const r = tail.then(async () => await v.apply(target, args))
        tail = r.catch(() => {})
        return await r
      }
    }
  })
}

export function createAgentRunner (o: { baseUrl: string, wallet: () => Promise<WalletInterface>, llm: boolean, token?: string, passes?: { tokenId: string, overlayUrl: string } }): AgentRunner {
  let runs: AgentRun[] = []
  let seq = 0
  let shared: Promise<WalletInterface> | undefined
  const wallet = async (): Promise<WalletInterface> => await (shared ??= o.wallet().then(serialized))

  const validate = (a: AgentSpec): { error: string } | { domain: Domain, agentCase: AgentCase, mode: Mode, budgetSats: number } => {
    const found = findCase(String(a?.domain), String(a?.caseId))
    if (found === undefined) return { error: `unknown case ${String(a?.domain)}/${String(a?.caseId)}` }
    if (!MODES.includes(a.mode as Mode)) return { error: 'bad mode' }
    if (a.mode === 'llm' && !o.llm) return { error: 'Claude mode needs ANTHROPIC_API_KEY on the server' }
    const b = a.budgetSats
    if (typeof b !== 'number' || !Number.isInteger(b) || b <= 0 || b > MAX_BUDGET) return { error: `${found.domain.name}: budget must be 1–${MAX_BUDGET} sats` }
    return { ...found, mode: a.mode as Mode, budgetSats: b }
  }

  const launch = (d: Domain, agentCase: AgentCase, mode: Mode, budgetSats: number): AgentRun => {
    const r: AgentRun = {
      id: String(++seq),
      domain: d.id,
      caseId: agentCase.id,
      title: `${d.name} · ${agentCase.title}`,
      mode,
      status: 'running',
      budgetSats,
      spentSats: 0,
      startedAt: Date.now(),
      log: []
    }
    const budget: Budget = { limitSats: budgetSats, spentSats: 0 }
    const log: Log = (kind, text, txid) => {
      r.log.push({ at: Date.now(), kind, text, txid })
      if (kind === 'pay') r.spentSats = budget.spentSats
    }
    const label = `${d.name} agent`
    void (async () => {
      try {
        log('info', `${mode === 'llm' ? 'Claude' : 'Rule-based agent'} started with a ${budgetSats}-sat budget`)
        const w = await wallet()
        if (mode === 'llm') await runLlmAgent({ wallet: w, baseUrl: o.baseUrl, tasks: agentCase.tasks, budgetSats, label, log, budget })
        else {
          const swap = o.passes === undefined ? undefined : { kit: new TokenKit(w, new OverlayClient(o.passes.overlayUrl)), tokenId: o.passes.tokenId }
          await runScripted({ wallet: w, baseUrl: o.baseUrl, agentCase, budget, label, log, swap })
          log('info', `spent ${budget.spentSats} of ${budgetSats} sats`)
        }
        r.spentSats = budget.spentSats
        r.status = 'done'
      } catch (e) {
        log('error', String(e))
        r.status = 'error'
      }
    })()
    return r
  }

  return {
    llm: o.llm,
    tokenRequired: o.token !== undefined && o.token !== '',
    current: () => runs,
    checkToken: token => o.token === undefined || o.token === '' || token === o.token,
    wallet,
    start: agents => {
      if (runs.some(r => r.status === 'running')) return { error: 'agents are already running', status: 409 }
      if (!Array.isArray(agents) || agents.length === 0 || agents.length > DOMAINS.length) return { error: `select 1–${DOMAINS.length} agents`, status: 400 }
      const specs = agents.map(validate)
      const bad = specs.find(s => 'error' in s)
      if (bad !== undefined) return { error: (bad as { error: string }).error, status: 400 }
      const ok = specs as Array<Exclude<ReturnType<typeof validate>, { error: string }>>
      if (new Set(ok.map(s => s.domain.id)).size !== ok.length) return { error: 'one agent per domain', status: 400 }
      runs = ok.map(s => launch(s.domain, s.agentCase, s.mode, s.budgetSats))
      return runs
    }
  }
}
