/**
 * File header: Tests the minimal POSIX ustar tar writer used to produce export bundle archives.
 */

import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { buildUstarTarBuffer, gzipBufferDeterministic } from "./tar-archive";

const TAR_BLOCK_SIZE = 512;

/**
 * Verifies the archive starts with the supplied filename in the ustar header name field.
 */
test("buildUstarTarBuffer writes the entry name into the first 100 header bytes", () => {
  const archive = buildUstarTarBuffer([
    { content: Buffer.from("hello"), path: "C0805/footprint.kicad_mod" }
  ]);

  const nameField = archive.subarray(0, "C0805/footprint.kicad_mod".length).toString("utf8");
  assert.equal(nameField, "C0805/footprint.kicad_mod");
});

/**
 * Verifies the size field is encoded as octal with a NUL terminator at offset 124.
 */
test("buildUstarTarBuffer encodes file size as zero-padded octal", () => {
  const archive = buildUstarTarBuffer([
    { content: Buffer.alloc(513), path: "x.bin" }
  ]);

  const sizeField = archive.subarray(124, 124 + 11).toString("ascii");
  assert.equal(sizeField, "00000001001"); // 513 octal
  assert.equal(archive.readUInt8(124 + 11), 0);
});

/**
 * Verifies the file content lives at offset 512 and is padded to a 512-byte block.
 */
test("buildUstarTarBuffer pads file content to the next 512-byte block boundary", () => {
  const fiveBytes = Buffer.from("hello");
  const archive = buildUstarTarBuffer([{ content: fiveBytes, path: "small.txt" }]);

  // Header (512) + first content block (512) + two trailing zero blocks (1024) = 2048
  assert.equal(archive.length, 2048);

  const contentSlice = archive.subarray(TAR_BLOCK_SIZE, TAR_BLOCK_SIZE + fiveBytes.length);
  assert.equal(contentSlice.toString("utf8"), "hello");

  // The remainder of the content block is zero-padded.
  const padding = archive.subarray(TAR_BLOCK_SIZE + fiveBytes.length, TAR_BLOCK_SIZE * 2);
  assert.ok(padding.every((byte) => byte === 0));
});

/**
 * Verifies the archive ends with two zero-filled 512-byte blocks per the ustar spec.
 */
test("buildUstarTarBuffer terminates with two trailing zero-filled blocks", () => {
  const archive = buildUstarTarBuffer([{ content: Buffer.from("a"), path: "a.txt" }]);

  const tail = archive.subarray(archive.length - TAR_BLOCK_SIZE * 2);
  assert.ok(tail.every((byte) => byte === 0));
});

/**
 * Verifies multiple entries land at independent block-aligned offsets.
 */
test("buildUstarTarBuffer concatenates multiple entries with correct block alignment", () => {
  const archive = buildUstarTarBuffer([
    { content: Buffer.from("first"), path: "first.txt" },
    { content: Buffer.from("second"), path: "second.txt" }
  ]);

  // 2 entries × (512 header + 512 content block) + 2 × 512 trailer = 3072
  assert.equal(archive.length, 3072);

  const secondHeaderName = archive.subarray(TAR_BLOCK_SIZE * 2, TAR_BLOCK_SIZE * 2 + "second.txt".length).toString("utf8");
  assert.equal(secondHeaderName, "second.txt");
});

/**
 * Verifies the ustar magic + version are present so engineering tools recognize the archive.
 */
test("buildUstarTarBuffer writes the ustar magic and version into the header", () => {
  const archive = buildUstarTarBuffer([{ content: Buffer.from("a"), path: "a.txt" }]);

  assert.equal(archive.subarray(257, 263).toString("ascii"), "ustar\0");
  assert.equal(archive.subarray(263, 265).toString("ascii"), "00");
});

/**
 * Verifies the header checksum equals the unsigned sum of all header bytes when the checksum field
 * is treated as eight ASCII spaces. Standard tar readers reject archives whose checksums disagree.
 */
test("buildUstarTarBuffer writes a checksum that matches the recomputed value", () => {
  const archive = buildUstarTarBuffer([{ content: Buffer.from("hello"), path: "hello.txt" }]);
  const header = archive.subarray(0, TAR_BLOCK_SIZE);

  const recomputed = recomputeUstarHeaderChecksum(header);

  // The persisted checksum lives at bytes 148..154 as octal, terminated by NUL + space.
  const persisted = parseInt(header.subarray(148, 154).toString("ascii"), 8);
  assert.equal(persisted, recomputed);
});

/**
 * Verifies entries with paths longer than the ustar name field are rejected with a clear error.
 */
test("buildUstarTarBuffer rejects entry paths longer than 100 bytes", () => {
  const longPath = "a".repeat(101);

  assert.throws(() => buildUstarTarBuffer([{ content: Buffer.from(""), path: longPath }]), /exceeds 100 bytes/u);
});

/**
 * Verifies gzipBufferDeterministic produces byte-identical output for identical input.
 */
test("gzipBufferDeterministic produces byte-identical output across runs", async () => {
  const payload = buildUstarTarBuffer([{ content: Buffer.from("stable"), path: "stable.txt" }]);

  const first = await gzipBufferDeterministic(payload);
  const second = await gzipBufferDeterministic(payload);

  assert.deepEqual(first, second);
});

/**
 * Verifies the gzip output round-trips back to the original tar bytes.
 */
test("gzipBufferDeterministic round-trips through gunzip", async () => {
  const payload = buildUstarTarBuffer([{ content: Buffer.from("round-trip"), path: "round.txt" }]);

  const compressed = await gzipBufferDeterministic(payload);
  const restored = gunzipSync(compressed);

  assert.deepEqual(restored, payload);
});

/**
 * Recomputes the ustar header checksum the same way readers do: replace the persisted checksum
 * field with eight spaces, then sum every unsigned byte in the 512-byte header.
 */
function recomputeUstarHeaderChecksum(header: Buffer): number {
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);

  let sum = 0;
  for (let i = 0; i < copy.length; i++) {
    sum += copy[i] ?? 0;
  }
  return sum;
}
