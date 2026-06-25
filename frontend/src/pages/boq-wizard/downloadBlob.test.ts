// Unit tests for downloadBlob.base64ToBytes -- the PURE base64 decode used by the Slice 5b
// priced-tender download (the DOM downloadBytes tail is owner-certified live, not unit-run).
import { describe, it, expect } from "vitest";
import { base64ToBytes } from "./downloadBlob";

describe("base64ToBytes", () => {
  it("decodes a known base64 string to the exact bytes", () => {
    // "Hello" -> base64 "SGVsbG8="
    const bytes = base64ToBytes("SGVsbG8=");
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });

  it("round-trips arbitrary bytes through btoa/base64ToBytes", () => {
    const original = Uint8Array.from([0, 1, 2, 250, 255, 128, 64]);
    const b64 = btoa(String.fromCharCode(...original));
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(original));
  });

  it("returns an empty Uint8Array for an empty string", () => {
    expect(base64ToBytes("").length).toBe(0);
  });

  it("preserves length for a small xlsx-like PK header", () => {
    // .xlsx is a zip -> starts with "PK\x03\x04". Confirm the decode keeps the bytes.
    const header = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    const b64 = btoa(String.fromCharCode(...header));
    expect(Array.from(base64ToBytes(b64))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
