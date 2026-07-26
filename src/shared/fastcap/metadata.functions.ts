import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

import { BgmTv } from '../3rd-ref/bgmtv'
import { TMDB, parseTMDBUrlC } from '../3rd-ref/tmdb'

const EpisodeMetadataRequestSchema = z.object({
  episodes: z.array(
    z.object({
      key: z.string(),
      refs: z.object({
        bgmtv_epid: z.string().optional(),
        tmdb_urlc: z.string().optional(),
      }),
    }),
  ),
})

export type FastCapEpisodeMetadata = {
  key: string
  title: string
  subtitle?: string
  source?: 'bgmtv' | 'tmdb'
  status: 'resolved' | 'fallback'
  error?: string
}

export const getFastCapEpisodeMetadata = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof EpisodeMetadataRequestSchema>) =>
    EpisodeMetadataRequestSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const bgmtv = new BgmTv()
    const tmdb = await TMDB.init()

    const entries = await Promise.all(
      data.episodes.map(async (episode) => [
        episode.key,
        await resolveEpisodeMetadata(episode.key, episode.refs, bgmtv, tmdb),
      ]),
    )

    return Object.fromEntries(entries) as Record<string, FastCapEpisodeMetadata>
  })

async function resolveEpisodeMetadata(
  key: string,
  refs: { bgmtv_epid?: string; tmdb_urlc?: string },
  bgmtv: BgmTv,
  tmdb: TMDB,
): Promise<FastCapEpisodeMetadata> {
  const failures: Array<string> = []

  if (refs.bgmtv_epid) {
    try {
      const id = Number.parseInt(refs.bgmtv_epid, 10)
      const result = await bgmtv.getEpisodeInfo(id)
      const episode = result.v0.episodes['{episode_id}']
      return {
        key,
        title:
          episode.name_cn || episode.name || `Bangumi EP ${refs.bgmtv_epid}`,
        subtitle: [
          `Bangumi ${refs.bgmtv_epid}`,
          episode.sort ? `sort ${episode.sort}` : undefined,
          episode.airdate || undefined,
        ]
          .filter(Boolean)
          .join(' · '),
        source: 'bgmtv',
        status: 'resolved',
      }
    } catch (error) {
      failures.push(`Bangumi: ${getErrorMessage(error)}`)
    }
  }

  if (refs.tmdb_urlc) {
    try {
      const parsed = parseTMDBUrlC(refs.tmdb_urlc)
      if (parsed?.episode_number !== undefined) {
        const result = await tmdb.getTVEpisodeInfo(parsed)
        const episode = result.tv.episode
        return {
          key,
          title: episode.name || `TMDB ${refs.tmdb_urlc}`,
          subtitle: [
            `TMDB ${refs.tmdb_urlc}`,
            episode.air_date || undefined,
            episode.runtime ? `${episode.runtime} min` : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
          source: 'tmdb',
          status: 'resolved',
        }
      }

      if (parsed?.movie_id !== undefined) {
        const result = await tmdb.getMovieInfo(parsed)
        return {
          key,
          title:
            result.movie.title ||
            result.movie.original_title ||
            `TMDB ${refs.tmdb_urlc}`,
          subtitle: [
            `TMDB ${refs.tmdb_urlc}`,
            result.movie.release_date || undefined,
            result.movie.runtime ? `${result.movie.runtime} min` : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
          source: 'tmdb',
          status: 'resolved',
        }
      }

      failures.push('TMDB: 不支持的 tmdb_urlc')
    } catch (error) {
      failures.push(`TMDB: ${getErrorMessage(error)}`)
    }
  }

  return {
    key,
    title: refs.bgmtv_epid
      ? `Bangumi EP ${refs.bgmtv_epid}`
      : refs.tmdb_urlc
        ? `TMDB ${refs.tmdb_urlc}`
        : '未提供第三方剧集 ID',
    subtitle: [refs.bgmtv_epid, refs.tmdb_urlc].filter(Boolean).join(' · '),
    status: 'fallback',
    error: failures.join('；') || '没有可用的第三方剧集信息',
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
