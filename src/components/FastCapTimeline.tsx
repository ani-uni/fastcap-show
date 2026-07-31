import interact from 'interactjs'
import { getHotkeyManager } from '@tanstack/hotkeys'
import type { HotkeyRegistrationHandle } from '@tanstack/hotkeys'
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import type { JSX } from 'solid-js'

import {
  MIN_CLIP_DURATION_MS,
  TIMELINE_SNAP_MS,
  assignTimelineLanes,
  collectEpisodeMappings,
  createRange,
  createTimelineTicks,
  expandEpisodeTimelineDuration,
  getEpisodeTimelineDuration,
  moveRange,
  pixelsToMilliseconds,
  resizeRange,
  snapMilliseconds,
} from '~/lib/clip-timeline'
import type { TimelineMapping, TimelineSelection } from '~/lib/clip-timeline'
import type { EditorContext } from '~/lib/fastcap-sync'
import {
  cloneFastCapJson,
  formatMilliseconds,
  parseProgressTimestamp,
} from '~/shared/fastcap/model'
import type {
  FastCapClipTuple,
  FastCapJson,
  FastCapResource,
} from '~/shared/fastcap/model'
import type { FastCapEpisodeMetadata } from '~/shared/fastcap/metadata.functions'

type Props = {
  draft: FastCapJson
  context?: EditorContext
  metadata?: Record<string, FastCapEpisodeMetadata>
  syncConnected: boolean
  requestPlayerTime?: (cid: string) => Promise<number>
  onChange: (draft: FastCapJson) => void
  onError: (message?: string) => void
  renderEpisodeEditor: (resourceIndex: number) => JSX.Element
}

type PreviewRange = { begin: number; end: number }
type TimelinePage = EditorContext['pages'][number] & {
  resourceIndex: number
  estimatedDuration: boolean
}

const TRACK_LEFT_PX = 190
const TRACK_MIN_WIDTH_PX = 760
const LANE_HEIGHT_PX = 34

