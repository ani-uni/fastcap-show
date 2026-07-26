import ky from 'ky'
import { HTTPError } from 'nitro/h3'
import { useStorage } from 'nitro/storage'
import z from 'zod'

import { headers } from '../headers'
import { env } from '~/env'

export const TMDBConfigSchema = z.object({
  api_url: z.url().nullish(),
  // 当使用tmdb api代理时，可以指定api_key为"proxy"，此时不会在请求头中添加Authorization
  api_key: z.union([z.literal('proxy'), z.string()]).nullish(),
})

export const TMDBUrlCRawSchema = {
  movie: z.templateLiteral([z.literal('movie/'), z.string()]),
  tv: {
    episode: z.templateLiteral([
      z.literal('tv/'),
      z.int32(),
      z.literal('/season/'),
      z.int32(),
      z.literal('/episode/'),
      z.int32(),
    ]),
    season: z.templateLiteral([
      z.literal('tv/'),
      z.int32(),
      z.literal('/season/'),
      z.int32(),
    ]),
    series: z.templateLiteral([z.literal('tv/'), z.int32()]),
  },
}
// const TMDBUrlCRawStringSchema = z.xor([
//   TMDBUrlCRawSchema.movie,
//   TMDBUrlCRawSchema.tv.episode,
//   TMDBUrlCRawSchema.tv.season,
//   TMDBUrlCRawSchema.tv.series,
// ])

// const TMDBClassSchema = {
//   getTVEpisodeInfo: z.xor([
//     TMDBUrlCRawSchema.movie,
//     TMDBUrlCRawSchema.tv.episode,
//   ]),
// }

const TMDBIdSchema = z.int32()
export function parseTMDBUrlC(urlc: string) {
  const input = urlc.trim()
  const parseId = (value?: string) => {
    if (!value) return null
    return TMDBIdSchema.parse(Number.parseInt(value, 10))
  }
  const patterns = [
    {
      kind: 'episode' as const,
      regex: /tv\/(\d+)(-[^/\s]+)?\/season\/(\d+)\/episode\/(\d+)/,
    },
    {
      kind: 'season' as const,
      regex: /tv\/(\d+)(-[^/\s]+)?\/season\/(\d+)/,
    },
    {
      kind: 'series' as const,
      regex: /tv\/(\d+)(-[^/\s]+)?/,
    },
    {
      kind: 'movie' as const,
      regex: /movie\/(\d+)(-[^/\s]+)?/,
    },
  ]

  for (const { kind, regex } of patterns) {
    const match = input.match(regex)
    if (!match) continue
    if (kind === 'movie') {
      const movie_id = parseId(match[1])
      if (movie_id === null) return null
      return { movie_id }
    } else {
      const series_id = parseId(match[1])
      if (series_id === null) return null
      if (kind === 'series') return { series_id }
      const season_number = parseId(match[3])
      if (season_number === null) return null
      if (kind === 'season') return { series_id, season_number }
      const episode_number = parseId(match[4])
      if (episode_number === null) return null
      // if (kind === 'episode')
      return { series_id, season_number, episode_number }
    }
  }

  return null
}

const TMDBApiSchemaSearch = {
  movie: z.object({
    adult: z.boolean().optional(),
    backdrop_path: z.string().nullish(),
    id: z.int(),
    title: z.string().optional(),
    original_language: z.string().optional(),
    original_title: z.string().optional(),
    overview: z.string().nullish(),
    poster_path: z.string().nullish(),
    genre_ids: z.array(z.int()).optional(),
    popularity: z.number().optional(),
    release_date: z.string().nullish(),
    video: z.boolean().optional(),
    vote_average: z.number().optional(),
    vote_count: z.int().optional(),
  }),
  tv: z.object({
    adult: z.boolean().optional(),
    backdrop_path: z.string().nullish(),
    id: z.int(),
    name: z.string().optional(),
    original_language: z.string().optional(),
    original_name: z.string().optional(),
    overview: z.string().nullish(),
    poster_path: z.string().nullish(),
    genre_ids: z.array(z.int()).optional(),
    popularity: z.number().optional(),
    first_air_date: z.string().nullish(),
    vote_average: z.number().optional(),
    vote_count: z.int().optional(),
    origin_country: z.array(z.string()).optional(),
  }),
}

