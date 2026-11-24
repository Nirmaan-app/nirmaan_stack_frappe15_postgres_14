import { describe, expect, it } from "vitest";

import { itmDeliveryLookups, itmSourceName } from "./materialUsageHelpers";

describe("itmSourceName", () => {
  it("is the source project's name, or Warehouse for a warehouse ITM", () => {
    expect(itmSourceName({ itm: "ITM-1", source_type: "Project", source_project_name: "Kochi Site" })).toBe("Kochi Site");
    expect(itmSourceName({ itm: "ITM-2", source_type: "Warehouse", source_project_name: null })).toBe("Warehouse");
  });

  it("is blank when neither is known", () => {
    expect(itmSourceName({ itm: "ITM-3", source_type: null, source_project_name: null })).toBe("");
  });
});

describe("itmDeliveryLookups (DC Wise / MIR Wise rows of an ITM)", () => {
  // Shaped like get_transfer_summary: keyed by item id, one `itms` line per incoming ITM carrying that item.
  const summary = {
    "ITEM-001155": {
      itms: [
        { itm: "ITM-2026-00017", source_type: "Project", source_project_name: "Kochi Site", received_qty: 11 },
        { itm: "ITM-2026-00019", source_type: "Warehouse", source_project_name: null, received_qty: 4 },
      ],
    },
    "ITEM-002651": {
      itms: [{ itm: "ITM-2026-00017", source_type: "Project", source_project_name: "Kochi Site", received_qty: 1 }],
    },
    "ITEM-009999": { itms: [{ itm: "ITM-2026-00020", source_type: "Warehouse", source_project_name: null, received_qty: null }] },
    "ITEM-000000": {},
  };

  it("keeps each ITM's delivered quantity per item: one ITM's DN never adds to another's", () => {
    const { receivedQty } = itmDeliveryLookups(summary);
    expect(receivedQty.get("ITM-2026-00017_ITEM-001155")).toBe(11);
    expect(receivedQty.get("ITM-2026-00019_ITEM-001155")).toBe(4);
    expect(receivedQty.get("ITM-2026-00017_ITEM-002651")).toBe(1);
  });

  it("reads nothing delivered as 0, and an item the ITM does not carry as absent", () => {
    const { receivedQty } = itmDeliveryLookups(summary);
    expect(receivedQty.get("ITM-2026-00020_ITEM-009999")).toBe(0);
    expect(receivedQty.has("ITM-2026-00019_ITEM-002651")).toBe(false);
  });

  it("labels each ITM by where its material came from, once per ITM", () => {
    const { fromLabel } = itmDeliveryLookups(summary);
    expect(fromLabel.get("ITM-2026-00017")).toBe("From Kochi Site");
    expect(fromLabel.get("ITM-2026-00019")).toBe("From Warehouse");
    expect(fromLabel.get("ITM-2026-00020")).toBe("From Warehouse");
    expect(fromLabel.size).toBe(3);
  });

  it("an empty summary gives empty lookups", () => {
    const { receivedQty, fromLabel } = itmDeliveryLookups({});
    expect(receivedQty.size).toBe(0);
    expect(fromLabel.size).toBe(0);
  });
});