export function FastCapTimeline(props: Props) {
  const [selection, setSelection] = createSignal<TimelineSelection>()
  const [armedTrackKey, setArmedTrackKey] = createSignal<string>()
  const [episodeDuration, setEpisodeDuration] = createSignal(300_000)
  let deleteHotkey: HotkeyRegistrationHandle | undefined
  let episodeIdentity = ''

  const pages = createMemo<Array<TimelinePage>>(() => {
    if (props.context?.pages.length) {
      return [...props.context.pages]
        .sort((left, right) => left.page - right.page)
        .map((page) => {
          const resourceIndex = props.draft.f.findIndex(
            (resource) => resource.id === page.cid,
          )
          const duration = page.durationMilliseconds
          return {
            ...page,
            resourceIndex,
            durationMilliseconds:
              duration && duration > 0
                ? duration
                : estimateVideoDuration(props.draft.f[resourceIndex]),
            estimatedDuration: !(duration && duration > 0),
          }
        })
    }
    return props.draft.f.map((resource, resourceIndex) => ({
      cid: resource.id,
      page: resourceIndex + 1,
      title: resource.id ? `资源 ${resource.id}` : `资源 ${resourceIndex + 1}`,
      durationMilliseconds: estimateVideoDuration(resource),
      resourceIndex,
      estimatedDuration: true,
    }))
  })
  const videoDuration = createMemo(() =>
    Math.max(...pages().map((page) => page.durationMilliseconds ?? 0), 0),
  )
  const selectedData = createMemo(() => {
    const current = selection()
    if (!current) return undefined
    const resource = props.draft.f.find((item, resourceIndex) =>
      current.resourceIndex === undefined
        ? item.id === current.cid
        : resourceIndex === current.resourceIndex,
    )
    const clip = resource?.p.find(
      (_item, clipIndex) => clipIndex === current.clipIndex,
    )
    if (!resource || !clip) return undefined
    const resourceIndex = props.draft.f.indexOf(resource)
    return { ...current, resourceIndex, resource, clip }
  })
  const episodeMappings = createMemo(() => {
    const current = selection()
    return current ? collectEpisodeMappings(props.draft, current) : []
  })
  const selectedMetadata = createMemo(() => {
    const data = selectedData()
    if (!data) return undefined
    return props.metadata?.[`${data.resourceIndex}:${data.clip[3]}`]
  })

  createEffect(() => {
    const data = selectedData()
    if (!data) {
      setSelection()
      return
    }
    const nextIdentity = `${data.resourceIndex}:${data.clip[3]}`
    const baseDuration = getEpisodeTimelineDuration(
      episodeMappings(),
      selectedMetadata()?.durationMilliseconds,
    )
    setEpisodeDuration((current) =>
      episodeIdentity === nextIdentity
        ? Math.max(current, baseDuration)
        : baseDuration,
    )
    episodeIdentity = nextIdentity
  })

  onMount(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setArmedTrackKey()
    }
    window.addEventListener('keydown', cancel)
    deleteHotkey = getHotkeyManager().register(
      'Delete',
      () => {
        const data = selectedData()
        if (!data) return
        if (
          window.confirm(
            `确定删除 CID ${data.cid || '未填写'} 的 Clip ${data.clipIndex} 吗？`,
          )
        ) {
          deleteSelected()
        }
      },
      {
        enabled: Boolean(selection()),
        ignoreInputs: true,
        conflictBehavior: 'replace',
        meta: { name: '删除选中的 FastCap clip' },
      },
    )
    onCleanup(() => window.removeEventListener('keydown', cancel))
  })

  createEffect(() => {
    deleteHotkey?.setOptions({ enabled: Boolean(selection()) })
  })

  onCleanup(() => deleteHotkey?.unregister())

  const updateClip = (
    target: TimelineSelection,
    updater: (clip: FastCapClipTuple) => FastCapClipTuple,
  ) => {
    const next = cloneFastCapJson(props.draft)
    const resource = next.f.find((item, resourceIndex) =>
      target.resourceIndex === undefined
        ? item.id === target.cid
        : resourceIndex === target.resourceIndex,
    )
    const clip = resource?.p[target.clipIndex]
    if (!resource || !clip) return
    resource.p[target.clipIndex] = updater(clip)
    props.onChange(next)
    props.onError()
  }

  const createClip = (page: TimelinePage, range: PreviewRange) => {
    const next = cloneFastCapJson(props.draft)
    let resource = next.f.find((_item, resourceIndex) =>
      page.resourceIndex >= 0 ? resourceIndex === page.resourceIndex : false,
    )
    resource ??= next.f.find((item) => item.id === page.cid)
    if (!resource) {
      resource = { i: 'bili_cid', id: page.cid, p: [], t: {} }
      next.f.push(resource)
    }
    const episodeIds = Object.keys(resource.t)
      .map((id) => Number.parseInt(id, 10))
      .filter(Number.isInteger)
      .sort((left, right) => left - right)
    const episodeId = episodeIds[0] ?? 1
    if (episodeIds.length === 0) resource.t[String(episodeId)] = {}
    resource.p.push([range.begin, range.end, 0, episodeId])
    props.onChange(next)
    setSelection({
      cid: resource.id,
      resourceIndex: next.f.indexOf(resource),
      clipIndex: resource.p.length - 1,
    })
    setArmedTrackKey()
    props.onError()
  }

  const deleteSelected = () => {
    const data = selectedData()
    if (!data) return
    const next = cloneFastCapJson(props.draft)
    const resource = next.f[data.resourceIndex]
    resource.p.splice(data.clipIndex, 1)
    props.onChange(next)
    const nextIndex = Math.min(data.clipIndex, resource.p.length - 1)
    setSelection(
      nextIndex >= 0
        ? {
            cid: data.cid,
            resourceIndex: data.resourceIndex,
            clipIndex: nextIndex,
          }
        : undefined,
    )
  }

  const readPlayerTime = async (position: 0 | 1) => {
    const data = selectedData()
    if (!data || !props.requestPlayerTime) return
    try {
      const value = await props.requestPlayerTime(data.cid)
      const duration =
        pages().find(
          (page) =>
            page.resourceIndex === data.resourceIndex || page.cid === data.cid,
        )?.durationMilliseconds ?? 0
      const nextValue = Math.min(duration, snapMilliseconds(value, 1))
      if (
        (position === 0 && nextValue >= data.clip[1]) ||
        (position === 1 && nextValue <= data.clip[0])
      ) {
        throw new Error('播放器进度会使 clip 起止时间无效')
      }
      updateClip(data, (clip) => {
        const next = [...clip] as FastCapClipTuple
        next[position] = nextValue
        return next
      })
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div class="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <section class="min-w-0 overflow-hidden rounded-md border border-border bg-background">
        <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 class="m-0 text-sm font-semibold text-foreground">
              视频多轨时间轴
            </h3>
            <p class="mt-1 mb-0 text-xs text-muted-foreground">
              {pages().length} 个分P · {formatMilliseconds(videoDuration())}
            </p>
          </div>
          <span
            class="text-xs font-medium"
            classList={{
              'text-emerald-700': props.syncConnected,
              'text-muted-foreground': !props.syncConnected,
            }}
          >
            {props.syncConnected ? '草稿同步中' : '本地草稿'}
          </span>
        </div>
        <div class="overflow-x-auto">
          <div
            style={{ 'min-width': `${TRACK_LEFT_PX + TRACK_MIN_WIDTH_PX}px` }}
          >
            <TimelineRuler duration={videoDuration()} />
            <For each={pages()}>
              {(page) => {
                const resource = () => props.draft.f[page.resourceIndex]
                const trackKey = () =>
                  `${page.resourceIndex}:${page.cid}:${page.page}`
                return (
                  <PageTrack
                    page={page}
                    resource={resource()}
                    duration={videoDuration()}
                    current={
                      props.syncConnected &&
                      page.cid === props.context?.currentCid
                    }
                    armed={armedTrackKey() === trackKey()}
                    selection={selection()}
                    onArm={() =>
                      setArmedTrackKey((current) =>
                        current === trackKey() ? undefined : trackKey(),
                      )
                    }
                    onCancel={() => setArmedTrackKey()}
                    onCreate={(range) => createClip(page, range)}
                    onSelect={(clipIndex) =>
                      setSelection({
                        cid: page.cid,
                        resourceIndex: page.resourceIndex,
                        clipIndex,
                      })
                    }
                    onCommit={(clipIndex, range) =>
                      updateClip(
                        {
                          cid: page.cid,
                          resourceIndex: page.resourceIndex,
                          clipIndex,
                        },
                        (clip) => [range.begin, range.end, clip[2], clip[3]],
                      )
                    }
                  />
                )
              }}
            </For>
          </div>
        </div>
      </section>

      <aside class="min-w-0 rounded-md border border-border bg-background">
        <Show
          when={selectedData()}
          fallback={
            <div class="flex min-h-64 items-center justify-center p-6 text-center text-sm text-muted-foreground">
              选择时间轴中的 clip 以编辑映射。
            </div>
          }
        >
          {(data) => (
            <div class="flex flex-col gap-4 p-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="m-0 text-sm font-semibold text-foreground">
                    Clip {data().clipIndex}
                  </h3>
                  <p class="mt-1 mb-0 text-xs text-muted-foreground">
                    CID {data().cid} · Ep {data().clip[3]}
                  </p>
                </div>
                <button
                  type="button"
                  class="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                  onClick={deleteSelected}
                >
                  删除
                </button>
              </div>

              <EpisodeMappingTrack
                mappings={episodeMappings()}
                duration={episodeDuration()}
                selection={selection()!}
                pages={pages()}
                onSelect={setSelection}
                onPreviewEnd={(end) =>
                  setEpisodeDuration((current) =>
                    expandEpisodeTimelineDuration(current, end),
                  )
                }
                onCommit={(offset) =>
                  updateClip(selection()!, (clip) => [
                    clip[0],
                    clip[1],
                    offset,
                    clip[3],
                  ])
                }
              />

              <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <TimeField
                  label="视频开始"
                  value={data().clip[0]}
                  onChange={(value) => {
                    if (value >= data().clip[1]) {
                      props.onError('视频开始必须早于视频结束')
                      return
                    }
                    updateClip(data(), (clip) => [
                      value,
                      clip[1],
                      clip[2],
                      clip[3],
                    ])
                  }}
                  action={() => void readPlayerTime(0)}
                  actionDisabled={
                    !props.syncConnected ||
                    props.context?.currentCid !== data().cid
                  }
                  actionDisabledReason={
                    props.syncConnected
                      ? '仅可读取当前分P的播放器进度'
                      : '等待 B 站插件连接'
                  }
                />
                <TimeField
                  label="视频结束"
                  value={data().clip[1]}
                  onChange={(value) => {
                    const pageDuration =
                      pages().find(
                        (page) =>
                          page.resourceIndex === data().resourceIndex ||
                          page.cid === data().cid,
                      )?.durationMilliseconds ?? 0
                    if (value <= data().clip[0] || value > pageDuration) {
                      props.onError('视频结束必须晚于开始且不超过分P时长')
                      return
                    }
                    updateClip(data(), (clip) => [
                      clip[0],
                      value,
                      clip[2],
                      clip[3],
                    ])
                  }}
                  action={() => void readPlayerTime(1)}
                  actionDisabled={
                    !props.syncConnected ||
                    props.context?.currentCid !== data().cid
                  }
                  actionDisabledReason={
                    props.syncConnected
                      ? '仅可读取当前分P的播放器进度'
                      : '等待 B 站插件连接'
                  }
                />
                <TimeField
                  label="真实进度 offset"
                  value={data().clip[2]}
                  onChange={(value) =>
                    updateClip(data(), (clip) => [
                      clip[0],
                      clip[1],
                      value,
                      clip[3],
                    ])
                  }
                />
                <label class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                  归属 Ep
                  <select
                    value={String(data().clip[3])}
                    class="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    onChange={(event) => {
                      const episodeId = Number.parseInt(
                        event.currentTarget.value,
                        10,
                      )
                      updateClip(data(), (clip) => [
                        clip[0],
                        clip[1],
                        clip[2],
                        episodeId,
                      ])
                    }}
                  >
                    <For
                      each={Object.keys(data().resource.t).sort(
                        (left, right) => Number(left) - Number(right),
                      )}
                    >
                      {(id) => <option value={id}>{id}</option>}
                    </For>
                  </select>
                </label>
              </div>
            </div>
          )}
        </Show>
      </aside>

      <EpisodeTableEditor
        draft={props.draft}
        pages={pages()}
        renderEditor={props.renderEpisodeEditor}
      />
    </div>
  )
}

