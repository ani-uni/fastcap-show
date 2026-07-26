import { describe, expect, it } from 'vite-plus/test'

import { formatMilliseconds, parseFastCapInput } from './model'

const jsonInput = {
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
})

describe('formatMilliseconds', () => {
  it('formats signed millisecond values', () => {
    expect(formatMilliseconds(3723004)).toBe('01:02:03.004')
    expect(formatMilliseconds(-1000)).toBe('-00:00:01.000')
  })
})
