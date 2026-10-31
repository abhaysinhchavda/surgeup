/**
 * Dashboard: polls /state and /agents, starts agent runs from the console, and
 * lets a human pay for a job from BSV Desktop. Every server-supplied string
 * (labels, prompts, results, agent log) is rendered with textContent.
 */
import { AuthFetch, WalletClient } from '@bsv/sdk'
import type { Job, MarketSnapshot } from '../src/market'
import type { AgentCase, Domain } from '../src/cases'
import type { AgentRun } from '../src/agentRuns'
import type { NetworkStats } from '../src/server'
import { createBrc29Payment, type Brc29Payment } from '../src/payments'

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
    previews.forEach(f => { f() })
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

  const servedRow = (j: Job): HTMLTableRowElement => tr([who(j.label, j.viaPass), paid(j), waitOf(j), txLink(j.txid)], [1, 2])
  const rows = (jobs: Job[]): HTMLTableRowElement[] => jobs.length > 0 ? jobs.map(servedRow) : [emptyRow('No jobs yet', 4)]
  el('recent').replaceChildren(...rows(s.served.slice(0, 5)))
  el('trace').replaceChildren(...rows(s.served))
  el('trace-count').textContent = `${s.served.length} job${s.served.length === 1 ? '' : 's'}`
  renderProfile(s)
}
const waitOf = (j: Job): string => j.startedAt === undefined ? '–' : `${((j.startedAt - j.enqueuedAt) / 1000).toFixed(1)} s`

// ---------- Pages ----------

