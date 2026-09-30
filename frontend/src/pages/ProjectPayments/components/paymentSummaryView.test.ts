import { describe, expect, it } from "vitest";

import {
  barSegments,
  gstLeftNote,
  leftAfter,
  LINE_ORDER,
  payForCap,
  valueLabel,
  WorkOrderLimit,
  visibleLines,
  waitingPayments,
  workOrderPaymentCap,
} from "./paymentSummaryView";

describe("valueLabel", () => {
  it("names the figure the balance is measured against", () => {
    expect(valueLabel({ document_type: "Procurement Orders", value_basis: "incl_gst" })).toBe("PO value (incl. GST)");
    expect(valueLabel({ document_type: "Service Requests", value_basis: "incl_gst" })).toBe("WO value (incl. GST)");
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

// The worked example's step 6 (ADR-0030): base 1,00,000 + GST 18,000, 40,000 base and 9,000 GST out,
// 18,000 of GST Invoiced.
const LIMIT: WorkOrderLimit = {
  gst_on: true,
  base_value: 100000,
  work_order_gst: 18000,
  gst_invoiced: 18000,
  gst_released: 18000,
  base_paid: 40000,
  gst_paid: 9000,
  base_left: 60000,
  gst_left: 9000,
  total_left: 69000,
};

describe("payForCap", () => {
  it("measures a base request against Base left and the base value", () => {
    expect(payForCap(LIMIT, "base")).toEqual({ value: 100000, max: 60000, capLabel: "Base left" });
  });
  it("measures a GST request against GST left and the released GST", () => {
    expect(payForCap(LIMIT, "gst")).toEqual({ value: 18000, max: 9000, capLabel: "GST left" });
  });
  it("never offers more than total left", () => {
    // An old Work Order paid 1,10,000 of base: GST left 18,000, but 8,000 in total.
    const old = { ...LIMIT, base_paid: 110000, gst_paid: 0, base_left: 0, gst_left: 18000, total_left: 8000 };
    expect(payForCap(old, "gst")).toEqual({ value: 18000, max: 8000, capLabel: "total left" });
  });
  it("never goes below zero", () => {
    expect(payForCap({ ...LIMIT, total_left: -500 }, "base").max).toBe(0);
  });
});

describe("gstLeftNote", () => {
  it("says nothing while GST is left", () => {
    expect(gstLeftNote(LIMIT)).toBeNull();
  });
  it("explains a zero before any invoice GST is approved", () => {
    expect(gstLeftNote({ ...LIMIT, gst_invoiced: 0, gst_released: 0, gst_paid: 0, gst_left: 0 })).toBe(
      "Opens when an invoice with GST is approved"
    );
  });
  it("explains a zero once the released GST is all requested", () => {
    expect(gstLeftNote({ ...LIMIT, gst_invoiced: 9000, gst_released: 9000, gst_left: 0 })).toBe(
      "All approved invoice GST is already requested"
    );
  });
});

describe("workOrderPaymentCap", () => {
  it("holds a GST-on Work Order payment to the chosen part, as the server does", () => {
    const summary = { left: 69000, limit: LIMIT };
    expect(workOrderPaymentCap(summary, "base")).toMatchObject({ max: 60000, capLabel: "Base left" });
    expect(workOrderPaymentCap(summary, "gst")).toMatchObject({ max: 9000, capLabel: "GST left" });
  });
  it("holds a GST-off Work Order payment to what is left of its total, whatever part is chosen", () => {
    const summary = { left: 12000, limit: { ...LIMIT, gst_on: false } };
    expect(workOrderPaymentCap(summary, "base")).toEqual({ max: 12000, capLabel: "balance" });
    expect(workOrderPaymentCap(summary, "gst")).toEqual({ max: 12000, capLabel: "balance" });
  });
  it("never goes below zero on an over-paid Work Order", () => {
    expect(workOrderPaymentCap({ left: -500, limit: undefined }, "base").max).toBe(0);
  });
});
