/**
 * VAV-2b1 (ANSWER 10 (ii), PIN 1 - 3): the by-name reader PROVES what it read -- the file it was asked for and its sha256 prefix -- and
 * refuses a file that does not exist or whose hash differs (vacuity), so the re-pointed v78 tests can never ride another file.
 */
import { describe, expect, it } from "vitest";
import { V78, assetByName } from "./v78ByName.harness";

describe("assetByName", () => {
  it("POSITIVE V78 is the v78 file by name, sha256 1cabaea4...", () => {
    expect(V78.file).toBe("rate_master_hvac_all_v78.json");
    expect(V78.sha256.startsWith("1cabaea4")).toBe(true);
    expect(V78.items.length).toBe(848);
    expect(V78.byId.size).toBe(16);
  });
  it("NEGATIVE (vacuity) a file that does not exist -> refused; a wrong sha256 prefix -> refused", () => {
    expect(() => assetByName("rate_master_hvac_all_v9999.json", "00")).toThrow(/no rate file named/);
    expect(() => assetByName("rate_master_hvac_all_v78.json", "deadbeef")).toThrow(/not deadbeef/);
  });
});
