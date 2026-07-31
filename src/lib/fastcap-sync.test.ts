import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  PAGE_TO_USERSCRIPT_BRIDGE,
  SYNC_NAMESPACE,
  SYNC_PROTOCOL_VERSION,
  USERSCRIPT_TO_PAGE_BRIDGE,
  compareSyncVersions,
  buildReadOnlyPreviewUrl,
  createFastCapSyncClient,
  createReadOnlyPreviewLauncher,
  createRemoteUpdateGuard,
  getPlayerTimeAvailability,
  isSyncEnvelope,
  isReadOnlyPreviewRequested,
  parseSyncSessionId,
} from './fastcap-sync'
import type { SyncEnvelope, SyncTransport } from './fastcap-sync'
import type { FastCapJson } from '~/shared/fastcap/model'

const sessionId = '0123456789abcdef0123456789abcdef'
const draft: FastCapJson = {
  f: [{ i: 'bili_cid', id: '100', p: [[0, 1000, 0, 1]], t: { 1: {} } }],
}

afterEach(() => vi.useRealTimers())

describe('fastcap sync protocol', () => {
  it('parses only a valid token from the hash', () => {
    expect(parseSyncSessionId(`#other=1&fastcap-sync=${sessionId}`)).toBe(
      sessionId,
    )
    expect(parseSyncSessionId('#fastcap-sync=short')).toBeUndefined()
    expect(parseSyncSessionId('#other=1')).toBeUndefined()
  })

  it('builds a read-only preview URL preserving the current session', () => {
    const url = new URL(
      buildReadOnlyPreviewUrl(
        `https://fastcap.example/?i=bili_cid&id=100#other=kept&fastcap-sync=${sessionId}`,
      ),
    )
    expect(url.searchParams.get('ro')).toBe('1')
    expect(url.searchParams.get('i')).toBe('bili_cid')
    expect(url.searchParams.get('id')).toBe('100')
    expect(new URLSearchParams(url.hash.slice(1)).get('other')).toBe('kept')
    expect(new URLSearchParams(url.hash.slice(1)).get('fastcap-sync')).toBe(
      sessionId,
    )
    expect(() => buildReadOnlyPreviewUrl('https://fastcap.example/')).toThrow(
      '当前页面没有有效的同步会话',
    )
    expect(isReadOnlyPreviewRequested(url.search)).toBe(true)
    expect(isReadOnlyPreviewRequested('?ro=true')).toBe(false)
  })

  it('opens one preview window and focuses it on repeated requests', () => {
    const opened: Array<{ url: string; target: string }> = []
    let focused = 0
    const launcher = createReadOnlyPreviewLauncher({
      openWindow: (url, target) => {
        opened.push({ url, target })
        return { closed: false, focus: () => (focused += 1) }
      },
      onBlocked: vi.fn(),
    })

    const href = `https://fastcap.example/editor?source=bili#fastcap-sync=${sessionId}`
    expect(launcher.open(href)).toBe(true)
    expect(launcher.open(href)).toBe(true)
    expect(opened).toHaveLength(1)
    expect(focused).toBe(1)
    expect(new URL(opened[0].url).searchParams.get('ro')).toBe('1')
    expect(parseSyncSessionId(new URL(opened[0].url).hash)).toBe(sessionId)
  })

  it('validates envelope identity and typed payloads', () => {
    expect(
      isSyncEnvelope(
        envelope({ type: 'draft', version: version(1), draft }),
        sessionId,
      ),
    ).toBe(true)
    expect(isSyncEnvelope(envelope({ type: 'unknown' }), sessionId)).toBe(false)
    expect(
      isSyncEnvelope(
        { ...envelope({ type: 'context', context: {} }), namespace: 'other' },
        sessionId,
      ),
    ).toBe(false)
  })

  it('orders Lamport versions by counter then sender id', () => {
    expect(
      compareSyncVersions(version(2, 'a'), version(1, 'z')),
    ).toBeGreaterThan(0)
    expect(
      compareSyncVersions(version(2, 'b'), version(2, 'a')),
    ).toBeGreaterThan(0)
    expect(compareSyncVersions(version(2, 'a'), version(2, 'a'))).toBe(0)
  })

  it('keeps the remote update guard active and restores it after errors', () => {
    const guard = createRemoteUpdateGuard()
    expect(guard.isActive()).toBe(false)
    expect(() =>
      guard.run(() => {
        expect(guard.isActive()).toBe(true)
        throw new Error('stop')
      }),
    ).toThrow('stop')
    expect(guard.isActive()).toBe(false)
  })

  it('enables player time only for the connected current CID', () => {
    expect(getPlayerTimeAvailability(false, '100', '100')).toMatchObject({
      enabled: false,
      disabledReason: '等待 B 站插件连接',
    })
    expect(getPlayerTimeAvailability(true, '200', '100')).toMatchObject({
      enabled: false,
      disabledReason: expect.stringContaining('CID 100'),
    })
    expect(getPlayerTimeAvailability(true, '100', '100')).toEqual({
      enabled: true,
      disabledReason: undefined,
    })
  })

  it('accepts optional safe page durations and rejects invalid durations', () => {
    const context = {
      bvid: 'BV1',
      currentCid: '100',
      pages: [
        { cid: '100', page: 1, title: 'P1', durationMilliseconds: 120_000 },
      ],
    }
    expect(isSyncEnvelope(envelope({ type: 'context', context }))).toBe(true)
    expect(
      isSyncEnvelope(
        envelope({
          type: 'context',
          context: {
            ...context,
            pages: [{ ...context.pages[0], durationMilliseconds: -1 }],
          },
        }),
      ),
    ).toBe(false)
    expect(
      isSyncEnvelope(
        envelope({
          type: 'context',
          context: {
            ...context,
            pages: [{ cid: '100', page: 1, title: 'legacy' }],
          },
        }),
      ),
    ).toBe(true)
  })
})

