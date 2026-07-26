import { BgmTv } from '../3rd-ref/bgmtv'
import { TMDB, parseTMDBUrlC } from '../3rd-ref/tmdb'
import type { FastCapEpisodeMetadata } from './metadata.functions'

export async function getFastCapEpisodeMetadataClient(
  key: string,
  refs: { bgmtv_epid?: string; tmdb_urlc?: string },
) {
  const bgmtv = new BgmTv()
  const tmdb = new TMDB()
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
      } satisfies FastCapEpisodeMetadata
    } catch (error) {
      failures.push(`Bangumi client: ${getErrorMessage(error)}`)
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
        } satisfies FastCapEpisodeMetadata
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
        } satisfies FastCapEpisodeMetadata
      }

      failures.push('TMDB client: 不支持的 tmdb_urlc')
    } catch (error) {
      failures.push(`TMDB client: ${getErrorMessage(error)}`)
    }
  }

  throw new Error(failures.join('；') || '没有可用的 client 元数据请求')
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
