import { describe, it, expect } from 'vitest'
import zlib from 'zlib'
import { createZipArchive, crc32, type ZipEntryInput } from './zip-writer'

const SIGNATURE_LOCAL_FILE = 0x04034b50
const SIGNATURE_END_OF_CENTRAL = 0x06054b50

// Parses the contiguous local-file section (entries are written from offset 0
// with no data descriptors) and inflates each payload back to its bytes.
const readLocalEntries = (zip: Buffer, count: number) => {
  const entries: Array<{ name: string; data: Buffer; method: number; crc: number }> = []
  let offset = 0

  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(offset)).toBe(SIGNATURE_LOCAL_FILE)
    const method = zip.readUInt16LE(offset + 8)
    const crc = zip.readUInt32LE(offset + 14)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const uncompressedSize = zip.readUInt32LE(offset + 22)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)

    const nameStart = offset + 30
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf8')
    const dataStart = nameStart + nameLength + extraLength
    const payload = zip.subarray(dataStart, dataStart + compressedSize)
    const data = method === 8 ? zlib.inflateRawSync(payload) : Buffer.from(payload)

    expect(data.length).toBe(uncompressedSize)
    entries.push({ name, data, method, crc })
    offset = dataStart + compressedSize
  }

  return entries
}

describe('createZipArchive', () => {
  const fixedDate = new Date(2026, 5, 28, 12, 30, 20)

  it('round-trips entry names, contents, and CRCs', () => {
    const inputs: ZipEntryInput[] = [
      { path: 'pack.mcmeta', data: Buffer.from('{"pack":{"pack_format":48}}', 'utf8') },
      { path: 'data/ns/function/a.mcfunction', data: Buffer.from('say hi\n'.repeat(200), 'utf8') },
    ]

    const zip = createZipArchive(inputs, fixedDate)
    const entries = readLocalEntries(zip, inputs.length)

    expect(entries.map((entry) => entry.name)).toEqual(inputs.map((input) => input.path))
    inputs.forEach((input, index) => {
      expect(entries[index].data.equals(input.data)).toBe(true)
      expect(entries[index].crc).toBe(crc32(input.data))
    })
  })

  it('normalizes backslashes in entry paths to forward slashes', () => {
    const zip = createZipArchive([{ path: 'data\\ns\\a.json', data: Buffer.from('{}') }], fixedDate)
    const [entry] = readLocalEntries(zip, 1)
    expect(entry.name).toBe('data/ns/a.json')
  })

  it('records the entry count and central-directory layout in the EOCD', () => {
    const inputs: ZipEntryInput[] = [
      { path: 'pack.mcmeta', data: Buffer.from('a') },
      { path: 'data/x.json', data: Buffer.from('bb') },
      { path: 'data/y.json', data: Buffer.from('ccc') },
    ]

    const zip = createZipArchive(inputs, fixedDate)
    const eocd = zip.subarray(zip.length - 22)

    expect(eocd.readUInt32LE(0)).toBe(SIGNATURE_END_OF_CENTRAL)
    expect(eocd.readUInt16LE(8)).toBe(inputs.length)
    expect(eocd.readUInt16LE(10)).toBe(inputs.length)

    const centralSize = eocd.readUInt32LE(12)
    const centralOffset = eocd.readUInt32LE(16)
    expect(centralOffset + centralSize).toBe(zip.length - 22)
  })

  it('falls back to STORE when deflate does not shrink the data', () => {
    const zip = createZipArchive([{ path: 'data/x.bin', data: Buffer.from([0x00]) }], fixedDate)
    expect(zip.readUInt16LE(8)).toBe(0) // method in first local header
  })

  it('uses DEFLATE for compressible data', () => {
    const zip = createZipArchive([{ path: 'data/big.txt', data: Buffer.from('a'.repeat(1000), 'utf8') }], fixedDate)
    expect(zip.readUInt16LE(8)).toBe(8)
  })

  it('produces a valid empty archive', () => {
    const zip = createZipArchive([], fixedDate)
    expect(zip.length).toBe(22)
    expect(zip.readUInt32LE(0)).toBe(SIGNATURE_END_OF_CENTRAL)
    expect(zip.readUInt16LE(10)).toBe(0)
  })

  it('throws a clear error when exceeding the 65535-entry limit', () => {
    const tooMany: ZipEntryInput[] = Array.from({ length: 65536 }, (_unused, index) => ({
      path: `data/f${index}.json`,
      data: Buffer.from('x'),
    }))
    expect(() => createZipArchive(tooMany, fixedDate)).toThrow(/65535-file ZIP limit/)
  })
})
