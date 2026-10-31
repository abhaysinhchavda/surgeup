/**
 * Dashboard: polls /state and /agents, starts agent runs from the console, and
 * lets a human pay for a job from BSV Desktop. Every server-supplied string
 * (labels, prompts, results, agent log) is rendered with textContent.
 */
import { AuthFetch, WalletClient } from '@bsv/sdk'
import type { Job, MarketSnapshot } from '../src/market'
import type { Domain } from '../src/cases'
import type { AgentRun } from '../src/agentRuns'

const POLL_MS = 1000
const RESULT_TIMEOUT_MS = 5 * 60_000
const BASE_SATS = 100
const SPARK_POINTS = 60

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: Array<string | Node>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...kids)
  return node
}

// Static Lucide paths (trusted constants, so innerHTML is safe here).
const ICONS: Record<string, string> = {
  finance: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  healthcare: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  legal: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  logistics: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  research: '<path d="M10 2v7.31"/><path d="M14 9.3V1.99"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.52 16h12.96"/>',
  ecommerce: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>'
}
const icon = (name: string): SVGSVGElement => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('class', 'i'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true')
  s.innerHTML = ICONS[name] ?? ''
  return s
}

const txLink = (txid: string, text = `${txid.slice(0, 8)}…`): HTMLAnchorElement =>
  h('a', { href: `https://whatsonchain.com/tx/${txid}`, target: '_blank', rel: 'noopener', textContent: text })
