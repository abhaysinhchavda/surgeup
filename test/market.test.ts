import { describe, expect, it } from 'vitest'
import { Market } from '../src/market'

const cfg = { baseSats: 100, k: 0.5 }
const job = (paidSats: number, viaPass = false) => ({ caller: 'k', label: 'L', prompt: 'p', paidSats, txid: 't', viaPass })

describe('Market', () => {
  it('price rises with queue depth', () => {
    const m = new Market(cfg)
    expect(m.price()).toBe(100)
    m.enqueue(job(100))
    expect(m.price()).toBe(150)
    m.enqueue(job(100))
    expect(m.price()).toBe(200)
    m.next()
    expect(m.price()).toBe(150)
  })

  it('serves highest paid first, FIFO on ties', () => {
    const m = new Market(cfg)
    const a = m.enqueue(job(100)); const b = m.enqueue(job(300)); const c = m.enqueue(job(200)); const d = m.enqueue(job(300))
    expect([m.next(), m.next(), m.next(), m.next()].map(j => j?.id)).toEqual([b.id, d.id, c.id, a.id])
    expect(m.next()).toBeUndefined()
  })

  it('pass jobs jump the queue', () => {
    const m = new Market(cfg)
    const a = m.enqueue(job(900)); const b = m.enqueue(job(0, true))
    expect(m.next()?.id).toBe(b.id)
    expect(m.next()?.id).toBe(a.id)
  })

  it('position is 1-based in serve order', () => {
    const m = new Market(cfg)
    const a = m.enqueue(job(100)); const b = m.enqueue(job(300))
    expect(m.position(b.id)).toBe(1)
    expect(m.position(a.id)).toBe(2)
    m.next()
    expect(m.position(b.id)).toBeUndefined()
    expect(m.position(a.id)).toBe(1)
  })

  it('snapshot lists served newest first, capped at 20', () => {
    let t = 0
    const m = new Market(cfg, () => ++t)
    let last = ''
    for (let i = 0; i < 25; i++) {
      const j = m.enqueue(job(100))
      m.next()
      m.complete(j.id, `r${i}`)
      last = j.id
    }
    const s = m.snapshot()
    expect(s.served).toHaveLength(20)
    expect(s.served[0].id).toBe(last)
    expect(s.served[0].status).toBe('done')
    expect(s.queueDepth).toBe(0)
  })
})
