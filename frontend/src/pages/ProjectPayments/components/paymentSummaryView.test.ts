import { describe, expect, it } from "vitest";

import {
  barSegments,
  leftAfter,
  LINE_ORDER,
  valueLabel,
  visibleLines,
  waitingPayments,
} from "./paymentSummaryView";

describe("valueLabel", () => {
  it("names the figure the balance is measured against", () => {
    expect(valueLabel({ document_type: "Procurement Orders", value_basis: "incl_gst" })).toBe("PO value (incl. GST)");
    expect(valueLabel({ document_type: "Service Requests", value_basis: "ex_gst" })).toBe("WO base amount (ex-GST)");
    expect(valueLabel({ document_type: "Service Requests", value_basis: "total" })).toBe("WO value");
  });
});

describe("visibleLines", () => {
  it("keeps the fixed order and hides ₹0 lines", () => {
    const out = visibleLines({ paid: 200000, reconciliation_pending: 50000, approved: 0, ceo_pending: 0, requested: 1000, rejected: 0 });
    expect(out.map((l) => l.key)).toEqual(["paid", "reconciliation_pending", "requested"]);
    expect(out[1].label).toBe("Paid, not yet reconciled");
  });

  it("shows a rejected payment still holding its share", () => {
    expect(visibleLines({ rejected: 5000 }).map((l) => l.label)).toEqual(["Rejected, not yet deleted"]);
  });

  it("orders money out before money on its way", () => {
    expect(LINE_ORDER.indexOf("paid")).toBeLessThan(LINE_ORDER.indexOf("approved"));
    expect(LINE_ORDER.indexOf("approved")).toBeLessThan(LINE_ORDER.indexOf("requested"));
  });
});

describe("leftAfter", () => {
  it("subtracts this payment from the cap's balance", () => {
    expect(leftAfter(150000, 100000)).toBe(50000);
  });
  it("goes negative when the payment takes the order over", () => {
    expect(leftAfter(50000, 80000)).toBe(-30000);
  });
});

describe("waitingPayments", () => {
  it("is the payments not yet money out — not paid, not reconciling, not rejected", () => {
    const rows = ["Paid", "Reconciliation Pending", "Approved", "CEO Pending", "Requested", "Rejected"].map(
      (status, i) => ({ name: `P${i}`, amount: 1, gross_amount: 1, status, creation: null, raised_by: null, raised_by_name: null })
    );
    expect(waitingPayments(rows).map((p) => p.status)).toEqual(["Approved", "CEO Pending", "Requested"]);
  });
});

describe("barSegments", () => {
  it("splits the order into settled / on its way / this / left, summing to 100", () => {
    const seg = barSegments({ paid: 200000, reconciliation_pending: 50000, approved: 100000 }, 500000, 100000);
    expect(seg).toEqual({ settled: 50, onItsWay: 20, current: 20, left: 10 });
  });
  it("scales to the committed total when the order is already over", () => {
    const seg = barSegments({ paid: 100 }, 100, 50);
    expect(seg.left).toBe(0);
    expect(Math.round(seg.settled + seg.current)).toBe(100);
  });
  it("never divides by zero", () => {
    expect(barSegments({}, 0, 0)).toEqual({ settled: 0, onItsWay: 0, current: 0, left: 0 });
  });
});
