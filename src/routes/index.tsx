import { createFileRoute } from '@tanstack/solid-router'
import { createForm } from '@tanstack/solid-form'
import { createClientOnlyFn } from '@tanstack/solid-start'
import 'solid-sonner/styles.css'
import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import type { Component } from 'solid-js'
import type { ToasterProps } from 'solid-sonner'

import {
  cloneFastCapJson,
  formatMilliseconds,
  parseFastCapInput,
  parseFastCapJson,
  parseProgressTimestamp,
} from '~/shared/fastcap/model'
import type {
  FastCapEpisodeRow,
  FastCapIndexRow,
  FastCapJson,
  FastCapParseResult,
  FastCapResource,
} from '~/shared/fastcap/model'
import { getFastCapEpisodeMetadata } from '~/shared/fastcap/metadata.functions'
import type { FastCapEpisodeMetadata } from '~/shared/fastcap/metadata.functions'
import { fastcapHighlighter, HighlightedTokens } from '~/lib/highlighter'
import { SearchBox } from '~/components/SearchBox'
import { FastCapTimeline } from '~/components/FastCapTimeline'
import { env } from '~/env'
import { BgmTv } from '~/shared/3rd-ref/bgmtv'
import { TMDB } from '~/shared/3rd-ref/tmdb'
import { searchStore } from '~/lib/search-history'
import {
  createReadOnlyPreviewLauncher,
  createFastCapSyncClient,
  createRemoteUpdateGuard,
  createWindowSyncTransport,
  getPlayerTimeAvailability,
  isReadOnlyPreviewRequested,
} from '~/lib/fastcap-sync'
import type {
  EditorContext,
  FastCapSyncClient,
  SyncClientEvent,
} from '~/lib/fastcap-sync'

export const Route = createFileRoute('/')({ component: App })

type ViewMode = 'episode' | 'index'
type ImageExportFormat = 'png' | 'webp'
type FastCapHighlightLanguage = 'fastcap' | 'fastcap-yue' | 'json' | 'toml'
const showImagesStorageKey = 'fastcap-show:show-episode-images'
const viewModeStorageKey = 'fastcap-show:view-mode'
const imageExportFormatStorageKey = 'fastcap-show:image-export-format'
const editorCollapsedStorageKey = 'fastcap-show:editor-collapsed'

const getClientEpisodeMetadata = createClientOnlyFn(
  async (episode: ReturnType<typeof toMetadataPayload>) => {
    const { getFastCapEpisodeMetadataClient } =
      await import('~/shared/fastcap/metadata.client')
    return getFastCapEpisodeMetadataClient(episode.key, episode.refs)
  },
)

const defaultStarterInput = `\`\`\`fastcap
[[f]]
i = "bili_cid"
id = "37322032240"
p = [ [ 0, 1371000, 0, 1 ] ]

[f.t.1]
bgmtv_epid = "1670640"
\`\`\``

function createEmptyFastCapDraft(): FastCapJson {
  return { f: [] }
}

function createEmptyEpisodeRef() {
  return {
    bgmtv_epid: '',
    tmdb_urlc: '',
  }
}

function normalizeFastCapDraftForEditor(data: FastCapJson): FastCapJson {
  const draft = cloneFastCapJson(data)
  return {
    f: draft.f.map((resource) => ({
      ...resource,
      t: Object.fromEntries(
        Object.entries(resource.t).map(([id, refs]) => [
          id,
          {
            bgmtv_epid: refs.bgmtv_epid ?? '',
            tmdb_urlc: refs.tmdb_urlc ?? '',
          },
        ]),
      ),
    })),
  }
}

function sanitizeFastCapDraftForApply(data: FastCapJson): FastCapJson {
  return {
    f: data.f.map((resource) => ({
      ...resource,
      t: Object.fromEntries(
        Object.entries(resource.t).map(([id, refs]) => {
          const bgmtvEpid = refs.bgmtv_epid?.trim()
          const tmdbUrlc = refs.tmdb_urlc?.trim()
          return [
            id,
            {
              ...(bgmtvEpid ? { bgmtv_epid: bgmtvEpid } : {}),
              ...(tmdbUrlc ? { tmdb_urlc: tmdbUrlc } : {}),
            },
          ]
        }),
      ),
    })),
  }
}

function isViewMode(value: string | null): value is ViewMode {
  return value === 'episode' || value === 'index'
}

function isImageExportFormat(value: string | null): value is ImageExportFormat {
  return value === 'png' || value === 'webp'
}

function validateFastCapInput(value: string) {
  try {
    parseFastCapInput(value)
    return undefined
  } catch (parseError) {
    return getErrorMessage(parseError)
  }
}

async function dismissToasts() {
  if (typeof window === 'undefined') return
  const { toast } = await import('solid-sonner')
  toast.dismiss()
}

async function showErrorToast(message: string) {
  if (typeof window === 'undefined') return
  const { toast } = await import('solid-sonner')
  toast.error('操作失败', {
    description: message,
    duration: 6000,
  })
}

