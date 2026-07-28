import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

import { BgmTv } from '../3rd-ref/bgmtv'
import { TMDB, parseTMDBUrlC } from '../3rd-ref/tmdb'
import { env } from '~/env'

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
  seriesTitle?: string
  seasonTitle?: string
  episodeLabel?: string
  duration?: string
  imageUrl?: string
  source?: 'bgmtv' | 'tmdb'
  status: 'resolved' | 'fallback'
  error?: string
}

export const getFastCapEpisodeMetadata = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof EpisodeMetadataRequestSchema>) =>
    EpisodeMetadataRequestSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const bgmtv = new BgmTv(env.BGMTV_API_URL)
    const tmdb = new TMDB()

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
      const subject = await bgmtv
        .getSubjectInfo(episode.subject_id)
        .then((info) => info.v0.subjects['{subject_id}'])
        .catch(() => undefined)
      return {
        key,
        title:
          episode.name_cn || episode.name || `Bangumi EP ${refs.bgmtv_epid}`,
        seriesTitle: subject?.name_cn || subject?.name,
        episodeLabel: [
          episode.ep ? `EP ${episode.ep}` : undefined,
          episode.sort ? `sort ${episode.sort}` : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
        duration: episode.duration || undefined,
        imageUrl: subject?.images.common,
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
        const [result, seriesResult, seasonResult] = await Promise.all([
          tmdb.getTVEpisodeInfo(parsed),
          tmdb.getTVSeriesInfo(parsed),
          tmdb.getTVSeasonInfo(parsed),
        ])
        const episode = result.tv.episode
        const series = seriesResult.tv.series
        const season = seasonResult.tv.season
        return {
          key,
          title: episode.name || `TMDB ${refs.tmdb_urlc}`,
          seriesTitle: series.name || series.original_name,
          seasonTitle: season.name || `Season ${episode.season_number}`,
          episodeLabel: `S${episode.season_number}E${episode.episode_number}`,
          duration: episode.runtime ? `${episode.runtime} min` : undefined,
          imageUrl: episode.still_path
            ? getTMDBImageUrl(episode.still_path)
            : season.poster_path
              ? getTMDBImageUrl(season.poster_path)
              : series.poster_path
                ? getTMDBImageUrl(series.poster_path)
                : undefined,
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
          seriesTitle: result.movie.title || result.movie.original_title,
          duration: result.movie.runtime
            ? `${result.movie.runtime} min`
            : undefined,
          imageUrl: result.movie.poster_path
            ? getTMDBImageUrl(result.movie.poster_path)
            : undefined,
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

function getTMDBImageUrl(path: string) {
  return `https://image.tmdb.org/t/p/w342${path}`
}
