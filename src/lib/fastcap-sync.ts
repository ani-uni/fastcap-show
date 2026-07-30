import type { FastCapJson } from '~/shared/fastcap/model'

export const SYNC_NAMESPACE = 'fastcap-editor-sync'
export const SYNC_PROTOCOL_VERSION = 1
export const PAGE_TO_USERSCRIPT_BRIDGE = 'fastcap-page-to-userscript'
export const USERSCRIPT_TO_PAGE_BRIDGE = 'fastcap-userscript-to-page'

export type SyncStateVersion = { counter: number; senderId: string }
export type EditorContext = {
  bvid: string
  currentCid: string
  pages: Array<{ cid: string; page: number; title: string }>
}

type SyncPayload =
  | { type: 'ready'; reason?: string }
  | { type: 'disconnect'; reason?: string }
  | { type: 'context'; context: EditorContext }
  | { type: 'draft'; version: SyncStateVersion; draft: FastCapJson }
  | { type: 'apply'; version: SyncStateVersion; config: FastCapJson }
  | { type: 'player-time-request'; requestId: string; cid: string }
  | {
      type: 'player-time-response'
      requestId: string
      cid: string
      milliseconds?: number
      error?: string
    }

export type SyncEnvelope = {
  namespace: typeof SYNC_NAMESPACE
  protocolVersion: typeof SYNC_PROTOCOL_VERSION
  sessionId: string
  senderId: string
  messageId: string
} & SyncPayload

export type SyncClientEvent =
  | Extract<SyncEnvelope, { type: 'context' | 'disconnect' }>
  | Extract<SyncEnvelope, { type: 'draft' | 'apply' }>

export type SyncTransport = {
  hash: string
  origin: string
  source: unknown
  postMessage: (message: unknown, targetOrigin: string) => void
  addMessageListener: (listener: (event: MessageEvent) => void) => void
  removeMessageListener: (listener: (event: MessageEvent) => void) => void
  addPageHideListener: (listener: () => void) => void
  removePageHideListener: (listener: () => void) => void
}

export type FastCapSyncClient = {
  sessionId: string
  senderId: string
  sendDraft: (draft: FastCapJson) => void
  sendApply: (config: FastCapJson) => void
  requestPlayerTime: (cid: string) => Promise<number>
  subscribe: (handler: (event: SyncClientEvent) => void) => () => void
  dispose: () => void
}

type ClientOptions = {
  requestTimeoutMs?: number
  readyRetryMs?: number
  readyRetryCount?: number
}

