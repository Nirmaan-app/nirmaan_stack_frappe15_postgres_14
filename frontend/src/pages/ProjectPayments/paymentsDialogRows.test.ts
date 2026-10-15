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