function TimelineRuler(props: { duration: number; compact?: boolean }) {
  const ticks = createMemo(() => createTimelineTicks(props.duration))
  return (
    <div
      class="grid border-b border-border bg-muted"
      style={{
        'grid-template-columns': `${TRACK_LEFT_PX}px minmax(${TRACK_MIN_WIDTH_PX}px, 1fr)`,
      }}
    >
      <div class="border-r border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
        {props.compact ? 'Ep 映射' : '分P / 资源'}
      </div>
      <div class="relative h-9">
        <For each={ticks()}>
          {(tick) => (
            <span
              class="absolute top-0 h-full border-l border-border px-1 pt-2 font-mono text-[10px] text-muted-foreground"
              style={{ left: `${(tick / props.duration) * 100}%` }}
            >
              {formatShortTime(tick)}
            </span>
          )}
        </For>
      </div>
    </div>
  )
}

function PageTrack(props: {
  page: TimelinePage
  resource?: FastCapResource
  duration: number
  current: boolean
  armed: boolean
  selection?: TimelineSelection
  onArm: () => void
  onCancel: () => void
  onCreate: (range: PreviewRange) => void
  onSelect: (clipIndex: number) => void
  onCommit: (clipIndex: number, range: PreviewRange) => void
}) {
  const [preview, setPreview] = createSignal<PreviewRange>()
  let surface: HTMLDivElement | undefined
  let anchor = 0
  let pointer = 0

  const clips = createMemo(() =>
    assignTimelineLanes(
      (props.resource?.p ?? []).map((clip, clipIndex) => ({
        begin: clip[0],
        end: clip[1],
        clip,
        clipIndex,
      })),
    ),
  )
  const laneCount = createMemo(() =>
    Math.max(1, ...clips().map(({ lane }) => lane + 1)),
  )

  onMount(() => {
    if (!surface) return
    const target = surface
    const interaction = interact(target).draggable({
      allowFrom: '[data-create-surface]',
      ignoreFrom: '[data-clip]',
      listeners: {
        start(event) {
          if (!props.armed) return
          const bounds = target.getBoundingClientRect()
          anchor = pixelsToMilliseconds(
            event.clientX - bounds.left,
            props.duration,
            bounds.width,
          )
          pointer = anchor
          setPreview({ begin: anchor, end: anchor })
        },
        move(event) {
          if (!props.armed || !preview()) return
          pointer += pixelsToMilliseconds(
            event.dx,
            props.duration,
            target.clientWidth,
          )
          const raw = {
            begin: Math.max(0, Math.min(anchor, pointer)),
            end: Math.min(props.duration, Math.max(anchor, pointer)),
          }
          setPreview(raw)
        },
        end() {
          if (!props.armed || !preview()) return
          const range = createRange(anchor, pointer, props.duration)
          setPreview()
          if (range) props.onCreate(range)
          else props.onCancel()
        },
      },
    })
    onCleanup(() => interaction.unset())
  })

  return (
    <div
      class="grid border-b border-border last:border-b-0"
      classList={{ 'bg-emerald-50/60': props.current }}
      style={{
        'grid-template-columns': `${TRACK_LEFT_PX}px minmax(${TRACK_MIN_WIDTH_PX}px, 1fr)`,
      }}
    >
      <div class="flex min-w-0 items-center gap-2 border-r border-border px-3 py-2">
        <div class="min-w-0 flex-1">
          <div
            class="truncate text-xs font-semibold text-foreground"
            title={props.page.title}
          >
            P{props.page.page} · {props.page.title || '未命名'}
          </div>
          <div class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {props.page.cid || 'CID 未填写'} ·{' '}
            {props.page.estimatedDuration ? '约 ' : ''}
            {formatShortTime(props.page.durationMilliseconds ?? 0)}
          </div>
        </div>
        <button
          type="button"
          class="flex-none rounded-md border border-border bg-background px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted"
          classList={{
            'border-foreground bg-foreground text-background': props.armed,
          }}
          onClick={props.onArm}
        >
          {props.armed ? '取消' : '拖选创建'}
        </button>
      </div>
      <div
        ref={(element) => {
          surface = element
        }}
        data-create-surface
        class="relative cursor-default bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)] bg-[length:10%_100%]"
        classList={{ 'cursor-crosshair': props.armed }}
        style={{ height: `${laneCount() * LANE_HEIGHT_PX + 12}px` }}
      >
        <Show when={preview()}>
          {(range) => (
            <div
              class="pointer-events-none absolute top-1.5 h-7 border border-dashed border-emerald-600 bg-emerald-100/80"
              style={rangeStyle(range(), props.duration)}
            />
          )}
        </Show>
        <For each={clips()}>
          {({ item, lane }) => (
            <VideoClipBlock
              clip={item.clip}
              clipIndex={item.clipIndex}
              duration={props.duration}
              lane={lane}
              selected={
                (props.selection?.resourceIndex === props.page.resourceIndex ||
                  (props.selection?.resourceIndex === undefined &&
                    props.selection?.cid === props.page.cid)) &&
                props.selection.clipIndex === item.clipIndex
              }
              onSelect={() => props.onSelect(item.clipIndex)}
              onCommit={(range) => props.onCommit(item.clipIndex, range)}
            />
          )}
        </For>
      </div>
    </div>
  )
}

