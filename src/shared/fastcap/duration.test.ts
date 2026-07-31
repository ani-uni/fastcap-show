import { describe, expect, it } from 'vite-plus/test'

import { parseDurationTextMilliseconds } from './duration'

describe('parseDurationTextMilliseconds', () => {
  it.each([
    ['00:24:30', 1_470_000],
    ['24:30', 1_470_000],
    ['24m', 1_440_000],
    ['1h 2m 3s', 3_723_000],
    ['24分钟30秒', 1_470_000],
  ])('parses %s', (input, expected) => {
    expect(parseDurationTextMilliseconds(input)).toBe(expected)
  })

  it.each(['', 'unknown', '24', '00:90:00'])('rejects %s', (input) => {
    expect(parseDurationTextMilliseconds(input)).toBeUndefined()
  })
})
