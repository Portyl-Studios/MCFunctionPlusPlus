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