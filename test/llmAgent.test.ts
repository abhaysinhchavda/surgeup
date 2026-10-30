import { describe, expect, it } from 'vitest'
import { guardBid } from '../src/llmAgent'

describe('guardBid', () => {
  const budget = { limitSats: 1000, spentSats: 900 }
  it('refuses a bid that would exceed the budget', () => {
    expect(guardBid(budget, 200).ok).toBe(false)
  })
  it('allows a bid that fits', () => {
    expect(guardBid(budget, 100).ok).toBe(true)
  })
  it('refuses zero, negative and fractional bids', () => {
    for (const bid of [0, -1, 1.5]) expect(guardBid(budget, bid).ok).toBe(false)
  })
})
