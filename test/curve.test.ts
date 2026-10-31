import { describe, expect, it } from 'vitest'
import { passPrice } from '../src/pass'

describe('SURGEPASS bonding curve', () => {
  it('starts at the base price and rises 50 sats per pass in circulation', () => {
    expect(passPrice(0)).toBe(300)
    expect(passPrice(4)).toBe(500)
    expect(passPrice(99)).toBe(5250)
  })
})
