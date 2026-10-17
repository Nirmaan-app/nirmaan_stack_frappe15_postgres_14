import { describe, expect, it } from "vitest";
import { srReportIncludes, type SRReportFigures } from "./srReportInclusion";

// A ₹10,000 Approved WO invoiced ₹4,000. Amount Paid is the stored figure: Paid payments less
// Received refunds (ADR-0034).
const wo = (amountPaid: number, over: Partial<SRReportFigures> = {}): SRReportFigures => ({
  status: "Approved",
  totalAmount: 10000,
  invoiceAmount: 4000,
  amountPaid,
  ...over,
});

describe("which WOs the WO reports list (#1461, story 33)", () => {
  it("a WO refunded to Amount Paid 0 meets neither condition, so neither report lists it", () => {
    expect(srReportIncludes("Pending Invoices", wo(0))).toBe(false);
    expect(srReportIncludes("PO with Excess Payments", wo(0))).toBe(false);
  });

  it("Pending Invoices lists a refunded WO still paid more than invoiced by over ₹100", () => {
    // Paid 9,000, refunded 4,000: Amount Paid 5,000, invoiced 4,000.
    expect(srReportIncludes("Pending Invoices", wo(5000))).toBe(true);
    // ₹100 exactly is not over.
    expect(srReportIncludes("Pending Invoices", wo(4100))).toBe(false);
  });

  it("Excess Payments lists a WO still paid more than its total by over ₹100", () => {
    // Paid 12,000, refunded 1,500: Amount Paid 10,500 on a 10,000 WO.
    expect(srReportIncludes("PO with Excess Payments", wo(10500))).toBe(true);
    expect(srReportIncludes("PO with Excess Payments", wo(10100))).toBe(false);
  });

  it("only an Approved WO is listed", () => {
    expect(srReportIncludes("Pending Invoices", wo(5000, { status: "Amendment" }))).toBe(false);
    expect(srReportIncludes("PO with Excess Payments", wo(10500, { status: "Amendment" }))).toBe(false);
  });
});
