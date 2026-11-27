import { describe, expect, it } from "vitest";

import { dnDcItemStatus } from "./dnDcStatus";

// dnDcItemStatus(orderedQty, dnQty, dcQty)
describe("dnDcItemStatus", () => {
  it("is Pending DN when nothing is received, whatever the DC says", () => {
    expect(dnDcItemStatus(50, 0, 0)).toBe("pending_dn");
    expect(dnDcItemStatus(50, 0, 10)).toBe("pending_dn");
  });

  it("is Partially Delivered when delivery is short and the DC equals the DN exactly", () => {
    expect(dnDcItemStatus(100, 70, 70)).toBe("partially_delivered");
  });

  it("is No DC Update when something is received and no DC covers it", () => {
    expect(dnDcItemStatus(400, 400, 0)).toBe("no_dc_update");
    expect(dnDcItemStatus(100, 30, 0)).toBe("no_dc_update");
  });

  it("is Mismatch when fully received but the DC is short", () => {
    expect(dnDcItemStatus(5, 5, 2)).toBe("mismatch");
  });

  it("is Matched when fully received and fully challaned", () => {
    expect(dnDcItemStatus(200, 200, 200)).toBe("matched");
  });

  it("reads an over-challaned short delivery as Matched (owner's call, not a Mismatch)", () => {
    expect(dnDcItemStatus(500, 300, 350)).toBe("matched");
  });

  it("reads a short delivery with a short DC as Matched (the rule's fallback)", () => {
    expect(dnDcItemStatus(100, 70, 40)).toBe("matched");
  });

  it("applies the 2.5% tolerance only when a quantity has decimals", () => {
    // 98 of 100 whole units is not "fully received": exact comparison, so not Mismatch.
    expect(dnDcItemStatus(100, 98, 50)).toBe("matched");
    // 97.6 of 100 is within 2.5%: counts as fully received, so a short DC is a Mismatch.
    expect(dnDcItemStatus(100, 97.6, 50)).toBe("mismatch");
  });

  it("keeps the DN vs DC comparison exact even with decimals", () => {
    // 342.74 received vs 342.73 challaned on a short delivery: not equal, so not Partially Delivered.
    expect(dnDcItemStatus(400, 342.74, 342.73)).not.toBe("partially_delivered");
  });
});
