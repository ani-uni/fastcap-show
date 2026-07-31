import FastCap, { FastCapUtils } from '@ani-uni/fastcap'

export type FastCapJson = {
  f: Array<FastCapResource>
}

export type FastCapResource = {
  i: 'bili_cid'
  id: string
  p: Array<FastCapClipTuple>
  t: Record<string, FastCapEpisodeRef>
}

export type FastCapClipTuple = [
  videoBegin: number,
  videoEnd: number,
  offset: number,
  tempEpId: number,
]

export type FastCapEpisodeRef = {
  bgmtv_epid?: string
  tmdb_urlc?: string
}

export type FastCapParseFormat = 'json' | 'toml' | 'yue'

export type FastCapParseResult = {
  format: FastCapParseFormat
  json: FastCapJson
  toml: string
  yue: string
  episodeRows: Array<FastCapEpisodeRow>
  indexRows: Array<FastCapIndexRow>
  stats: {
    resources: number
    episodes: number
    clips: number
  }
}

export type FastCapEpisodeRow = {
  key: string
  fIndex: number
  resourceIndex: number
  indexType: string
  resourceId: string
  tempEpId: number
  refs: FastCapEpisodeRef
  clips: Array<FastCapClipRow>
}

export type FastCapIndexRow = FastCapClipRow & {
  rowKey: string
}

export type FastCapClipRow = {
  fIndex: number
  resourceIndex: number
  clipIndex: number
  indexType: string
  resourceId: string
  tempEpId: number
  episodeKey: string
  refs: FastCapEpisodeRef
  videoBegin: number
  videoEnd: number
  offset: number
  realBegin: number
  realEnd: number
  duration: number
}

export function parseFastCapInput(input: string): FastCapParseResult {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('请输入 fastcap 配置')

  const parsed = createFastCap(trimmed)
  return buildFastCapResult(parsed.fc, parsed.format)
}

export function parseFastCapJson(json: FastCapJson): FastCapParseResult {
  return buildFastCapResult(new FastCap(json), 'json')
}

export function cloneFastCapJson(json: FastCapJson): FastCapJson {
  return structuredClone(json)
}

export function parseProgressTimestamp(input: string) {
  return FastCapUtils.zProgressTimestampCodec.decode(input)
}

export function isProgressTimestamp(input: string) {
  const re = new RegExp(`^${FastCapUtils.reProgressTimestampSource}$`)
  return re.test(input)
}

export function formatMilliseconds(value: number): string {
  if (value < 0) return `-${formatMilliseconds(Math.abs(value))}`
  return FastCapUtils.zProgressTimestampCodec.encode(value)
}

function buildFastCapResult(
  fc: FastCap,
  format: FastCapParseFormat,
): FastCapParseResult {
  // Normalize once at the input boundary so all views and exports share the same episode IDs.
  fc.fmt()
  const json = fc.toJSON() as FastCapJson
  const episodeRows = buildEpisodeRows(json)
  const indexRows = buildIndexRows(episodeRows)

  return {
    format,
    json,
    toml: fc.toString('toml'),
    yue: fc.toString('yue'),
    episodeRows,
    indexRows,
    stats: {
      resources: json.f.length,
      episodes: episodeRows.length,
      clips: indexRows.length,
    },
  }
}

function createFastCap(input: string) {
  if (looksLikeJson(input)) {
    return {
      format: 'json' as const,
      fc: new FastCap(JSON.parse(input)),
    }
  }

  if (input.includes('本资源FastCap配置如下')) {
    return {
      format: 'yue' as const,
      fc: new FastCap(input),
    }
  }

  if (input.includes('fastcap')) {
    return {
      format: 'toml' as const,
      fc: new FastCap(input),
    }
  }

  if (looksLikeRawToml(input)) {
    return {
      format: 'toml' as const,
      fc: new FastCap(wrapToml(input)),
    }
  }

  throw new Error('无法识别输入格式，请粘贴 TOML、Yue 或 JSON fastcap 配置')
}

function buildEpisodeRows(json: FastCapJson) {
  return json.f
    .flatMap((resource, fIndex) =>
      Object.entries(resource.t).map(([tempEpId, refs]) => {
        const numericTempEpId = Number.parseInt(tempEpId, 10)
        const key = getEpisodeKey(fIndex, numericTempEpId)
        const clips = resource.p
          .map((clip, clipIndex) =>
            buildClipRow(resource, fIndex, clip, clipIndex),
          )
          .filter((clip) => clip.tempEpId === numericTempEpId)
          .sort((left, right) => left.offset - right.offset)

        return {
          key,
          fIndex,
          resourceIndex: fIndex + 1,
          indexType: resource.i,
          resourceId: resource.id,
          tempEpId: numericTempEpId,
          refs,
          clips,
        }
      }),
    )
    .sort(
      (left, right) =>
        left.tempEpId - right.tempEpId || left.fIndex - right.fIndex,
    )
}

function buildIndexRows(episodeRows: Array<FastCapEpisodeRow>) {
  return episodeRows
    .flatMap((episode) => episode.clips)
    .sort(
      (left, right) =>
        left.fIndex - right.fIndex || left.clipIndex - right.clipIndex,
    )
    .map((clip) => ({
      ...clip,
      rowKey: `${clip.fIndex}:${clip.clipIndex}`,
    }))
}

function buildClipRow(
  resource: FastCapResource,
  fIndex: number,
  clip: FastCapClipTuple,
  clipIndex: number,
): FastCapClipRow {
  const [videoBegin, videoEnd, offset, tempEpId] = clip
  const refs = resource.t[String(tempEpId)] ?? {}
  const duration = videoEnd - videoBegin

  return {
    fIndex,
    resourceIndex: fIndex + 1,
    clipIndex,
    indexType: resource.i,
    resourceId: resource.id,
    tempEpId,
    episodeKey: getEpisodeKey(fIndex, tempEpId),
    refs,
    videoBegin,
    videoEnd,
    offset,
    realBegin: offset,
    realEnd: offset + duration,
    duration,
  }
}

function getEpisodeKey(fIndex: number, tempEpId: number) {
  return `${fIndex}:${tempEpId}`
}

function looksLikeJson(input: string) {
  return input.startsWith('{')
}

function looksLikeRawToml(input: string) {
  return input.includes('[[f]]') || input.includes('[f.t.')
}

function wrapToml(input: string) {
  return `\`\`\`fastcap\n${input}\n\`\`\``
}
