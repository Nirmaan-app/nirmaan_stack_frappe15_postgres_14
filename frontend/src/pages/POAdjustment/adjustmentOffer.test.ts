// #1400: "Adjust Payments" offers only the credit not held by a waiting Vendor Refund.
import { describe, it, expect } from "vitest";

import { creditOnOffer } from "./adjustmentOffer";

describe("creditOnOffer", () => {
  it("offers only the rest when a waiting refund holds part of the credit", () => {
    // 1,180 overpaid, 500 held for a waiting refund: the server will spend 680.
    expect(creditOnOffer(-1180, 680)).toBe(680);
  });

  it("offers nothing when the whole credit is held", () => {
    expect(creditOnOffer(-1180, 0)).toBe(0);
  });

  it("never offers more than the ledger claims", () => {
    expect(creditOnOffer(-300, 1000)).toBe(300);
  });

  it("offers nothing on a balance the PO still owes", () => {
    expect(creditOnOffer(144, 0)).toBe(0);
  });

  it("falls back to the ledger claim when the server sends no usable credit", () => {
    expect(creditOnOffer(-1180, undefined)).toBe(1180);
  });
});
