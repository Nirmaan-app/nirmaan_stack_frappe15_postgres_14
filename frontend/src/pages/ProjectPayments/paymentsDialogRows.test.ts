import { describe, expect, it } from "vitest";
import type { VendorRefundRow } from "@/components/vendor-refunds/useVendorRefunds";
import { paymentsDialogRows } from "./paymentsDialogRows";

const payment = (name: string, amount: number, payment_date: string) => ({ name, amount, payment_date });
const refund = (name: string, amount: number, status: VendorRefundRow["status"], payment_date: string): VendorRefundRow => ({
  name,
  amount,
  status,
  payment_date,
  vendor: "V-1",
  document_type: "Procurement Orders",
  document_name: "PO/1",
  creation: `${payment_date} 10:00:00`,
});

describe("paymentsDialogRows (the payments pop-up, #1460)", () => {
  // Paid 100 + 50, less the Received refund of 30 = 120, the order's Amount Paid.
  const payments = [payment("PAY-1", 100, "2026-04-01"), payment("PAY-2", 50, "2026-05-10")];
  const refunds = [
    refund("VRF-1", 30, "Received", "2026-06-01"),
    refund("VRF-2", 20, "Reconciliation Pending", "2026-06-02"),
    refund("VRF-3", 10, "Cancelled", "2026-06-03"),
  ];

  it("lists the Received refunds beside the payments, newest first", () => {
    const { rows } = paymentsDialogRows(payments, refunds);
    expect(rows.map((r) => r.name)).toEqual(["VRF-1", "PAY-2", "PAY-1"]);
  });

  it("adds up to the Amount Paid: payments less Received refunds", () => {
    expect(paymentsDialogRows(payments, refunds).total).toBe(120);
  });

  it("is just the payments while the refunds have not loaded", () => {
    const { rows, total } = paymentsDialogRows(payments, undefined);
    expect(rows.map((r) => r.name)).toEqual(["PAY-2", "PAY-1"]);
    expect(total).toBe(150);
  });
});

describe("paymentsDialogRows on a Work Order with TDS (#1512, ADR-0034 Amendment A)", () => {
  // PAY-V: 10,000 gross, 200 withheld from the vendor, 9,800 reached the bank.
  // PAY-C: 800 kept whole, 16 paid by the company on top (not the vendor's money).
  // Less a Received refund of 1,000: Amount Paid 9,800 + 200 + 800 - 1,000 = 9,800.
  const payments = [payment("PAY-V", 9800, "2026-05-10"), payment("PAY-C", 800, "2026-06-10")];
  const refunds = [refund("VRF-1", 1000, "Received", "2026-07-01")];
  const deductions = {
    "PAY-V": { tds_amount: 200, borne_by: "Vendor" as const },
    "PAY-C": { tds_amount: 16, borne_by: "Company" as const },
  };

  it("shows each payment's tax withheld from the vendor, and none for the company's", () => {
    const { rows } = paymentsDialogRows(payments, refunds, deductions);
    const tdsOf = (name: string) => rows.find((r) => r.name === name);
    expect(tdsOf("PAY-V")).toMatchObject({ kind: "payment", tds: 200 });
    expect(tdsOf("PAY-C")).toMatchObject({ kind: "payment", tds: 0 });
  });

  it("adds up to the Work Order's Amount Paid: payments + TDS withheld - Received refunds", () => {
    expect(paymentsDialogRows(payments, refunds, deductions).total).toBe(9800);
  });

  it("has no total and no TDS while the Work Order's TDS is still loading, never a total without the tax", () => {
    const { rows, total } = paymentsDialogRows(payments, refunds, undefined, true);
    expect(total).toBeUndefined();
    expect(rows.filter((r) => r.kind === "payment").map((r) => r.tds)).toEqual([undefined, undefined]);
  });
});
