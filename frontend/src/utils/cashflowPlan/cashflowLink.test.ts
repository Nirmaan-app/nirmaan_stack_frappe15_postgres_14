import { describe, expect, it } from "vitest";

import { parseJson } from "@/lib/parseJson";
import type { ProjectPO } from "@/utils/materialPlan/poLink";

import { cashflowPOLinkUpdate, cashflowWOLinkUpdate, woOptionLabel, woOptionSearchText, type ProjectWO } from "./cashflowLink";

const entry = { critical_po_category: "HVAC Piping", critical_po_task: "Refnet", critical_po_sub_category: null };

const refnetPO: ProjectPO = {
  name: "PO/140/00107/26-27",
  vendor: "VEN-1",
  vendor_name: "Havells India Ltd",
  items: [
    { name: "r1", item_id: "ITEM-1", item_name: "Refnet joint kit", category: "Copper", procurement_package: "HVAC" },
    { name: "r2", item_id: "ITEM-2", item_name: "Copper pipe 12.7mm", category: "Copper", procurement_package: "HVAC" },
  ],
  associated_tasks: [{ task_name: "t1", item_name: "Refnet", category: "HVAC Piping" }],
};
const ductPO: ProjectPO = {
  name: "PO/151/00107/26-27",
  items: [{ name: "d1", item_name: "Threaded rod" }],
  associated_tasks: [{ task_name: "t2", item_name: "Duct Supporting Material", category: "HVAC  Ducting", sub_category: "" }],
};
const forkliftWO: ProjectWO = {
  name: "SR-00107-001158",
  vendor: "VEN-S-365",
  vendor_name: "SRI AMMAN FORKLIFT",
  status: "Approved",
  grand_total: 7670,
  items: [{ description: "Forklift Unloading Charges", category: "Miscellaneous Services" }],
};

describe("cashflowPOLinkUpdate", () => {
  it("moves a New PO entry onto the picked PO with only the ticked items and no estimated price", () => {
    const update = cashflowPOLinkUpdate(refnetPO, (n) => n === "r2", entry);
    expect(update.type).toBe("Existing PO");
    expect(update.id_link).toBe("PO/140/00107/26-27");
    expect(update.estimated_price).toBe(0);
    expect(parseJson(update.items)).toEqual({
      list: [{ name: "r2", item_id: "ITEM-2", item_name: "Copper pipe 12.7mm", category: "Copper" }],
    });
    expect(update.critical_po_task).toBe("Refnet");
  });
  it("moves the task to the new PO's task when it belongs to another", () => {
    const update = cashflowPOLinkUpdate(ductPO, () => true, entry);
    expect(update.critical_po_task).toBe("Duct Supporting Material");
    expect(update.critical_po_category).toBe("HVAC  Ducting");
  });
  it("never writes the planned amount, date or vendor (the form owns those)", () => {
    const update = cashflowPOLinkUpdate(refnetPO, () => true, entry);
    expect(update).not.toHaveProperty("planned_amount");
    expect(update).not.toHaveProperty("planned_date");
    expect(update).not.toHaveProperty("vendor");
  });
});

describe("cashflowWOLinkUpdate", () => {
  it("moves the entry onto the picked WO with all its descriptions and no estimated price", () => {
    const update = cashflowWOLinkUpdate(forkliftWO);
    expect(update).toEqual({
      type: "Existing WO",
      id_link: "SR-00107-001158",
      estimated_price: 0,
      items: JSON.stringify({ list: forkliftWO.items }),
    });
  });
  it("writes an empty list for a WO with no items", () => {
    expect(parseJson(cashflowWOLinkUpdate({ name: "SR-1" }).items)).toEqual({ list: [] });
  });
});

describe("woOptionSearchText", () => {
  it("joins the WO's descriptions", () => {
    const wo = { ...forkliftWO, items: [{ description: "Forklift Unloading Charges" }, { description: null }, { description: "Night shift" }] };
    expect(woOptionSearchText(wo)).toBe("Forklift Unloading Charges\nNight shift");
  });
  it("is empty for a WO with no items", () => {
    expect(woOptionSearchText({ name: "SR-1" })).toBe("");
  });
});

describe("woOptionLabel", () => {
  it("shows WO, vendor, rounded total, status and the first description", () => {
    expect(woOptionLabel(forkliftWO)).toBe(
      "SR-00107-001158 · SRI AMMAN FORKLIFT · ₹7,670 · Approved — Forklift Unloading Charges",
    );
  });
  it("shows only the first line of a long description, shortened, and how many more there are", () => {
    const wo = {
      name: "SR-2",
      items: [
        { description: "Unloading and shifting of Double Skin Plenum units to the second floor\nDate: 03-10-2026" },
        { description: "Night shift" },
        { description: "Crane" },
      ],
    };
    // The first 50 characters, trailing space trimmed.
    expect(woOptionLabel(wo)).toBe("SR-2 — Unloading and shifting of Double Skin Plenum units… (+2 more)");
  });
  it("leaves out what the WO does not have", () => {
    expect(woOptionLabel({ name: "SR-1" })).toBe("SR-1");
  });
});