const TMDBApiSchema = {
  3: {
    authentication: {
      response: z.object({
        success: z.literal(true),
      }),
    },
    search: {
      movie: {
        response: z.object({
          page: z.int(),
          results: z.array(TMDBApiSchemaSearch.movie),
          total_pages: z.int(),
          total_results: z.int(),
        }),
      },
      multi: {
        response: z.object({
          page: z.int(),
          results: z.array(
            z.discriminatedUnion('media_type', [
              TMDBApiSchemaSearch.movie.safeExtend({
                media_type: z.literal('movie'),
              }),
              TMDBApiSchemaSearch.tv.safeExtend({
                media_type: z.literal('tv'),
              }),
            ]),
          ),
          total_pages: z.int(),
          total_results: z.int(),
        }),
      },
      tv: {
        response: z.object({
          page: z.int(),
          results: z.array(TMDBApiSchemaSearch.tv),
          total_pages: z.int(),
          total_results: z.int(),
        }),
      },
    },
    movie: {
      '{movie_id}': {
        response: z.object({
          adult: z.boolean().optional(),
          backdrop_path: z.string().nullish(),
          belongs_to_collection: z
            .object({
              id: z.int(),
              name: z.string(),
              poster_path: z.string().nullish(),
              backdrop_path: z.string().nullish(),
            })
            .nullable()
            .optional(),
          budget: z.int().optional(),
          genres: z
            .array(
              z.object({
                id: z.int(),
                name: z.string(),
              }),
            )
            .optional(),
          homepage: z.string().nullish(),
          id: z.int(),
          imdb_id: z.string().nullish(),
          original_language: z.string().optional(),
          original_title: z.string().optional(),
          overview: z.string().nullish(),
          popularity: z.number().optional(),
          poster_path: z.string().nullish(),
          production_companies: z
            .array(
              z.object({
                id: z.int(),
                logo_path: z.string().nullish(),
                name: z.string(),
                origin_country: z.string().nullish(),
              }),
            )
            .optional(),
          production_countries: z
            .array(
              z.object({
                iso_3166_1: z.string(),
                name: z.string(),
              }),
            )
            .optional(),
          release_date: z.string().nullish(),
          revenue: z.int().optional(),
          runtime: z.int().nullish(),
          spoken_languages: z
            .array(
              z.object({
                english_name: z.string().optional(),
                iso_639_1: z.string(),
                name: z.string(),
              }),
            )
            .optional(),
          status: z.string().optional(),
          tagline: z.string().nullish(),
          title: z.string().optional(),
          video: z.boolean().optional(),
          vote_average: z.number(),
          vote_count: z.int(),
        }),
      },
    },
    tv: {
      '{series_id}': {
        season: {
          '{season_number}': {
            episode: {
              '{episode_number}': {
                response: z.object({
                  air_date: z.string().nullish(),
                  crew: z
                    .array(
                      z.object({
                        department: z.string(),
                        job: z.string(),
                        credit_id: z.string(),
                        adult: z.boolean(),
                        gender: z.int(),
                        id: z.int(),
                        known_for_department: z.string(),
                        name: z.string(),
                        original_name: z.string(),
                        popularity: z.number(),
                        profile_path: z.string().nullish(),
                      }),
                    )
                    .optional(),
                  episode_number: z.int(),
                  guest_stars: z
                    .array(
                      z.object({
                        character: z.string(),
                        credit_id: z.string(),
                        order: z.int(),
                        adult: z.boolean(),
                        gender: z.int(),
                        id: z.int(),
                        known_for_department: z.string(),
                        name: z.string(),
                        original_name: z.string(),
                        popularity: z.number(),
                        profile_path: z.string().nullish(),
                      }),
                    )
                    .optional(),
                  name: z.string(),
                  overview: z.string(),
                  id: z.int(),
                  production_code: z.string().nullish(),
                  runtime: z.int().nullish(),
                  season_number: z.int(),
                  still_path: z.string().nullish(),
                  vote_average: z.number(),
                  vote_count: z.int(),
                }),
              },
            },
            response: z.object({
              _id: z.string(),
              air_date: z.string().nullish(),
              episodes: z
                .array(
                  z.object({
                    air_date: z.string().nullish(),
                    episode_number: z.int(),
                    episode_type: z.string().nullish(),
                    id: z.int(),
                    name: z.string(),
                    overview: z.string(),
                    production_code: z.string().nullish(),
                    runtime: z.int().nullish(),
                    season_number: z.int(),
                    show_id: z.int(),
                    still_path: z.string().nullish(),
                    vote_average: z.number(),
                    vote_count: z.int(),
                    crew: z
                      .array(
                        z.object({
                          department: z.string(),
                          job: z.string(),
                          credit_id: z.string(),
                          adult: z.boolean(),
                          gender: z.int(),
                          id: z.int(),
                          known_for_department: z.string(),
                          name: z.string(),
                          original_name: z.string(),
                          popularity: z.number(),
                          profile_path: z.string().nullish(),
                        }),
                      )
                      .optional(),
                    guest_stars: z
                      .array(
                        z.object({
                          character: z.string(),
                          credit_id: z.string(),
                          order: z.int(),
                          adult: z.boolean(),
                          gender: z.int(),
                          id: z.int(),
                          known_for_department: z.string(),
                          name: z.string(),
                          original_name: z.string(),
                          popularity: z.number(),
                          profile_path: z.string().nullish(),
                        }),
                      )
                      .optional(),
                  }),
                )
                .optional(),
              name: z.string(),
              networks: z
                .array(
                  z.object({
                    id: z.int(),
                    logo_path: z.string().nullish(),
                    name: z.string(),
                    origin_country: z.string(),
                  }),
                )
                .optional(),
              overview: z.string().nullish(),
              id: z.int(),
              poster_path: z.string().nullish(),
              season_number: z.int(),
              vote_average: z.number(),
            }),
          },
        },
        response: z.object({
          adult: z.boolean().optional(),
          backdrop_path: z.string().nullish(),
          created_by: z
            .array(
              z.object({
                id: z.int(),
                credit_id: z.string().optional(),
                name: z.string(),
                gender: z.int().optional(),
                profile_path: z.string().nullish(),
              }),
            )
            .optional(),
          episode_run_time: z.array(z.int()).optional(),
          first_air_date: z.string().nullish(),
          genres: z
            .array(
              z.object({
                id: z.int(),
                name: z.string(),
              }),
            )
            .optional(),
          homepage: z.string().nullish(),
          id: z.int(),
          in_production: z.boolean().optional(),
          languages: z.array(z.string()).optional(),
          last_air_date: z.string().nullish(),
          last_episode_to_air: z
            .object({
              air_date: z.string().nullish(),
              episode_number: z.int(),
              id: z.int(),
              name: z.string(),
              overview: z.string(),
              production_code: z.string().nullish(),
              runtime: z.int().nullish(),
              season_number: z.int(),
              show_id: z.int().optional(),
              still_path: z.string().nullish(),
              vote_average: z.number(),
              vote_count: z.int(),
            })
            .nullable()
            .optional(),
          name: z.string(),
          next_episode_to_air: z
            .object({
              air_date: z.string().nullish(),
              episode_number: z.int(),
              id: z.int(),
              name: z.string(),
              overview: z.string(),
              production_code: z.string().nullish(),
              runtime: z.int().nullish(),
              season_number: z.int(),
              show_id: z.int().optional(),
              still_path: z.string().nullish(),
              vote_average: z.number(),
              vote_count: z.int(),
            })
            .nullable()
            .optional(),
          networks: z
            .array(
              z.object({
                id: z.int(),
                logo_path: z.string().nullish(),
                name: z.string(),
                origin_country: z.string(),
              }),
            )
            .optional(),
          number_of_episodes: z.int().optional(),
          number_of_seasons: z.int().optional(),
          origin_country: z.array(z.string()).optional(),
          original_language: z.string().optional(),
          original_name: z.string().optional(),
          overview: z.string().nullish(),
          popularity: z.number().optional(),
          poster_path: z.string().nullish(),
          production_companies: z
            .array(
              z.object({
                id: z.int(),
                logo_path: z.string().nullish(),
                name: z.string(),
                origin_country: z.string().nullish(),
              }),
            )
            .optional(),
          production_countries: z
            .array(
              z.object({
                iso_3166_1: z.string(),
                name: z.string(),
              }),
            )
            .optional(),
          seasons: z
            .array(
              z.object({
                air_date: z.string().nullish(),
                episode_count: z.int().optional(),
                id: z.int(),
                name: z.string(),
                overview: z.string().nullish(),
                poster_path: z.string().nullish(),
                season_number: z.int(),
                vote_average: z.number().optional(),
              }),
            )
            .optional(),
          spoken_languages: z
            .array(
              z.object({
                english_name: z.string().optional(),
                iso_639_1: z.string(),
                name: z.string(),
              }),
            )
            .optional(),
          status: z.string().optional(),
          tagline: z.string().nullish(),
          type: z.string().optional(),
          vote_average: z.number(),
          vote_count: z.int(),
        }),
      },
    },
  },
}