function App() {
  const [viewMode, setViewMode] = createSignal<ViewMode>('episode')
  const [parsed, setParsed] = createSignal<FastCapParseResult>()
  const [draft, setDraft] = createSignal<FastCapJson>()
  const [editorError, setEditorError] = createSignal<string>()
  const [exportFormat, setExportFormat] = createSignal<'toml' | 'yue'>('toml')
  const [isParsing, setIsParsing] = createSignal(false)
  const [metadata, setMetadata] =
    createSignal<Record<string, FastCapEpisodeMetadata>>()
  const [isLoadingMetadata, setIsLoadingMetadata] = createSignal(false)
  const [isExportingImage, setIsExportingImage] = createSignal(false)
  const [imageExportError, setImageExportError] = createSignal<string>()
  const [isImageExportModalOpen, setIsImageExportModalOpen] =
    createSignal(false)
  const [imageExportFormat, setImageExportFormat] =
    createSignal<ImageExportFormat>('png')
  const [imageExportPreviewUrl, setImageExportPreviewUrl] =
    createSignal<string>()
  const [imageExportBlob, setImageExportBlob] = createSignal<Blob>()
  const [showEpisodeImages, setShowEpisodeImages] = createSignal(true)
  const [isEditorCollapsed, setIsEditorCollapsed] = createSignal(false)
  const [SonnerToaster, setSonnerToaster] =
    createSignal<Component<ToasterProps>>()
  const [syncMode, setSyncMode] = createSignal(false)
  const [syncConnected, setSyncConnected] = createSignal(false)
  const [syncContext, setSyncContext] = createSignal<EditorContext>()
  const [readOnlyPreviewRequested, setReadOnlyPreviewRequested] =
    createSignal(false)
  const readOnlyPreview = createMemo(
    () => readOnlyPreviewRequested() && syncConnected(),
  )
  const remoteUpdateGuard = createRemoteUpdateGuard()
  let syncClient: FastCapSyncClient | undefined
  let previewLauncher: ReturnType<typeof createReadOnlyPreviewLauncher>
  let unsubscribeSync: (() => void) | undefined
  let metadataRequestId = 0
  const [resourceSectionRef, setResourceSectionRef] =
    createSignal<HTMLDivElement>()

  createEffect(() => {
    if (parsed() && resourceSectionRef()) {
      setTimeout(() => {
        resourceSectionRef()?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }, 100)
    }
  })
  const getQueryParams = () => {
    const params = new URLSearchParams(window.location.search)
    return {
      i: params.get('i') ?? '',
      id: params.get('id') ?? '',
    }
  }
  const queryIndexType = () => getQueryParams().i
  const queryId = () => getQueryParams().id
  const hasQueryConfig = () => !!queryIndexType() && !!queryId()

  const inputForm = createForm(() => ({
    defaultValues: {
      input: defaultStarterInput,
    },
    onSubmit: ({ value }) => {
      const result = parseFastCapInput(value.input)
      void dismissToasts()
      showResult(result)
      setEditorError()
    },
  }))
  const inputFormErrors = inputForm.useSelector(
    (state) => state.fieldMeta.input?.errors ?? [],
  )
  const getInputFormError = () =>
    inputFormErrors()
      .filter((message): message is string => Boolean(message))
      .join('；')
  const setInputSubmitError = (message: string | undefined) => {
    inputForm.setFieldMeta('input', (current) => ({
      ...current,
      isTouched: true,
      errorMap: {
        ...current.errorMap,
        onSubmit: message,
      },
    }))
  }

  onMount(() => {
    void import('solid-sonner').then(({ Toaster }) => {
      setSonnerToaster(() => Toaster)
    })

    const savedShowImages = localStorage.getItem(showImagesStorageKey)
    if (savedShowImages !== null) {
      setShowEpisodeImages(savedShowImages === 'true')
    }

    const savedViewMode = localStorage.getItem(viewModeStorageKey)
    if (isViewMode(savedViewMode)) setViewMode(savedViewMode)

    const savedImageExportFormat = localStorage.getItem(
      imageExportFormatStorageKey,
    )
    if (isImageExportFormat(savedImageExportFormat)) {
      setImageExportFormat(savedImageExportFormat)
    }

    const savedEditorCollapsed = localStorage.getItem(editorCollapsedStorageKey)
    if (savedEditorCollapsed !== null) {
      setIsEditorCollapsed(savedEditorCollapsed === 'true')
    }

    const requestedReadOnly = isReadOnlyPreviewRequested(window.location.search)
    setReadOnlyPreviewRequested(requestedReadOnly)
    syncClient = createFastCapSyncClient(createWindowSyncTransport(), {
      disconnectOnDispose: !requestedReadOnly,
    })
    if (syncClient) {
      setSyncMode(true)
      unsubscribeSync = syncClient.subscribe(handleSyncEvent)
    }
    previewLauncher = createReadOnlyPreviewLauncher({
      openWindow: (url, target) => window.open(url, target),
      onBlocked: () => {
        void showErrorToast('浏览器阻止了只读预览窗口')
      },
    })

    // query 参数创建初始资源草稿（不解析，等待用户手动操作）
    if (hasQueryConfig()) {
      setDraft({
        f: [
          {
            i: queryIndexType() as FastCapResource['i'],
            id: queryId(),
            p: [],
            t: {},
          },
        ],
      })
    }
  })

  onCleanup(() => {
    unsubscribeSync?.()
    syncClient?.dispose()
    const previewUrl = imageExportPreviewUrl()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  })

  const setImagePreviewBlob = (blob: Blob) => {
    const previousUrl = imageExportPreviewUrl()
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    setImageExportBlob(blob)
    setImageExportPreviewUrl(URL.createObjectURL(blob))
  }

  const toggleEpisodeImages = (value: boolean) => {
    setShowEpisodeImages(value)
    localStorage.setItem(showImagesStorageKey, String(value))
  }

  const selectViewMode = (value: ViewMode) => {
    setViewMode(value)
    localStorage.setItem(viewModeStorageKey, value)
  }

  const toggleEditorCollapsed = () => {
    const next = !isEditorCollapsed()
    setIsEditorCollapsed(next)
    localStorage.setItem(editorCollapsedStorageKey, String(next))
  }

  const mergeMetadata = (item: FastCapEpisodeMetadata) => {
    setMetadata((current) => ({
      ...current,
      [item.key]: item,
    }))
  }

  const loadMetadata = async (episodes: Array<FastCapEpisodeRow>) => {
    const requestId = metadataRequestId + 1
    metadataRequestId = requestId

    if (!episodes.length) {
      setMetadata()
      setIsLoadingMetadata(false)
      return
    }
    setIsLoadingMetadata(true)
    await waitForPaint()

    const payload = episodes.map(toMetadataPayload)

    try {
      await Promise.all(
        payload.map(async (episode) => {
          const item = await resolveMetadataClientFirst(episode)
          if (requestId === metadataRequestId) mergeMetadata(item)
        }),
      )
    } finally {
      if (requestId === metadataRequestId) setIsLoadingMetadata(false)
    }
  }

  const buildFallbackMetadata = (episodes: Array<FastCapEpisodeRow>) =>
    Object.fromEntries(
      episodes.map((episode) => {
        const payload = toMetadataPayload(episode)
        return [
          episode.key,
          {
            key: payload.key,
            title: fallbackMetadataTitle(payload.refs),
            subtitle: formatRefs(payload.refs),
            status: 'fallback',
          } satisfies FastCapEpisodeMetadata,
        ]
      }),
    )

  const showResult = (result: FastCapParseResult) => {
    setParsed(result)
    setDraft(normalizeFastCapDraftForEditor(result.json))
    setMetadata(buildFallbackMetadata(result.episodeRows))
    void loadMetadata(result.episodeRows)
  }

  function handleSyncEvent(event: SyncClientEvent) {
    if (event.type === 'context') {
      setSyncContext(structuredClone(event.context))
      setSyncConnected(true)
      return
    }
    if (event.type === 'disconnect') {
      setSyncConnected(false)
      return
    }
    if (event.type === 'draft') {
      if (readOnlyPreview()) {
        try {
          const previewDraft = normalizeFastCapDraftForEditor(event.draft)
          const result = parseFastCapJson(
            sanitizeFastCapDraftForApply(previewDraft),
          )
          remoteUpdateGuard.run(() => {
            inputForm.setFieldValue('input', result.yue, {
              dontValidate: true,
            })
            showResult(result)
            setDraft(previewDraft)
            setInputSubmitError(undefined)
            setEditorError()
            setExportFormat('yue')
          })
        } catch (previewError) {
          remoteUpdateGuard.run(() => {
            setDraft(normalizeFastCapDraftForEditor(event.draft))
            setEditorError(getErrorMessage(previewError))
          })
        }
      } else {
        remoteUpdateGuard.run(() => {
          setDraft(normalizeFastCapDraftForEditor(event.draft))
          setEditorError()
        })
      }
      return
    }
    try {
      const result = parseFastCapJson(event.config)
      remoteUpdateGuard.run(() => {
        inputForm.setFieldValue('input', result.yue, {
          dontValidate: true,
        })
        showResult(result)
        setInputSubmitError(undefined)
        setEditorError()
        setExportFormat('yue')
      })
    } catch {
      // Invalid remote configs are ignored without disturbing local editor state.
    }
  }

  const exportText = createMemo(() => {
    const data = parsed()
    if (!data) return ''
    return exportFormat() === 'toml' ? data.toml : data.yue
  })

  const parseInput = async () => {
    if (readOnlyPreview()) return
    setIsParsing(true)
    void dismissToasts()
    await waitForPaint()

    try {
      await inputForm.handleSubmit()
      const validationMessage = getInputFormError()
      if (validationMessage) void showErrorToast(validationMessage)
    } catch (submitError) {
      void showErrorToast(getErrorMessage(submitError))
    } finally {
      setIsParsing(false)
    }
  }

  const readClipboardAndParse = async () => {
    if (readOnlyPreview()) return
    setIsParsing(true)
    void dismissToasts()
    await waitForPaint()

    try {
      const clipboardText = await navigator.clipboard.readText()
      const validationError = validateFastCapInput(clipboardText)
      if (validationError) {
        setInputSubmitError(validationError)
        void showErrorToast(validationError)
        return
      }

      inputForm.setFieldValue('input', clipboardText, { dontValidate: true })
      setInputSubmitError(undefined)
      const result = parseFastCapInput(clipboardText)
      showResult(result)
      setEditorError()
    } catch (clipboardOrParseError) {
      void showErrorToast(getErrorMessage(clipboardOrParseError))
    } finally {
      setIsParsing(false)
    }
  }

  const copyExport = () => {
    const text = exportText()
    if (!text) return
    void navigator.clipboard.writeText(text)
  }

  const applyDraft = () => {
    if (readOnlyPreview()) return
    const data = draft()
    if (!data) return

    try {
      const result = parseFastCapJson(sanitizeFastCapDraftForApply(data))
      inputForm.setFieldValue('input', result.yue, { dontValidate: true })
      showResult(result)
      setEditorError()
      setExportFormat('yue')
      syncClient?.sendApply(result.json)
    } catch (applyError) {
      setEditorError(getErrorMessage(applyError))
    }
  }

  const updateDraft = (next: FastCapJson) => {
    if (readOnlyPreview()) {
      try {
        const previewDraft = normalizeFastCapDraftForEditor(next)
        const result = parseFastCapJson(
          sanitizeFastCapDraftForApply(previewDraft),
        )
        inputForm.setFieldValue('input', result.yue, { dontValidate: true })
        showResult(result)
        setDraft(previewDraft)
        setInputSubmitError(undefined)
        setEditorError()
        setExportFormat('yue')
      } catch (previewError) {
        setDraft(next)
        setEditorError(getErrorMessage(previewError))
      }
      return
    }
    setDraft(next)
    setEditorError()
    if (!remoteUpdateGuard.isActive()) syncClient?.sendDraft(next)
  }

  const requestPlayerTime = (cid: string) => {
    if (!syncClient) return Promise.reject(new Error('当前不是同步编辑会话'))
    return syncClient.requestPlayerTime(cid)
  }

  const currentSyncPage = createMemo(() => {
    const context = syncContext()
    return context?.pages.find((page) => page.cid === context.currentCid)
  })

  const createEmptyConfig = () => {
    if (readOnlyPreview()) return
    metadataRequestId += 1
    inputForm.setFieldValue('input', '', { dontValidate: true })
    setParsed()
    setDraft(createEmptyFastCapDraft())
    void dismissToasts()
    setEditorError()
    setMetadata()
    setIsLoadingMetadata(false)
    setExportFormat('toml')
  }

  const openReadOnlyPreview = () => {
    if (!syncConnected() || readOnlyPreview()) return
    previewLauncher.open(window.location.href)
  }

  const renderImageExportPreview = async (format: ImageExportFormat) => {
    const data = parsed()
    if (!data) return

    setIsExportingImage(true)
    setImageExportError()

    try {
      const blob = await exportFastCapListAsBlob(
        data,
        metadata(),
        viewMode(),
        format,
        showEpisodeImages(),
      )
      setImagePreviewBlob(blob)
      setImageExportFormat(format)
      localStorage.setItem(imageExportFormatStorageKey, format)
      setIsImageExportModalOpen(true)
    } catch (exportError) {
      setImageExportError(getErrorMessage(exportError))
    } finally {
      setIsExportingImage(false)
    }
  }

  const openImageExportPreview = () => {
    void renderImageExportPreview(imageExportFormat())
  }

  const changeImageExportFormat = (format: ImageExportFormat) => {
    if (format === imageExportFormat()) return
    void renderImageExportPreview(format)
  }

  const closeImageExportModal = () => {
    setIsImageExportModalOpen(false)
  }

  const downloadImageExport = () => {
    const blob = imageExportBlob()
    if (!blob) return
    downloadBlob(
      blob,
      `fastcap-${viewMode()}-${formatFileTimestamp(new Date())}.${imageExportFormat()}`,
    )
  }

  return (
    <main class="mx-auto flex w-full max-w-[1440px] max-h-[calc(100vh-4rem)] flex-col gap-6 px-4 py-8 lg:px-6">
      <Show when={SonnerToaster()}>
        {(Toaster) => {
          const ToastComponent = Toaster()
          return (
            <ToastComponent
              position="top-right"
              richColors
              closeButton
              duration={6000}
            />
          )
        }}
      </Show>

      <Show when={syncMode()}>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
          <span
            class="inline-flex items-center gap-2 font-semibold"
            classList={{
              'text-emerald-700': syncConnected(),
              'text-amber-700': !syncConnected(),
            }}
          >
            <span class="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
            {syncConnected()
              ? readOnlyPreview()
                ? '只读预览 · 已连接 B 站插件'
                : '已连接 B 站插件'
              : '等待 B 站插件'}
          </span>
          <Show when={syncContext()}>
            {(context) => (
              <>
                <span>来源 {context().bvid}</span>
                <span>
                  当前分P {currentSyncPage()?.title || '未命名'} / CID{' '}
                  {context().currentCid}
                </span>
              </>
            )}
          </Show>
        </div>
      </Show>

      <section
        class="grid gap-6"
        classList={{
          'lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.4fr)]':
            !syncConnected() || readOnlyPreview(),
        }}
      >
        <div
          class="rounded-lg border border-border bg-background p-5 shadow-sm"
          classList={{ hidden: syncConnected() && !readOnlyPreview() }}
        >
          <div class="mb-4 flex items-start justify-between gap-4">
            <div>
              <p class="mb-1 text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                FastCap
              </p>
              <h1 class="m-0 text-2xl font-semibold tracking-tight text-foreground">
                配置查看器
              </h1>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={readOnlyPreview()}
                title={readOnlyPreview() ? '只读预览不能创建配置' : undefined}
                class="rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
                onClick={createEmptyConfig}
              >
                创建空配置
              </button>
              <button
                type="button"
                disabled={isParsing() || readOnlyPreview()}
                title={readOnlyPreview() ? '只读预览不能读取配置' : undefined}
                class="rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
                onClick={readClipboardAndParse}
              >
                读取剪贴板
              </button>
              <button
                type="button"
                disabled={isParsing() || readOnlyPreview()}
                title={readOnlyPreview() ? '只读预览不能解析配置' : undefined}
                class="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
                onClick={parseInput}
              >
                {isParsing() ? '解析中…' : '解析'}
              </button>
            </div>
          </div>

          <inputForm.Field
            name="input"
            validators={{
              onSubmit: ({ value }) => validateFastCapInput(value),
            }}
          >
            {(field) => (
              <HighlightedCodeTextarea
                value={field().state.value}
                language={getInputHighlightLanguage(field().state.value)}
                minHeightClass="min-h-[420px]"
                readOnly={readOnlyPreview()}
                onInput={field().handleChange}
              />
            )}
          </inputForm.Field>

          <Show when={parsed()}>
            {(data) => (
              <div class="mt-5 rounded-lg border border-border bg-muted p-4">
                <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div class="flex rounded-md border border-border bg-background p-1">
                    <FormatButton
                      active={exportFormat() === 'toml'}
                      onClick={() => setExportFormat('toml')}
                    >
                      TOML
                    </FormatButton>
                    <FormatButton
                      active={exportFormat() === 'yue'}
                      onClick={() => setExportFormat('yue')}
                    >
                      Yue
                    </FormatButton>
                  </div>
                  <button
                    type="button"
                    class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-muted"
                    onClick={copyExport}
                  >
                    复制导出
                  </button>
                </div>
                <HighlightedCodeTextarea
                  value={exportText()}
                  readOnly
                  language={
                    exportFormat() === 'toml' ? 'fastcap' : 'fastcap-yue'
                  }
                  minHeightClass="min-h-48"
                  textSizeClass="text-xs"
                />
                <p class="mt-2 text-xs text-muted-foreground">
                  规范化导出，不保留原始注释、空行或字段顺序。当前输入识别为{' '}
                  {data().format.toUpperCase()}。
                </p>
              </div>
            )}
          </Show>
        </div>

        <div
          ref={setResourceSectionRef}
          class="relative min-w-0 rounded-lg border border-border bg-background p-5 shadow-sm"
        >
          <Show
            when={parsed()}
            fallback={
              <Show
                when={draft()}
                fallback={
                  <div class="flex min-h-[560px] items-center justify-center rounded-lg border border-dashed border-border bg-muted text-sm text-muted-foreground">
                    粘贴配置后点击解析，或创建空配置后从可视化编辑器开始。
                  </div>
                }
              >
                {(draftData) => (
                  <div class="flex min-w-0 flex-col gap-4">
                    <div class="rounded-lg border border-dashed border-border bg-muted px-4 py-5 text-sm text-muted-foreground">
                      当前是空配置草稿。补充资源、剧集引用和片段后点击“应用到配置”生成
                      TOML。
                    </div>
                    <FastCapEditor
                      draft={draftData()}
                      error={editorError()}
                      collapsed={isEditorCollapsed()}
                      onApply={applyDraft}
                      onToggleCollapsed={toggleEditorCollapsed}
                      syncConnected={syncConnected() && !readOnlyPreview()}
                      readOnlyPreview={readOnlyPreview()}
                      syncContext={syncContext()}
                      metadata={metadata()}
                      currentCid={syncContext()?.currentCid}
                      requestPlayerTime={
                        syncConnected() && !readOnlyPreview()
                          ? requestPlayerTime
                          : undefined
                      }
                      onOpenReadOnlyPreview={
                        syncConnected() && !readOnlyPreview()
                          ? openReadOnlyPreview
                          : undefined
                      }
                      onChange={updateDraft}
                    />
                  </div>
                )}
              </Show>
            }
          >
            {(data) => (
              <div class="flex min-w-0 flex-col gap-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="grid grid-cols-3 gap-2">
                    <StatCard label="资源" value={data().stats.resources} />
                    <StatCard label="剧集" value={data().stats.episodes} />
                    <StatCard label="片段" value={data().stats.clips} />
                  </div>

                  <div class="flex rounded-md border border-border bg-muted p-1">
                    <ModeButton
                      active={viewMode() === 'episode'}
                      onClick={() => selectViewMode('episode')}
                    >
                      依据剧集
                    </ModeButton>
                    <ModeButton
                      active={viewMode() === 'index'}
                      onClick={() => selectViewMode('index')}
                    >
                      依据索引
                    </ModeButton>
                  </div>
                  <button
                    type="button"
                    disabled={isExportingImage()}
                    class="rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
                    onClick={openImageExportPreview}
                  >
                    {isExportingImage() ? '生成中…' : '导出图片'}
                  </button>
                  <label class="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={showEpisodeImages()}
                      onChange={(event) =>
                        toggleEpisodeImages(event.currentTarget.checked)
                      }
                    />
                    显示剧集图片
                  </label>
                </div>

                <Show when={imageExportError()}>
                  {(message) => (
                    <p class="m-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {message()}
                    </p>
                  )}
                </Show>

                <div class="min-w-0 bg-background">
                  <Show
                    when={viewMode() === 'episode'}
                    fallback={
                      <IndexTable
                        rows={data().indexRows}
                        metadata={metadata()}
                        loading={isLoadingMetadata()}
                        showImages={showEpisodeImages()}
                      />
                    }
                  >
                    <EpisodeTable
                      episodes={data().episodeRows}
                      metadata={metadata()}
                      loading={isLoadingMetadata()}
                      showImages={showEpisodeImages()}
                    />
                  </Show>
                </div>

                <Show when={draft()}>
                  {(draftData) => (
                    <FastCapEditor
                      draft={draftData()}
                      error={editorError()}
                      collapsed={isEditorCollapsed()}
                      onApply={applyDraft}
                      onToggleCollapsed={toggleEditorCollapsed}
                      syncConnected={syncConnected() && !readOnlyPreview()}
                      readOnlyPreview={readOnlyPreview()}
                      syncContext={syncContext()}
                      metadata={metadata()}
                      currentCid={syncContext()?.currentCid}
                      requestPlayerTime={
                        syncConnected() && !readOnlyPreview()
                          ? requestPlayerTime
                          : undefined
                      }
                      onOpenReadOnlyPreview={
                        syncConnected() && !readOnlyPreview()
                          ? openReadOnlyPreview
                          : undefined
                      }
                      onChange={updateDraft}
                    />
                  )}
                </Show>
              </div>
            )}
          </Show>

          <Show when={isParsing()}>
            <div class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-[2px]">
              <div class="flex items-center gap-3 rounded-full border border-border bg-background px-4 py-2 shadow-sm">
                <span class="h-3 w-3 animate-pulse rounded-full bg-foreground" />
                <span class="text-sm font-medium text-foreground">
                  正在解析 fastcap…
                </span>
              </div>
            </div>
          </Show>
        </div>
      </section>

      <Show when={isImageExportModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4">
          <div class="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 class="m-0 text-lg font-semibold text-foreground">
                  导出图片预览
                </h2>
                <p class="mt-1 mb-0 text-xs text-muted-foreground">
                  当前导出内容：
                  {viewMode() === 'episode' ? '依据剧集' : '依据索引'}
                </p>
              </div>
              <button
                type="button"
                class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-muted"
                onClick={closeImageExportModal}
              >
                关闭
              </button>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-5 py-3">
              <div class="flex rounded-md border border-border bg-background p-1">
                <FormatButton
                  active={imageExportFormat() === 'png'}
                  onClick={() => changeImageExportFormat('png')}
                >
                  PNG
                </FormatButton>
                <FormatButton
                  active={imageExportFormat() === 'webp'}
                  onClick={() => changeImageExportFormat('webp')}
                >
                  WebP
                </FormatButton>
              </div>

              <button
                type="button"
                disabled={!imageExportBlob() || isExportingImage()}
                class="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-70"
                onClick={downloadImageExport}
              >
                下载 {imageExportFormat().toUpperCase()}
              </button>
            </div>

            <div class="min-h-0 overflow-auto bg-muted p-5">
              <Show
                when={imageExportPreviewUrl()}
                fallback={
                  <div class="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
                    正在生成预览…
                  </div>
                }
              >
                {(previewUrl) => (
                  <img
                    src={previewUrl()}
                    alt="导出图片预览"
                    class="mx-auto max-w-full rounded-lg border border-border bg-background shadow-sm"
                  />
                )}
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </main>
  )
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

function HighlightedCodeTextarea(props: {
  value: string
  language: FastCapHighlightLanguage
  minHeightClass: string
  textSizeClass?: string
  readOnly?: boolean
  onInput?: (value: string) => void
}) {
  let textareaElement: HTMLTextAreaElement | undefined
  let highlightElement: HTMLPreElement | undefined
  const tokens = createMemo(
    () =>
      fastcapHighlighter.tokenize(props.value, { lang: props.language }).tokens,
  )
  const textSizeClass = () => props.textSizeClass ?? 'text-sm'

  const syncScroll = () => {
    if (!textareaElement || !highlightElement) return
    highlightElement.scrollTop = textareaElement.scrollTop
    highlightElement.scrollLeft = textareaElement.scrollLeft
  }

  return (
    <div
      class={`fastcap-code-editor ${props.minHeightClass} ${textSizeClass()}`}
    >
      <pre
        ref={(element) => {
          highlightElement = element
        }}
        aria-hidden="true"
        class="fastcap-code-highlight"
      >
        <code>
          <HighlightedTokens tokens={tokens()} />
        </code>
      </pre>
      <textarea
        ref={(element) => {
          textareaElement = element
        }}
        value={props.value}
        readOnly={props.readOnly}
        spellcheck={false}
        onInput={(event) => props.onInput?.(event.currentTarget.value)}
        onScroll={syncScroll}
        class="fastcap-code-input"
      />
    </div>
  )
}

function getInputHighlightLanguage(value: string): FastCapHighlightLanguage {
  const trimmed = value.trimStart()
  if (trimmed.startsWith('{')) return 'json'
  if (trimmed.includes('本资源FastCap配置如下')) return 'fastcap-yue'
  if (trimmed.startsWith('```fastcap')) return 'fastcap'
  return 'toml'
}

type CanvasTableColumn = {
  title: string
  width: number
}

type CanvasCell = {
  text: string
  imageUrl?: string
}

type CanvasTable = {
  title: string
  subtitle: string
  columns: Array<CanvasTableColumn>
  rows: Array<Array<CanvasCell>>
}

async function exportFastCapListAsBlob(
  result: FastCapParseResult,
  metadata: Record<string, FastCapEpisodeMetadata> | undefined,
  mode: ViewMode,
  format: ImageExportFormat,
  showImages: boolean,
) {
  await document.fonts.ready

  const table =
    mode === 'episode'
      ? buildEpisodeCanvasTable(result, metadata, showImages)
      : buildIndexCanvasTable(result, metadata, showImages)
  if (!table.rows.length) throw new Error('没有可导出的列表内容')

  return renderCanvasTableToBlob(table, format)
}

function buildEpisodeCanvasTable(
  result: FastCapParseResult,
  metadata: Record<string, FastCapEpisodeMetadata> | undefined,
  showImages: boolean,
): CanvasTable {
  return {
    title: 'FastCap 配置 · 依据剧集',
    subtitle: formatExportStats(result),
    columns: [
      { title: 'Ep', width: 80 },
      { title: '剧集信息', width: 340 },
      { title: '索引', width: 220 },
      { title: 'Clip', width: 70 },
      { title: '视频片段', width: 210 },
      { title: '真实进度', width: 210 },
      { title: 'Offset', width: 140 },
    ],
    rows: result.episodeRows.flatMap((episode) => {
      const episodeMetadata = metadata?.[episode.key]
      const baseCells = [
        canvasCell(`${episode.tempEpId}\nf${episode.resourceIndex}`),
        canvasCell(formatExportEpisodeMeta(episode, episodeMetadata), {
          imageUrl: showImages ? episodeMetadata?.imageUrl : undefined,
        }),
        canvasCell(`${episode.indexType}:${episode.resourceId}`),
      ]

      if (!episode.clips.length) {
        return [
          [
            ...baseCells,
            canvasCell('无片段'),
            canvasCell('—'),
            canvasCell('—'),
            canvasCell('—'),
          ],
        ]
      }

      return episode.clips.map((clip) => [
        ...baseCells,
        canvasCell(String(clip.clipIndex)),
        canvasCell(
          `${formatMilliseconds(clip.videoBegin)} →\n${formatMilliseconds(clip.videoEnd)}`,
        ),
        canvasCell(
          `${formatMilliseconds(clip.realBegin)} →\n${formatMilliseconds(clip.realEnd)}`,
        ),
        canvasCell(formatMilliseconds(clip.offset)),
      ])
    }),
  }
}

function buildIndexCanvasTable(
  result: FastCapParseResult,
  metadata: Record<string, FastCapEpisodeMetadata> | undefined,
  showImages: boolean,
): CanvasTable {
  return {
    title: 'FastCap 配置 · 依据索引',
    subtitle: formatExportStats(result),
    columns: [
      { title: '索引', width: 250 },
      { title: 'Clip', width: 70 },
      { title: '视频片段', width: 210 },
      { title: 'Ep', width: 70 },
      { title: '剧集信息', width: 350 },
      { title: '真实进度', width: 210 },
      { title: 'Offset', width: 140 },
    ],
    rows: result.indexRows.map((row) => {
      const episodeMetadata = metadata?.[row.episodeKey]
      return [
        canvasCell(`f${row.resourceIndex}\n${row.indexType}:${row.resourceId}`),
        canvasCell(`p${row.clipIndex}`),
        canvasCell(
          `${formatMilliseconds(row.videoBegin)} →\n${formatMilliseconds(row.videoEnd)}`,
        ),
        canvasCell(String(row.tempEpId)),
        canvasCell(
          formatExportEpisodeMeta(
            {
              key: row.episodeKey,
              fIndex: row.fIndex,
              resourceIndex: row.resourceIndex,
              indexType: row.indexType,
              resourceId: row.resourceId,
              tempEpId: row.tempEpId,
              refs: row.refs,
              clips: [],
            },
            episodeMetadata,
          ),
          {
            imageUrl: showImages ? episodeMetadata?.imageUrl : undefined,
          },
        ),
        canvasCell(
          `${formatMilliseconds(row.realBegin)} →\n${formatMilliseconds(row.realEnd)}`,
        ),
        canvasCell(formatMilliseconds(row.offset)),
      ]
    }),
  }
}

function canvasCell(text: string, options?: { imageUrl?: string }): CanvasCell {
  return {
    text,
    imageUrl: options?.imageUrl,
  }
}

async function renderCanvasTableToBlob(
  table: CanvasTable,
  format: ImageExportFormat,
) {
  const padding = 32
  const titleHeight = 72
  const headerHeight = 42
  const rowPaddingY = 12
  const lineHeight = 18
  const columnGap = 0
  const tableWidth =
    table.columns.reduce((sum, column) => sum + column.width, 0) +
    columnGap * (table.columns.length - 1)
  const width = tableWidth + padding * 2

  const measureCanvas = document.createElement('canvas')
  const measureContext = measureCanvas.getContext('2d')
  if (!measureContext) throw new Error('当前浏览器不支持 Canvas 导出')

  measureContext.font = '13px Inter, system-ui, sans-serif'
  const wrappedRows = table.rows.map((row) =>
    row.map((cell, index) =>
      wrapCanvasText(
        measureContext,
        cell.text,
        table.columns[index].width - 24 - (cell.imageUrl ? 42 : 0),
      ),
    ),
  )
  const rowHeights = wrappedRows.map((row) => {
    const maxLines = Math.max(...row.map((cell) => cell.length), 1)
    return Math.max(48, maxLines * lineHeight + rowPaddingY * 2)
  })
  const exportImages = await loadExportImages(table)
  const height =
    padding * 2 +
    titleHeight +
    headerHeight +
    rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0)

  const scale = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)

  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持 Canvas 导出')

  context.scale(scale, scale)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)

  context.fillStyle = '#020617'
  context.font = '700 24px Inter, system-ui, sans-serif'
  context.fillText(table.title, padding, padding + 24)
  context.fillStyle = '#64748b'
  context.font = '13px Inter, system-ui, sans-serif'
  context.fillText(table.subtitle, padding, padding + 50)

  const domain = window.location.href
  if (domain) {
    context.fillStyle = '#94a3b8'
    context.font = '12px Inter, system-ui, sans-serif'
    context.textAlign = 'right'
    context.fillText('分享自 ' + domain, width - padding, padding + 24)
    context.textAlign = 'start'
  }

  let y = padding + titleHeight
  let x = padding
  context.fillStyle = '#f8fafc'
  context.fillRect(padding, y, tableWidth, headerHeight)
  context.strokeStyle = '#e2e8f0'
  context.strokeRect(padding, y, tableWidth, headerHeight)

  table.columns.forEach((column) => {
    context.fillStyle = '#475569'
    context.font = '700 12px Inter, system-ui, sans-serif'
    context.fillText(column.title, x + 12, y + 26)
    context.strokeStyle = '#e2e8f0'
    context.beginPath()
    context.moveTo(x + column.width, y)
    context.lineTo(x + column.width, y + headerHeight)
    context.stroke()
    x += column.width
  })
  y += headerHeight

  wrappedRows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex]
    context.fillStyle = rowIndex % 2 === 0 ? '#ffffff' : '#f8fafc'
    context.fillRect(padding, y, tableWidth, rowHeight)
    context.strokeStyle = '#e2e8f0'
    context.strokeRect(padding, y, tableWidth, rowHeight)

    x = padding
    row.forEach((lines, columnIndex) => {
      const cell = table.rows[rowIndex][columnIndex]
      const column = table.columns[columnIndex]
      context.fillStyle = '#334155'
      context.font = '13px Inter, system-ui, sans-serif'
      let textX = x + 12
      const image = cell.imageUrl ? exportImages.get(cell.imageUrl) : undefined
      if (image) {
        const imageWidth = 42
        const imageHeight = Math.min(
          Math.round(imageWidth * (80 / 56)),
          rowHeight - rowPaddingY * 2,
        )
        context.save()
        roundedRect(
          context,
          x + 12,
          y + rowPaddingY,
          imageWidth,
          imageHeight,
          6,
        )
        context.clip()
        context.drawImage(
          image,
          x + 12,
          y + rowPaddingY,
          imageWidth,
          imageHeight,
        )
        context.restore()
        textX += imageWidth + 12
      }
      lines.forEach((line, lineIndex) => {
        context.fillText(
          line,
          textX,
          y + rowPaddingY + 14 + lineIndex * lineHeight,
        )
      })
      context.strokeStyle = '#e2e8f0'
      context.beginPath()
      context.moveTo(x + column.width, y)
      context.lineTo(x + column.width, y + rowHeight)
      context.stroke()
      x += column.width
    })

    y += rowHeight
  })

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('图片导出失败'))
    }, `image/${format}`)
  })
}

