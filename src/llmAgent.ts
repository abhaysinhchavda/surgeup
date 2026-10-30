/**
 * LLM purchasing agent: Claude decides what to buy through three tools backed
 * by the agent's own wallet. The budget is enforced in code (guardBid), not
 * trusted to the prompt. ANTHROPIC_API_KEY is read by the SDK, never logged.
 *   npm run llm-agent -- 2000
 */
import { pathToFileURL } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { submitJob } from './agent'
import { walletFromEnv } from './wallet'

export interface Budget { limitSats: number, spentSats: number }
export interface Task { prompt: string, deadlineSec: number, valueSats: number }

export function guardBid (budget: Budget, bid: number): { ok: true } | { ok: false, reason: string } {
  if (!Number.isInteger(bid) || bid <= 0) return { ok: false, reason: 'bid must be a positive whole number of sats' }
  if (budget.spentSats + bid > budget.limitSats) return { ok: false, reason: `over budget: ${budget.limitSats - budget.spentSats} sats left` }
  return { ok: true }
}

const MAX_TURNS = 20
const LABEL = 'LLM agent'
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_price',
    description: 'Current surge price in sats (the minimum bid) and queue depth.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'submit_job',
    description: 'Pay `bid` sats to queue `prompt`. The bid must be at least the surge price; higher bids are served first. Spends from your budget.',
    input_schema: { type: 'object', properties: { prompt: { type: 'string' }, bid: { type: 'integer' } }, required: ['prompt', 'bid'] }
  },
  {
    name: 'check_job',
    description: 'Status, queue position and result of a submitted job.',
    input_schema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] }
  }
]

export async function runLlmAgent (o: { wallet: WalletInterface, baseUrl: string, tasks: Task[], budgetSats: number, model?: string, client?: Anthropic }): Promise<void> {
  const client = o.client ?? new Anthropic()
  const budget: Budget = { limitSats: o.budgetSats, spentSats: 0 }
  const system = `You are a purchasing agent with a budget of ${o.budgetSats} sats. For each task decide whether it is worth paying for now, given its value and deadline and the current surge price. Never bid more than a task's value. Bid higher only when the deadline is close. Use the tools; explain each decision in one sentence.`

  // Tool calls run one at a time, so the budget check and the spend cannot interleave.
  const runTool = async (name: string, input: any): Promise<{ body: unknown, isError?: boolean }> => {
    if (name === 'get_price') return { body: await (await fetch(`${o.baseUrl}/price`)).json() }
    if (name === 'check_job') return { body: await (await fetch(`${o.baseUrl}/job/${encodeURIComponent(String(input?.jobId))}`)).json() }
    if (name === 'submit_job') {
      const guard = guardBid(budget, input?.bid)
      if (!guard.ok) return { body: { error: guard.reason }, isError: true }
      const r = await submitJob(o.wallet, o.baseUrl, String(input.prompt), input.bid, LABEL)
      if (r.status !== 200) return { body: r.body, isError: true }
      budget.spentSats += r.body.paidSats
      console.log(`[LLM] paid ${r.body.paidSats} sats  https://whatsonchain.com/tx/${r.body.txid}`)
      return { body: r.body }
    }
    return { body: { error: `unknown tool ${name}` }, isError: true }
  }

  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: 'Tasks:\n' + o.tasks.map(t => `- "${t.prompt}": deadline in ${t.deadlineSec}s, worth ${t.valueSats} sats`).join('\n')
  }]
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({ model: o.model ?? 'claude-haiku-5-5', max_tokens: 16000, system, tools: TOOLS, messages })
    for (const b of res.content) if (b.type === 'text' && b.text.trim() !== '') console.log(`[LLM] ${b.text.trim()}`)
    messages.push({ role: 'assistant', content: res.content })
    if (res.stop_reason === 'pause_turn') continue
    if (res.stop_reason !== 'tool_use') {
      if (res.stop_reason === 'refusal') console.log('[LLM] the model declined to continue')
      break
    }
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const b of res.content) {
      if (b.type !== 'tool_use') continue
      // A thrown tool (network, payment) goes back to the model as an error, not a crash.
      const out = await runTool(b.name, b.input).catch(e => ({ body: { error: String(e) }, isError: true }))
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out.body), is_error: out.isError })
    }
    messages.push({ role: 'user', content: results })
  }
  console.log(`[LLM] spent ${budget.spentSats} of ${budget.limitSats} sats`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const budgetSats = Number(process.argv[2] ?? 2000)
  if (!Number.isInteger(budgetSats) || budgetSats <= 0) throw new Error('usage: npm run llm-agent -- <budget sats>')
  const wallet = await walletFromEnv('AGENT_LLM_KEY')
  await runLlmAgent({
    wallet,
    baseUrl: process.env.SURGE_URL ?? 'http://localhost:3000',
    budgetSats,
    tasks: [
      { prompt: 'Summarise incident report', deadlineSec: 30, valueSats: 600 },
      { prompt: 'Translate product page', deadlineSec: 600, valueSats: 200 },
      { prompt: 'Classify 10 tickets', deadlineSec: 120, valueSats: 300 }
    ]
  })
  process.exit(0) // wallet monitor keeps the event loop alive
}
