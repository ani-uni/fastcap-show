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
      } satisfies FastCapEpisodeMetadata
    } catch (error) {
      failures.push(`Bangumi client: ${getErrorMessage(error)}`)
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

function getTMDBImageUrl(path: string) {
  return `https://image.tmdb.org/t/p/w342${path}`
}