const PAGES = ['overview', 'market', 'trace', 'profile']
function route (): void {
  const page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview'
  for (const p of PAGES) el(`page-${p}`).hidden = p !== page
  document.querySelectorAll<HTMLAnchorElement>('.nav a').forEach(a => {
    if (a.dataset.page === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current')
  })
  document.title = `${el(`page-${page}`).dataset.title ?? ''} · SurgeAPI`
  window.scrollTo(0, 0)
}
window.addEventListener('hashchange', route)
route()

// ---------- My profile ----------

const ME_KEY = 'surgeapi.me' // the public identity key only, to restore the profile on reload
let me: string | undefined
try { me = localStorage.getItem(ME_KEY) ?? undefined } catch {}
let lastSnapshot: MarketSnapshot | undefined

function renderProfile (s: MarketSnapshot): void {
  lastSnapshot = s
  if (me === undefined) return
  const all = [...(s.running === undefined ? [] : [s.running]), ...s.queue, ...s.served].filter(j => j.caller === me)
  const done = all.filter(j => j.startedAt !== undefined)
  el('me-jobs').textContent = String(all.length)
  el('me-spent').textContent = fmt(all.reduce((sum, j) => sum + j.paidSats, 0))
  el('me-wait').textContent = done.length === 0 ? '–' : `${(done.reduce((sum, j) => sum + j.startedAt! - j.enqueuedAt, 0) / done.length / 1000).toFixed(1)} s`
  el('me-table').replaceChildren(...(all.length > 0
    ? all.map(j => { const r = tr([j.prompt, j.status, paid(j), txLink(j.txid)], [2]); r.cells[0].className = 'prompt'; r.cells[0].title = j.prompt; return r })
    : [emptyRow('No jobs from this wallet yet. Pay for one on Live Market.', 4)]))
}

function showMe (): void {
  if (me === undefined) return
  const copy = h('button', { className: 'ghost', type: 'button', textContent: 'Copy' })
  copy.addEventListener('click', () => { void navigator.clipboard.writeText(me!).then(() => { copy.textContent = 'Copied' }) })
  el('me-key').replaceChildren(h('span', { textContent: 'Identity key' }), h('code', { className: 'mono', textContent: me }), copy)
  el('connect').textContent = 'Reconnect BSV Desktop'
  if (lastSnapshot !== undefined) renderProfile(lastSnapshot)
}
showMe()

el('connect').addEventListener('click', () => {
  const msg = el('me-msg')
  msg.className = 'hint'
  msg.textContent = 'Approve in BSV Desktop…'
  void (async () => {
    try {
      wallet ??= new WalletClient('auto')
      me = (await wallet.getPublicKey({ identityKey: true })).publicKey
      try { localStorage.setItem(ME_KEY, me) } catch {}
      msg.textContent = ''
      showMe()
    } catch (e) {
      msg.className = 'hint err'
      msg.textContent = `Could not reach BSV Desktop: ${String(e)}`
    }
  })()
})

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

interface Pick { on: boolean, caseId: string, mode: 'scripted' | 'llm', budgetSats: number }
const STORE_KEY = 'surgeapi.roster'
let domains: Domain[] = []
let picks: Record<string, Pick> = {}
let agentsEnabled = false
let llmAvailable = false
let walletSats: number | undefined
let previews: Array<() => void> = [] // one per agent card: its spend preview at the live surge

const URGENCY_X = { high: 3, medium: 1.5, low: 1 }
/** What the rule-based agent would do at the current surge price: the same rules as runScripted on the server. */
function previewSpend (ac: AgentCase, budget: number): { spend: number, paid: number, overBudget: number, tooPricey: number } {
  const surge = lastPrice ?? BASE_SATS
  const e = { spend: 0, paid: 0, overBudget: 0, tooPricey: 0 }
  for (const t of ac.tasks) {
    const bid = Math.min(Math.ceil(surge * URGENCY_X[urgencyOf(t.deadlineSec)]), t.valueSats)
    if (bid < surge) { e.tooPricey++; continue }
    if (e.spend + bid > budget) { e.overBudget++; continue }
    e.spend += bid
    e.paid++
  }
  return e
}

const savePicks = (): void => { try { localStorage.setItem(STORE_KEY, JSON.stringify(picks)) } catch {} }
const loadPicks = (): Record<string, Pick> => { try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') } catch { return {} } }

function renderRoster (): void {
  previews = []
  el('roster').replaceChildren(...domains.map(d => {
    const p = picks[d.id]
    const c = d.cases.find(x => x.id === p.caseId) ?? d.cases[0]
    const card = h('div', { className: `agent${p.on ? ' on' : ''}` })

    const check = h('input', { type: 'checkbox', checked: p.on })
    check.addEventListener('change', () => { p.on = check.checked; card.classList.toggle('on', p.on); changed() })
    const amt = h('span', { className: 'amt num', textContent: `${p.budgetSats} sats` })
    const head = h('label', { className: 'agent-head' }, check, icon(d.id), `${d.name} agent`, amt)

    const select = h('select', {}, ...d.cases.map(x => h('option', { value: x.id, textContent: x.title, selected: x.id === c.id })))
    select.setAttribute('aria-label', `${d.name} case`)
    const brief = h('p', { className: 'brief', textContent: c.brief })
    const chips = h('div', { className: 'chips' })
    const renderChips = (ac: typeof c): void => {
      chips.replaceChildren(...ac.tasks.map(t => {
        const u = urgencyOf(t.deadlineSec)
        return h('span', { className: `chip ${u}`, title: `${t.prompt} (worth up to ${t.valueSats} sats)`, textContent: `${u} · ${fmtDeadline(t.deadlineSec)}` })
      }))
    }
    renderChips(c)
    select.addEventListener('change', () => {
      p.caseId = select.value
      const ac = d.cases.find(x => x.id === p.caseId)!
      brief.textContent = ac.brief
      renderChips(ac)
      changed()
    })

    const range = h('input', { type: 'range', min: '100', max: '2000', step: '50', value: String(p.budgetSats) })
    range.setAttribute('aria-label', `${d.name} budget`)
    range.addEventListener('input', () => { p.budgetSats = Number(range.value); amt.textContent = `${p.budgetSats} sats`; changed() })
    const brain = h('div', { className: 'mini' })
    brain.setAttribute('role', 'group')
    brain.setAttribute('aria-label', `${d.name} brain`)
    const modeBtn = (mode: Pick['mode'], text: string): HTMLButtonElement => {
      const locked = mode === 'llm' && !llmAvailable
      const b = h('button', { type: 'button', textContent: text, disabled: locked, title: locked ? 'Needs ANTHROPIC_API_KEY on the server' : '' })
      b.setAttribute('aria-pressed', String(p.mode === mode))
      b.addEventListener('click', () => { p.mode = mode; brain.querySelectorAll('button').forEach(x => { x.setAttribute('aria-pressed', String(x === b)) }); changed() })
      return b
    }
    brain.append(modeBtn('scripted', 'Rules'), modeBtn('llm', 'Claude'))

    const est = h('p', { className: 'est' })
    previews.push(() => {
      const ac = d.cases.find(x => x.id === p.caseId) ?? d.cases[0]
      if (p.mode === 'llm') { est.className = 'est'; est.textContent = `Claude picks each bid, never past ${p.budgetSats} sats`; return }
      const e = previewSpend(ac, p.budgetSats)
      const skipped = [e.overBudget > 0 ? `${e.overBudget} skipped: budget too low` : '', e.tooPricey > 0 ? `${e.tooPricey} skipped: surge above its worth` : ''].filter(Boolean)
      est.className = skipped.length > 0 ? 'est warn' : 'est'
      est.replaceChildren(`At ${lastPrice ?? BASE_SATS} sats surge: pays `, h('b', { className: 'num', textContent: `~${e.spend}` }), ` for ${e.paid}/${ac.tasks.length} tasks · `,
        skipped.length > 0 ? skipped.join(' · ') : `${p.budgetSats - e.spend} unused`)
    })

    card.append(head, select, brief, chips, h('div', { className: 'agent-foot' }, range, brain), est)
    return card
  }))
  changed()
}

function changed (): void {
  savePicks()
  previews.forEach(f => { f() })
  const on = domains.filter(d => picks[d.id].on)
  const total = on.reduce((s, d) => s + picks[d.id].budgetSats, 0)
  const summary = el('summary')
  summary.replaceChildren(h('b', { textContent: String(on.length) }), ` agent${on.length === 1 ? '' : 's'} · up to `, h('b', { className: 'num', textContent: String(total) }), ' sats')
  if (walletSats !== undefined && total > walletSats) summary.append(h('span', { className: 'err', textContent: ` · wallet has only ${walletSats}` }))
  el('run-label').textContent = on.length === 0 ? 'Select agents' : `Run ${on.length} agent${on.length === 1 ? '' : 's'}`
  syncRunButton()
}

function setAll (on: boolean, caseIndex?: number, budgetSats?: number): void {
  for (const d of domains) {
    const p = picks[d.id]
    p.on = on
    if (caseIndex !== undefined) p.caseId = d.cases[caseIndex].id
    if (budgetSats !== undefined) p.budgetSats = budgetSats
  }
  renderRoster()
}
el('select-all').addEventListener('click', () => { setAll(true) })
el('select-none').addEventListener('click', () => { setAll(false) })
// Presets are one click: select, configure and launch.
el('preset-rush').addEventListener('click', () => { setAll(true, 0, 800); startRun() })
el('preset-quiet').addEventListener('click', () => { setAll(true, 1, 300); startRun() })

function runMsg (text: string, isError = false): void {
  const m = el('run-msg')
  m.textContent = text
  m.className = isError ? 'hint err' : 'hint'
}

let runActive = false
let startingRun = false
function syncRunButton (): void {
  const busy = startingRun || runActive || !agentsEnabled
  el<HTMLButtonElement>('run').disabled = busy || !domains.some(d => picks[d.id]?.on)
  for (const id of ['preset-rush', 'preset-quiet']) el<HTMLButtonElement>(id).disabled = busy
}

const shown = new Map<string, number>() // run id → log lines already appended
let batchKey = ''
const nameOf = (domainId: string): string => domains.find(d => d.id === domainId)?.name ?? domainId

function renderRuns (runs: AgentRun[]): void {
  if (runs.length === 0) return
  const key = runs.map(r => r.id).join(',')
  const log = el('log')
  if (key !== batchKey) { batchKey = key; shown.clear(); log.replaceChildren() }
  el('empty-log').hidden = true
  const spent = runs.reduce((s, r) => s + r.spentSats, 0)
  const budget = runs.reduce((s, r) => s + r.budgetSats, 0)
  el('run-total').textContent = `${spent} / ${budget} sats`

  el('lanes').replaceChildren(...runs.map(r => {
    const fill = h('div')
    fill.style.width = `${Math.min(100, (r.spentSats / r.budgetSats) * 100)}%`
    const meter = h('div', { className: 'meter' }, fill)
    meter.setAttribute('aria-hidden', 'true')
    const badge = h('span', { className: `badge ${r.status}`, textContent: r.status === 'running' ? (r.mode === 'llm' ? 'Claude · running' : 'running') : r.status })
    return h('div', { className: 'lane' },
      icon(r.domain),
      h('span', { className: 't', title: r.title }, h('b', { textContent: nameOf(r.domain) }), ` · ${r.title.split(' · ')[1] ?? ''}`),
      h('span', { className: 'amt num' }, `${r.spentSats}/${r.budgetSats} `, badge),
      meter)
  }))

  // Append only the new lines, merged across agents in time order.
  const fresh = runs.flatMap(r => r.log.slice(shown.get(r.id) ?? 0).map(line => ({ line, r })))
  for (const r of runs) shown.set(r.id, r.log.length)
  fresh.sort((a, b) => a.line.at - b.line.at)
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40
  for (const { line, r } of fresh) {
    const body = h('span', {}, h('span', { className: 'tagd', textContent: nameOf(r.domain) }), line.text)
    if (line.txid !== undefined) body.append(txLink(line.txid, 'view tx ↗'))
    log.append(h('li', { className: line.kind }, h('span', { className: 'k', textContent: line.kind.toUpperCase() }), body))
  }
  if (nearBottom) log.scrollTop = log.scrollHeight

  const wasActive = runActive
  runActive = runs.some(r => r.status === 'running')
  if (wasActive && !runActive) { runMsg(`All agents finished: ${spent} sats spent.`); void loadWallet() }
  syncRunButton()
}

let identityKey = ''
async function loadWallet (): Promise<void> {
  if (!agentsEnabled) return
  try {
    const res = await fetch('/agents/wallet')
    const w = await res.json()
    if (!res.ok) { el('wallet-sats').textContent = 'unavailable'; return }
    identityKey = w.identityKey
    walletSats = w.sats
    el('wallet-sats').textContent = `${w.sats} sats`
    el('copy-key').hidden = false
    el<HTMLButtonElement>('fund').disabled = false
    changed()
  } catch {
    el('wallet-sats').textContent = 'unavailable'
  }
}
el('copy-key').addEventListener('click', () => {
  void navigator.clipboard.writeText(identityKey).then(() => { el('copy-key').textContent = 'Copied' })
  setTimeout(() => { el('copy-key').textContent = 'Copy identity key' }, 1500)
})

async function pollAgents (first = false): Promise<void> {
  try {
    const a = await (await fetch('/agents')).json()
    if (first) {
      domains = a.domains
      agentsEnabled = a.enabled
      llmAvailable = a.llm
      const saved = loadPicks()
      picks = Object.fromEntries(domains.map((d, i): [string, Pick] => {
        const s = saved[d.id]
        if (s === undefined || !d.cases.some(c => c.id === s.caseId)) return [d.id, { on: i < 3, caseId: d.cases[0].id, mode: 'scripted', budgetSats: 500 }]
        return [d.id, { ...s, mode: s.mode === 'llm' && !llmAvailable ? 'scripted' : s.mode }]
      }))
      renderRoster()
      el('token-field').hidden = !a.tokenRequired
      if (!a.enabled) runMsg('Agent console is off: the server needs AGENT_LLM_KEY in .env.', true)
      void loadWallet()
      if (a.enabled) void recoverFund()
    }
    renderRuns(a.runs ?? [])
  } catch {
    if (first) setTimeout(() => { void pollAgents(true) }, 3000)
  }
}

function startRun (): void {
  const agents = domains.filter(d => picks[d.id].on).map(d => {
    const { caseId, mode, budgetSats } = picks[d.id]
    return { domain: d.id, caseId, mode, budgetSats }
  })
  if (agents.length === 0 || runActive || startingRun) return
  startingRun = true
  syncRunButton()
  runMsg(`Starting ${agents.length} agent${agents.length === 1 ? '' : 's'}…`)
  void (async () => {
    try {
      const res = await fetch('/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-run-token': el<HTMLInputElement>('token').value },
        body: JSON.stringify({ agents })
      })
      const body = await res.json()
      if (!res.ok) { runMsg(body.error ?? `Request failed (HTTP ${res.status})`, true); return }
      runMsg('Agents running: they compete for the queue below.')
      runActive = true
      renderRuns(body.runs)
    } catch (e) {
      runMsg(String(e), true)
    } finally {
      startingRun = false
      syncRunButton()
    }
  })()
}
el('run').addEventListener('click', startRun)

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

