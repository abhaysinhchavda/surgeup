/**
 * Surge pricing and the priority queue. Pure and in-memory: a restart drops
 * queued jobs (README "known limits").
 */
import { randomUUID } from 'node:crypto'

export interface MarketConfig { baseSats: number, k: number }
export type JobStatus = 'queued' | 'running' | 'done'
export interface Job { id: string, caller: string, label: string, prompt: string, paidSats: number, txid: string, viaPass: boolean, seq: number, enqueuedAt: number, status: JobStatus, startedAt?: number, doneAt?: number, result?: string }
export interface MarketSnapshot { priceSats: number, queueDepth: number, queue: Job[], running?: Job, served: Job[] }

const SERVED_LIMIT = 20

/** Serve order: pass holders first, then most sats paid, then arrival. */
const byPriority = (a: Job, b: Job): number =>
  Number(b.viaPass) - Number(a.viaPass) || b.paidSats - a.paidSats || a.seq - b.seq

export class Market {
  private readonly jobs = new Map<string, Job>()
  private queued: Job[] = []
  private served: Job[] = []
  private seq = 0

  constructor (readonly cfg: MarketConfig, private readonly now: () => number = Date.now) {}

  price (): number {
    return Math.ceil(this.cfg.baseSats * (1 + this.cfg.k * this.queued.length))
  }

  enqueue (j: { caller: string, label: string, prompt: string, paidSats: number, txid: string, viaPass?: boolean }): Job {
    const job: Job = { ...j, viaPass: j.viaPass ?? false, id: randomUUID(), seq: this.seq++, enqueuedAt: this.now(), status: 'queued' }
    this.jobs.set(job.id, job)
    this.queued.push(job)
    return job
  }

  // ponytail: O(n log n) sort per dequeue, use a heap if the queue passes ~10k
  next (): Job | undefined {
    this.queued.sort(byPriority)
    const job = this.queued.shift()
    if (job === undefined) return undefined
    job.status = 'running'
    job.startedAt = this.now()
    return job
  }

  complete (id: string, result: string): void {
    const job = this.jobs.get(id)
    if (job === undefined || job.status !== 'running') return
    job.status = 'done'
    job.result = result
    job.doneAt = this.now()
    this.served = [job, ...this.served].slice(0, SERVED_LIMIT)
  }

  get (id: string): Job | undefined {
    return this.jobs.get(id)
  }

  position (id: string): number | undefined {
    const i = [...this.queued].sort(byPriority).findIndex(j => j.id === id)
    return i === -1 ? undefined : i + 1
  }

  snapshot (): MarketSnapshot {
    const running = [...this.jobs.values()].find(j => j.status === 'running')
    return { priceSats: this.price(), queueDepth: this.queued.length, queue: [...this.queued].sort(byPriority), running, served: [...this.served] }
  }
}
