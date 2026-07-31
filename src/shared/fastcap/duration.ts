export function parseDurationTextMilliseconds(value: string) {
  const input = value.trim().toLowerCase()
  if (!input) return undefined

  if (/^(?:\d+:)?\d{1,2}:\d{2}$/.test(input)) {
    const parts = input.split(':').map(Number)
    const hours = parts.length === 3 ? parts.shift()! : 0
    const [minutes, seconds] = parts
    if (minutes >= 60 || seconds >= 60) return undefined
    return (hours * 3_600 + minutes * 60 + seconds) * 1_000
  }

  const unitPattern =
    /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|小时|m|min|mins|minute|minutes|分钟|s|sec|secs|second|seconds|秒)/g
  let totalSeconds = 0
  let consumed = ''
  for (const match of input.matchAll(unitPattern)) {
    const amount = Number(match[1])
    const unit = match[2]
    consumed += match[0]
    if (/^(?:h|hr|hrs|hour|hours|小时)$/.test(unit))
      totalSeconds += amount * 3_600
    else if (/^(?:m|min|mins|minute|minutes|分钟)$/.test(unit))
      totalSeconds += amount * 60
    else totalSeconds += amount
  }
  if (
    !consumed ||
    input.replaceAll(/\s/g, '') !== consumed.replaceAll(/\s/g, '')
  ) {
    return undefined
  }
  const milliseconds = Math.round(totalSeconds * 1_000)
  return Number.isSafeInteger(milliseconds) && milliseconds > 0
    ? milliseconds
    : undefined
}