describe('FastCapSyncClient', () => {
  it('ignores stale drafts and clones accepted snapshots', () => {
    const transport = new FakeTransport()
    const client = createFastCapSyncClient(transport)!
    const received: Array<SyncEnvelope> = []
    const remoteDraft = structuredClone(draft)
    client.subscribe((message) => received.push(message))

    transport.receive(
      envelope({ type: 'draft', version: version(2), draft: remoteDraft }),
    )
    transport.receive(
      envelope({ type: 'draft', version: version(1), draft: { f: [] } }),
    )
    remoteDraft.f[0].id = 'mutated'

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      type: 'draft',
      draft: { f: [{ id: '100' }] },
    })
    client.dispose()
  })

  it('sends full cloned draft and apply snapshots with increasing versions', () => {
    const transport = new FakeTransport()
    const client = createFastCapSyncClient(transport)!
    const localDraft = structuredClone(draft)

    client.sendDraft(localDraft)
    client.sendApply(localDraft)
    localDraft.f[0].id = 'mutated-after-send'

    const sentDraft = transport.lastEnvelope('draft')
    const sentApply = transport.lastEnvelope('apply')
    expect(sentDraft.draft.f[0].id).toBe('100')
    expect(sentApply.config.f[0].id).toBe('100')
    expect(
      compareSyncVersions(sentApply.version, sentDraft.version),
    ).toBeGreaterThan(0)
    client.dispose()
  })

  it('does not disconnect the shared session when a preview is disposed', () => {
    const transport = new FakeTransport()
    const client = createFastCapSyncClient(transport, {
      disconnectOnDispose: false,
    })!
    client.dispose()
    expect(() => transport.lastEnvelope('disconnect')).toThrow()
  })

  it('resolves player time responses and rejects bridge errors', async () => {
    const transport = new FakeTransport()
    const client = createFastCapSyncClient(transport)!
    transport.receive(
      envelope({
        type: 'context',
        context: { bvid: 'BV1', currentCid: '100', pages: [] },
      }),
    )

    const success = client.requestPlayerTime('100')
    const request = transport.lastEnvelope('player-time-request')
    transport.receive(
      envelope({
        type: 'player-time-response',
        requestId: request.requestId,
        cid: '100',
        milliseconds: 1234,
      }),
    )
    await expect(success).resolves.toBe(1234)

    const failure = client.requestPlayerTime('100')
    const failedRequest = transport.lastEnvelope('player-time-request')
    transport.receive(
      envelope({
        type: 'player-time-response',
        requestId: failedRequest.requestId,
        cid: '100',
        error: '播放器尚未就绪',
      }),
    )
    await expect(failure).rejects.toThrow('播放器尚未就绪')
    client.dispose()
  })

  it('times out player requests and cleans them up', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const client = createFastCapSyncClient(transport, { requestTimeoutMs: 10 })!
    transport.receive(
      envelope({
        type: 'context',
        context: { bvid: 'BV1', currentCid: '100', pages: [] },
      }),
    )

    const pending = client.requestPlayerTime('100')
    const rejection = expect(pending).rejects.toThrow('读取播放器进度超时')
    await vi.advanceTimersByTimeAsync(10)
    await rejection
    client.dispose()
  })

  it('does nothing without a valid sync token', () => {
    const transport = new FakeTransport('#normal')
    expect(createFastCapSyncClient(transport)).toBeUndefined()
    expect(transport.messages).toHaveLength(0)
    expect(transport.messageListener).toBeUndefined()
  })
})

function version(counter: number, senderId = 'remote') {
  return { counter, senderId }
}

function envelope(payload: Record<string, unknown>) {
  return {
    namespace: SYNC_NAMESPACE,
    protocolVersion: SYNC_PROTOCOL_VERSION,
    sessionId,
    senderId: 'remote',
    messageId: crypto.randomUUID(),
    ...payload,
  } as SyncEnvelope
}

class FakeTransport implements SyncTransport {
  hash: string
  origin = 'https://fastcap.example'
  source = this
  messages: Array<{ message: unknown; targetOrigin: string }> = []
  messageListener?: (event: MessageEvent) => void
  pageHideListener?: () => void

  constructor(hash = `#fastcap-sync=${sessionId}`) {
    this.hash = hash
  }

  postMessage = (message: unknown, targetOrigin: string) => {
    this.messages.push({ message: structuredClone(message), targetOrigin })
  }

  addMessageListener = (listener: (event: MessageEvent) => void) => {
    this.messageListener = listener
  }

  removeMessageListener = (listener: (event: MessageEvent) => void) => {
    if (this.messageListener === listener) this.messageListener = undefined
  }

  addPageHideListener = (listener: () => void) => {
    this.pageHideListener = listener
  }

  removePageHideListener = (listener: () => void) => {
    if (this.pageHideListener === listener) this.pageHideListener = undefined
  }

  receive(message: SyncEnvelope) {
    this.messageListener?.({
      source: this.source,
      origin: this.origin,
      data: { bridge: USERSCRIPT_TO_PAGE_BRIDGE, envelope: message },
    } as unknown as MessageEvent)
  }

  lastEnvelope<T extends SyncEnvelope['type']>(type: T) {
    const item = [...this.messages].reverse().find(({ message }) => {
      const data = message as { bridge?: string; envelope?: SyncEnvelope }
      return (
        data.bridge === PAGE_TO_USERSCRIPT_BRIDGE &&
        data.envelope?.type === type
      )
    })
    return (item!.message as { envelope: Extract<SyncEnvelope, { type: T }> })
      .envelope
  }
}
