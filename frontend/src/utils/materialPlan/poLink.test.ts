import { describe, expect, it } from "vitest";

import { parseJson } from "@/lib/parseJson";

import {
  criticalFieldsForPO,
  isLinkedToPlanTask,
  planItemsFromPO,
  poLinkUpdate,
  poOptionLabel,
  posForPicker,
  poTaskLabel,
  sortPOsForPlan,
  type ProjectPO,
} from "./poLink";

// A New PO plan for "HVAC Piping / Copper Pipe and Insulation" with typed-in items.
const plan = {
  critical_po_category: "HVAC Piping",
  critical_po_task: "Copper Pipe and Insulation",
  critical_po_sub_category: null,
};

const copperPO: ProjectPO = {
  name: "PO/105/00107/26-27",
  vendor_name: "Pipe Vendor",
  items: [
    { name: "r1", item_id: "ITEM-1", item_name: "COPPER PIPE 12.7MM", procurement_package: "HVAC", category: "Copper" },
    { name: "r2", item_id: "ITEM-2", item_name: "NITRILE INSULATION 13MM", procurement_package: "HVAC", category: "Insulation" },
    { name: "r3", item_id: "ITEM-3", item_name: "Freight Charges", procurement_package: "HVAC", category: "Misc" },
  ],
  associated_tasks: [{ task_name: "t1", item_name: "Copper Pipe and Insulation", category: "HVAC Piping", sub_category: "" }],
};
const ductPO: ProjectPO = {
  name: "PO/099/00107/26-27",
  items: [{ name: "d1", item_id: "ITEM-9", item_name: "FIRE DAMPER", category: "Dampers" }],
  associated_tasks: [{ task_name: "t2", item_name: "Fire Damper", category: "HVAC Ducting", sub_category: "Sub A" }],
};
const plainPO: ProjectPO = { name: "PO/150/00107/26-27", items: [{ name: "p1", item_name: "Bolt" }] };
const twoTaskPO: ProjectPO = {
  name: "PO/200",
  items: [],
  associated_tasks: [
    { task_name: "t2", item_name: "Fire Damper", category: "HVAC Ducting" },
    { task_name: "t1", item_name: "Copper Pipe and Insulation", category: "HVAC Piping", sub_category: "Main" },
  ],
};

describe("isLinkedToPlanTask", () => {
  it("is true only for a PO linked to the plan's own task", () => {
    expect(isLinkedToPlanTask(copperPO, plan)).toBe(true);
    expect(isLinkedToPlanTask(ductPO, plan)).toBe(false);
    expect(isLinkedToPlanTask(plainPO, plan)).toBe(false);
  });
  it("needs the same category when the plan has one", () => {
    expect(isLinkedToPlanTask(copperPO, { ...plan, critical_po_category: "HVAC Ducting" })).toBe(false);
    expect(isLinkedToPlanTask(copperPO, { ...plan, critical_po_category: null })).toBe(true);
  });
  it("is false for a plan with no task", () => {
    expect(isLinkedToPlanTask(copperPO, {})).toBe(false);
  });
});

describe("sortPOsForPlan", () => {
  it("puts the POs linked to the plan's task first, keeping the rest in order", () => {
    expect(sortPOsForPlan([plainPO, ductPO, copperPO, twoTaskPO], plan).map((p) => p.name)).toEqual([
      "PO/105/00107/26-27",
      "PO/200",
      "PO/150/00107/26-27",
      "PO/099/00107/26-27",
    ]);
  });
  it("gives an empty list for no POs", () => {
    expect(sortPOsForPlan(undefined, plan)).toEqual([]);
  });
});

describe("posForPicker", () => {
  const all = [plainPO, ductPO, copperPO, twoTaskPO];
  it("lists only the POs linked to the plan's task by default (like Add Material Plan)", () => {
    expect(posForPicker(all, plan, false).map((p) => p.name)).toEqual(["PO/105/00107/26-27", "PO/200"]);
  });
  it("lists every project PO, the task's own first, with See all", () => {
    expect(posForPicker(all, plan, true).map((p) => p.name)).toEqual([
      "PO/105/00107/26-27",
      "PO/200",
      "PO/150/00107/26-27",
      "PO/099/00107/26-27",
    ]);
  });
  it("lists nothing by default for a task no PO is linked to, or a plan with no task", () => {
    expect(posForPicker(all, { critical_po_task: "Cable Tray" }, false)).toEqual([]);
    expect(posForPicker(all, {}, false)).toEqual([]);
  });
});

