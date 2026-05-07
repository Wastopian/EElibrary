/**
 * File header: Minimal POSIX ustar tar writer used to package one export bundle's verified asset
 * bytes into a single downloadable archive.
 *
 * EE Library does not pull in a third-party tar/zip dependency for this; the export-bundle archive
 * shape is small (a handful of CAD/datasheet files plus one manifest.json), every entry is a
 * regular file, and the bundlePath values produced by the manifest are short engineering-style
 * paths that fit comfortably in tar's 100-byte name field. Anything that does not fit is rejected
 * up front so the operator gets a clear failure rather than a silently-truncated archive.
 *
 * The output is gzipped at the call site (see `gzipBufferDeterministic`) so the final artifact is
 * a `.tar.gz` engineers can extract with any standard tool.
 */

import { gzip, type ZlibOptions } from "node:zlib";

/** TarFileEntry is one regular-file entry to write into the archive. */
export interface TarFileEntry {
  /** Path inside the archive. Must be 100 bytes or fewer when UTF-8 encoded. */
  path: string;
  /** Binary contents of the file. */
  content: Buffer;
}

/** TAR_BLOCK_SIZE is the POSIX ustar block size every entry is padded to. */
const TAR_BLOCK_SIZE = 512;

/** TAR_NAME_FIELD_BYTES is the fixed-width name field length in the ustar header. */
const TAR_NAME_FIELD_BYTES = 100;

/**
 * Builds an in-memory POSIX ustar archive containing the supplied regular files.
 *
 * Header fields are zero-filled (uid/gid/mtime/devmajor/devminor) so the same set of inputs always
 * produces the same archive bytes — useful for hashing, audit, and integration tests.
 *
 * Throws when any entry's path exceeds the ustar name field. Long-name extensions are intentionally
 * not supported here because export bundles use short engineering-style paths.
 */
export function buildUstarTarBuffer(entries: TarFileEntry[]): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, "utf8");

    if (nameBytes.length === 0) {
      throw new Error("tar entry path must not be empty");
    }

    if (nameBytes.length > TAR_NAME_FIELD_BYTES) {
      throw new Error(
        `tar entry path exceeds ${TAR_NAME_FIELD_BYTES} bytes (${nameBytes.length}): ${entry.path}`
      );
    }

    blocks.push(buildUstarHeader(nameBytes, entry.content.length));
    blocks.push(entry.content);

    const trailingPaddingBytes = (TAR_BLOCK_SIZE - (entry.content.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
    if (trailingPaddingBytes > 0) {
      blocks.push(Buffer.alloc(trailingPaddingBytes));
    }
  }

  // Two trailing zero-filled blocks mark the end of archive per the POSIX ustar spec.
  blocks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));

  return Buffer.concat(blocks);
}

/**
 * Builds one 512-byte ustar header for a regular file.
 *
 * Numeric fields are written as zero-padded octal followed by a trailing space (`mode`, `mtime`)
 * or NUL (`size`) per the convention used by GNU tar. The checksum field is filled with spaces
 * before the sum is computed, then overwritten with the octal sum followed by a NUL and a space.
 */
function buildUstarHeader(nameBytes: Buffer, fileSize: number): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE);

  nameBytes.copy(header, 0, 0, Math.min(nameBytes.length, TAR_NAME_FIELD_BYTES));

  writeOctalField(header, 100, 8, 0o644); // mode: rw-r--r--
  writeOctalField(header, 108, 8, 0); // uid
  writeOctalField(header, 116, 8, 0); // gid
  writeOctalField(header, 124, 12, fileSize); // size
  writeOctalField(header, 136, 12, 0); // mtime — fixed for deterministic output

  // Checksum placeholder: spaces, then computed sum, then NUL + space terminators.
  header.fill(0x20, 148, 156);

  header.writeUInt8(0x30, 156); // typeflag: '0' = regular file

  // ustar magic + version per POSIX spec.
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  // uname, gname, devmajor, devminor, prefix all stay zero-filled.

  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    checksum += header[i] ?? 0;
  }

  // Format: 6 octal digits + NUL + space.
  const checksumOctal = checksum.toString(8).padStart(6, "0");
  header.write(checksumOctal, 148, 6, "ascii");
  header.writeUInt8(0, 154);
  header.writeUInt8(0x20, 155);

  return header;
}

/**
 * Writes one fixed-width zero-padded octal field followed by a single NUL terminator.
 *
 * The ustar spec allows either a trailing NUL or a trailing space; readers accept both, so a NUL is
 * used here for compactness. The numeric value is the file size or POSIX mode being encoded.
 */
function writeOctalField(target: Buffer, offset: number, fieldBytes: number, value: number): void {
  const digits = fieldBytes - 1;
  const text = value.toString(8).padStart(digits, "0");
  target.write(text, offset, digits, "ascii");
  target.writeUInt8(0, offset + digits);
}

/**
 * Gzips one buffer with deterministic output (no embedded mtime, no original filename).
 *
 * Used to wrap the tar payload as `.tar.gz` for download. Without these flags zlib stamps the
 * current time into the gzip header, which makes byte-identical bundles regenerate to differing
 * file hashes — confusing for audit history.
 */
export function gzipBufferDeterministic(payload: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options: ZlibOptions = { level: 6 };
    gzip(payload, options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      // Zero out the four-byte mtime field at offset 4 so identical inputs produce identical bytes.
      // The trailing CRC32 + ISIZE remain content-derived, which is what audit consumers expect.
      result.writeUInt32LE(0, 4);
      resolve(result);
    });
  });
}
