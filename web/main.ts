/**
 * Dashboard: polls /state, and lets a human pay for a job from BSV Desktop.
 * Every caller-supplied string (labels, results) is rendered with textContent.
 */
import { AuthFetch, WalletClient } from '@bsv/sdk'
import type { Job, MarketSnapshot } from '../src/market'

const POLL_MS = 1000
const RESULT_TIMEOUT_MS = 5 * 60_000

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

function row (cells: Array<string | Node>, className = ''): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.className = className
  for (const c of cells) { const td = document.createElement('td'); td.append(c); tr.append(td) }
  return tr
}
function emptyRow (text: string, cols: number): HTMLTableRowElement {
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  td.colSpan = cols
  td.className = 'empty'
  td.textContent = text
  tr.append(td)
  return tr
}
function paid (job: Job): string | Node {
  if (!job.viaPass) return `${job.paidSats} sats`
  const b = document.createElement('span')
  b.className = 'pass'
  b.textContent = 'PASS'
  return b
}
function txLink (txid: string): Node {
  const a = document.createElement('a')
  a.href = `https://whatsonchain.com/tx/${txid}`
  a.target = '_blank'
  a.rel = 'noopener'
  a.textContent = `${txid.slice(0, 8)}…`
  return a
}

let bidEdited = false
el<HTMLInputElement>('bid').addEventListener('input', () => { bidEdited = true })

function render (s: MarketSnapshot): void {
  el('price').textContent = String(s.priceSats)
  el('depth').textContent = String(s.queueDepth)
  if (!bidEdited) el<HTMLInputElement>('bid').value = String(s.priceSats)

  const queue = s.queue.map((j, i) => row([String(i + 1), j.label, paid(j)]))
  if (s.running !== undefined) queue.unshift(row(['▶', s.running.label, paid(s.running)], 'running'))
  el('queue').replaceChildren(...(queue.length > 0 ? queue : [emptyRow('Queue empty', 3)]))

  const served = s.served.map(j => row([
    j.label,
    paid(j),
    j.startedAt === undefined ? '–' : `${((j.startedAt - j.enqueuedAt) / 1000).toFixed(1)} s`,
    txLink(j.txid)
  ]))
  el('served').replaceChildren(...(served.length > 0 ? served : [emptyRow('No jobs yet', 4)]))
}

async function poll (): Promise<void> {
  try {
    render(await (await fetch('/state')).json())
    el('status').textContent = ''
  } catch {
    el('status').textContent = 'Server unreachable: is `npm run server` running?'
  }
}
void poll()
setInterval(() => { void poll() }, POLL_MS)

function say (text: string, isError = false): void {
  const msg = el('msg')
  msg.textContent = text
  msg.className = isError ? 'err' : ''
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
      if (res.status !== 200) { say(body.error ?? `Request failed (HTTP ${res.status})`, true); return }
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
