import { describe, expect, it } from "vitest";

import type { PartiallyReconciledItem } from "@/pages/reports/hooks/usePartiallyReconciled";
import { nonProjectReconciledInFilters } from "./nonProjectReconciledInFilters";

const item = (over: Partial<PartiallyReconciledItem>): PartiallyReconciledItem => ({
  doctype: "Non Project Expenses", name: "NPE-1", amount: 0, document_type: null, document_name: null,
  bill_amount: 0, pending_amount: 0, latest_line_date: "2026-10-01", line_count: 1, project: null,
  project_name: null, vendor: null, type: "Office Rent", expense_type_name: null, description: "Rent October",
  ...over,
});

// Two part-reconciled expenses: Rs 63,99,695 of salaries, Rs 500 of rent (walk W7).
const items = [
  item({ name: "NPE-1", amount: 6399695, type: "Salaries", description: "Staff salaries September" }),
  item({ name: "NPE-2", amount: 500, type: "Office Rent", description: "Rent to Enamul" }),
];

describe("the Payments Report (Non-Project)'s part-reconciled add-on follows the report's filters (walk W7)", () => {
  it("keeps every record with no filter and no search", () => {
    expect(nonProjectReconciledInFilters(items, [], "", "description")).toMatchObject({ amount: 6400195, count: 2 });
  });

  it("follows the search on the field it searches", () => {
    expect(nonProjectReconciledInFilters(items, [], "enamul", "description")).toMatchObject({ amount: 500, count: 1 });
    expect(nonProjectReconciledInFilters(items, [], "NPE-1", "name").items.map((i) => i.name)).toEqual(["NPE-1"]);
  });

  it("follows a facet filter", () => {
    expect(nonProjectReconciledInFilters(items, [{ id: "type", value: ["Office Rent"] }], "", "description").amount).toBe(500);
  });
});
