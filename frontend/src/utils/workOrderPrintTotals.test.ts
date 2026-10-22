import { describe, expect, it } from "vitest";

import { workOrderPrintTotals } from "./workOrderPrintTotals";

describe("workOrderPrintTotals", () => {
  it("prints the server's total rounded to the nearest rupee, never floored", () => {
    // ₹2,594.42 of items, GST on: the server stores ₹3,061.42 (2,594.42 x 1.18 = 3,061.4156 at 2 places).
    expect(workOrderPrintTotals(2594.42, 3061.42)).toEqual({ tax: 467, roundOff: -0.42, total: 3061 });
    // ₹3,061.60 rounds up, where Math.floor printed ₹3,061 and left ₹1 due.
    expect(workOrderPrintTotals(2594.58, 3061.6)).toEqual({ tax: 467.02, roundOff: 0.4, total: 3062 });
  });

  it("has no tax on a GST-off Work Order, whose stored total is its items", () => {
    expect(workOrderPrintTotals(1000.5, 1000.5)).toEqual({ tax: 0, roundOff: 0.5, total: 1001 });
  });
});