describe("poTaskLabel", () => {
  it("names the PO's task(s), once each", () => {
    expect(poTaskLabel(ductPO)).toBe("Fire Damper");
    expect(poTaskLabel(twoTaskPO)).toBe("Fire Damper, Copper Pipe and Insulation");
    expect(poTaskLabel({ ...ductPO, associated_tasks: [...ductPO.associated_tasks!, ...ductPO.associated_tasks!] })).toBe("Fire Damper");
  });
  it("says so when the PO has no task", () => {
    expect(poTaskLabel(plainPO)).toBe("no task");
  });
});

describe("poOptionLabel", () => {
  it("shows PO, vendor and item count", () => {
    expect(poOptionLabel(copperPO, plan, false)).toBe("PO/105/00107/26-27 · Pipe Vendor · 3 items");
    expect(poOptionLabel(plainPO, plan, false)).toBe("PO/150/00107/26-27 · 1 item");
  });
  it("names another task's PO only in the all-POs list", () => {
    expect(poOptionLabel(ductPO, plan, true)).toBe("PO/099/00107/26-27 · 1 item · task: Fire Damper");
    expect(poOptionLabel(copperPO, plan, true)).toBe("PO/105/00107/26-27 · Pipe Vendor · 3 items");
    expect(poOptionLabel(plainPO, plan, true)).toBe("PO/150/00107/26-27 · 1 item · task: no task");
  });
});

describe("criticalFieldsForPO", () => {
  it("takes the PO's task when the PO has one", () => {
    expect(criticalFieldsForPO(ductPO, plan)).toEqual({
      critical_po_category: "HVAC Ducting",
      critical_po_task: "Fire Damper",
      critical_po_sub_category: "Sub A",
    });
  });
  it("prefers the plan's own task when the PO is linked to several", () => {
    expect(criticalFieldsForPO(twoTaskPO, plan)).toEqual({
      critical_po_category: "HVAC Piping",
      critical_po_task: "Copper Pipe and Insulation",
      critical_po_sub_category: "Main",
    });
  });
  it("keeps the plan's own fields when the PO has no task", () => {
    expect(criticalFieldsForPO(plainPO, { ...plan, critical_po_sub_category: "X" })).toEqual({
      critical_po_category: "HVAC Piping",
      critical_po_task: "Copper Pipe and Insulation",
      critical_po_sub_category: "X",
    });
  });
  it("stores blanks as null", () => {
    expect(criticalFieldsForPO(copperPO, plan).critical_po_sub_category).toBeNull();
    expect(criticalFieldsForPO(plainPO, {})).toEqual({
      critical_po_category: null,
      critical_po_task: null,
      critical_po_sub_category: null,
    });
  });
});

describe("planItemsFromPO", () => {
  it("keeps only the ticked rows, in the PO's order, with the plan's item fields", () => {
    const ticked = new Set(["r3", "r1"]);
    expect(planItemsFromPO(copperPO.items, (n) => ticked.has(n))).toEqual([
      { name: "r1", item_id: "ITEM-1", item_name: "COPPER PIPE 12.7MM", procurement_package: "HVAC", category: "Copper" },
      { name: "r3", item_id: "ITEM-3", item_name: "Freight Charges", procurement_package: "HVAC", category: "Misc" },
    ]);
  });
  it("gives an empty list when nothing is ticked or there are no items", () => {
    expect(planItemsFromPO(copperPO.items, () => false)).toEqual([]);
    expect(planItemsFromPO(undefined, () => true)).toEqual([]);
  });
});

describe("poLinkUpdate", () => {
  it("moves a New PO plan onto the picked PO with only the ticked PO items", () => {
    const update = poLinkUpdate(copperPO, (n) => n === "r1", plan);
    expect(update.po_type).toBe("Existing PO");
    expect(update.po_link).toBe("PO/105/00107/26-27");
    expect(parseJson(update.mp_items)).toEqual({
      list: [{ name: "r1", item_id: "ITEM-1", item_name: "COPPER PIPE 12.7MM", procurement_package: "HVAC", category: "Copper" }],
    });
    expect(update.critical_po_task).toBe("Copper Pipe and Insulation");
    expect(update).not.toHaveProperty("delivery_date");
    expect(update).not.toHaveProperty("delivery_status");
  });
  it("moves the plan's task to the new PO's task when it has another one", () => {
    const update = poLinkUpdate(ductPO, () => true, plan);
    expect(update.po_link).toBe("PO/099/00107/26-27");
    expect(update.critical_po_task).toBe("Fire Damper");
    expect(update.critical_po_category).toBe("HVAC Ducting");
  });
});