const urgencyOf = (deadlineSec: number): 'high' | 'medium' | 'low' => deadlineSec <= 60 ? 'high' : deadlineSec <= 300 ? 'medium' : 'low'
const fmtDeadline = (s: number): string => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`

// ---------- Market ----------

function who (label: string, viaPass?: boolean): HTMLElement {
  const span = h('span', { className: 'who' }, label)
  if (viaPass === true) span.append(h('span', { className: 'pill pass', textContent: 'PASS' }))
  else if (label.endsWith(' agent')) span.append(h('span', { className: 'pill agent', textContent: 'AGENT' }))
  else if (label === 'You') span.append(h('span', { className: 'pill you', textContent: 'YOU' }))
  return span
}
const paid = (j: Job): string => j.viaPass ? '—' : `${j.paidSats} sats`
function tr (cells: Array<string | Node>, numCols: number[] = [], className = ''): HTMLTableRowElement {
  const row = h('tr', { className })
  cells.forEach((c, i) => row.append(h('td', { className: numCols.includes(i) ? 'num' : '' }, c)))
  return row
}
const emptyRow = (text: string, cols: number): HTMLTableRowElement => h('tr', {}, h('td', { className: 'empty', colSpan: cols, textContent: text }))

const history: number[] = []
let lastPrice: number | undefined
let bidEdited = false
el<HTMLInputElement>('bid').addEventListener('input', () => { bidEdited = true })

function renderSpark (): void {
  const svg = el('spark')
  const max = Math.max(BASE_SATS * 2, ...history)
  const pts = history.map((p, i) => `${(i / (SPARK_POINTS - 1)) * 100},${40 - (p / max) * 36}`)
  svg.querySelector('polyline')!.setAttribute('points', pts.join(' '))
  const x1 = ((history.length - 1) / (SPARK_POINTS - 1)) * 100
  svg.querySelector('polygon')!.setAttribute('points', pts.length > 1 ? `0,40 ${pts.join(' ')} ${x1},40` : '')
}

function renderMarket (s: MarketSnapshot): void {
  const price = s.priceSats
  if (price !== lastPrice) {
    const p = el('price')
    p.textContent = String(price)
    p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash')
    lastPrice = price
  }
  const mult = price / BASE_SATS
  el('surge').dataset.level = mult >= 2.5 ? 'hot' : mult >= 1.5 ? 'warm' : 'base'
  el('mult').textContent = mult === 1 ? '×1.0 base' : `×${mult.toFixed(1)} surge`
  history.push(price); if (history.length > SPARK_POINTS) history.shift()
  renderSpark()

  el('depth').textContent = String(s.queueDepth)
  el('served-count').textContent = String(s.served.length)
  el('earned').textContent = String(s.served.reduce((sum, j) => sum + j.paidSats, 0) + (s.running?.paidSats ?? 0))
  if (!bidEdited) el<HTMLInputElement>('bid').value = String(price)

  const queue = s.queue.map((j, i) => tr([String(i + 1), who(j.label, j.viaPass), paid(j)], [2]))
  if (s.running !== undefined) queue.unshift(tr(['▶', who(s.running.label, s.running.viaPass), paid(s.running)], [2], 'running'))
  el('queue').replaceChildren(...(queue.length > 0 ? queue : [emptyRow('Queue empty', 3)]))
  el('queue-count').textContent = s.running === undefined ? '' : `1 running · ${s.queue.length} waiting`

  const served = s.served.map(j => tr([
    who(j.label, j.viaPass),
    paid(j),
    j.startedAt === undefined ? '–' : `${((j.startedAt - j.enqueuedAt) / 1000).toFixed(1)} s`,
    txLink(j.txid)
  ], [1, 2]))
  el('served').replaceChildren(...(served.length > 0 ? served : [emptyRow('No jobs yet', 4)]))
}

function setLive (ok: boolean): void {
  el('live').className = `live ${ok ? 'on' : 'off'}`
  el('live-text').textContent = ok ? 'Live' : 'Server unreachable'
}

async function pollMarket (): Promise<void> {
  try {
    renderMarket(await (await fetch('/state')).json())
    setLive(true)
  } catch {
    setLive(false)
  }
}

// ---------- Agent console ----------

let domains: Domain[] = []
let domainId = ''
let caseId = ''
let agentsEnabled = false

function renderTabs (): void {
  el('tabs').replaceChildren(...domains.map(d => {
    const b = h('button', { type: 'button', className: 'tab', id: `tab-${d.id}` }, icon(d.id), d.name)
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-selected', String(d.id === domainId))
    b.tabIndex = d.id === domainId ? 0 : -1
    b.addEventListener('click', () => { selectDomain(d.id) })
    return b
  }))
}
// Arrow keys move between domain tabs (roving tabindex).
el('tabs').addEventListener('keydown', e => {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (step === 0) return
  e.preventDefault()
  const i = domains.findIndex(d => d.id === domainId)
  selectDomain(domains[(i + step + domains.length) % domains.length].id)
  el(`tab-${domainId}`).focus()
})

function selectDomain (id: string): void {
  domainId = id
  const d = domains.find(x => x.id === id)!
  if (!d.cases.some(c => c.id === caseId)) caseId = d.cases[0].id
  renderTabs()
  el('cases').replaceChildren(...d.cases.map(c => {
    const input = h('input', { type: 'radio', name: 'case', value: c.id, checked: c.id === caseId })
    input.addEventListener('change', () => { caseId = c.id })
    const tasks = h('ul', { className: 'tasks' }, ...c.tasks.map(t => {
      const u = urgencyOf(t.deadlineSec)
      return h('li', {},
        h('span', { title: t.prompt, textContent: t.prompt }),
        h('span', { className: `chip ${u}`, textContent: `${u} · ${fmtDeadline(t.deadlineSec)}` }),
        h('span', { className: 'worth num', textContent: `≤${t.valueSats}` }))
    }))
    return h('label', { className: 'case' }, input, h('b', { textContent: c.title }), h('p', { textContent: c.brief }), tasks)
  }))
}

const budgetInput = el<HTMLInputElement>('budget')
budgetInput.addEventListener('input', () => { el('budget-out').textContent = `${budgetInput.value} sats` })

function runMsg (text: string, isError = false): void {
  const m = el('run-msg')
  m.textContent = text
  m.className = isError ? 'hint err' : 'hint'
}

let shownRunId = ''
let shownLines = 0
let runActive = false

function renderRun (run: AgentRun | undefined): void {
  if (run === undefined) return
  const log = el('log')
  if (run.id !== shownRunId) { log.replaceChildren(); shownRunId = run.id; shownLines = 0 }
  el('empty-log').hidden = true
  el('run-title').textContent = run.title
  const badge = el('run-badge')
  badge.hidden = false
  badge.className = `badge ${run.status}`
  badge.textContent = run.status === 'running' ? `${run.mode === 'llm' ? 'Claude' : 'Rule-based'} · running` : run.status
  el('meter').style.width = `${Math.min(100, (run.spentSats / run.budgetSats) * 100)}%`
  el('spent').textContent = `${run.spentSats} sats spent`
  el('budget-label').textContent = `budget ${run.budgetSats}`

  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40
  for (const line of run.log.slice(shownLines)) {
    const body = h('span', {}, line.text)
    if (line.txid !== undefined) body.append(txLink(line.txid, 'view tx ↗'))
    log.append(h('li', { className: line.kind }, h('span', { className: 'k', textContent: line.kind.toUpperCase() }), body))
  }
  shownLines = run.log.length
  if (nearBottom) log.scrollTop = log.scrollHeight

  const wasActive = runActive
  runActive = run.status === 'running'
  if (wasActive && !runActive) void loadWallet()
}

let identityKey = ''
async function loadWallet (): Promise<void> {
  if (!agentsEnabled) return
  try {
    const res = await fetch('/agents/wallet')
    const w = await res.json()
    if (!res.ok) { el('wallet-sats').textContent = 'unavailable'; return }
    identityKey = w.identityKey
    el('wallet-sats').textContent = `${w.sats} sats`
    el('copy-key').hidden = false
    if (w.sats < 300) runMsg('The agent wallet is low: fund it with npm run fund -- 2500, or send sats to its identity key.', true)
  } catch {
    el('wallet-sats').textContent = 'unavailable'
  }
}
el('copy-key').addEventListener('click', () => {
  void navigator.clipboard.writeText(identityKey).then(() => { el('copy-key').textContent = 'Copied' })
  setTimeout(() => { el('copy-key').textContent = 'Copy identity key' }, 1500)
})

let startingRun = false
async function pollAgents (first = false): Promise<void> {
  try {
    const a = await (await fetch('/agents')).json()
    if (first) {
      domains = a.domains
      agentsEnabled = a.enabled
      selectDomain(domains[0].id)
      const llm = el('llm-label').querySelector('input')!
      llm.disabled = !a.llm
      if (!a.llm) el('llm-label').title = 'Needs ANTHROPIC_API_KEY on the server'
      el('token-field').hidden = !a.tokenRequired
      if (!a.enabled) runMsg('Agent console is off: the server needs AGENT_LLM_KEY in .env.', true)
      void loadWallet()
    }
    renderRun(a.run)
    el<HTMLButtonElement>('run').disabled = startingRun || runActive || !agentsEnabled
  } catch {
    if (first) setTimeout(() => { void pollAgents(true) }, 3000)
  }
}

el('run').addEventListener('click', () => {
  const mode = (document.querySelector('input[name=mode]:checked') as HTMLInputElement).value
  startingRun = true
  el<HTMLButtonElement>('run').disabled = true
  runMsg('Starting agent…')
  void (async () => {
    try {
      const res = await fetch('/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-run-token': el<HTMLInputElement>('token').value },
        body: JSON.stringify({ domain: domainId, caseId, mode, budgetSats: Number(budgetInput.value) })
      })
      const body = await res.json()
      if (!res.ok) { runMsg(body.error ?? body.description ?? `Request failed (HTTP ${res.status})`, true); return }
      runMsg('Agent running: watch it bid in the log and the queue.')
      renderRun(body)
    } catch (e) {
      runMsg(String(e), true)
    } finally {
      startingRun = false
    }
  })()
})

// ---------- Pay yourself ----------

function say (text: string, isError = false): void {
  const msg = el('msg')
  msg.textContent = text
  msg.className = isError ? 'hint err' : 'hint'
}

async function showResult (jobId: string): Promise<void> {
  const deadline = Date.now() + RESULT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const job = await (await fetch(`/job/${encodeURIComponent(jobId)}`)).json()
    if (job.status === 'done') {
      say(`Served after ${((job.waitedMs ?? 0) / 1000).toFixed(1)} s in the queue.`)
      el('result').textContent = job.result ?? ''
      return
    }
    say(job.status === 'running' ? 'Running…' : `Queued at position ${job.position ?? '?'}…`)
    await sleep(POLL_MS)
  }
  say('Still queued after 5 minutes; it will appear under Served when done.', true)
}

let wallet: WalletClient | undefined
el<HTMLFormElement>('form').addEventListener('submit', e => {
  e.preventDefault()
  const button = el<HTMLButtonElement>('pay')
  const prompt = el<HTMLInputElement>('prompt').value.trim()
  const bid = Number(el<HTMLInputElement>('bid').value)
  button.disabled = true
  el('result').textContent = ''
  say('Approve the payment in BSV Desktop…')
  void (async () => {
    try {
      wallet ??= new WalletClient('auto')
      const res = await new AuthFetch(wallet).fetch(`${location.origin}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, bid, label: 'You' })
      })
      const body = await res.json()
      if (res.status !== 200) { say(body.error ?? body.description ?? `Request failed (HTTP ${res.status})`, true); return }
      say(`Paid ${body.paidSats} sats. Queued at position ${body.position}.`)
      await showResult(body.jobId)
    } catch (err) {
      say(String(err), true)
    } finally {
      button.disabled = false
      bidEdited = false
    }
  })()
})

void pollMarket()
void pollAgents(true)
setInterval(() => { void pollMarket(); void pollAgents() }, POLL_MS)
