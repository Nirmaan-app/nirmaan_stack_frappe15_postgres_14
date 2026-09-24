import { describe, expect, it } from "vitest";

import { poLinkFor } from "./poRoute";

const PO = "PO/123/00045/25-26";

describe("poLinkFor", () => {
  it("opens each list status on its own tab", () => {
    expect(poLinkFor(PO, "PO Approved", "P1")).toBe("/purchase-orders/PO&=123&=00045&=25-26?tab=Approved+PO");
    expect(poLinkFor(PO, "Partially Dispatched", "P1")).toContain("?tab=Partially+Dispatched+PO");
    expect(poLinkFor(PO, "Dispatched", "P1")).toContain("?tab=Dispatched+PO");
    expect(poLinkFor(PO, "Partially Delivered", "P1")).toContain("?tab=Partially+Delivered+PO");
    expect(poLinkFor(PO, "Delivered", "P1")).toContain("?tab=Delivered+PO");
  });

  it("falls back to the project summary for a status with no tab, or before the PO loads", () => {
    expect(poLinkFor(PO, "Merged", "P1")).toBe("/projects/P1/po/PO&=123&=00045&=25-26");
    expect(poLinkFor(PO, undefined, "P1")).toBe("/projects/P1/po/PO&=123&=00045&=25-26");
  });

  it("never emits a tab-less PO route", () => {
    expect(poLinkFor(PO, "Cancelled", null)).toContain("?tab=");
  });
});
