import { describe, expect, it } from "vitest";

import { searchWords } from "@/utils/searchWords";

import {
  cashflowItemHits,
  cashflowItemTexts,
  cashflowPlanMatchesSearch,
  filterCashflowPlansBySearch,
} from "./cashflowSearch";

// Shaped like the rows the four Add forms save.
const existingPO = {
  name: "po1",
  type: "Existing PO",
  id_link: "PO/149/00107/26-27",
  vendor_name: "Cosmic Equipments (India) Pvt. Ltd.",
  critical_po_category: "HVAC  Ducting",
  critical_po_task: "Grills & Diffusers",
  remarks: "Balance payment after delivery",
  items: JSON.stringify({
    list: [{ name: "r1", item_id: "ITEM-002593", item_name: "DIFFUSER NECK SIZE 375X375", category: "Air Distribution" }],
  }),
};
const newPO = {
  name: "po2",
  type: "New PO",
  id_link: "",
  vendor_name: "Havells India Ltd",
  critical_po_category: "HVAC Piping",
  critical_po_task: "Refnet",
  remarks: null,
  items: { list: [{ name: "m0", item_name: "Copper pipe 12.7mm" }] }, // already parsed
};
const existingWO = {
  name: "wo1",
  type: "Existing WO",
  id_link: "SR-00107-001158",
  vendor_name: "SRI AMMAN FORKLIFT",
  remarks: "Pay on bill submission",
  items: JSON.stringify({ list: [{ description: "Forklift Unloading Charges\nMaterial: VRF Outdoor Units", category: "Misc" }] }),
};
const misc = { name: "m1", type: "Misc", remarks: "Diesel for DG set during power shutdown", items: null };
const inflow = { name: "i1", type: "Inflow", remarks: "Client RA Bill 3 payment from CTS" };

const plans = [existingPO, newPO, existingWO, misc, inflow];
const names = (out?: { name: string }[]) => (out ?? []).map((p) => p.name);
const find = (q: string) => names(filterCashflowPlansBySearch(plans, searchWords(q)));

describe("filterCashflowPlansBySearch", () => {
  it("keeps everything (same array) with no words, and passes a missing list through", () => {
    expect(filterCashflowPlansBySearch(plans, [])).toBe(plans);
    expect(filterCashflowPlansBySearch(undefined, ["x"])).toBeUndefined();
  });
  it("finds by PO/WO number, including part of it", () => {
    expect(find("PO/149")).toEqual(["po1"]);
    expect(find("001158")).toEqual(["wo1"]);
  });
  it("finds by vendor, ignoring case", () => {
    expect(find("havells")).toEqual(["po2"]);
    expect(find("FORKLIFT")).toEqual(["wo1"]);
  });
  it("finds by Critical PO category and task", () => {
    expect(find("piping")).toEqual(["po2"]);
    expect(find("refnet")).toEqual(["po2"]);
  });
  it("finds by a PO material name, from JSON text or an already-parsed object", () => {
    expect(find("diffuser")).toEqual(["po1"]);
    expect(find("copper")).toEqual(["po2"]);
  });
  it("finds by a WO description, including its second line", () => {
    expect(find("vrf outdoor")).toEqual(["wo1"]);
  });
  it("finds Misc and Inflow plans by remarks", () => {
    expect(find("diesel")).toEqual(["m1"]);
    expect(find("ra bill")).toEqual(["i1"]);
  });
  it("needs every word, which may sit in different fields", () => {
    expect(find("cosmic diffuser")).toEqual(["po1"]);
    expect(find("havells diffuser")).toEqual([]);
  });
  it("finds nothing for text no plan holds", () => {
    expect(find("transformer")).toEqual([]);
  });
});

describe("cashflowItemTexts", () => {
  it("reads PO item names and WO descriptions", () => {
    expect(cashflowItemTexts(existingPO)).toEqual(["DIFFUSER NECK SIZE 375X375"]);
    expect(cashflowItemTexts(existingWO)).toEqual(["Forklift Unloading Charges\nMaterial: VRF Outdoor Units"]);
  });
  it("gives none for missing, empty, broken or wrong-shaped items, without throwing", () => {
    expect(cashflowItemTexts({})).toEqual([]);
    expect(cashflowItemTexts({ items: null })).toEqual([]);
    expect(cashflowItemTexts({ items: "" })).toEqual([]);
    expect(cashflowItemTexts({ items: "{not json" })).toEqual([]);
    expect(cashflowItemTexts({ items: JSON.stringify({ list: "x" }) })).toEqual([]);
    expect(cashflowItemTexts({ items: JSON.stringify({ list: [null, 3, { item_name: 5 }, { item_name: "ok" }] }) })).toEqual(["ok"]);
  });
  it("reads a bare list (no { list } wrapper)", () => {
    expect(cashflowItemTexts({ items: [{ item_name: "Bare" }] })).toEqual(["Bare"]);
  });
});

describe("cashflowPlanMatchesSearch", () => {
  it("tolerates a plan with no fields at all", () => {
    expect(cashflowPlanMatchesSearch({}, [])).toBe(true);
    expect(cashflowPlanMatchesSearch({}, ["x"])).toBe(false);
  });
});

describe("cashflowItemHits", () => {
  const twoItemPO = {
    ...existingPO,
    items: JSON.stringify({
      list: [
        { name: "r1", item_name: "DIFFUSER NECK SIZE 375X375" },
        { name: "r2", item_name: "Linear Grill Without Collar Damper" },
        { name: "r3", item_name: "ROUND DIFFUSER 250 DIA" },
      ],
    }),
  };
  const hits = (plan: Parameters<typeof cashflowItemHits>[0], q: string) =>
    [...cashflowItemHits(plan, searchWords(q))].sort();

  it("marks nothing with no words", () => {
    expect(hits(twoItemPO, "")).toEqual([]);
  });
  it("marks the positions of the items whose text holds the word", () => {
    expect(hits(twoItemPO, "diffuser")).toEqual([0, 2]);
    expect(hits(twoItemPO, "grill")).toEqual([1]);
  });
  it("marks no item when only the plan's own fields matched (vendor, PO, remarks)", () => {
    expect(hits(twoItemPO, "cosmic")).toEqual([]);
    expect(hits(twoItemPO, "PO/149")).toEqual([]);
  });
  it("lets a plan-field word pass and marks the item for the rest", () => {
    expect(hits(twoItemPO, "cosmic round")).toEqual([2]);
  });
  it("needs every word not in the plan's fields to be in the same item", () => {
    // "round" and "linear" sit in different items and neither is in the plan's own fields.
    expect(hits(twoItemPO, "round linear")).toEqual([]);
    // "grill" is in the plan's task ("Grills & Diffusers"), so it passes and the round item is marked.
    expect(hits(twoItemPO, "round grill")).toEqual([2]);
  });
  it("reads a WO description, from an already-parsed object too", () => {
    expect(hits(existingWO, "forklift")).toEqual([0]);
    expect(hits(newPO, "copper")).toEqual([0]);
  });
  it("keeps positions aligned with the rendered list when an item is empty or broken", () => {
    const messy = { items: { list: [null, { item_name: "" }, { item_name: "Copper pipe" }] } };
    expect(hits(messy, "copper")).toEqual([2]);
  });
  it("gives none for unreadable items, without throwing", () => {
    expect(hits({ items: "{not json" }, "copper")).toEqual([]);
    expect(hits({}, "copper")).toEqual([]);
  });
});
