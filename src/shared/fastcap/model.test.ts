import { describe, expect, it } from 'vite-plus/test'

import {
  formatMilliseconds,
  parseFastCapInput,
  parseFastCapJson,
  parseProgressTimestamp,
} from './model'
import type { FastCapJson } from './model'

const jsonInput: FastCapJson = {
  f: [
    {
      i: 'bili_cid',
      id: '100',
      p: [
        [1000, 3000, 5000, 2],
        [0, 1000, 0, 1],
      ],
      t: {
        1: { bgmtv_epid: '11' },
        2: { tmdb_urlc: 'tv/285933/season/1/episode/2' },
      },
    },
    {
      i: 'bili_cid',
      id: '200',
      p: [[0, 1000, 0, 1]],
      t: {
        1: { bgmtv_epid: '22' },
      },
    },
  ],
}

describe('parseFastCapInput', () => {
  it('formats imported resources before building views', () => {
    const result = parseFastCapJson({
      f: [
        {
          i: 'bili_cid',
          id: '100',
          p: [[0, 1000, 0, 1]],
          t: { 1: { bgmtv_epid: '11' } },
        },
        {
          i: 'bili_cid',
          id: '200',
          p: [[0, 1000, 0, 2]],
          t: { 2: { tmdb_urlc: 'tv/1/season/1/episode/1', bgmtv_epid: '11' } },
        },
        { i: 'bili_cid', id: '300', p: [], t: {} },
      ],
    })

    expect(result.json.f).toHaveLength(2)
    expect(result.json.f.map((resource) => resource.t)).toEqual([
      { 2: { bgmtv_epid: '11', tmdb_urlc: 'tv/1/season/1/episode/1' } },
      { 2: { bgmtv_epid: '11', tmdb_urlc: 'tv/1/season/1/episode/1' } },
    ])
    expect(result.indexRows.map((row) => row.tempEpId)).toEqual([2, 2])
  })

  it('parses json text', () => {
    const result = parseFastCapInput(JSON.stringify(jsonInput))

    expect(result.format).toBe('json')
    expect(result.stats).toEqual({ resources: 2, episodes: 3, clips: 3 })
    expect(result.indexRows.map((row) => row.resourceId)).toEqual([
      '100',
      '100',
      '200',
    ])
  })

  it('parses raw toml and exports parseable yue', () => {
    const result = parseFastCapInput(`[[f]]
i = "bili_cid"
id = "100"
p = [ [ 0, 1000, 0, 1 ] ]

[f.t.1]
bgmtv_epid = "11"`)
    const reparsed = parseFastCapInput(result.yue)

    expect(result.format).toBe('toml')
    expect(reparsed.json).toEqual(result.json)
  })

  it('sorts episode view by temp ep id then f index', () => {
    const result = parseFastCapInput(JSON.stringify(jsonInput))

    expect(
      result.episodeRows.map((episode) => [
        episode.resourceId,
        episode.tempEpId,
      ]),
    ).toEqual([
      ['100', 1],
      ['200', 1],
      ['100', 2],
    ])
  })

  it('keeps same temp ep ids under different resources separate', () => {
    const result = parseFastCapInput(JSON.stringify(jsonInput))

    expect(
      result.episodeRows.filter((episode) => episode.tempEpId === 1),
    ).toHaveLength(2)
    expect(result.episodeRows.map((episode) => episode.key)).toEqual([
      '0:1',
      '1:1',
      '0:2',
    ])
  })

  it('applies json through the fastcap package exporter', () => {
    const result = parseFastCapJson(jsonInput)
    const reparsed = parseFastCapInput(result.toml)

    expect(result.stats.clips).toBe(3)
    expect(reparsed.json).toEqual(result.json)
  })
})

describe('formatMilliseconds', () => {
  it('formats signed millisecond values', () => {
    expect(formatMilliseconds(3723004)).toBe('01:02:03.004')
    expect(formatMilliseconds(-1000)).toBe('-00:00:01.000')
  })

  it('parses progress timestamps with FastCapUtils', () => {
    expect(parseProgressTimestamp('01:02:03.004')).toBe(3723004)
  })
})
