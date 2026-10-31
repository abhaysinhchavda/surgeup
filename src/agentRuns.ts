/**
 * Agent runs started from the dashboard: one at a time, spending from one agent
 * wallet within a hard per-run budget. The run log lives in memory; the
 * dashboard polls it through GET /agents.
 */
import type { WalletInterface } from '@bsv/sdk'
import { bidFor, submitJob, type Urgency } from './agent'
import { findCase, type AgentCase } from './cases'
import { guardBid, runLlmAgent, type Budget } from './llmAgent'

export type Mode = 'scripted' | 'llm'
export type LogKind = 'info' | 'think' | 'pay' | 'skip' | 'error'
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

export interface AgentRunner {
  llm: boolean
  tokenRequired: boolean
  current: () => AgentRun | undefined
  checkToken: (token: unknown) => boolean
  wallet: () => Promise<WalletInterface>
  /** Starts a run, or returns why it cannot start. */
  start: (o: { domain: unknown, caseId: unknown, mode: unknown, budgetSats: unknown }) => AgentRun | { error: string, status: number }
}

const urgencyFor = (deadlineSec: number): Urgency => deadlineSec <= 60 ? 'high' : deadlineSec <= 300 ? 'medium' : 'low'

/** Rule-based agent: urgency from the deadline, bid capped at what the task is worth. */
export async function runScripted (o: { wallet: WalletInterface, baseUrl: string, agentCase: AgentCase, budget: Budget, label: string, log: Log }): Promise<void> {
  for (const t of o.agentCase.tasks) {
    try {
      const urgency = urgencyFor(t.deadlineSec)
      const bidAt = (surge: number): number => Math.min(bidFor(urgency, surge), t.valueSats)
      const { priceSats } = await (await fetch(`${o.baseUrl}/price`)).json()
      let bid = bidAt(priceSats)
      if (bid < priceSats) { o.log('skip', `"${t.prompt}": surge ${priceSats} sats is above its worth (${t.valueSats}); skipped`); continue }
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
      if (r.status !== 200) { o.log('error', `"${t.prompt}": refused (${r.status}) ${r.body?.error ?? ''}`); continue }
      o.budget.spentSats += r.body.paidSats
      o.log('pay', `paid ${r.body.paidSats} sats, queue position ${r.body.position}`, r.body.txid)
    } catch (e) {
      o.log('error', `"${t.prompt}": ${String(e)}`)
    }
  }
}

export function createAgentRunner (o: { baseUrl: string, wallet: () => Promise<WalletInterface>, llm: boolean, token?: string }): AgentRunner {
  let run: AgentRun | undefined
  let seq = 0

  return {
    llm: o.llm,
    tokenRequired: o.token !== undefined && o.token !== '',
    current: () => run,
    checkToken: token => o.token === undefined || o.token === '' || token === o.token,
    wallet: o.wallet,
    start: ({ domain, caseId, mode, budgetSats }) => {
      if (run?.status === 'running') return { error: 'an agent run is already in progress', status: 409 }
      const found = findCase(String(domain), String(caseId))
      if (found === undefined) return { error: 'unknown case', status: 400 }
      if (!MODES.includes(mode as Mode)) return { error: 'bad mode', status: 400 }
      if (mode === 'llm' && !o.llm) return { error: 'Claude mode needs ANTHROPIC_API_KEY on the server', status: 503 }
      if (typeof budgetSats !== 'number' || !Number.isInteger(budgetSats) || budgetSats <= 0 || budgetSats > MAX_BUDGET) {
        return { error: `budget must be 1–${MAX_BUDGET} sats`, status: 400 }
      }

      const { domain: d, agentCase } = found
      const r: AgentRun = {
        id: String(++seq),
        domain: d.id,
        caseId: agentCase.id,
        title: `${d.name} · ${agentCase.title}`,
        mode: mode as Mode,
        status: 'running',
        budgetSats,
        spentSats: 0,
        startedAt: Date.now(),
        log: []
      }
      run = r
      const budget: Budget = { limitSats: budgetSats, spentSats: 0 }
      const log: Log = (kind, text, txid) => {
        r.log.push({ at: Date.now(), kind, text, txid })
        if (kind === 'pay') r.spentSats = budget.spentSats
      }
      const label = `${d.name} agent`

      void (async () => {
        try {
          log('info', `${mode === 'llm' ? 'Claude' : 'Rule-based agent'} started with a ${budgetSats}-sat budget`)
          const wallet = await o.wallet()
          if (mode === 'llm') await runLlmAgent({ wallet, baseUrl: o.baseUrl, tasks: agentCase.tasks, budgetSats, label, log, budget })
          else {
            await runScripted({ wallet, baseUrl: o.baseUrl, agentCase, budget, label, log })
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
  }
}
