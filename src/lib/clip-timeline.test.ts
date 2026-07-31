import { describe, expect, it } from 'vite-plus/test'

import {
  assignTimelineLanes,
  collectEpisodeMappings,
  createRange,
  createTimelineTicks,
  expandEpisodeTimelineDuration,
  getEpisodeTimelineDuration,
  millisecondsToPixels,
  moveRange,
  pixelsToMilliseconds,
  resizeRange,
  snapMilliseconds,
} from './clip-timeline'
import type { FastCapJson } from '~/shared/fastcap/model'

describe('clip timeline math', () => {
  it('converts pixels and milliseconds and snaps to 100ms', () => {
    expect(millisecondsToPixels(30_000, 120_000, 800)).toBe(200)
    expect(pixelsToMilliseconds(200, 120_000, 800)).toBe(30_000)
    expect(snapMilliseconds(1_249)).toBe(1_200)
    expect(snapMilliseconds(1_250)).toBe(1_300)
  })

  it('creates, moves and resizes bounded ranges', () => {
    expect(createRange(1_049, 2_151, 10_000)).toEqual({
      begin: 1_000,
      end: 2_200,
    })
    expect(createRange(1_000, 1_049, 10_000)).toBeUndefined()
    expect(moveRange(1_000, 3_000, 9_000, 10_000)).toEqual({
      begin: 8_000,
      end: 10_000,
    })
    expect(resizeRange(1_000, 3_000, 'left', 5_000, 10_000)).toEqual({
      begin: 2_900,
      end: 3_000,
    })
    expect(resizeRange(1_000, 3_000, 'right', 20_000, 10_000)).toEqual({
      begin: 1_000,
      end: 10_000,
    })
  })

  it('generates ticks and separates overlaps into lanes', () => {
    expect(createTimelineTicks(120_000)).toEqual([
      0, 20_000, 40_000, 60_000, 80_000, 100_000, 120_000,
    ])
    const lanes = assignTimelineLanes([
      { begin: 0, end: 2_000 },
      { begin: 1_000, end: 3_000 },
      { begin: 3_000, end: 4_000 },
    ])
    expect(lanes.map(({ lane }) => lane)).toEqual([0, 1, 0])
  })
})

describe('episode mapping timeline', () => {
  const draft: FastCapJson = {
    f: [
      {
        i: 'bili_cid',
        id: '100',
        p: [[0, 10_000, 1_000, 1]],
        t: { 1: { bgmtv_epid: '7' } },
      },
      {
        i: 'bili_cid',
        id: '200',
        p: [[0, 5_000, 12_000, 2]],
        t: { 2: { bgmtv_epid: '7', tmdb_urlc: 'tv/1/season/1/episode/1' } },
      },
      {
        i: 'bili_cid',
        id: '300',
        p: [[0, 3_000, 20_000, 3]],
        t: { 3: { tmdb_urlc: 'tv/1/season/1/episode/1' } },
      },
      {
        i: 'bili_cid',
        id: '400',
        p: [[0, 1_000, 0, 1]],
        t: { 1: {} },
      },
    ],
  }

  it('merges transitive third-party episode references across resources', () => {
    const mappings = collectEpisodeMappings(draft, {
      cid: '100',
      resourceIndex: 0,
      clipIndex: 0,
    })
    expect(mappings.map(({ cid }) => cid)).toEqual(['100', '200', '300'])
    expect(mappings[0]).toMatchObject({
      begin: 1_000,
      end: 11_000,
      duration: 10_000,
    })
  })

  it('does not merge unreferenced episodes from different resources', () => {
    expect(
      collectEpisodeMappings(draft, {
        cid: '400',
        resourceIndex: 3,
        clipIndex: 0,
      }),
    ).toHaveLength(1)
  })

  it('uses resource index to distinguish offline resources with empty CIDs', () => {
    const offlineDraft: FastCapJson = {
      f: [
        {
          i: 'bili_cid',
          id: '',
          p: [[0, 1_000, 0, 1]],
          t: { 1: {} },
        },
        {
          i: 'bili_cid',
          id: '',
          p: [[0, 2_000, 5_000, 1]],
          t: { 1: {} },
        },
      ],
    }
    const mappings = collectEpisodeMappings(offlineDraft, {
      cid: '',
      resourceIndex: 1,
      clipIndex: 0,
    })
    expect(mappings).toHaveLength(1)
    expect(mappings[0]).toMatchObject({ resourceIndex: 1, end: 7_000 })
  })

  it('uses metadata duration or an expanding padded fallback', () => {
    const mappings = [{ end: 240_000 }]
    expect(getEpisodeTimelineDuration(mappings, 1_500_000)).toBe(1_500_000)
    expect(getEpisodeTimelineDuration(mappings)).toBe(500_000)
    expect(expandEpisodeTimelineDuration(500_000, 460_000)).toBe(1_000_000)
    expect(expandEpisodeTimelineDuration(500_000, 100_000)).toBe(500_000)
  })
})