type PendingPlayerTime = {
  cid: string
  resolve: (milliseconds: number) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export function parseSyncSessionId(hash: string) {
  const value = new URLSearchParams(
    hash.startsWith('#') ? hash.slice(1) : hash,
  ).get('fastcap-sync')
  return value && /^[a-f\d]{32}$/i.test(value) ? value : undefined
}

export function compareSyncVersions(
  left: SyncStateVersion,
  right: SyncStateVersion,
) {
  return (
    left.counter - right.counter || left.senderId.localeCompare(right.senderId)
  )
}

export function isSyncEnvelope(
  value: unknown,
  sessionId?: string,
): value is SyncEnvelope {
  if (!isRecord(value)) return false
  if (
    value.namespace !== SYNC_NAMESPACE ||
    value.protocolVersion !== SYNC_PROTOCOL_VERSION ||
    typeof value.sessionId !== 'string' ||
    (sessionId !== undefined && value.sessionId !== sessionId) ||
    typeof value.senderId !== 'string' ||
    typeof value.messageId !== 'string' ||
    typeof value.type !== 'string'
  ) {
    return false
  }

  switch (value.type) {
    case 'ready':
    case 'disconnect':
      return value.reason === undefined || typeof value.reason === 'string'
    case 'context':
      return isEditorContext(value.context)
    case 'draft':
      return isSyncVersion(value.version) && isFastCapJson(value.draft)
    case 'apply':
      return isSyncVersion(value.version) && isFastCapJson(value.config)
    case 'player-time-request':
      return (
        typeof value.requestId === 'string' && typeof value.cid === 'string'
      )
    case 'player-time-response':
      return (
        typeof value.requestId === 'string' &&
        typeof value.cid === 'string' &&
        (value.milliseconds === undefined ||
          (typeof value.milliseconds === 'number' &&
            Number.isInteger(value.milliseconds) &&
            value.milliseconds >= 0)) &&
        (value.error === undefined || typeof value.error === 'string') &&
        (value.milliseconds !== undefined || value.error !== undefined)
      )
    default:
      return false
  }
}

export function createRemoteUpdateGuard() {
  let depth = 0
  return {
    isActive: () => depth > 0,
    run<T>(callback: () => T) {
      depth += 1
      try {
        return callback()
      } finally {
        depth -= 1
      }
    },
  }
}

export function getPlayerTimeAvailability(
  connected: boolean,
  resourceCid: string,
  currentCid?: string,
) {
  if (!connected) {
    return { enabled: false, disabledReason: '等待 B 站插件连接' } as const
  }
  if (resourceCid !== currentCid) {
    return {
      enabled: false,
      disabledReason: `仅可读取当前分P（CID ${currentCid ?? '未知'}）`,
    } as const
  }
  return { enabled: true, disabledReason: undefined } as const
}

export function createFastCapSyncClient(
  transport: SyncTransport,
  options: ClientOptions = {},
): FastCapSyncClient | undefined {
  const sessionId = parseSyncSessionId(transport.hash)
  if (!sessionId) return undefined

  const senderId = createRandomId()
  const handlers = new Set<(event: SyncClientEvent) => void>()
  const pendingPlayerTimes = new Map<string, PendingPlayerTime>()
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000
  const readyRetryMs = options.readyRetryMs ?? 300
  const readyRetryCount = options.readyRetryCount ?? 5
  let clock = 0
  let lastAcceptedVersion: SyncStateVersion = { counter: 0, senderId: '' }
  let disposed = false
  let connected = false
  let readyAttempts = 0
  let readyTimer: ReturnType<typeof setInterval> | undefined

  const baseEnvelope = () => ({
    namespace: SYNC_NAMESPACE,
    protocolVersion: SYNC_PROTOCOL_VERSION,
    sessionId,
    senderId,
    messageId: createRandomId(),
  })

  const send = (payload: SyncPayload) => {
    if (disposed) return
    const envelope = { ...baseEnvelope(), ...structuredClone(payload) }
    transport.postMessage(
      { bridge: PAGE_TO_USERSCRIPT_BRIDGE, envelope },
      transport.origin,
    )
  }

  const nextVersion = () => {
    const version = { counter: ++clock, senderId }
    lastAcceptedVersion = version
    return version
  }

  const accepts = (version: SyncStateVersion) => {
    clock = Math.max(clock, version.counter)
    if (compareSyncVersions(version, lastAcceptedVersion) <= 0) return false
    lastAcceptedVersion = version
    return true
  }

  const stopReadyRetries = () => {
    if (readyTimer) clearInterval(readyTimer)
    readyTimer = undefined
  }

  const sendReady = () => {
    if (disposed || connected) return
    readyAttempts += 1
    send({ type: 'ready' })
    if (readyAttempts >= readyRetryCount) stopReadyRetries()
  }

  const handlePlayerTimeResponse = (
    envelope: Extract<SyncEnvelope, { type: 'player-time-response' }>,
  ) => {
    const pending = pendingPlayerTimes.get(envelope.requestId)
    if (!pending || pending.cid !== envelope.cid) return
    clearTimeout(pending.timeout)
    pendingPlayerTimes.delete(envelope.requestId)
    if (envelope.error) pending.reject(new Error(envelope.error))
    else pending.resolve(envelope.milliseconds!)
  }

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== transport.source || event.origin !== transport.origin)
      return
    const data = event.data as
      | {
          bridge?: unknown
          bridgeReady?: unknown
          sessionId?: unknown
          envelope?: unknown
        }
      | undefined
    if (data?.bridge !== USERSCRIPT_TO_PAGE_BRIDGE) return
    if (data.bridgeReady === true && data.sessionId === sessionId) {
      sendReady()
      return
    }
    if (!isSyncEnvelope(data.envelope, sessionId)) return
    const envelope = data.envelope
    if (envelope.senderId === senderId) return

    if (envelope.type === 'context') {
      connected = true
      stopReadyRetries()
      for (const handler of handlers) handler(structuredClone(envelope))
      return
    }
    if (envelope.type === 'disconnect') {
      connected = false
      for (const handler of handlers) handler(structuredClone(envelope))
      return
    }
    if (envelope.type === 'draft' || envelope.type === 'apply') {
      if (!accepts(envelope.version)) return
      for (const handler of handlers) handler(structuredClone(envelope))
      return
    }
    if (envelope.type === 'player-time-response') {
      handlePlayerTimeResponse(envelope)
    }
  }

  const dispose = () => {
    if (disposed) return
    send({ type: 'disconnect', reason: 'page-closed' })
    disposed = true
    stopReadyRetries()
    transport.removeMessageListener(handleMessage)
    transport.removePageHideListener(dispose)
    for (const pending of pendingPlayerTimes.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('同步连接已关闭'))
    }
    pendingPlayerTimes.clear()
    handlers.clear()
  }

  transport.addMessageListener(handleMessage)
  transport.addPageHideListener(dispose)
  sendReady()
  if (readyAttempts < readyRetryCount) {
    readyTimer = setInterval(sendReady, readyRetryMs)
  }

  return {
    sessionId,
    senderId,
    sendDraft(draft) {
      send({
        type: 'draft',
        version: nextVersion(),
        draft: structuredClone(draft),
      })
    },
    sendApply(config) {
      send({
        type: 'apply',
        version: nextVersion(),
        config: structuredClone(config),
      })
    },
    requestPlayerTime(cid) {
      if (!connected) return Promise.reject(new Error('尚未连接 B 站插件'))
      const requestId = createRandomId()
      return new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingPlayerTimes.delete(requestId)
          reject(new Error('读取播放器进度超时'))
        }, requestTimeoutMs)
        pendingPlayerTimes.set(requestId, { cid, resolve, reject, timeout })
        send({ type: 'player-time-request', requestId, cid })
      })
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    dispose,
  }
}

