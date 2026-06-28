import zlib from 'zlib'

// Minimal, dependency-free ZIP archive writer.
//
// Produces a standard (non-zip64) archive readable by java.util.zip — which is
// what Minecraft uses to load datapacks. Each entry gets a local file header and
// a central directory record; the archive ends with an end-of-central-directory
// record. Entries are DEFLATE-compressed, falling back to STORE when compression
// does not help. Suitable for datapacks (well under the 4GB / 65535-entry limits
// that would require zip64).

const SIGNATURE_LOCAL_FILE = 0x04034b50
const SIGNATURE_CENTRAL_FILE = 0x02014b50
const SIGNATURE_END_OF_CENTRAL = 0x06054b50

const COMPRESSION_STORE = 0
const COMPRESSION_DEFLATE = 8

const VERSION_NEEDED = 20 // 2.0 — required for DEFLATE
const FLAG_UTF8_NAMES = 0x0800 // general-purpose bit 11: filenames are UTF-8

// Non-zip64 limits. Exceeding them would otherwise surface as a cryptic
// Buffer RangeError; we throw a clear, actionable message instead.
const ZIP_MAX_ENTRIES = 0xffff
const ZIP_MAX_UINT32 = 0xffffffff
const ZIP_TOO_LARGE_MESSAGE =
  'Datapack too large to export: a file or the total archive exceeds the 4GB ZIP limit (zip64 is not supported).'

export interface ZipEntryInput {
  path: string
  data: Buffer
}

const buildCrcTable = (): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = buildCrcTable()

export const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// MS-DOS date/time encoding used by the ZIP format. Years before 1980 are clamped.
const toDosDateTime = (date: Date): { dosTime: number; dosDate: number } => {
  const year = date.getFullYear()
  const dosYear = Math.max(0, year - 1980)
  const dosDate = (dosYear << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  return { dosTime: dosTime & 0xffff, dosDate: dosDate & 0xffff }
}

export const createZipArchive = (entries: ZipEntryInput[], date: Date = new Date()): Buffer => {
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(
      `Datapack too large to export: ${entries.length} files exceeds the ${ZIP_MAX_ENTRIES}-file ZIP limit (zip64 is not supported).`,
    )
  }

  const { dosTime, dosDate } = toDosDateTime(date)

  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.path.replace(/\\/g, '/'), 'utf8')
    const uncompressedSize = entry.data.length
    const crc = crc32(entry.data)

    let method = COMPRESSION_DEFLATE
    let payload: Buffer = zlib.deflateRawSync(entry.data)
    if (payload.length >= uncompressedSize) {
      method = COMPRESSION_STORE
      payload = entry.data
    }
    const compressedSize = payload.length

    if (uncompressedSize > ZIP_MAX_UINT32 || compressedSize > ZIP_MAX_UINT32 || localOffset > ZIP_MAX_UINT32) {
      throw new Error(ZIP_TOO_LARGE_MESSAGE)
    }

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(SIGNATURE_LOCAL_FILE, 0)
    localHeader.writeUInt16LE(VERSION_NEEDED, 4)
    localHeader.writeUInt16LE(FLAG_UTF8_NAMES, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressedSize, 18)
    localHeader.writeUInt32LE(uncompressedSize, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28) // extra field length
    localChunks.push(localHeader, nameBuffer, payload)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(SIGNATURE_CENTRAL_FILE, 0)
    centralHeader.writeUInt16LE(VERSION_NEEDED, 4) // version made by
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6) // version needed
    centralHeader.writeUInt16LE(FLAG_UTF8_NAMES, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressedSize, 20)
    centralHeader.writeUInt32LE(uncompressedSize, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra field length
    centralHeader.writeUInt16LE(0, 32) // comment length
    centralHeader.writeUInt16LE(0, 34) // disk number start
    centralHeader.writeUInt16LE(0, 36) // internal attributes
    centralHeader.writeUInt32LE(0, 38) // external attributes
    centralHeader.writeUInt32LE(localOffset, 42) // offset of local header
    centralChunks.push(centralHeader, nameBuffer)

    localOffset += localHeader.length + nameBuffer.length + payload.length
  }

  const localSection = Buffer.concat(localChunks)
  const centralSection = Buffer.concat(centralChunks)

  if (localSection.length > ZIP_MAX_UINT32 || centralSection.length > ZIP_MAX_UINT32) {
    throw new Error(ZIP_TOO_LARGE_MESSAGE)
  }

  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(SIGNATURE_END_OF_CENTRAL, 0)
  endRecord.writeUInt16LE(0, 4) // this disk number
  endRecord.writeUInt16LE(0, 6) // disk with central directory
  endRecord.writeUInt16LE(entries.length, 8) // entries on this disk
  endRecord.writeUInt16LE(entries.length, 10) // total entries
  endRecord.writeUInt32LE(centralSection.length, 12) // central directory size
  endRecord.writeUInt32LE(localSection.length, 16) // central directory offset
  endRecord.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([localSection, centralSection, endRecord])
}
