import { describe, it, expect } from "vitest";
import {
  encodeFrame,
  createFrameDecoder,
  MAX_FRAME_BYTES,
} from "../../bridge/frame-codec.js";

describe("encodeFrame", () => {
  it("prefixes a 4-byte little-endian length", () => {
    const frame = encodeFrame({ a: 1 });
    const json = JSON.stringify({ a: 1 });
    expect(frame.readUInt32LE(0)).toBe(Buffer.byteLength(json, "utf8"));
    expect(frame.subarray(4).toString("utf8")).toBe(json);
  });

  it("measures length in bytes, not characters (multi-byte utf8)", () => {
    const frame = encodeFrame({ s: "café — 世界" });
    const bodyLen = frame.length - 4;
    expect(frame.readUInt32LE(0)).toBe(bodyLen);
    expect(JSON.parse(frame.subarray(4).toString("utf8"))).toEqual({ s: "café — 世界" });
  });
});

describe("createFrameDecoder", () => {
  it("round-trips a single frame", () => {
    const dec = createFrameDecoder();
    const out = dec.push(encodeFrame({ text: "ok" }));
    expect(out).toEqual([{ text: "ok" }]);
    expect(dec.pending()).toBe(0);
  });

  it("reassembles a frame split across chunks", () => {
    const dec = createFrameDecoder();
    const frame = encodeFrame({ system: "s", user: "u" });
    // split mid-body
    expect(dec.push(frame.subarray(0, 6))).toEqual([]);
    expect(dec.pending()).toBe(6);
    expect(dec.push(frame.subarray(6))).toEqual([{ system: "s", user: "u" }]);
    expect(dec.pending()).toBe(0);
  });

  it("splits the 4-byte header itself across chunks", () => {
    const dec = createFrameDecoder();
    const frame = encodeFrame({ ping: true });
    expect(dec.push(frame.subarray(0, 2))).toEqual([]);
    expect(dec.push(frame.subarray(2))).toEqual([{ ping: true }]);
  });

  it("decodes multiple frames delivered in one chunk", () => {
    const dec = createFrameDecoder();
    const chunk = Buffer.concat([
      encodeFrame({ n: 1 }),
      encodeFrame({ n: 2 }),
      encodeFrame({ n: 3 }),
    ]);
    expect(dec.push(chunk)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("carries a partial trailing frame to the next push", () => {
    const dec = createFrameDecoder();
    const a = encodeFrame({ n: 1 });
    const b = encodeFrame({ n: 2 });
    const chunk = Buffer.concat([a, b.subarray(0, 3)]);
    expect(dec.push(chunk)).toEqual([{ n: 1 }]);
    expect(dec.push(b.subarray(3))).toEqual([{ n: 2 }]);
  });

  it("throws on a length prefix beyond MAX_FRAME_BYTES", () => {
    const dec = createFrameDecoder();
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(MAX_FRAME_BYTES + 1, 0);
    expect(() => dec.push(header)).toThrow(/exceeds MAX_FRAME_BYTES/);
  });
});