export function createWindowSyncTransport(): SyncTransport {
  return {
    hash: window.location.hash,
    origin: window.location.origin,
    source: window,
    postMessage: (message, targetOrigin) =>
      window.postMessage(message, targetOrigin),
    addMessageListener: (listener) =>
      window.addEventListener('message', listener),
    removeMessageListener: (listener) =>
      window.removeEventListener('message', listener),
    addPageHideListener: (listener) =>
      window.addEventListener('pagehide', listener),
    removePageHideListener: (listener) =>
      window.removeEventListener('pagehide', listener),
  }
}

function createRandomId() {
  return crypto.randomUUID()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isSyncVersion(value: unknown): value is SyncStateVersion {
  return (
    isRecord(value) &&
    Number.isInteger(value.counter) &&
    Number(value.counter) >= 0 &&
    typeof value.senderId === 'string'
  )
}

function isEditorContext(value: unknown): value is EditorContext {
  return (
    isRecord(value) &&
    typeof value.bvid === 'string' &&
    typeof value.currentCid === 'string' &&
    Array.isArray(value.pages) &&
    value.pages.every(
      (page) =>
        isRecord(page) &&
        typeof page.cid === 'string' &&
        Number.isInteger(page.page) &&
        typeof page.title === 'string',
    )
  )
}

function isFastCapJson(value: unknown): value is FastCapJson {
  return (
    isRecord(value) &&
    Array.isArray(value.f) &&
    value.f.every(
      (resource) =>
        isRecord(resource) &&
        resource.i === 'bili_cid' &&
        typeof resource.id === 'string' &&
        Array.isArray(resource.p) &&
        resource.p.every(
          (clip) =>
            Array.isArray(clip) &&
            clip.length === 4 &&
            clip.every(
              (item) => typeof item === 'number' && Number.isFinite(item),
            ),
        ) &&
        isRecord(resource.t) &&
        Object.values(resource.t).every(
          (refs) =>
            isRecord(refs) &&
            (refs.bgmtv_epid === undefined ||
              typeof refs.bgmtv_epid === 'string') &&
            (refs.tmdb_urlc === undefined ||
              typeof refs.tmdb_urlc === 'string'),
        ),
    )
  )
}
