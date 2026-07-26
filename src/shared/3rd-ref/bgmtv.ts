import ky from 'ky'
import z from 'zod'

import { headers } from '../headers'

const BgmTvApiModelSchema = {
  Paged: z.object({
    total: z.int(),
    limit: z.int(),
    offset: z.int(),
    data: z.array(z.any()),
  }),
  Subject: z.object({
    id: z.int(),
    type: z.int(),
    name: z.string(),
    name_cn: z.string(),
    summary: z.string(),
    series: z.boolean(),
    nsfw: z.boolean(),
    locked: z.boolean(),
    date: z.string().nullish(),
    platform: z.string(),
    images: z.object({
      large: z.string(),
      common: z.string(),
      medium: z.string(),
      small: z.string(),
      grid: z.string(),
    }),
    infobox: z
      .array(
        z.record(
          z.string(),
          z.union([z.string(), z.array(z.object({ v: z.string() }))]),
        ),
      )
      .nullish(),
    volumes: z.int(),
    eps: z.int(),
    total_episodes: z.int(),
    rating: z.object({
      rank: z.int(),
      total: z.int(),
      count: z.record(z.string(), z.int()),
      score: z.number(),
    }),
    collection: z.object({
      wish: z.int(),
      collect: z.int(),
      doing: z.int(),
      on_hold: z.int(),
      dropped: z.int(),
    }),
    meta_tags: z.array(z.string()),
    tags: z.array(z.object({ name: z.string(), count: z.int() })),
  }),
  Episode: z.object({
    id: z.int(),
    type: z.int().gte(0).lte(6),
    name: z.string(),
    name_cn: z.string(),
    sort: z.number(),
    ep: z.number().nullish(),
    airdate: z.string(),
    comment: z.int(),
    duration: z.string(),
    desc: z.string(),
    disc: z.int(),
    subject_id: z.int(),
  }),
  EpisodeDetail: z.object({
    id: z.int(),
    type: z.int().gte(0).lte(6),
    name: z.string(),
    name_cn: z.string(),
    sort: z.number(),
    ep: z.number().nullish(),
    airdate: z.string(),
    comment: z.int(),
    duration: z.string(),
    desc: z.string(),
    disc: z.int(),
    duration_seconds: z.int().nullish(),
  }),
}
// 除get外的请求使用尖括号包裹请求方法
const BgmTvApiSchema = {
  v0: {
    search: {
      subjects: {
        '<post>': {
          request: {
            body: z.object({
              keyword: z.string(),
              sort: z.enum(['match', 'heat', 'rank', 'score']).optional(),
              filter: z.object({
                type: z.array(z.int()).optional(),
                meta_tags: z.array(z.string()).optional(),
                tag: z.array(z.string()).optional(),
                airdate: z.array(z.string()).optional(),
                rating: z.array(z.string()).optional(),
                rating_count: z.array(z.string()).optional(),
                rank: z.array(z.string()).optional(),
                nsfw: z.boolean().nullish(),
              }),
            }),
          },
          response: BgmTvApiModelSchema.Paged.extend({
            data: z.array(BgmTvApiModelSchema.Subject),
          }),
        },
      },
    },
    subjects: {
      '{subject_id}': {
        response: BgmTvApiModelSchema.Subject,
      },
    },
    episodes: {
      '{episode_id}': {
        response: BgmTvApiModelSchema.Episode,
      },
      request: {
        query: z.object({
          subject_id: z.int(),
          type: z.int().gte(0).lte(6).optional(),
          limit: z.int().optional(),
          offset: z.int().optional(),
        }),
      },
      response: BgmTvApiModelSchema.Paged.extend({
        data: z.array(BgmTvApiModelSchema.EpisodeDetail),
      }),
    },
  },
}

export class BgmTv {
  public api_url = new URL('https://api.bgm.tv')
  kyInstance() {
    const hds = headers.get('app')
    hds.set('Accept', 'application/json')
    return ky.create({
      headers: hds,
      prefix: this.api_url,
    })
  }
  async getEpisodeInfo(episode_id: number) {
    const res = await this.kyInstance()
      .get(`v0/episodes/${episode_id}`)
      .json()
      .then((r) => BgmTvApiSchema.v0.episodes['{episode_id}'].response.parse(r))
    return {
      v0: {
        episodes: {
          '{episode_id}': res,
        },
      },
    }
  }
  async getSubjectInfo(subject_id: number) {
    const res = await this.kyInstance()
      .get(`v0/subjects/${subject_id}`)
      .json()
      .then((r) => BgmTvApiSchema.v0.subjects['{subject_id}'].response.parse(r))
    return {
      v0: {
        subjects: {
          '{subject_id}': res,
        },
      },
    }
  }
  async listEpisodes(subject_id: number) {
    const res = await this.kyInstance()
      .get('v0/episodes', {
        searchParams: BgmTvApiSchema.v0.episodes.request.query.parse({
          subject_id,
        }),
      })
      .json()
      .then((r) => BgmTvApiSchema.v0.episodes.response.parse(r))
    return {
      v0: {
        episodes: res,
      },
    }
  }
  async searchSubjects(keyword: string) {
    const res = await this.kyInstance()
      .post('v0/search/subjects', {
        json: BgmTvApiSchema.v0.search.subjects['<post>'].request.body.parse({
          keyword,
          filter: { type: [2] },
        }),
      })
      .json()
      .then((r) =>
        BgmTvApiSchema.v0.search.subjects['<post>'].response.parse(r),
      )
    return {
      v0: {
        search: {
          subjects: {
            '<post>': res,
          },
        },
      },
    }
  }
}
