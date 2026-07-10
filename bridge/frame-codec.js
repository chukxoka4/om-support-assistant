// Chrome native-messaging wire format: a 4-byte little-endian uint32 length
// prefix followed by that many bytes of UTF-8 JSON, in BOTH directions.
// This module is pure (Buffer only) so the framing can be unit-tested without
// touching stdin/stdout or spawning anything.

// Chrome caps a single native message at 1 MB inbound / 4 GB outbound. We keep
// a conservative guard so a corrupt length prefix can't make us buffer forever.
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

// Encode one JS value as a single length-prefixed frame.
export function encodeFrame(value) {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

// Incremental decoder. Feed it arbitrary chunks (frames can be split across
// chunks, and one chunk can carry several frames); it returns whatever complete
// frames are now available and keeps the remainder buffered internally.
export function createFrameDecoder() {
  let buffer = Buffer.alloc(0);

  return {
    // Returns an array of decoded values (possibly empty). Throws on a frame
    // that exceeds MAX_FRAME_BYTES or on malformed JSON.
    push(chunk) {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      const out = [];
      while (buffer.length >= 4) {
        const len = buffer.readUInt32LE(0);
        if (len > MAX_FRAME_BYTES) {
          throw new Error(`frame length ${len} exceeds MAX_FRAME_BYTES`);
        }
        if (buffer.length < 4 + len) break; // wait for the rest of this frame
        const json = buffer.subarray(4, 4 + len).toString("utf8");
        buffer = buffer.subarray(4 + len);
        out.push(JSON.parse(json));
      }
      return out;
    },
    // Bytes buffered but not yet forming a complete frame (for diagnostics/tests).
    pending() {
      return buffer.length;
    },
  };
}
