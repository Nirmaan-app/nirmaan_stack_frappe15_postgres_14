import { describe, expect, it } from "vitest";

import finalCases from "./generatedInvoiceFinalCases.json";
import {
  generatedInvoiceDeleteNote,
  isFinalAmount,
  syncPercentAmount,
  unsignedGeneratedCopy,
  visibleGeneratedInvoices,
} from "./generatedInvoices";

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

describe("visibleGeneratedInvoices", () => {
  const row = (name: string, status: string) => ({ name, status });

  it("hides Approved and keeps Generated, Signed and Voided, in order", () => {
    const all = [row("RA-4", "Generated"), row("RA-3", "Approved"), row("RA-2", "Signed"), row("RA-1", "Voided")];
    expect(visibleGeneratedInvoices(all).map((r) => r.name)).toEqual(["RA-4", "RA-2", "RA-1"]);
  });

  it("lists nothing when every one is Approved, so the table is not shown", () => {
    expect(visibleGeneratedInvoices([row("RA-2", "Approved"), row("RA-1", "Approved")])).toEqual([]);
  });

  it("lists nothing for a Work Order with none", () => {
    expect(visibleGeneratedInvoices([])).toEqual([]);
  });

  it("matches the status exactly: only Approved is hidden", () => {
    const odd = [row("a", "approved"), row("b", " Approved"), row("c", "")];
    expect(visibleGeneratedInvoices(odd).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("leaves the full list untouched for the signed-upload lock and delete note", () => {
    const all = [row("RA-2", "Approved"), row("RA-1", "Generated")];
    visibleGeneratedInvoices(all);
    expect(all.map((r) => r.name)).toEqual(["RA-2", "RA-1"]);
  });
});

describe("unsignedGeneratedCopy (the Add Invoice warning; server: generated_copy_verdict + signature_signed)", () => {
  const generated = [
    { invoice_no: "INV-26-27-00107-00990-RA-1", status: "Approved", amount: 250000 },
    { invoice_no: "INV-26-27-00107-00990", status: "Generated", amount: 219395 },
  ];
  const upload = {
    generated,
    gstOff: true,
    aiRead: true,
    submittedNo: "INV-26-27-00107-00990",
    extractedNo: "INV-26-27-00107-00990",
    amount: 219395,
    entities: [{ type: "authorized_signature", value: "not_signed" }],
  };

  it("warns for a Generated invoice's copy the AI found unsigned", () => {
    expect(unsignedGeneratedCopy(upload)?.invoice_no).toBe("INV-26-27-00107-00990");
  });

  it("warns when the AI gave no signature answer, as the server counts it unsigned", () => {
    expect(unsignedGeneratedCopy({ ...upload, entities: [] })).toBeDefined();
  });

  it("says nothing for a signed or stamped copy", () => {
    for (const value of ["signed", "Stamped "]) {
      expect(unsignedGeneratedCopy({ ...upload, entities: [{ type: "authorized_signature", value }] })).toBeUndefined();
    }
  });

  it("matches the number in any case and the amount within a rupee", () => {
    expect(unsignedGeneratedCopy({ ...upload, submittedNo: " inv-26-27-00107-00990", amount: 219396 })).toBeDefined();
    expect(unsignedGeneratedCopy({ ...upload, amount: 219397 })).toBeUndefined();
  });

  it("says nothing when the upload is not that copy", () => {
    expect(unsignedGeneratedCopy({ ...upload, gstOff: false })).toBeUndefined();
    expect(unsignedGeneratedCopy({ ...upload, aiRead: false })).toBeUndefined();
    expect(unsignedGeneratedCopy({ ...upload, submittedNo: "OTHER-1" })).toBeUndefined();
    expect(unsignedGeneratedCopy({ ...upload, extractedNo: "" })).toBeUndefined();
    // Already uploaded: the server refuses that one as a duplicate.
    expect(
      unsignedGeneratedCopy({ ...upload, submittedNo: generated[0].invoice_no, extractedNo: generated[0].invoice_no, amount: 250000 })
    ).toBeUndefined();
  });
});
