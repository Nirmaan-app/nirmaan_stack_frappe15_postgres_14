import { describe, expect, it } from "vitest";
import { buildReceivableLedger } from "./useReceivableLedgerRows";
import type { CustomerLedgerTransaction } from "./useCustomerLedger";

const row = (over: Partial<CustomerLedgerTransaction>): CustomerLedgerTransaction => ({
  type: "Invoice Raised", date: "2026-01-01", project: "Tower A", project_id: "P-A", details: "", invoice: 0, inflow: 0, ...over,
});

// Tower A: invoice 1,000, inflow 400. Tower B: invoice 5,000. In date order.
const ROWS = [
  row({ date: "2026-01-05", details: "Invoice No: INV-A1", invoice: 1000 }),
  row({ date: "2026-02-01", project: "Tower B", project_id: "P-B", details: "Invoice No: INV-B1", invoice: 5000 }),
  row({ type: "Inflow Received", date: "2026-03-10", details: "UTR: UTR-A1", inflow: 400 }),
];
const ALL_KEYS = ["details", "project", "type"] as const;

describe("buildReceivableLedger", () => {
  it("runs the receivable from zero in row order and totals the footer", () => {
    const ledger = buildReceivableLedger(ROWS, { searchTerm: "", searchKeys: ALL_KEYS });
    expect(ledger.items.map((i) => i.receivable)).toEqual([1000, 6000, 5600]);
    expect(ledger.totals).toEqual({ invoice: 6000, inflow: 400 });
    expect(ledger.closingReceivable).toBe(5600);
  });

  it("filters BEFORE the running total: one project's own trail, not the customer's", () => {
    const ledger = buildReceivableLedger(ROWS, { searchTerm: "", searchKeys: ALL_KEYS, projectFilter: new Set(["Tower A"]) });
    expect(ledger.items.map((i) => i.receivable)).toEqual([1000, 600]);
    expect(ledger.closingReceivable).toBe(600);
  });

  it("searches only the keys it is given", () => {
    // "Tower B" is a project name: found with the customer's keys, not with the project ledger's.
    expect(buildReceivableLedger(ROWS, { searchTerm: "Tower B", searchKeys: ALL_KEYS }).items.map((i) => i.details))
      .toContain("Invoice No: INV-B1");
    expect(buildReceivableLedger(ROWS, { searchTerm: "Tower B", searchKeys: ["details", "type"] }).items).toEqual([]);
  });

  it("applies the date filter", () => {
    const ledger = buildReceivableLedger(ROWS, {
      searchTerm: "", searchKeys: ALL_KEYS, dateFilter: { operator: ">=", value: "2026-02-01" },
    });
    expect(ledger.items.map((i) => i.date)).toEqual(["2026-02-01", "2026-03-10"]);
    expect(ledger.items.map((i) => i.receivable)).toEqual([5000, 4600]);
  });

  it("is empty, with zero totals, when there are no rows (or they have not loaded)", () => {
    for (const rows of [undefined, []]) {
      expect(buildReceivableLedger(rows, { searchTerm: "", searchKeys: ALL_KEYS }))
        .toEqual({ items: [], totals: { invoice: 0, inflow: 0 }, closingReceivable: 0 });
    }
  });
});
