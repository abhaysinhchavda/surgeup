import { describe, expect, it } from 'vitest'
import { bidFor } from '../src/agent'

describe('bidFor', () => {
  it('scales the surge price by urgency', () => {
    expect(bidFor('low', 150)).toBe(150)
    expect(bidFor('medium', 150)).toBe(225)
    expect(bidFor('high', 150)).toBe(450)
    expect(bidFor('medium', 101)).toBe(152)
  })
})