function VideoClipBlock(props: {
  clip: FastCapClipTuple
  clipIndex: number
  duration: number
  lane: number
  selected: boolean
  onSelect: () => void
  onCommit: (range: PreviewRange) => void
}) {
  const [preview, setPreview] = createSignal<PreviewRange>()
  let element: HTMLDivElement | undefined
  let base: PreviewRange
  let delta = 0

  const current = () =>
    preview() ?? { begin: props.clip[0], end: props.clip[1] }
  const commitKeyboard = (range: PreviewRange) => {
    props.onCommit(range)
    props.onSelect()
  }

  onMount(() => {
    if (!element) return
    const target = element
    const interaction = interact(target)
      .draggable({
        listeners: {
          start() {
            base = { begin: props.clip[0], end: props.clip[1] }
            delta = 0
            props.onSelect()
          },
          move(event) {
            delta += pixelsToMilliseconds(
              event.dx,
              props.duration,
              target.parentElement!.clientWidth,
            )
            setPreview(moveRange(base.begin, base.end, delta, props.duration))
          },
          end() {
            const next = preview()
            setPreview()
            if (next && (next.begin !== base.begin || next.end !== base.end))
              props.onCommit(next)
          },
        },
      })
      .resizable({
        edges: { left: true, right: true, top: false, bottom: false },
        listeners: {
          start() {
            base = { begin: props.clip[0], end: props.clip[1] }
            delta = 0
            props.onSelect()
          },
          move(event) {
            const edge = event.edges.left ? 'left' : 'right'
            delta += pixelsToMilliseconds(
              edge === 'left' ? event.deltaRect.left : event.deltaRect.right,
              props.duration,
              target.parentElement!.clientWidth,
            )
            setPreview(
              resizeRange(base.begin, base.end, edge, delta, props.duration),
            )
          },
          end() {
            const next = preview()
            setPreview()
            if (next && (next.begin !== base.begin || next.end !== base.end))
              props.onCommit(next)
          },
        },
      })
    onCleanup(() => interaction.unset())
  })

  const moveByKeyboard = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? 1_000 : TIMELINE_SNAP_MS
    const deltaMs = event.key === 'ArrowLeft' ? -step : step
    commitKeyboard(
      moveRange(props.clip[0], props.clip[1], deltaMs, props.duration),
    )
  }

  const resizeByKeyboard = (edge: 'left' | 'right', event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? 1_000 : TIMELINE_SNAP_MS
    const deltaMs = event.key === 'ArrowLeft' ? -step : step
    commitKeyboard(
      resizeRange(props.clip[0], props.clip[1], edge, deltaMs, props.duration),
    )
  }

  return (
    <div
      ref={(node) => {
        element = node
      }}
      data-clip
      role="button"
      tabIndex={0}
      aria-label={`Clip ${props.clipIndex}, Ep ${props.clip[3]}, ${formatMilliseconds(current().begin)} 到 ${formatMilliseconds(current().end)}`}
      class="absolute flex h-7 touch-none select-none items-center overflow-hidden border bg-sky-100 px-2 text-[10px] font-semibold text-sky-950 shadow-sm"
      classList={{
        'z-10 border-foreground ring-2 ring-foreground/30': props.selected,
        'border-sky-400': !props.selected,
      }}
      style={{
        ...rangeStyle(current(), props.duration),
        top: `${props.lane * LANE_HEIGHT_PX + 6}px`,
      }}
      onClick={props.onSelect}
      onKeyDown={moveByKeyboard}
    >
      <span
        role="slider"
        tabIndex={0}
        aria-label="视频开始"
        aria-valuemin={0}
        aria-valuemax={props.clip[1] - MIN_CLIP_DURATION_MS}
        aria-valuenow={props.clip[0]}
        class="absolute inset-y-0 left-0 w-2 cursor-ew-resize border-r border-sky-500 bg-sky-300/70"
        onKeyDown={(event) => resizeByKeyboard('left', event)}
      />
      <span class="pointer-events-none truncate">
        C{props.clipIndex} · Ep {props.clip[3]}
      </span>
      <span
        role="slider"
        tabIndex={0}
        aria-label="视频结束"
        aria-valuemin={props.clip[0] + MIN_CLIP_DURATION_MS}
        aria-valuemax={props.duration}
        aria-valuenow={props.clip[1]}
        class="absolute inset-y-0 right-0 w-2 cursor-ew-resize border-l border-sky-500 bg-sky-300/70"
        onKeyDown={(event) => resizeByKeyboard('right', event)}
      />
    </div>
  )
}