async function loadExportImages(table: CanvasTable) {
  const urls = Array.from(
    new Set(
      table.rows
        .flatMap((row) => row.map((cell) => cell.imageUrl))
        .filter((url): url is string => Boolean(url)),
    ),
  )
  const entries = await Promise.all(
    urls.map(async (url) => {
      const image = await loadCorsImage(url).catch(() => undefined)
      return [url, image] as const
    }),
  )

  return new Map(
    entries.filter(
      (entry): entry is readonly [string, HTMLImageElement] =>
        entry[1] !== undefined,
    ),
  )
}

function loadCorsImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片不允许跨域导出'))
    image.src = url
  })
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height,
  )
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
) {
  const lines: Array<string> = []
  value.split('\n').forEach((paragraph) => {
    const characters = Array.from(paragraph || ' ')
    let line = ''

    characters.forEach((character) => {
      const next = `${line}${character}`
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line)
        line = character
      } else {
        line = next
      }
    })

    lines.push(line)
  })

  return lines
}

function formatExportStats(result: FastCapParseResult) {
  return `资源 ${result.stats.resources} · 剧集 ${result.stats.episodes} · 片段 ${result.stats.clips} · ${new Date().toLocaleString()}`
}

function formatExportEpisodeMeta(
  episode: FastCapEpisodeRow,
  metadata?: FastCapEpisodeMetadata,
) {
  return [
    metadata?.title ?? `EP ${episode.tempEpId}`,
    formatEpisodeDetails(metadata),
    metadata?.subtitle || formatRefs(episode.refs),
  ]
    .filter(Boolean)
    .join('\n')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function formatFileTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function toMetadataPayload(episode: FastCapEpisodeRow) {
  return {
    key: episode.key,
    refs: episode.refs,
  }
}

async function resolveMetadataClientFirst(
  episode: ReturnType<typeof toMetadataPayload>,
) {
  try {
    return await getClientEpisodeMetadata(episode)
  } catch (clientError) {
    try {
      const result = await getFastCapEpisodeMetadata({
        data: { episodes: [episode] },
      })
      return result[episode.key] ?? fallbackMetadata(episode, clientError)
    } catch (serverError) {
      return fallbackMetadata(
        episode,
        `client: ${getErrorMessage(clientError)}；server: ${getErrorMessage(
          serverError,
        )}`,
      )
    }
  }
}

function fallbackMetadata(
  episode: ReturnType<typeof toMetadataPayload>,
  error?: unknown,
) {
  return {
    key: episode.key,
    title: fallbackMetadataTitle(episode.refs),
    subtitle: formatRefs(episode.refs),
    status: 'fallback',
    error: error ? getErrorMessage(error) : undefined,
  } satisfies FastCapEpisodeMetadata
}

function FastCapEditor(props: {
  draft: FastCapJson
  error?: string
  collapsed: boolean
  syncConnected: boolean
  readOnlyPreview: boolean
  syncContext?: EditorContext
  metadata?: Record<string, FastCapEpisodeMetadata>
  currentCid?: string
  requestPlayerTime?: (cid: string) => Promise<number>
  onApply: () => void
  onOpenReadOnlyPreview?: () => void
  onToggleCollapsed: () => void
  onChange: (next: FastCapJson) => void
}) {
  const [advancedOpen, setAdvancedOpen] = createSignal(false)
  const timelineAvailable = createMemo(
    () =>
      props.syncConnected &&
      (props.draft.f.length > 0 || Boolean(props.syncContext?.pages.length)),
  )
  const missingSyncPages = createMemo(() => {
    if (!props.syncConnected || !props.syncContext) return []
    const resourceCids = new Set(props.draft.f.map((resource) => resource.id))
    return props.syncContext.pages.filter((page) => !resourceCids.has(page.cid))
  })
  const updateResource = (
    resourceIndex: number,
    updater: (resource: FastCapResource) => FastCapResource,
  ) => {
    props.onChange({
      f: props.draft.f.map((resource, index) =>
        index === resourceIndex ? updater(resource) : resource,
      ),
    })
  }

  const addResource = () => {
    let resourceId = ''
    if (props.syncConnected) {
      const syncPage = missingSyncPages().find((_page, index) => index === 0)
      if (!syncPage) return
      resourceId = syncPage.cid
    }
    props.onChange({
      f: [
        ...props.draft.f,
        {
          i: 'bili_cid',
          id: resourceId,
          p: [],
          t: {
            1: createEmptyEpisodeRef(),
          },
        },
      ],
    })
  }

  const deleteResource = (resourceIndex: number) => {
    props.onChange({
      f: props.draft.f.filter((_, index) => index !== resourceIndex),
    })
  }

  return (
    <div class="min-w-0 rounded-lg border border-border bg-background p-4">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-start gap-2">
          <button
            type="button"
            aria-label={
              props.collapsed ? '展开可视化编辑器' : '折叠可视化编辑器'
            }
            title={props.collapsed ? '展开' : '折叠'}
            class="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={props.onToggleCollapsed}
          >
            <ChevronDown
              class="h-4 w-4 transition-transform"
              collapsed={props.collapsed}
            />
          </button>
          <div class="min-w-0">
            <h2 class="m-0 text-lg font-semibold text-foreground">
              可视化编辑器
            </h2>
            <p class="mt-1 mb-0 text-xs text-muted-foreground">
              {timelineAvailable()
                ? '拖动时间轴编辑草稿，点击应用后更新配置文本和表格。'
                : props.readOnlyPreview
                  ? '本页调整仅用于预览和导出；主编辑页的新草稿会覆盖本地调整。'
                  : '改动保存在草稿中，点击应用后才会更新配置文本和表格。'}
            </p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <Show when={!props.collapsed}>
            <Show when={props.onOpenReadOnlyPreview}>
              {(openPreview) => (
                <button
                  type="button"
                  class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-muted"
                  onClick={openPreview()}
                >
                  预览 / 导出
                </button>
              )}
            </Show>
            <button
              type="button"
              disabled={props.syncConnected && missingSyncPages().length === 0}
              title={
                props.syncConnected && missingSyncPages().length === 0
                  ? '同步中的所有分P都已有资源'
                  : undefined
              }
              class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              onClick={addResource}
            >
              {props.syncConnected
                ? missingSyncPages().length > 0
                  ? `新增分P资源 (${missingSyncPages().length})`
                  : '分P资源已齐'
                : '新增资源'}
            </button>
            <button
              type="button"
              disabled={props.readOnlyPreview}
              title={
                props.readOnlyPreview ? '只读预览不能应用到最终配置' : undefined
              }
              class="rounded-md bg-foreground px-3 py-1.5 text-sm font-semibold text-background transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
              onClick={props.onApply}
            >
              应用到配置
            </button>
          </Show>
        </div>
      </div>

      <Show when={!props.collapsed}>
        <Show when={props.error}>
          {(message) => (
            <p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {message()}
            </p>
          )}
        </Show>

        <Show when={timelineAvailable()}>
          <div class="mb-4 flex flex-col gap-3">
            <FastCapTimeline
              draft={props.draft}
              context={props.syncContext}
              metadata={props.metadata}
              syncConnected={props.syncConnected}
              requestPlayerTime={props.requestPlayerTime}
              onChange={props.onChange}
              onError={(message) => {
                if (message) void showErrorToast(message)
              }}
              renderEpisodeEditor={(resourceIndex) => (
                <ResourceEditor
                  resource={props.draft.f[resourceIndex]}
                  resourceIndex={resourceIndex}
                  episodesOnly
                  syncConnected={props.syncConnected}
                  currentCid={props.currentCid}
                  requestPlayerTime={props.requestPlayerTime}
                  onChange={(next) => updateResource(resourceIndex, () => next)}
                  onDelete={() => deleteResource(resourceIndex)}
                />
              )}
            />
            <div class="flex justify-end">
              <button
                type="button"
                aria-expanded={advancedOpen()}
                class="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                {advancedOpen() ? '收起高级表单编辑' : '展开高级表单编辑'}
              </button>
            </div>
          </div>
        </Show>

        <Show when={!timelineAvailable() || advancedOpen()}>
          <div class="flex flex-col gap-4">
            <Show
              when={props.draft.f.length > 0}
              fallback={
                <div class="rounded-md border border-dashed border-border bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
                  还没有资源。点击“新增资源”开始创建 fastcap 配置。
                </div>
              }
            >
              <Index each={props.draft.f}>
                {(resource, resourceIndex) => (
                  <ResourceEditor
                    resource={resource()}
                    resourceIndex={resourceIndex}
                    syncConnected={props.syncConnected}
                    currentCid={props.currentCid}
                    requestPlayerTime={props.requestPlayerTime}
                    onChange={(next) =>
                      updateResource(resourceIndex, () => next)
                    }
                    onDelete={() => deleteResource(resourceIndex)}
                  />
                )}
              </Index>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function ChevronDown(props: { class: string; collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class={props.class}
      classList={{ '-rotate-90': props.collapsed }}
    >
      <path
        fill="currentColor"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
      />
    </svg>
  )
}

function ResourceEditor(props: {
  resource: FastCapResource
  resourceIndex: number
  episodesOnly?: boolean
  syncConnected: boolean
  currentCid?: string
  requestPlayerTime?: (cid: string) => Promise<number>
  onChange: (next: FastCapResource) => void
  onDelete: () => void
}) {
  const episodeEntries = createMemo(() =>
    Object.entries(props.resource.t).sort(
      ([left], [right]) => Number(left) - Number(right),
    ),
  )

  const setResource = (patch: Partial<FastCapResource>) => {
    props.onChange({ ...props.resource, ...patch })
  }

  const addEpisode = () => {
    const nextId = getNextEpisodeId(props.resource)
    props.onChange({
      ...props.resource,
      t: {
        ...props.resource.t,
        [nextId]: createEmptyEpisodeRef(),
      },
    })
  }

  const updateEpisodeId = (oldId: string, newValue: string) => {
    const newId = Number.parseInt(newValue, 10)
    if (!Number.isInteger(newId) || newId <= 0) return
    const refs = props.resource.t[oldId]
    const nextT = { ...props.resource.t }
    delete nextT[oldId]
    nextT[String(newId)] = refs
    const oldNumericId = Number.parseInt(oldId, 10)
    props.onChange({
      ...props.resource,
      t: nextT,
      p: props.resource.p.map((clip) =>
        clip[3] === oldNumericId ? [clip[0], clip[1], clip[2], newId] : clip,
      ),
    })
  }

  const updateEpisodeRefs = (
    id: string,
    patch: { bgmtv_epid?: string; tmdb_urlc?: string },
  ) => {
    props.onChange({
      ...props.resource,
      t: {
        ...props.resource.t,
        [id]: normalizeEpisodeRef({
          ...props.resource.t[id],
          ...patch,
        }),
      },
    })
  }

  // BgmTv 搜索弹窗
  const [bgmtvModalOpen, setBgmtvModalOpen] = createSignal(false)
  const [bgmtvResults, setBgmtvResults] = createSignal<
    Array<{ id: number; name: string; name_cn: string }>
  >([])
  const [bgmtvEpisodes, setBgmtvEpisodes] = createSignal<
    Array<{
      id: number
      name: string
      name_cn: string
      sort?: number
      ep?: number
    }>
  >([])
  const [bgmtvSelectedSubject, setBgmtvSelectedSubject] = createSignal<{
    id: number
    name: string
    name_cn: string
  } | null>(null)
  const [bgmtvLoading, setBgmtvLoading] = createSignal(false)
  const [bgmtvTarget, setBgmtvTarget] = createSignal<{
    episodeId: string
  } | null>(null)

  const openBgmtvModal = (episodeId: string) => {
    setBgmtvTarget({ episodeId })
    setBgmtvResults([])
    setBgmtvEpisodes([])
    setBgmtvSelectedSubject(null)
    setBgmtvModalOpen(true)
  }
  const closeBgmtvModal = () => setBgmtvModalOpen(false)

  const searchBgmTv = async () => {
    const keyword = searchStore.state.query.trim()
    if (!keyword) return
    setBgmtvLoading(true)
    try {
      const bgmtv = new BgmTv(env.VITE_BGMTV_API_URL)
      const result = await bgmtv.searchSubjects(keyword)
      setBgmtvResults(
        result.v0.search.subjects['<post>'].data.map(
          (s: { id: number; name: string; name_cn: string }) => ({
            id: s.id,
            name: s.name,
            name_cn: s.name_cn,
          }),
        ),
      )
    } catch {
      setBgmtvResults([])
    } finally {
      setBgmtvLoading(false)
    }
  }

  const selectBgmTvSubject = async (subject: {
    id: number
    name: string
    name_cn: string
  }) => {
    setBgmtvSelectedSubject(subject)
    setBgmtvLoading(true)
    try {
      const bgmtv = new BgmTv(env.VITE_BGMTV_API_URL)
      const result = await bgmtv.listEpisodes(subject.id)
      setBgmtvEpisodes(
        result.v0.episodes.data.map((e) => ({
          id: e.id,
          name: e.name,
          name_cn: e.name_cn,
          sort: e.sort,
          ep: e.ep ?? undefined,
        })),
      )
    } catch {
      setBgmtvEpisodes([])
    } finally {
      setBgmtvLoading(false)
    }
  }

  const selectBgmTvEpisode = (episode: { id: number }) => {
    const target = bgmtvTarget()
    if (!target) return
    updateEpisodeRefs(target.episodeId, { bgmtv_epid: String(episode.id) })
    closeBgmtvModal()
  }

  // TMDB 搜索弹窗
  const [tmdbModalOpen, setTmdbModalOpen] = createSignal(false)
  const [tmdbTab, setTmdbTab] = createSignal<'tv' | 'movie'>('tv')
  const [tmdbTVResults, setTmdbTVResults] = createSignal<
    Array<{ id: number; name: string; original_name: string }>
  >([])
  const [tmdbMovieResults, setTmdbMovieResults] = createSignal<
    Array<{ id: number; title: string; original_title: string }>
  >([])
  const [tmdbSeasons, setTmdbSeasons] = createSignal<
    Array<{ season_number: number; name: string; episode_count: number }>
  >([])
  const [tmdbEpisodes, setTmdbEpisodes] = createSignal<
    Array<{ episode_number: number; name: string; season_number: number }>
  >([])
  const [tmdbSelectedSeries, setTmdbSelectedSeries] = createSignal<{
    id: number
    name: string
  } | null>(null)
  const [tmdbSelectedSeason, setTmdbSelectedSeason] = createSignal<{
    season_number: number
    name: string
  } | null>(null)
  const [tmdbLoading, setTmdbLoading] = createSignal(false)
  const [tmdbTarget, setTmdbTarget] = createSignal<{
    episodeId: string
  } | null>(null)

  const openTmdbModal = (episodeId: string) => {
    setTmdbTarget({ episodeId })
    setTmdbTVResults([])
    setTmdbMovieResults([])
    setTmdbSeasons([])
    setTmdbEpisodes([])
    setTmdbSelectedSeries(null)
    setTmdbSelectedSeason(null)
    setTmdbModalOpen(true)
  }
  const closeTmdbModal = () => setTmdbModalOpen(false)

  const searchTmdb = async () => {
    const query = searchStore.state.query.trim()
    if (!query) return
    setTmdbLoading(true)
    try {
      const tmdb = new TMDB()
      const result = await tmdb.searchMulti(query)
      const multi = result.search.multi.results
      setTmdbTVResults(
        multi
          .filter((r) => r.media_type === 'tv')
          .map((r) => ({
            id: r.id,
            name: r.name ?? '',
            original_name: r.original_name ?? '',
          })),
      )
      setTmdbMovieResults(
        multi
          .filter((r) => r.media_type === 'movie')
          .map((r) => ({
            id: r.id,
            title: r.title ?? '',
            original_title: r.original_title ?? '',
          })),
      )
    } catch {
      setTmdbTVResults([])
      setTmdbMovieResults([])
    } finally {
      setTmdbLoading(false)
    }
  }

  const selectTmdbSeries = async (series: { id: number; name: string }) => {
    setTmdbSelectedSeries(series)
    setTmdbLoading(true)
    try {
      const tmdb = new TMDB()
      const result = await tmdb.getTVSeriesInfo(`tv/${series.id}`)
      const seasons = (result.tv.series.seasons ?? [])
        .filter((s) => s.season_number > 0)
        .map((s) => ({
          season_number: s.season_number,
          name: s.name,
          episode_count: s.episode_count ?? 0,
        }))
      setTmdbSeasons(seasons)
    } catch {
      setTmdbSeasons([])
    } finally {
      setTmdbLoading(false)
    }
  }

  const selectTmdbSeason = async (season: {
    season_number: number
    name: string
  }) => {
    setTmdbSelectedSeason(season)
    const series = tmdbSelectedSeries()
    if (!series) return
    setTmdbLoading(true)
    try {
      const tmdb = new TMDB()
      const result = await tmdb.getTVSeasonInfo(
        `tv/${series.id}/season/${season.season_number}`,
      )
      setTmdbEpisodes(
        result.tv.season.episodes?.map((e) => ({
          episode_number: e.episode_number,
          name: e.name,
          season_number: e.season_number,
        })) ?? [],
      )
    } catch {
      setTmdbEpisodes([])
    } finally {
      setTmdbLoading(false)
    }
  }

  const selectTmdbEpisode = (episode: {
    episode_number: number
    season_number: number
  }) => {
    const target = tmdbTarget()
    const series = tmdbSelectedSeries()
    if (!target || !series) return
    const urlc = `tv/${series.id}/season/${episode.season_number}/episode/${episode.episode_number}`
    updateEpisodeRefs(target.episodeId, { tmdb_urlc: urlc })
    closeTmdbModal()
  }

  const selectTmdbMovie = (movie: { id: number }) => {
    const target = tmdbTarget()
    if (!target) return
    updateEpisodeRefs(target.episodeId, { tmdb_urlc: `movie/${movie.id}` })
    closeTmdbModal()
  }

  const deleteEpisode = (id: string) => {
    const numericId = Number.parseInt(id, 10)
    if (props.resource.p.some((clip) => clip[3] === numericId)) return
    const nextT = { ...props.resource.t }
    delete nextT[id]
    props.onChange({
      ...props.resource,
      t: nextT,
    })
  }

  const addClip = () => {
    const firstEpisodeId =
      Number.parseInt(Object.keys(props.resource.t)[0] ?? '1', 10) || 1
    props.onChange({
      ...props.resource,
      p: [...props.resource.p, [0, 0, 0, firstEpisodeId]],
    })
  }

  const updateClip = (
    clipIndex: number,
    next: [number, number, number, number],
  ) => {
    props.onChange({
      ...props.resource,
      p: props.resource.p.map((clip, index) =>
        index === clipIndex ? next : clip,
      ),
    })
  }

  const deleteClip = (clipIndex: number) => {
    props.onChange({
      ...props.resource,
      p: props.resource.p.filter((_, index) => index !== clipIndex),
    })
  }

  return (
    <section
      classList={{
        'rounded-lg border border-border bg-muted p-4': !props.episodesOnly,
        'min-w-0': props.episodesOnly,
      }}
    >
      <Show when={!props.episodesOnly}>
        <div class="mb-4 flex flex-wrap items-end gap-3">
          <label class="flex min-w-32 flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground">
            索引类型
            <input
              value={props.resource.i}
              readOnly
              class="rounded-md border border-border bg-muted px-2 py-1.5 text-sm font-medium text-muted-foreground"
            />
          </label>
          <label class="flex min-w-48 flex-[2] flex-col gap-1 text-xs font-semibold text-muted-foreground">
            资源 ID
            <input
              value={props.resource.id}
              onInput={(event) =>
                setResource({ id: event.currentTarget.value })
              }
              class="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <button
            type="button"
            class="rounded-md border border-red-200 bg-background px-3 py-1.5 text-sm font-semibold text-red-700 transition hover:bg-red-50"
            onClick={props.onDelete}
          >
            删除资源
          </button>
        </div>
      </Show>

      <div
        class="grid gap-4"
        classList={{ '2xl:grid-cols-2': !props.episodesOnly }}
      >
        <div
          classList={{
            'rounded-md border border-border bg-background p-3':
              !props.episodesOnly,
          }}
        >
          <div
            class="mb-3 flex items-center gap-3"
            classList={{
              'justify-between': !props.episodesOnly,
              'justify-end': props.episodesOnly,
            }}
          >
            <Show when={!props.episodesOnly}>
              <h3 class="m-0 text-sm font-semibold text-foreground">剧集表</h3>
            </Show>
            <button
              type="button"
              class="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground transition hover:bg-muted"
              onClick={addEpisode}
            >
              新建剧集
            </button>
          </div>
          <div class="flex flex-col gap-3">
            <Index each={episodeEntries()}>
              {(entry) => {
                const id = () => entry()[0]
                const refs = () => entry()[1]

                return (
                  <div class="grid gap-2 rounded-md border border-border bg-muted p-3 md:grid-cols-[5rem_minmax(0,1fr)]">
                    <label class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                      Ep ID
                      <input
                        type="number"
                        min="1"
                        value={id()}
                        onChange={(event) =>
                          updateEpisodeId(id(), event.currentTarget.value)
                        }
                        class="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                      />
                    </label>
                    <div class="grid gap-2 md:grid-cols-2">
                      <label class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                        bgmtv_epid
                        <div class="flex gap-1">
                          <input
                            value={refs().bgmtv_epid ?? ''}
                            onInput={(event) =>
                              updateEpisodeRefs(id(), {
                                bgmtv_epid: event.currentTarget.value,
                              })
                            }
                            class="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                          />
                          <button
                            type="button"
                            onClick={() => openBgmtvModal(id())}
                            class="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            title="搜索 Bangumi 剧集"
                          >
                            🔍
                          </button>
                        </div>
                      </label>
                      <label class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                        tmdb_urlc
                        <div class="flex gap-1">
                          <input
                            value={refs().tmdb_urlc ?? ''}
                            onInput={(event) =>
                              updateEpisodeRefs(id(), {
                                tmdb_urlc: event.currentTarget.value,
                              })
                            }
                            class="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                          />
                          <button
                            type="button"
                            onClick={() => openTmdbModal(id())}
                            class="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            title="搜索 TMDB 影视"
                          >
                            🔍
                          </button>
                        </div>
                      </label>
                    </div>
                    <div class="md:col-span-2 flex items-center justify-end">
                      <button
                        type="button"
                        disabled={props.resource.p.some(
                          (clip) => clip[3] === Number.parseInt(id(), 10),
                        )}
                        class="rounded-md border border-red-200 bg-background px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => deleteEpisode(id())}
                      >
                        删除剧集
                      </button>
                    </div>
                  </div>
                )
              }}
            </Index>
          </div>
        </div>

        <Show when={!props.episodesOnly}>
          <div class="rounded-md border border-border bg-background p-3">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h3 class="m-0 text-sm font-semibold text-foreground">片段</h3>
              <button
                type="button"
                class="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground transition hover:bg-muted"
                onClick={addClip}
              >
                新增片段
              </button>
            </div>
            <div class="flex flex-col gap-3">
              <Index each={props.resource.p}>
                {(clip, clipIndex) => (
                  <ClipEditor
                    clip={clip()}
                    clipIndex={clipIndex}
                    resourceCid={props.resource.id}
                    syncConnected={props.syncConnected}
                    currentCid={props.currentCid}
                    requestPlayerTime={props.requestPlayerTime}
                    episodeIds={episodeEntries().map(([id]) =>
                      Number.parseInt(id, 10),
                    )}
                    onChange={(next) => updateClip(clipIndex, next)}
                    onDelete={() => deleteClip(clipIndex)}
                  />
                )}
              </Index>
            </div>
          </div>
        </Show>
      </div>

      {/* BgmTv 搜索弹窗 */}
      <Show when={bgmtvModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4">
          <div class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
            <div class="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 class="m-0 text-lg font-semibold text-foreground">
                搜索 Bangumi 剧集
              </h2>
              <button
                type="button"
                onClick={closeBgmtvModal}
                class="rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground transition hover:bg-muted"
              >
                ✕
              </button>
            </div>
            <div class="min-h-0 overflow-auto p-5">
              <SearchBox
                placeholder="输入作品名称搜索..."
                onSearch={searchBgmTv}
              />
              <Show when={bgmtvSelectedSubject()}>
                <div class="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <span>已选作品：</span>
                  <span class="font-medium text-foreground">
                    {bgmtvSelectedSubject()!.name_cn ||
                      bgmtvSelectedSubject()!.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setBgmtvSelectedSubject(null)
                      setBgmtvEpisodes([])
                    }}
                    class="text-xs text-muted-foreground hover:text-foreground"
                  >
                    重新选择
                  </button>
                </div>
              </Show>
              <div class="mt-3 flex max-h-96 flex-col gap-2 overflow-auto rounded-md border border-border p-2">
                <Show when={!bgmtvSelectedSubject()}>
                  <Index each={bgmtvResults()}>
                    {(subject) => (
                      <button
                        type="button"
                        onClick={() => selectBgmTvSubject(subject())}
                        class="rounded-md border border-border bg-muted p-3 text-left transition hover:bg-accent"
                      >
                        <div class="text-sm font-medium text-foreground">
                          {subject().name_cn || subject().name}
                        </div>
                        <Show
                          when={
                            subject().name_cn &&
                            subject().name_cn !== subject().name
                          }
                        >
                          <div class="mt-1 text-xs text-muted-foreground">
                            {subject().name}
                          </div>
                        </Show>
                      </button>
                    )}
                  </Index>
                </Show>
                <Show when={bgmtvSelectedSubject()}>
                  <Index each={bgmtvEpisodes()}>
                    {(episode) => (
                      <button
                        type="button"
                        onClick={() => selectBgmTvEpisode(episode())}
                        class="rounded-md border border-border bg-muted p-2 text-left transition hover:bg-accent"
                      >
                        <div class="text-sm text-foreground">
                          <Show when={episode().ep}>
                            <span class="font-semibold">EP{episode().ep}</span>
                            <span class="mx-1 text-muted-foreground">|</span>
                          </Show>
                          <Show when={!episode().ep && episode().sort}>
                            <span class="font-semibold">
                              第{episode().sort}话
                            </span>
                            <span class="mx-1 text-muted-foreground">|</span>
                          </Show>
                          {episode().name_cn || episode().name}
                        </div>
                      </button>
                    )}
                  </Index>
                </Show>
                <Show
                  when={
                    !bgmtvLoading() &&
                    searchStore.state.query &&
                    ((bgmtvSelectedSubject() && !bgmtvEpisodes().length) ||
                      (!bgmtvSelectedSubject() && !bgmtvResults().length))
                  }
                >
                  <p class="p-4 text-center text-sm text-muted-foreground">
                    无结果
                  </p>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* TMDB 搜索弹窗 */}
      <Show when={tmdbModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4">
          <div class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
            <div class="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 class="m-0 text-lg font-semibold text-foreground">
                搜索 TMDB 影视
              </h2>
              <button
                type="button"
                onClick={closeTmdbModal}
                class="rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground transition hover:bg-muted"
              >
                ✕
              </button>
            </div>
            <div class="min-h-0 overflow-auto p-5">
              <SearchBox
                placeholder="输入影视名称搜索..."
                onSearch={searchTmdb}
              />
              <div class="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setTmdbTab('tv')}
                  class="rounded-md px-3 py-1 text-sm font-medium transition"
                  classList={{
                    'bg-foreground text-background': tmdbTab() === 'tv',
                    'text-muted-foreground hover:text-foreground':
                      tmdbTab() !== 'tv',
                  }}
                >
                  电视剧
                </button>
                <button
                  type="button"
                  onClick={() => setTmdbTab('movie')}
                  class="rounded-md px-3 py-1 text-sm font-medium transition"
                  classList={{
                    'bg-foreground text-background': tmdbTab() === 'movie',
                    'text-muted-foreground hover:text-foreground':
                      tmdbTab() !== 'movie',
                  }}
                >
                  电影
                </button>
              </div>
              <Show when={tmdbSelectedSeries()}>
                <div class="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <span>已选：</span>
                  <span class="font-medium text-foreground">
                    {tmdbSelectedSeries()!.name}
                  </span>
                  <Show when={tmdbSelectedSeason()}>
                    <span>→</span>
                    <span class="font-medium text-foreground">
                      {tmdbSelectedSeason()!.name}
                    </span>
                  </Show>
                  <button
                    type="button"
                    onClick={() => {
                      setTmdbSelectedSeries(null)
                      setTmdbSelectedSeason(null)
                      setTmdbSeasons([])
                      setTmdbEpisodes([])
                    }}
                    class="text-xs text-muted-foreground hover:text-foreground"
                  >
                    重新选择
                  </button>
                </div>
              </Show>
              <div class="mt-3 flex max-h-80 flex-col gap-2 overflow-auto rounded-md border border-border p-2">
                <Show when={tmdbTab() === 'tv' && !tmdbSelectedSeries()}>
                  <Index each={tmdbTVResults()}>
                    {(series) => (
                      <button
                        type="button"
                        onClick={() => selectTmdbSeries(series())}
                        class="rounded-md border border-border bg-muted p-3 text-left transition hover:bg-accent"
                      >
                        <div class="text-sm font-medium text-foreground">
                          {series().name}
                        </div>
                        <Show when={series().original_name !== series().name}>
                          <div class="mt-1 text-xs text-muted-foreground">
                            {series().original_name}
                          </div>
                        </Show>
                      </button>
                    )}
                  </Index>
                </Show>
                <Show
                  when={
                    tmdbTab() === 'tv' &&
                    tmdbSelectedSeries() &&
                    !tmdbSelectedSeason()
                  }
                >
                  <Index each={tmdbSeasons()}>
                    {(season) => (
                      <button
                        type="button"
                        onClick={() => selectTmdbSeason(season())}
                        class="flex items-center justify-between rounded-md border border-border bg-muted p-2 text-left transition hover:bg-accent"
                      >
                        <span class="text-sm text-foreground">
                          {season().name}
                        </span>
                        <span class="text-xs text-muted-foreground">
                          {season().episode_count} 集
                        </span>
                      </button>
                    )}
                  </Index>
                </Show>
                <Show when={tmdbTab() === 'tv' && tmdbSelectedSeason()}>
                  <Index each={tmdbEpisodes()}>
                    {(episode) => (
                      <button
                        type="button"
                        onClick={() => selectTmdbEpisode(episode())}
                        class="rounded-md border border-border bg-muted p-2 text-left transition hover:bg-accent"
                      >
                        <span class="text-sm text-foreground">
                          <span class="font-semibold">
                            EP{episode().episode_number}
                          </span>
                          <span class="mx-1 text-muted-foreground">|</span>
                          {episode().name}
                        </span>
                      </button>
                    )}
                  </Index>
                </Show>
                <Show when={tmdbTab() === 'movie'}>
                  <Index each={tmdbMovieResults()}>
                    {(movie) => (
                      <button
                        type="button"
                        onClick={() => selectTmdbMovie(movie())}
                        class="rounded-md border border-border bg-muted p-3 text-left transition hover:bg-accent"
                      >
                        <div class="text-sm font-medium text-foreground">
                          {movie().title}
                        </div>
                        <Show when={movie().original_title !== movie().title}>
                          <div class="mt-1 text-xs text-muted-foreground">
                            {movie().original_title}
                          </div>
                        </Show>
                      </button>
                    )}
                  </Index>
                </Show>
                <Show
                  when={
                    !tmdbLoading() &&
                    searchStore.state.query &&
                    ((tmdbTab() === 'tv' &&
                      !tmdbSelectedSeries() &&
                      !tmdbTVResults().length) ||
                      (tmdbTab() === 'movie' && !tmdbMovieResults().length))
                  }
                >
                  <p class="p-4 text-center text-sm text-muted-foreground">
                    无结果
                  </p>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </section>
  )
}

function ClipEditor(props: {
  clip: [number, number, number, number]
  clipIndex: number
  resourceCid: string
  syncConnected: boolean
  currentCid?: string
  requestPlayerTime?: (cid: string) => Promise<number>
  episodeIds: Array<number>
  onChange: (next: [number, number, number, number]) => void
  onDelete: () => void
}) {
  const updateValue = (position: 0 | 1 | 2 | 3, value: number) => {
    const next: [number, number, number, number] = [...props.clip]
    next[position] = value
    props.onChange(next)
  }

  const playerTimeCapability = () => {
    if (!props.requestPlayerTime) return undefined
    return {
      ...getPlayerTimeAvailability(
        props.syncConnected,
        props.resourceCid,
        props.currentCid,
      ),
      request: () => props.requestPlayerTime!(props.resourceCid),
    }
  }

  return (
    <div class="rounded-md border border-border bg-muted p-3">
      <div class="mb-2 flex items-center justify-between gap-3">
        <p class="m-0 text-xs font-semibold text-muted-foreground">
          Clip {props.clipIndex}
        </p>
        <button
          type="button"
          class="rounded-md border border-red-200 bg-background px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
          onClick={props.onDelete}
        >
          删除片段
        </button>
      </div>
      <div class="grid gap-2 md:grid-cols-2">
        <TimestampField
          label="视频开始"
          value={props.clip[0]}
          playerTime={playerTimeCapability()}
          onChange={(value) => updateValue(0, value)}
        />
        <TimestampField
          label="视频结束"
          value={props.clip[1]}
          playerTime={playerTimeCapability()}
          onChange={(value) => updateValue(1, value)}
        />
        <TimestampField
          label="真实进度 offset"
          value={props.clip[2]}
          onChange={(value) => updateValue(2, value)}
        />
        <label class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          归属 Ep
          <select
            value={String(props.clip[3])}
            onChange={(event) =>
              updateValue(3, Number.parseInt(event.currentTarget.value, 10))
            }
            class="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            <For each={props.episodeIds}>
              {(id) => <option value={String(id)}>{id}</option>}
            </For>
          </select>
        </label>
      </div>
    </div>
  )
}

function TimestampField(props: {
  label: string
  value: number
  playerTime?: {
    enabled: boolean
    disabledReason?: string
    request: () => Promise<number>
  }
  onChange: (value: number) => void
}) {
  const [textValue, setTextValue] = createSignal(
    formatMilliseconds(props.value),
  )
  const [error, setError] = createSignal<string>()
  const [isReadingPlayerTime, setIsReadingPlayerTime] = createSignal(false)

  createEffect(() => {
    setTextValue(formatMilliseconds(props.value))
    setError()
  })

  const applyTimestamp = (value: string) => {
    setTextValue(value)
    try {
      props.onChange(parseProgressTimestamp(value))
      setError()
    } catch {
      setError('时间格式应为 00:00:00.000')
    }
  }

  const applyMilliseconds = (value: string) => {
    const next = Number.parseInt(value, 10)
    if (!Number.isFinite(next) || next < 0) {
      setError('毫秒值必须是非负整数')
      return
    }
    props.onChange(next)
    setTextValue(formatMilliseconds(next))
    setError()
  }

  const readPlayerTime = async () => {
    if (!props.playerTime?.enabled || isReadingPlayerTime()) return
    setIsReadingPlayerTime(true)
    setError()
    try {
      const milliseconds = await props.playerTime.request()
      if (!Number.isInteger(milliseconds) || milliseconds < 0) {
        throw new Error('播放器返回了无效进度')
      }
      props.onChange(milliseconds)
      setTextValue(formatMilliseconds(milliseconds))
    } catch (playerTimeError) {
      setError(getErrorMessage(playerTimeError))
    } finally {
      setIsReadingPlayerTime(false)
    }
  }

  return (
    <div class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
      <div class="flex min-h-6 items-center justify-between gap-2">
        <span>{props.label}</span>
        <Show when={props.playerTime}>
          {(capability) => (
            <button
              type="button"
              disabled={!capability().enabled || isReadingPlayerTime()}
              title={capability().disabledReason ?? '读取 B 站播放器当前进度'}
              class="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void readPlayerTime()}
            >
              {isReadingPlayerTime() ? '读取中…' : '当前进度'}
            </button>
          )}
        </Show>
      </div>
      <label class="contents">
        <span class="sr-only">{props.label}时间文本</span>
        <input
          value={textValue()}
          onChange={(event) => applyTimestamp(event.currentTarget.value)}
          class="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
        />
      </label>
      <label class="contents">
        <span class="sr-only">{props.label}毫秒值</span>
        <input
          type="number"
          min="0"
          value={String(props.value)}
          onInput={(event) => applyMilliseconds(event.currentTarget.value)}
          class="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
        />
      </label>
      <Show when={error()}>
        {(message) => <span class="text-xs text-red-600">{message()}</span>}
      </Show>
      <Show when={props.playerTime?.disabledReason}>
        {(reason) => <span class="text-xs font-normal">{reason()}</span>}
      </Show>
    </div>
  )
}

function getNextEpisodeId(resource: FastCapResource) {
  const maxId = Object.keys(resource.t).reduce(
    (max, id) => Math.max(max, Number.parseInt(id, 10) || 0),
    0,
  )
  return maxId + 1
}

function normalizeEpisodeRef(refs: {
  bgmtv_epid?: string
  tmdb_urlc?: string
}) {
  return {
    bgmtv_epid: refs.bgmtv_epid ?? '',
    tmdb_urlc: refs.tmdb_urlc ?? '',
  }
}

function EpisodeTable(props: {
  episodes: Array<FastCapEpisodeRow>
  metadata?: Record<string, FastCapEpisodeMetadata>
  loading: boolean
  showImages: boolean
}) {
  return (
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full min-w-[980px] border-collapse text-left text-sm">
        <thead class="bg-muted text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <tr>
            <th class="px-3 py-3">Ep</th>
            <th class="px-3 py-3">剧集信息</th>
            <th class="px-3 py-3">索引</th>
            <th class="px-3 py-3">Clip</th>
            <th class="px-3 py-3">视频片段</th>
            <th class="px-3 py-3">真实进度</th>
            <th class="px-3 py-3">Offset</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.episodes}>
            {(episode) => (
              <Show
                when={episode.clips.length > 0}
                fallback={<EpisodeOnlyRow episode={episode} {...props} />}
              >
                <For each={episode.clips}>
                  {(clip, clipOffset) => (
                    <tr class="border-t border-border align-top">
                      <td class="px-3 py-3 font-mono text-foreground">
                        <Show when={clipOffset() === 0}>
                          {episode.tempEpId}
                          <span class="ml-1 text-xs text-muted-foreground">
                            f{episode.resourceIndex}
                          </span>
                        </Show>
                      </td>
                      <td class="max-w-72 px-3 py-3">
                        <Show when={clipOffset() === 0}>
                          <EpisodeMeta
                            episode={episode}
                            metadata={props.metadata?.[episode.key]}
                            loading={props.loading}
                            showImage={props.showImages}
                          />
                        </Show>
                      </td>
                      <td class="px-3 py-3 font-mono text-xs text-muted-foreground">
                        {episode.indexType}:{episode.resourceId}
                      </td>
                      <td class="px-3 py-3 font-mono text-foreground">
                        {clip.clipIndex}
                      </td>
                      <td class="px-3 py-3 font-mono text-xs text-foreground">
                        {formatMilliseconds(clip.videoBegin)} →{' '}
                        {formatMilliseconds(clip.videoEnd)}
                      </td>
                      <td class="px-3 py-3 font-mono text-xs text-foreground">
                        {formatMilliseconds(clip.realBegin)} →{' '}
                        {formatMilliseconds(clip.realEnd)}
                      </td>
                      <td class="px-3 py-3 font-mono text-xs text-foreground">
                        {formatMilliseconds(clip.offset)}
                      </td>
                    </tr>
                  )}
                </For>
              </Show>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}

function EpisodeOnlyRow(props: {
  episode: FastCapEpisodeRow
  metadata?: Record<string, FastCapEpisodeMetadata>
  loading: boolean
  showImages: boolean
}) {
  return (
    <tr class="border-t border-border align-top">
      <td class="px-3 py-3 font-mono text-foreground">
        {props.episode.tempEpId}
        <span class="ml-1 text-xs text-muted-foreground">
          f{props.episode.resourceIndex}
        </span>
      </td>
      <td class="max-w-72 px-3 py-3">
        <EpisodeMeta
          episode={props.episode}
          metadata={props.metadata?.[props.episode.key]}
          loading={props.loading}
          showImage={props.showImages}
        />
      </td>
      <td class="px-3 py-3 font-mono text-xs text-muted-foreground">
        {props.episode.indexType}:{props.episode.resourceId}
      </td>
      <td class="px-3 py-3 text-muted-foreground">无片段</td>
      <td class="px-3 py-3 text-muted-foreground">—</td>
      <td class="px-3 py-3 text-muted-foreground">—</td>
      <td class="px-3 py-3 text-muted-foreground">—</td>
    </tr>
  )
}

function IndexTable(props: {
  rows: Array<FastCapIndexRow>
  metadata?: Record<string, FastCapEpisodeMetadata>
  loading: boolean
  showImages: boolean
}) {
  return (
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full min-w-[1080px] border-collapse text-left text-sm">
        <thead class="bg-muted text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <tr>
            <th class="px-3 py-3">索引</th>
            <th class="px-3 py-3">Clip</th>
            <th class="px-3 py-3">视频片段</th>
            <th class="px-3 py-3">Ep</th>
            <th class="px-3 py-3">剧集信息</th>
            <th class="px-3 py-3">真实进度</th>
            <th class="px-3 py-3">Offset</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr class="border-t border-border align-top">
                <td class="px-3 py-3 font-mono text-xs text-muted-foreground">
                  f{row.resourceIndex} · {row.indexType}:{row.resourceId}
                </td>
                <td class="px-3 py-3 font-mono text-foreground">
                  p{row.clipIndex}
                </td>
                <td class="px-3 py-3 font-mono text-xs text-foreground">
                  {formatMilliseconds(row.videoBegin)} →{' '}
                  {formatMilliseconds(row.videoEnd)}
                </td>
                <td class="px-3 py-3 font-mono text-foreground">
                  {row.tempEpId}
                </td>
                <td class="max-w-72 px-3 py-3">
                  <EpisodeMeta
                    episode={{
                      key: row.episodeKey,
                      fIndex: row.fIndex,
                      resourceIndex: row.resourceIndex,
                      indexType: row.indexType,
                      resourceId: row.resourceId,
                      tempEpId: row.tempEpId,
                      refs: row.refs,
                      clips: [],
                    }}
                    metadata={props.metadata?.[row.episodeKey]}
                    loading={props.loading}
                    showImage={props.showImages}
                  />
                </td>
                <td class="px-3 py-3 font-mono text-xs text-foreground">
                  {formatMilliseconds(row.realBegin)} →{' '}
                  {formatMilliseconds(row.realEnd)}
                </td>
                <td class="px-3 py-3 font-mono text-xs text-foreground">
                  {formatMilliseconds(row.offset)}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}

function EpisodeMeta(props: {
  episode: FastCapEpisodeRow
  metadata?: FastCapEpisodeMetadata
  loading: boolean
  showImage: boolean
}) {
  const status = createMemo(() => props.metadata?.status)
  return (
    <div class="flex gap-3">
      <Show when={props.showImage && props.metadata?.imageUrl}>
        {(imageUrl) => (
          <img
            src={imageUrl()}
            alt=""
            crossorigin="anonymous"
            referrerpolicy="no-referrer"
            loading="lazy"
            class="h-20 w-14 flex-none rounded border border-border object-cover"
          />
        )}
      </Show>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <p class="m-0 font-medium text-foreground">
            {props.metadata?.title ?? `EP ${props.episode.tempEpId}`}
          </p>
          <Show when={props.loading}>
            <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              加载中
            </span>
          </Show>
          <Show when={status() === 'fallback'}>
            <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
              降级
            </span>
          </Show>
        </div>
        <Show
          when={
            props.metadata?.seriesTitle ||
            props.metadata?.seasonTitle ||
            props.metadata?.episodeLabel ||
            props.metadata?.duration
          }
        >
          <p class="mt-1 mb-0 text-xs text-foreground">
            {formatEpisodeDetails(props.metadata)}
          </p>
        </Show>
        <p class="mt-1 mb-0 text-xs text-muted-foreground">
          {props.metadata?.subtitle || formatRefs(props.episode.refs)}
        </p>
        <Show when={props.metadata?.error}>
          {(error) => <p class="mt-1 mb-0 text-xs text-amber-700">{error()}</p>}
        </Show>
      </div>
    </div>
  )
}

function StatCard(props: { label: string; value: number }) {
  return (
    <div class="min-w-20 rounded-md border border-border bg-muted px-3 py-2">
      <p class="m-0 text-xs text-muted-foreground">{props.label}</p>
      <p class="m-0 text-xl font-semibold text-foreground">{props.value}</p>
    </div>
  )
}

function ModeButton(props: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      classList={{
        'bg-background text-foreground shadow-sm': props.active,
        'text-muted-foreground hover:text-foreground': !props.active,
      }}
      class="rounded px-3 py-1.5 text-sm font-semibold transition"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function FormatButton(props: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      classList={{
        'bg-foreground text-background': props.active,
        'text-muted-foreground hover:text-foreground': !props.active,
      }}
      class="rounded px-3 py-1 text-sm font-semibold transition"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function formatRefs(refs: { bgmtv_epid?: string; tmdb_urlc?: string }) {
  return [
    refs.bgmtv_epid ? `Bangumi ${refs.bgmtv_epid}` : undefined,
    refs.tmdb_urlc ? `TMDB ${refs.tmdb_urlc}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

function formatEpisodeDetails(metadata?: FastCapEpisodeMetadata) {
  if (!metadata) return ''
  return [
    metadata.seriesTitle,
    metadata.seasonTitle,
    metadata.episodeLabel,
    metadata.duration ? `时长 ${metadata.duration}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

function fallbackMetadataTitle(refs: {
  bgmtv_epid?: string
  tmdb_urlc?: string
}) {
  if (refs.bgmtv_epid) return `Bangumi EP ${refs.bgmtv_epid}`
  if (refs.tmdb_urlc) return `TMDB ${refs.tmdb_urlc}`
  return '未提供第三方剧集 ID'
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
