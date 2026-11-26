import { describe, expect, it } from "vitest";

import { itmDnDcItemStatus } from "./itmDnDcStatus";

// itmDnDcItemStatus(dnQty, dcQty) — the worked cases shown to the owner (Transfer Qty 60).
describe("itmDnDcItemStatus", () => {
  it("is Matched when fully received and fully challaned", () => {
    expect(itmDnDcItemStatus(60, 60)).toBe("matched");
  });

  it("is Mismatch when fully received and the DC is short", () => {
    expect(itmDnDcItemStatus(60, 25)).toBe("mismatch");
  });

  it("is No DC Update when received and no DC at all", () => {
    expect(itmDnDcItemStatus(60, 0)).toBe("no_dc_update");
  });

  it("is Matched when part received and the DC equals what was received (no Partially Delivered)", () => {
    expect(itmDnDcItemStatus(40, 40)).toBe("matched");
  });

  it("is Mismatch when part received and the DC is short (the PO rule says Matched here)", () => {
    expect(itmDnDcItemStatus(40, 25)).toBe("mismatch");
  });

  it("is Matched when nothing is received and no DC is filed", () => {
    expect(itmDnDcItemStatus(0, 0)).toBe("matched");
  });

  it("is Pending DN when nothing is received but a DC is filed", () => {
    expect(itmDnDcItemStatus(0, 20)).toBe("pending_dn");
  });

  it("is Matched when the DC covers more than was received", () => {
    expect(itmDnDcItemStatus(40, 50)).toBe("matched");
  });
});