export class TMDB {
  public api_url = new URL('https://api.tmdb.org')
  public api_key = env.VITE_TMDB_API_KEY
  toJSON() {
    return {
      api_url: this.api_url.toString(),
      api_key: this.api_key,
    }
  }
  static async init(
    /**
     * 传入数据创建临时实例(overlay)
     */
    data?: z.infer<typeof TMDBConfigSchema>,
  ) {
    const tmdb = new TMDB()
    if (data) data = TMDBConfigSchema.parse(data)
    const storage = useStorage('tmdb')
    const url = await storage.get<string>('api_url')
    const key = await storage.get<string>('api_key')
    if (url) tmdb.api_url = new URL(url)
    if (key) tmdb.api_key = key
    if (data?.api_url) tmdb.api_url = new URL(data.api_url)
    if (data?.api_key) tmdb.api_key = data.api_key
    return tmdb
  }
  static async setConfig(data: z.infer<typeof TMDBConfigSchema>) {
    data = TMDBConfigSchema.parse(data)
    const storage = useStorage('tmdb')
    // 设置null重置为默认值
    if (data.api_url !== undefined) await storage.set('api_url', data.api_url)
    if (data.api_key !== undefined) await storage.set('api_key', data.api_key)
    return TMDB.init()
  }
  kyInstance() {
    const hds = headers.get('app')
    return ky.create({
      searchParams: {
        api_key:
          this.api_key === 'proxy'
            ? undefined
            : (this.api_key ?? import.meta.env.VITE_TMDB_API_KEY),
        language: 'zh-CN',
        include_image_language: 'zh,null',
      },
      headers: hds,
      prefix: this.api_url,
    })
  }
  /**
   * 检查api配置
   * 若配置正确，则会返回true，否则会抛出异常
   */
  async check() {
    const res = await this.kyInstance()
      .get('3/authentication')
      .json()
      .then((r) => TMDBApiSchema[3].authentication.response.parse(r))
      .then((r) => r.success)
    return res
  }
  private check_input_of_getTVEpisodeInfo(i: string) {
    const c = parseTMDBUrlC(i)
    if (c?.episode_number !== undefined) return c
    else
      throw new HTTPError('Invalid input for getTVEpisodeInfo', {
        statusCode: 400,
      })
  }
  async getTVEpisodeInfo(
    input: string | ReturnType<typeof this.check_input_of_getTVEpisodeInfo>,
  ) {
    const id =
      typeof input === 'string'
        ? this.check_input_of_getTVEpisodeInfo(input)
        : input
    const res = await this.kyInstance()
      .get(
        `3/tv/${id.series_id}/season/${id.season_number}/episode/${id.episode_number}`,
      )
      .json()
      .then((r) =>
        TMDBApiSchema[3].tv['{series_id}'].season['{season_number}'].episode[
          '{episode_number}'
        ].response.parse(r),
      )
    return {
      tv: {
        episode: res,
      },
    }
  }
  private check_input_of_getMovieInfo(i: string) {
    const c = parseTMDBUrlC(i)
    if (c?.movie_id !== undefined) return c
    else
      throw new HTTPError('Invalid input for getMovieInfo', {
        statusCode: 400,
      })
  }
  async getMovieInfo(
    input: string | ReturnType<typeof this.check_input_of_getMovieInfo>,
  ) {
    const id =
      typeof input === 'string'
        ? this.check_input_of_getMovieInfo(input)
        : input
    const res = await this.kyInstance()
      .get(`3/movie/${id.movie_id}`)
      .json()
      .then((r) => TMDBApiSchema[3].movie['{movie_id}'].response.parse(r))
    return {
      movie: res,
    }
  }
  private check_input_of_getTVSeasonInfo(i: string) {
    const c = parseTMDBUrlC(i)
    if (c?.season_number !== undefined) return c
    else
      throw new HTTPError('Invalid input for getTVSeasonInfo', {
        statusCode: 400,
      })
  }
  async getTVSeasonInfo(
    input: string | ReturnType<typeof this.check_input_of_getTVSeasonInfo>,
  ) {
    const id =
      typeof input === 'string'
        ? this.check_input_of_getTVSeasonInfo(input)
        : input
    const res = await this.kyInstance()
      .get(`3/tv/${id.series_id}/season/${id.season_number}`)
      .json()
      .then((r) =>
        TMDBApiSchema[3].tv['{series_id}'].season[
          '{season_number}'
        ].response.parse(r),
      )
    return {
      tv: {
        season: res,
      },
    }
  }
  private check_input_of_getTVSeriesInfo(i: string) {
    const c = parseTMDBUrlC(i)
    if (c?.series_id !== undefined) return c
    else
      throw new HTTPError('Invalid input for getTVSeriesInfo', {
        statusCode: 400,
      })
  }
  async getTVSeriesInfo(
    input: string | ReturnType<typeof this.check_input_of_getTVSeriesInfo>,
  ) {
    const id =
      typeof input === 'string'
        ? this.check_input_of_getTVSeriesInfo(input)
        : input
    const res = await this.kyInstance()
      .get(`3/tv/${id.series_id}`)
      .json()
      .then((r) => TMDBApiSchema[3].tv['{series_id}'].response.parse(r))
    return {
      tv: {
        series: res,
      },
    }
  }
  async searchMovie(
    query: string,
    page = 1,
  ): Promise<{
    search: {
      movie: z.infer<(typeof TMDBApiSchema)[3]['search']['movie']['response']>
    }
  }> {
    const res = await this.kyInstance()
      .get('3/search/movie', {
        searchParams: { query, include_adult: true, page },
      })
      .json()
      .then((r) => TMDBApiSchema[3].search.movie.response.parse(r))
    return {
      search: {
        movie: res,
      },
    }
  }
  async searchTV(
    query: string,
    page = 1,
  ): Promise<{
    search: {
      tv: z.infer<(typeof TMDBApiSchema)[3]['search']['tv']['response']>
    }
  }> {
    const res = await this.kyInstance()
      .get('3/search/tv', {
        searchParams: { query, include_adult: true, page },
      })
      .json()
      .then((r) => TMDBApiSchema[3].search.tv.response.parse(r))
    return {
      search: {
        tv: res,
      },
    }
  }
  async searchMulti(
    query: string,
    page = 1,
  ): Promise<{
    search: {
      multi: z.infer<(typeof TMDBApiSchema)[3]['search']['multi']['response']>
    }
  }> {
    const res = await this.kyInstance()
      .get('3/search/multi', {
        searchParams: { query, include_adult: true, page },
      })
      .json()
      .then((r: any) => ({
        ...r,
        results: r.results.filter(
          (ri: any) => ri.media_type === 'movie' || ri.media_type === 'tv',
        ),
      }))
      .then((r) => TMDBApiSchema[3].search.multi.response.parse(r))
    return {
      search: {
        multi: res,
      },
    }
  }
}