function EpisodeMappingTrack(props: {
  mappings: Array<TimelineMapping>
  duration: number
  selection: TimelineSelection
  pages: Array<TimelinePage>
  onSelect: (selection: TimelineSelection) => void
  onPreviewEnd: (end: number) => void
  onCommit: (offset: number) => void
}) {
  const lanes = createMemo(() => assignTimelineLanes(props.mappings))
  const laneCount = createMemo(() =>
    Math.max(1, ...lanes().map(({ lane }) => lane + 1)),
  )
  return (
    <div class="overflow-x-auto rounded-md border border-border">
      <div style={{ 'min-width': `${TRACK_LEFT_PX + TRACK_MIN_WIDTH_PX}px` }}>
        <TimelineRuler duration={props.duration} compact />
        <div
          class="grid"
          style={{
            'grid-template-columns': `${TRACK_LEFT_PX}px minmax(${TRACK_MIN_WIDTH_PX}px, 1fr)`,
          }}
        >
          <div class="border-r border-border px-3 py-2">
            <div class="text-xs font-semibold text-foreground">
              真实剧集进度
            </div>
            <div class="mt-1 text-[10px] text-muted-foreground">
              拖动当前映射调整 offset
            </div>
          </div>
          <div
            class="relative bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)] bg-[length:10%_100%]"
            style={{ height: `${laneCount() * LANE_HEIGHT_PX + 12}px` }}
          >
            <For each={lanes()}>
              {({ item, lane }) => {
                const selected = () =>
                  item.resourceIndex === props.selection.resourceIndex &&
                  item.clipIndex === props.selection.clipIndex
                const page = () =>
                  props.pages.find(
                    (entry) =>
                      entry.resourceIndex === item.resourceIndex ||
                      entry.cid === item.cid,
                  )
                return (
                  <MappingBlock
                    mapping={item}
                    duration={props.duration}
                    lane={lane}
                    selected={selected()}
                    label={`P${page()?.page ?? '?'} · C${item.clipIndex}`}
                    onSelect={() =>
                      props.onSelect({
                        cid: item.cid,
                        resourceIndex: item.resourceIndex,
                        clipIndex: item.clipIndex,
                      })
                    }
                    onPreviewEnd={props.onPreviewEnd}
                    onCommit={props.onCommit}
                  />
                )
              }}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}

function MappingBlock(props: {
  mapping: TimelineMapping
  duration: number
  lane: number
  selected: boolean
  label: string
  onSelect: () => void
  onPreviewEnd: (end: number) => void
  onCommit: (offset: number) => void
}) {
  const [preview, setPreview] = createSignal<PreviewRange>()
  let element: HTMLDivElement | undefined
  let interaction: ReturnType<typeof interact> | undefined
  let delta = 0
  let startOffset = 0
  const current = () =>
    preview() ?? { begin: props.mapping.begin, end: props.mapping.end }

  onMount(() => {
    if (!element) return
    const target = element
    interaction = interact(target).draggable({
      enabled: props.selected,
      listeners: {
        start() {
          if (!props.selected) return
          startOffset = props.mapping.begin
          delta = 0
        },
        move(event) {
          if (!props.selected) return
          delta += pixelsToMilliseconds(
            event.dx,
            props.duration,
            target.parentElement!.clientWidth,
          )
          const begin = Math.max(0, snapMilliseconds(startOffset + delta))
          const next = { begin, end: begin + props.mapping.duration }
          setPreview(next)
          props.onPreviewEnd(next.end)
        },
        end() {
          if (!props.selected) return
          const next = preview()
          setPreview()
          if (next && next.begin !== startOffset) props.onCommit(next.begin)
        },
      },
    })
    onCleanup(() => interaction?.unset())
  })

  createEffect(() => {
    const enabled = props.selected
    interaction?.draggable({ enabled })
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !props.selected ||
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    )
      return
    event.preventDefault()
    const step = event.shiftKey ? 1_000 : TIMELINE_SNAP_MS
    const begin = Math.max(
      0,
      props.mapping.begin + (event.key === 'ArrowLeft' ? -step : step),
    )
    props.onPreviewEnd(begin + props.mapping.duration)
    props.onCommit(begin)
  }

  return (
    <div
      ref={(node) => {
        element = node
      }}
      role="button"
      tabIndex={0}
      aria-label={`${props.label}, 映射 ${formatMilliseconds(current().begin)} 到 ${formatMilliseconds(current().end)}`}
      class="absolute flex h-7 touch-none select-none items-center overflow-hidden border px-2 text-[10px] font-semibold shadow-sm"
      classList={{
        'z-10 cursor-ew-resize border-foreground bg-amber-200 text-amber-950 ring-2 ring-foreground/30':
          props.selected,
        'cursor-pointer border-violet-300 bg-violet-100 text-violet-950':
          !props.selected,
      }}
      style={{
        ...rangeStyle(current(), props.duration),
        top: `${props.lane * LANE_HEIGHT_PX + 6}px`,
      }}
      onClick={props.onSelect}
      onKeyDown={onKeyDown}
    >
      <span class="truncate">{props.label}</span>
    </div>
  )
}

function EpisodeTableEditor(props: {
  draft: FastCapJson
  pages: Array<TimelinePage>
  renderEditor: (resourceIndex: number) => JSX.Element
}) {
  return (
    <section class="min-w-0 overflow-hidden rounded-md border border-border bg-background xl:col-span-2">
      <div class="border-b border-border px-4 py-3">
        <h3 class="m-0 text-sm font-semibold text-foreground">剧集表</h3>
        <p class="mt-1 mb-0 text-xs text-muted-foreground">
          配置各资源的临时 Ep 与第三方剧集引用。
        </p>
      </div>
      <For each={props.pages}>
        {(page) => {
          const resource = () =>
            props.draft.f.find((_item, index) => index === page.resourceIndex)
          return (
            <Show when={resource()}>
              {(currentResource) => (
                <div class="border-b border-border p-4 last:border-b-0">
                  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div class="text-xs font-semibold text-foreground">
                        P{page.page} · {page.title}
                      </div>
                      <div class="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {currentResource().id || 'CID 未填写'}
                      </div>
                    </div>
                  </div>
                  {props.renderEditor(page.resourceIndex)}
                </div>
              )}
            </Show>
          )
        }}
      </For>
    </section>
  )
}

function TimeField(props: {
  label: string
  value: number
  action?: () => void
  actionDisabled?: boolean
  actionDisabledReason?: string
  onChange: (value: number) => void
}) {
  const [text, setText] = createSignal(formatMilliseconds(props.value))
  createEffect(() => setText(formatMilliseconds(props.value)))
  return (
    <div class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
      <div class="flex min-h-6 items-center justify-between gap-2">
        <span>{props.label}</span>
        <Show when={props.action}>
          <button
            type="button"
            disabled={props.actionDisabled}
            title={
              props.actionDisabled ? props.actionDisabledReason : undefined
            }
            class="rounded-md border border-border px-2 py-0.5 text-[10px] font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            onClick={props.action}
          >
            选取当前进度
          </button>
        </Show>
      </div>
      <Show
        when={
          props.action && props.actionDisabledReason && props.actionDisabled
        }
      >
        <span class="text-[10px] font-normal">
          {props.actionDisabledReason}
        </span>
      </Show>
      <input
        value={text()}
        class="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
        onChange={(event) => {
          try {
            const value = parseProgressTimestamp(event.currentTarget.value)
            if (value < 0) return
            props.onChange(value)
            setText(formatMilliseconds(value))
          } catch {
            setText(formatMilliseconds(props.value))
          }
        }}
      />
      <input
        type="number"
        min="0"
        value={String(props.value)}
        class="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
        onChange={(event) => {
          const value = Number.parseInt(event.currentTarget.value, 10)
          if (Number.isSafeInteger(value) && value >= 0) props.onChange(value)
        }}
      />
    </div>
  )
}

function rangeStyle(range: PreviewRange, duration: number) {
  const begin = Math.max(0, Math.min(range.begin, duration))
  const end = Math.max(begin, Math.min(range.end, duration))
  return {
    left: `${(begin / duration) * 100}%`,
    width: `${Math.max(((end - begin) / duration) * 100, 0.2)}%`,
  }
}

function formatShortTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function estimateVideoDuration(resource?: FastCapResource) {
  return getEpisodeTimelineDuration(
    (resource?.p ?? []).map((clip) => ({ end: clip[1] })),
  )
}
