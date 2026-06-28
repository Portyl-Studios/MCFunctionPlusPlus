import { describe, it, expect } from 'vitest'
import {
  applyExportFileNameTemplate,
  sanitizeExportFileName,
  shouldIncludeInExport,
  matchesGlob,
  formatExportDateStamp,
  DEFAULT_EXPORT_FILENAME_TEMPLATE,
  type ExportFileNameVariables,
} from './export-utils'

const baseVars: ExportFileNameVariables = {
  projectName: 'My Pack',
  mcVersion: '1.21',
  packVersion: '1.00.03',
  datapackId: 'MP',
  author: 'wen',
  packFormat: '48',
  date: '2026-06-28',
}

describe('applyExportFileNameTemplate', () => {
  it('substitutes every supported token', () => {
    const result = applyExportFileNameTemplate(
      '%PROJECT_NAME%-mc%MC_VERSION%-v%PACK_VERSION%-%DATAPACK_ID%-%AUTHOR%-%PACK_FORMAT%-%DATE%',
      baseVars,
    )
    expect(result).toBe('My Pack-mc1.21-v1.00.03-MP-wen-48-2026-06-28')
  })

  it('handles the default template', () => {
    expect(applyExportFileNameTemplate(DEFAULT_EXPORT_FILENAME_TEMPLATE, baseVars)).toBe('My Pack-mc1.21-v1.00.03')
  })

  it('replaces unknown tokens with nothing only for known ones (leaves others intact)', () => {
    expect(applyExportFileNameTemplate('%PACK_VERSION%-%UNKNOWN%', baseVars)).toBe('1.00.03-%UNKNOWN%')
  })

  it('replaces every occurrence of a repeated token', () => {
    expect(applyExportFileNameTemplate('%DATAPACK_ID%-%DATAPACK_ID%', baseVars)).toBe('MP-MP')
  })
})

describe('sanitizeExportFileName', () => {
  it('appends a single .zip extension', () => {
    expect(sanitizeExportFileName('pack')).toBe('pack.zip')
    expect(sanitizeExportFileName('pack.zip')).toBe('pack.zip')
    expect(sanitizeExportFileName('pack.ZIP')).toBe('pack.zip')
  })

  it('replaces invalid filename characters with hyphens', () => {
    expect(sanitizeExportFileName('a/b\\c:d')).toBe('a-b-c-d.zip')
    expect(sanitizeExportFileName('na*me?')).toBe('na-me-.zip')
  })

  it('keeps hyphens and dots from the default template output', () => {
    expect(sanitizeExportFileName('My Pack-mc1.21-v1.00.03')).toBe('My Pack-mc1.21-v1.00.03.zip')
  })

  it('falls back to a default base when empty', () => {
    expect(sanitizeExportFileName('')).toBe('datapack.zip')
    expect(sanitizeExportFileName('   ')).toBe('datapack.zip')
  })

  it('guards reserved Windows device names', () => {
    expect(sanitizeExportFileName('CON')).toBe('_CON.zip')
    expect(sanitizeExportFileName('nul')).toBe('_nul.zip')
  })

  it('strips trailing dots and spaces', () => {
    expect(sanitizeExportFileName('pack...')).toBe('pack.zip')
    expect(sanitizeExportFileName('pack   ')).toBe('pack.zip')
  })
})

describe('matchesGlob', () => {
  it('matches single-segment wildcards within a directory', () => {
    expect(matchesGlob('data/foo/a.json', 'data/foo/*.json')).toBe(true)
    expect(matchesGlob('data/foo/bar/a.json', 'data/foo/*.json')).toBe(false)
  })

  it('matches across directories with **', () => {
    expect(matchesGlob('data/foo/bar/a.json', 'data/**/*.json')).toBe(true)
    expect(matchesGlob('a.json', '**/*.json')).toBe(true)
    expect(matchesGlob('data/x/y/z.mcfunction', 'data/**')).toBe(true)
  })

  it('matches single characters with ?', () => {
    expect(matchesGlob('data/a1.json', 'data/a?.json')).toBe(true)
    expect(matchesGlob('data/a12.json', 'data/a?.json')).toBe(false)
  })
})

describe('shouldIncludeInExport', () => {
  it('includes Minecraft-read content', () => {
    expect(shouldIncludeInExport('pack.mcmeta')).toBe(true)
    expect(shouldIncludeInExport('pack.png')).toBe(true)
    expect(shouldIncludeInExport('data/ns/function/a.mcfunction')).toBe(true)
  })

  it('excludes IDE meta and non-Minecraft files', () => {
    expect(shouldIncludeInExport('.mpp-datapack')).toBe(false)
    expect(shouldIncludeInExport('README.md')).toBe(false)
    expect(shouldIncludeInExport('.git/config')).toBe(false)
    expect(shouldIncludeInExport('src/notes.txt')).toBe(false)
  })

  it('always drops .disabled files even under data/', () => {
    expect(shouldIncludeInExport('data/ns/function/a.mcfunction.disabled')).toBe(false)
    expect(shouldIncludeInExport('pack.mcmeta.disabled')).toBe(false)
  })

  it('applies user exclude globs within the allowlist', () => {
    expect(shouldIncludeInExport('data/ns/function/test/a.mcfunction', ['data/**/test/**'])).toBe(false)
    expect(shouldIncludeInExport('data/ns/function/a.mcfunction', ['data/**/test/**'])).toBe(true)
    expect(shouldIncludeInExport('data/ns/x.json', ['**/*.json'])).toBe(false)
  })

  it('ignores blank exclude patterns', () => {
    expect(shouldIncludeInExport('data/ns/a.mcfunction', ['', '   '])).toBe(true)
  })

  it('never lets an exclude glob drop the mandatory pack.mcmeta', () => {
    expect(shouldIncludeInExport('pack.mcmeta', ['pack.mcmeta'])).toBe(true)
    expect(shouldIncludeInExport('pack.mcmeta', ['*'])).toBe(true)
    expect(shouldIncludeInExport('pack.mcmeta', ['**'])).toBe(true)
  })

  it('still allows pack.png to be excluded', () => {
    expect(shouldIncludeInExport('pack.png', ['pack.png'])).toBe(false)
  })
})

describe('formatExportDateStamp', () => {
  it('formats as YYYY-MM-DD with zero padding', () => {
    expect(formatExportDateStamp(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(formatExportDateStamp(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})
