import { describe, expect, it } from "vitest";

import finalCases from "./generatedInvoiceFinalCases.json";
import { generatedInvoiceDeleteNote, isFinalAmount, syncPercentAmount } from "./generatedInvoices";

describe("isFinalAmount (parity with services/wo_generated_invoices.is_final)", () => {
  for (const c of finalCases.cases) {
    it(c.name, () => {
      expect(isFinalAmount(c.wo_amount, c.billed, c.amount)).toBe(c.final);
    });
  }
});

describe("syncPercentAmount", () => {
  it("works the amount out from a percentage of the WO amount", () => {
    expect(syncPercentAmount("percent", "20", 6000)).toEqual({ percent: "20", amount: "1200" });
  });

  it("works the percentage out from an amount, rounded to 2 decimals", () => {
    expect(syncPercentAmount("amount", "2000", 6000)).toEqual({ amount: "2000", percent: "33.33" });
  });

  it("clears the other box when the typed one is cleared or not a number", () => {
    expect(syncPercentAmount("amount", "", 6000)).toEqual({ amount: "", percent: "" });
    expect(syncPercentAmount("percent", "abc", 6000)).toEqual({ percent: "abc", amount: "" });
  });

  it("does not divide by a WO amount of nothing", () => {
    expect(syncPercentAmount("amount", "500", 0)).toEqual({ amount: "500", percent: "" });
  });
});

describe("generatedInvoiceDeleteNote", () => {
  const generated = [
    { vendor_invoice: "VI-2026-00010", invoice_no: "INV-26-27-00203-01073-RA-1" },
    { vendor_invoice: null, invoice_no: "INV-26-27-00203-01073-RA-2" },
  ];

  it("names the generated invoice a signed upload's Vendor Invoice takes with it", () => {
    expect(generatedInvoiceDeleteNote(generated, "VI-2026-00010")).toBe(
      "This also deletes generated invoice INV-26-27-00203-01073-RA-1."
    );
  });

  it("says nothing for an invoice uploaded the ordinary way", () => {
    expect(generatedInvoiceDeleteNote(generated, "VI-2026-00099")).toBeUndefined();
    expect(generatedInvoiceDeleteNote([], "VI-2026-00010")).toBeUndefined();
  });
});
