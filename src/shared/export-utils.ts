// Pure helpers for the datapack export pipeline. Intentionally free of Node.js
// imports so they can be shared by the sandboxed renderer (live filename preview,
// settings editing) and the Electron main process (the actual export handler).

export const DEFAULT_EXPORT_FILENAME_TEMPLATE = '%PROJECT_NAME%-mc%MC_VERSION%-v%PACK_VERSION%'
export const DEFAULT_EXPORT_DIR_NAME = 'dist'

export interface ExportFileNameVariables {
  projectName: string
  mcVersion: string
  packVersion: string
  datapackId: string
  author: string
  packFormat: string
  date: string
}

// Tokens supported inside the filename template, surfaced in the UI hint.
export const EXPORT_TEMPLATE_TOKENS = [
  '%PROJECT_NAME%',
  '%MC_VERSION%',
  '%PACK_VERSION%',
  '%DATAPACK_ID%',
  '%AUTHOR%',
  '%PACK_FORMAT%',
  '%DATE%',
] as const

export const applyExportFileNameTemplate = (template: string, variables: ExportFileNameVariables): string => {
  const replacements: Record<string, string> = {
    '%PROJECT_NAME%': variables.projectName ?? '',
    '%MC_VERSION%': variables.mcVersion ?? '',
    '%PACK_VERSION%': variables.packVersion ?? '',
    '%DATAPACK_ID%': variables.datapackId ?? '',
    '%AUTHOR%': variables.author ?? '',
    '%PACK_FORMAT%': variables.packFormat ?? '',
    '%DATE%': variables.date ?? '',
  }

  let result = template
  for (const [token, value] of Object.entries(replacements)) {
    // split/join performs a literal global replace without regex escaping.
    result = result.split(token).join(value)
  }
  return result
}

const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g

// Strip ASCII control characters (code < 32) and DEL (127) without relying on
// regex escape sequences in source (keeps this file plain text).
const stripControlCharacters = (value: string): string =>
  Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')

// Turns a templated name into a safe single-segment filename ending in ".zip".
export const sanitizeExportFileName = (name: string): string => {
  let base = (name ?? '').trim().replace(/\.zip$/i, '')

  // Replace Windows-invalid filename characters, then strip control characters.
  base = stripControlCharacters(base.replace(INVALID_FILENAME_CHARS, '-'))
  // Windows disallows trailing spaces/periods.
  base = base.replace(/[ .]+$/g, '').trim()

  if (!base || base === '.' || base === '..') {
    base = 'datapack'
  }
  if (RESERVED_DEVICE_NAME.test(base)) {
    base = `_${base}`
  }

  return `${base}.zip`
}

// Formats a date as YYYY-MM-DD for the %DATE% template token (local time).
export const formatExportDateStamp = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const escapeRegExpLiteral = (value: string): string => value.replace(/[.+^${}()|[\]\\]/g, '\\$&')

// Minimal glob support: `**` (any depth, incl. zero via `**/`), `*` (within a
// segment), and `?` (single non-separator char). Case-insensitive to match
// Windows path semantics.
export const matchesGlob = (filePath: string, pattern: string): boolean => {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedPattern) return false

  let regex = ''
  let index = 0
  while (index < normalizedPattern.length) {
    if (normalizedPattern.startsWith('**/', index)) {
      regex += '(?:.*/)?'
      index += 3
      continue
    }
    if (normalizedPattern.startsWith('**', index)) {
      regex += '.*'
      index += 2
      continue
    }

    const char = normalizedPattern[index]
    if (char === '*') {
      regex += '[^/]*'
    } else if (char === '?') {
      regex += '[^/]'
    } else {
      regex += escapeRegExpLiteral(char)
    }
    index += 1
  }

  return new RegExp(`^${regex}$`, 'i').test(normalizedPath)
}

// Allowlist filter deciding whether a datapack-relative file belongs in the
// exported zip. Only Minecraft-read content is kept: pack.mcmeta, pack.png, and
// anything under data/. IDE-disabled files (`*.disabled`) are always dropped, as
// is anything matching a user-supplied exclude glob.
export const shouldIncludeInExport = (relativePath: string, excludeGlobs: string[] = []): boolean => {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized) return false

  if (normalized.toLowerCase().endsWith('.disabled')) return false

  const isAllowlisted =
    normalized === 'pack.mcmeta' ||
    normalized === 'pack.png' ||
    normalized.startsWith('data/')
  if (!isAllowlisted) return false

  // pack.mcmeta is mandatory for Minecraft to load the pack; never let a
  // user exclude glob drop it (which would silently produce an invalid zip).
  if (normalized === 'pack.mcmeta') return true

  for (const pattern of excludeGlobs) {
    const trimmed = pattern.trim()
    if (!trimmed) continue
    if (matchesGlob(normalized, trimmed)) return false
  }

  return true
}
