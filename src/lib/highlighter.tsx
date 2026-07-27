import { createHighlighter, defineLanguage } from '@tanstack/highlight/core'
import { json } from '@tanstack/highlight/languages/json'
import { toml } from '@tanstack/highlight/languages/toml'
import { ts } from '@tanstack/highlight/languages/ts'
import { shell } from '@tanstack/highlight/languages/shell'
import type {
  HighlightToken,
  HighlightTokenClass,
  TokenRange,
} from '@tanstack/highlight/core'
import { For, Show } from 'solid-js'

const fastcapFenceLanguage = defineLanguage({
  name: 'fastcap',
  aliases: ['fastcap-toml'],
  tokenize(code, context) {
    const ranges: Array<TokenRange> = []
    const fenceStart = code.match(/^```fastcap[^\n]*(?:\n|$)/)

    if (!fenceStart) {
      return context.hasLanguage('toml') ? context.tokenize(code, 'toml') : []
    }

    ranges.push({
      start: 0,
      end: fenceStart[0].length,
      className: 'meta',
    })

    const closeStart = code.lastIndexOf('```')
    const bodyStart = fenceStart[0].length
    const bodyEnd = closeStart > bodyStart ? closeStart : code.length

    if (context.hasLanguage('toml')) {
      ranges.push(
        ...context.tokenize(code.slice(bodyStart, bodyEnd), 'toml').map(
          (range) =>
            ({
              ...range,
              start: range.start + bodyStart,
              end: range.end + bodyStart,
            }) satisfies TokenRange,
        ),
      )
    }

    if (closeStart > bodyStart) {
      ranges.push({
        start: closeStart,
        end: code.length,
        className: 'meta',
      })
    }

    return ranges
  },
})

const fastcapYueLanguage = defineLanguage({
  name: 'fastcap-yue',
  aliases: ['yue'],
  tokenize(code) {
    const ranges: Array<TokenRange> = []

    pushTokenMatches(
      ranges,
      code,
      /00:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}:\d{2}\.\d{3}/g,
      'literal',
    )
    pushTokenMatches(ranges, code, /\b\d+\b/g, 'number')
    pushTokenMatches(
      ranges,
      code,
      /\b(?:bgmtv_epid|tmdb_urlc|bili_cid)\b/g,
      'property',
    )
    pushTokenMatches(
      ranges,
      code,
      /本资源FastCap配置如下|对应实际剧集|归属下方剧集|索引|片段|剧集|标记了|共|从|到|ID/g,
      'keyword',
    )

    return ranges
  },
})

export const fastcapHighlighter = createHighlighter({
  languages: [fastcapFenceLanguage, fastcapYueLanguage, json, toml, shell, ts],
})

export function HighlightedTokens(props: { tokens: Array<HighlightToken> }) {
  return (
    <>
      <For each={props.tokens}>
        {(token) => (
          <Show when={token.className} fallback={<>{token.value}</>}>
            {(className) => (
              <span class={`th-token th-${className()}`}>{token.value}</span>
            )}
          </Show>
        )}
      </For>
      <Show when={props.tokens.length === 0}>{'\u00A0'}</Show>
    </>
  )
}

function pushTokenMatches(
  ranges: Array<TokenRange>,
  code: string,
  pattern: RegExp,
  className: HighlightTokenClass,
) {
  let match: RegExpExecArray | null

  while ((match = pattern.exec(code))) {
    pushTokenRange(ranges, {
      start: match.index,
      end: match.index + match[0].length,
      className,
    })
  }
}

function pushTokenRange(ranges: Array<TokenRange>, range: TokenRange) {
  if (range.start >= range.end) return
  if (
    ranges.some(
      (current) => range.start < current.end && range.end > current.start,
    )
  ) {
    return
  }
  ranges.push(range)
}
