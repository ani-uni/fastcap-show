import type {
  FastCapClipTuple,
  FastCapEpisodeRef,
  FastCapJson,
} from '~/shared/fastcap/model'

export const TIMELINE_SNAP_MS = 100
export const MIN_CLIP_DURATION_MS = 100

export type TimelineSelection = {
  cid: string
  resourceIndex?: number
  clipIndex: number
}

export type TimelineMapping = TimelineSelection & {
  resourceIndex: number
  tempEpId: number
  begin: number
  end: number
  duration: number
}

export function snapMilliseconds(value: number, step = TIMELINE_SNAP_MS) {
  return Math.round(value / step) * step
}

export function millisecondsToPixels(
  milliseconds: number,
  duration: number,
  width: number,
) {
  return duration > 0 ? (milliseconds / duration) * width : 0
}

export function pixelsToMilliseconds(
  pixels: number,
  duration: number,
  width: number,
) {
  return width > 0 ? (pixels / width) * duration : 0
}

export function createRange(anchor: number, pointer: number, duration: number) {
  const begin = snapMilliseconds(Math.max(0, Math.min(anchor, pointer)))
  const end = snapMilliseconds(Math.min(duration, Math.max(anchor, pointer)))
  return end - begin >= MIN_CLIP_DURATION_MS ? { begin, end } : undefined
}

export function moveRange(
  begin: number,
  end: number,
  delta: number,
  duration: number,
) {
  const length = end - begin
  const nextBegin = Math.max(
    0,
    Math.min(snapMilliseconds(begin + delta), duration - length),
  )
  return { begin: nextBegin, end: nextBegin + length }
}

export function resizeRange(
  begin: number,
  end: number,
  edge: 'left' | 'right',
  delta: number,
  duration: number,
) {
  if (edge === 'left') {
    return {
      begin: Math.max(
        0,
        Math.min(snapMilliseconds(begin + delta), end - MIN_CLIP_DURATION_MS),
      ),
      end,
    }
  }
  return {
    begin,
    end: Math.min(
      duration,
      Math.max(snapMilliseconds(end + delta), begin + MIN_CLIP_DURATION_MS),
    ),
  }
}

export function createTimelineTicks(duration: number, targetCount = 8) {
  if (duration <= 0) return [0]
  const rawStep = duration / Math.max(1, targetCount)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const step = factor * magnitude
  const ticks: Array<number> = []
  for (let value = 0; value < duration; value += step) ticks.push(value)
  ticks.push(duration)
  return ticks
}

export function assignTimelineLanes<T extends { begin: number; end: number }>(
  items: Array<T>,
) {
  const laneEnds: Array<number> = []
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        left.item.begin - right.item.begin ||
        left.item.end - right.item.end ||
        left.index - right.index,
    )
    .map(({ item, index }) => {
      let lane = laneEnds.findIndex((end) => end <= item.begin)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = item.end
      return { item, index, lane }
    })
}

export function collectEpisodeMappings(
  draft: FastCapJson,
  selected: TimelineSelection,
) {
  const selectedResource = draft.f.find((resource, resourceIndex) =>
    selected.resourceIndex === undefined
      ? resource.id === selected.cid
      : resourceIndex === selected.resourceIndex,
  )
  const selectedClip = selectedResource?.p.find(
    (_clip, clipIndex) => clipIndex === selected.clipIndex,
  )
  if (!selectedResource || !selectedClip) return []
  const selectedResourceIndex = draft.f.indexOf(selectedResource)

  const episodeNodes = draft.f.flatMap((resource, resourceIndex) =>
    Object.entries(resource.t).map(([tempEpId, refs]) => ({
      resourceIndex,
      tempEpId: Number.parseInt(tempEpId, 10),
      refs,
    })),
  )
  const selectedNode = episodeNodes.find(
    (node) =>
      node.resourceIndex === selectedResourceIndex &&
      node.tempEpId === selectedClip[3],
  )
  if (!selectedNode) return []

  const group = new Set([selectedNode])
  if (hasEpisodeRef(selectedNode.refs)) {
    let changed = true
    while (changed) {
      changed = false
      for (const node of episodeNodes) {
        if (group.has(node) || !hasEpisodeRef(node.refs)) continue
        if (
          [...group].some((member) => sameEpisodeRef(member.refs, node.refs))
        ) {
          group.add(node)
          changed = true
        }
      }
    }
  }

  return [...group].flatMap((node) => {
    const resource = draft.f[node.resourceIndex]
    return resource.p.flatMap((clip, clipIndex) => {
      if (clip[3] !== node.tempEpId) return []
      const duration = clipDuration(clip)
      return [
        {
          cid: resource.id,
          resourceIndex: node.resourceIndex,
          clipIndex,
          tempEpId: node.tempEpId,
          begin: clip[2],
          end: clip[2] + duration,
          duration,
        } satisfies TimelineMapping,
      ]
    })
  })
}

export function getEpisodeTimelineDuration(
  mappings: Array<{ end: number }>,
  metadataDuration?: number,
) {
  const furthestEnd = mappings.reduce(
    (max, mapping) => Math.max(max, mapping.end),
    0,
  )
  if (metadataDuration && metadataDuration > 0) {
    return Math.max(metadataDuration, furthestEnd)
  }
  const padding = Math.max(60_000, furthestEnd * 0.2)
  return niceTimelineCeiling(Math.max(300_000, furthestEnd + padding))
}

export function expandEpisodeTimelineDuration(
  current: number,
  proposedEnd: number,
) {
  if (proposedEnd < current * 0.9) return current
  return niceTimelineCeiling(Math.max(proposedEnd * 1.1, current * 1.5))
}

export function clipDuration(clip: FastCapClipTuple) {
  return clip[1] - clip[0]
}

function hasEpisodeRef(refs: FastCapEpisodeRef) {
  return Boolean(refs.bgmtv_epid || refs.tmdb_urlc)
}

function sameEpisodeRef(left: FastCapEpisodeRef, right: FastCapEpisodeRef) {
  return Boolean(
    (left.bgmtv_epid && left.bgmtv_epid === right.bgmtv_epid) ||
    (left.tmdb_urlc && left.tmdb_urlc === right.tmdb_urlc),
  )
}

function niceTimelineCeiling(value: number) {
  if (value <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}
