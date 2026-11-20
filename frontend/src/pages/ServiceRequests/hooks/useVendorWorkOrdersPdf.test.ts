import { describe, expect, it } from "vitest";

import { parseJson } from "@/lib/parseJson";

import { SR_SEARCHABLE_FIELDS } from "../config/srTable.config";
import { buildVendorWorkOrdersPdfParams, vendorWorkOrdersPdfFileName } from "./useVendorWorkOrdersPdf";

const base = {
  columnFilters: [],
  sorting: [],
  searchableFields: SR_SEARCHABLE_FIELDS,
  view: "all" as const,
};

describe("buildVendorWorkOrdersPdfParams", () => {
  it("sends only the view when the table is untouched (the format's default sort applies)", () => {
    expect(buildVendorWorkOrdersPdfParams(base)).toEqual({
      wo_view: "all",
      wo_filters: undefined,
      order_by: undefined,
      search_term: undefined,
      search_field: undefined,
      item_search: undefined,
    });
  });

  it("turns the facet and date filters into Frappe filters", () => {
    const params = buildVendorWorkOrdersPdfParams({
      ...base,
      view: "finalized",
      columnFilters: [
        { id: "project", value: ["PROJ-1"] },
        { id: "gst", value: ["true"] },
        { id: "is_finalized", value: ["1"] },
        { id: "creation", value: { operator: "Between", value: ["2025-01-01", "2025-06-30"] } },
      ],
    });
    expect(params.wo_view).toBe("finalized");
    expect(parseJson(params.wo_filters ?? "")).toEqual([
      ["project", "in", ["PROJ-1"]],
      ["gst", "in", ["true"]],
      ["is_finalized", "in", ["1"]],
      ["creation", "Between", ["2025-01-01", "2025-06-30"]],
    ]);
  });

  it("drops filters and sorts on columns that are not Service Requests fields", () => {
    const params = buildVendorWorkOrdersPdfParams({
      ...base,
      columnFilters: [{ id: "pending_invoice_amount", value: ["1"] }, { id: "remarks", value: "x" }],
      sorting: [{ id: "pending_invoice_amount", desc: true }],
    });
    expect(params.wo_filters).toBeUndefined();
    expect(params.order_by).toBeUndefined();
  });

  it("passes the sort as order_by", () => {
    expect(buildVendorWorkOrdersPdfParams({ ...base, sorting: [{ id: "total_amount", desc: false }] }).order_by).toBe(
      "total_amount asc"
    );
  });

  it("flags the item search, and leaves a blank search out", () => {
    const item = buildVendorWorkOrdersPdfParams({ ...base, searchTerm: " paint ", selectedSearchField: "work_order_items" });
    expect([item.search_term, item.search_field, item.item_search]).toEqual(["paint", "work_order_items", "1"]);

    const byId = buildVendorWorkOrdersPdfParams({ ...base, searchTerm: "000375", selectedSearchField: "name" });
    expect([byId.search_term, byId.search_field, byId.item_search]).toEqual(["000375", "name", undefined]);

    const blank = buildVendorWorkOrdersPdfParams({ ...base, searchTerm: "   ", selectedSearchField: "name" });
    expect([blank.search_term, blank.search_field]).toEqual([undefined, undefined]);
  });
});

describe("vendorWorkOrdersPdfFileName", () => {
  const date = new Date("2026-11-19T10:00:00Z");
  it("names the vendor, the view and the date", () => {
    expect(vendorWorkOrdersPdfFileName("Mahmood", "VEN-Service-0085", "approved", date)).toBe(
      "Mahmood_Approved_WO_2026-11-19.pdf"
    );
    expect(vendorWorkOrdersPdfFileName(undefined, "VEN-Service-0085", "all", date)).toBe(
      "VEN-Service-0085_All_WO_2026-11-19.pdf"
    );
  });
});
