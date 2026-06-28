const DOTTED_VERSION_REGEX = /^[0-9]+(?:\.[0-9]+)*$/

export const isDottedNumericVersion = (version: string): boolean => {
  return DOTTED_VERSION_REGEX.test(version.trim())
}

const parseVersionParts = (version: string): number[] => {
  return version
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
}

export const compareDottedVersions = (left: string, right: string): number => {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    if (leftValue === rightValue) continue
    return leftValue > rightValue ? 1 : -1
  }

  return 0
}

// Pack-version helpers (used by the datapack export pipeline).
//
// A pack version is a dotted string whose first three segments are treated as
// major.minor.patch (e.g. "1.00.00"). Helpers preserve the zero-padding width of
// each segment so "1.00.00" -> "1.00.01" rather than "1.0.1". Malformed versions
// (fewer than three numeric segments) are returned unchanged so the caller can
// surface a warning instead of corrupting the value.

const padNumberToWidth = (value: number, width: number): string => {
  const text = String(value)
  return text.length >= width ? text : `${'0'.repeat(width - text.length)}${text}`
}

const parsePackVersionSegments = (version: string): string[] | null => {
  const trimmed = version.trim()
  if (!trimmed) return null

  const segments = trimmed.split('.')
  if (segments.length < 3) return null
  if (!segments.every((segment) => /^[0-9]+$/.test(segment))) return null

  return segments
}

export const incrementPatchVersion = (version: string): string => {
  const segments = parsePackVersionSegments(version)
  if (!segments) return version

  const patchWidth = segments[2].length
  const nextPatch = Number.parseInt(segments[2], 10) + 1

  const next = [...segments]
  next[2] = padNumberToWidth(nextPatch, patchWidth)
  return next.join('.')
}

export const resetPatchOnMajorMinorIncrement = (previous: string, next: string): string => {
  const previousSegments = parsePackVersionSegments(previous)
  const nextSegments = parsePackVersionSegments(next)
  if (!previousSegments || !nextSegments) return next

  const previousMajor = Number.parseInt(previousSegments[0], 10)
  const previousMinor = Number.parseInt(previousSegments[1], 10)
  const nextMajor = Number.parseInt(nextSegments[0], 10)
  const nextMinor = Number.parseInt(nextSegments[1], 10)

  const majorOrMinorIncremented =
    nextMajor > previousMajor || (nextMajor === previousMajor && nextMinor > previousMinor)
  if (!majorOrMinorIncremented) return next

  const reset = [...nextSegments]
  reset[2] = padNumberToWidth(0, nextSegments[2].length)
  return reset.join('.')
}