// ---------- Fund the agents ----------

// A payment the agent has not accepted yet is kept here, so a failed hand-over
// never strands the sats: the next page load delivers it without paying again.
const PENDING_FUND = 'surgeapi.pending-fund'

function fundMsg (text: string, isError = false, txid?: string): void {
  const m = el('fund-msg')
  m.className = isError ? 'hint err' : 'hint'
  m.replaceChildren(text)
  if (txid !== undefined) m.append(txLink(txid, 'view tx ↗'))
}

function pendingFund (): Brc29Payment | undefined {
  try { const raw = localStorage.getItem(PENDING_FUND); return raw === null ? undefined : JSON.parse(raw) } catch { return undefined }
}

async function deliverFund (p: Brc29Payment): Promise<void> {
  const res = await fetch('/agents/fund', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  try { localStorage.removeItem(PENDING_FUND) } catch {}
  fundMsg(`The agents received ${p.satoshis} sats from your wallet.`, false, p.txid)
  void loadWallet()
  void pollNetwork()
}

el('fund').addEventListener('click', () => {
  const sats = Number(el<HTMLInputElement>('fund-sats').value)
  if (!Number.isInteger(sats) || sats < 1 || sats > 100_000) { fundMsg('Enter whole sats, 1–100000.', true); return }
  const button = el<HTMLButtonElement>('fund')
  button.disabled = true
  fundMsg(`Approve the ${sats}-sat payment in BSV Desktop…`)
  void (async () => {
    try {
      wallet ??= new WalletClient('auto')
      const p = await createBrc29Payment(wallet, identityKey, sats, 'Fund SurgeAPI agents')
      try { localStorage.setItem(PENDING_FUND, JSON.stringify(p)) } catch {}
      fundMsg('Paid. Handing the payment to the agent wallet…')
      await deliverFund(p)
    } catch (e) {
      fundMsg(`${String(e)}${pendingFund() === undefined ? '' : ' Your payment is saved; reload the page to deliver it.'}`, true)
    } finally {
      button.disabled = identityKey === ''
    }
  })()
})

async function recoverFund (): Promise<void> {
  const p = pendingFund()
  if (p === undefined) return
  fundMsg(`Delivering your earlier ${p.satoshis}-sat top-up…`)
  try { await deliverFund(p) } catch (e) { fundMsg(`Earlier top-up not delivered yet: ${String(e)}`, true) }
}

// ---------- Network impact ----------

const fmt = (n: number): string => n.toLocaleString('en-US')
function setStat (id: string, text: string): void {
  const v = el(id)
  if (v.textContent === text) return
  v.textContent = text
  v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash')
}

async function pollNetwork (): Promise<void> {
  try {
    const n: NetworkStats = await (await fetch('/network')).json()
    setStat('net-txs', fmt(n.txs))
    setStat('net-sats', fmt(n.providerSats))
    setStat('net-payers', fmt(n.payers))
    setStat('net-funded', fmt(n.fundedSats))
    setStat('net-fee', n.avgFeeSats === undefined ? '–' : fmt(n.avgFeeSats))
    if (walletSats !== undefined) setStat('net-capital', fmt(walletSats))
    el('net-since').textContent = `since ${new Date(n.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  } catch {}
}

void pollMarket()
void pollAgents(true)
void pollNetwork()
setInterval(() => { void pollMarket(); void pollAgents(); void pollNetwork() }, POLL_MS)
setInterval(() => { void loadWallet() }, 10_000)
