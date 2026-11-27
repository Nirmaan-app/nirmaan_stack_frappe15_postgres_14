import { describe, expect, it } from "vitest";

import { searchWords } from "@/utils/searchWords";

import { filterPlansBySearch, matchedItemIndexes, planMatchesSearch } from "./planSearch";

const items = (...names: (string | null)[]) => names.map((item_name) => ({ item_name }));

const cablePlan = {
  name: "p1",
  po_link: "PO/0012/00107/25-26",
  critical_po_task: "Cable Laying",
  critical_po_category: "Electrical",
  remarks: null,
  mp_items: items("MCB 32A DP", "Armoured Cable 4C x 16 sq mm", "Cable Tray 300mm"),
};
const plumbingPlan = {
  name: "p2",
  po_link: "PO/0020/00107/25-26",
  critical_po_task: "Drainage",
  critical_po_category: "Plumbing",
  remarks: "Second lot after site visit",
  mp_items: items("PVC Pipe 110mm", "Elbow 110mm"),
};
const emptyPlan = { name: "p3", po_link: null, critical_po_task: null, mp_items: [] as { item_name: string | null }[] };
const plans = [cablePlan, plumbingPlan, emptyPlan];
const itemsOf = (plan: (typeof plans)[number]) => plan.mp_items;
const names = (out?: { name: string }[]) => (out ?? []).map((p) => p.name);

describe("filterPlansBySearch", () => {
  it("keeps everything (same array) with no words", () => {
    expect(filterPlansBySearch(plans, [], itemsOf)).toBe(plans);
  });
  it("passes a missing list through", () => {
    expect(filterPlansBySearch(undefined, ["mcb"], itemsOf)).toBeUndefined();
  });
  it("finds a plan by a material name, ignoring case", () => {
    expect(names(filterPlansBySearch(plans, searchWords("mcb"), itemsOf))).toEqual(["p1"]);
  });
  it("finds a plan by part of its PO number", () => {
    expect(names(filterPlansBySearch(plans, searchWords("0020"), itemsOf))).toEqual(["p2"]);
  });
  it("finds a plan by task, category and remarks", () => {
    expect(names(filterPlansBySearch(plans, searchWords("drainage"), itemsOf))).toEqual(["p2"]);
    expect(names(filterPlansBySearch(plans, searchWords("electrical"), itemsOf))).toEqual(["p1"]);
    expect(names(filterPlansBySearch(plans, searchWords("site visit"), itemsOf))).toEqual(["p2"]);
  });
  it("needs every word, which may sit in different fields", () => {
    expect(names(filterPlansBySearch(plans, searchWords("0012 mcb"), itemsOf))).toEqual(["p1"]);
    expect(names(filterPlansBySearch(plans, searchWords("0020 mcb"), itemsOf))).toEqual([]);
  });
  it("matches a word shared by several plans in all of them", () => {
    expect(names(filterPlansBySearch(plans, searchWords("mm"), itemsOf))).toEqual(["p1", "p2"]);
  });
  it("finds nothing for text no plan holds", () => {
    expect(names(filterPlansBySearch(plans, searchWords("transformer"), itemsOf))).toEqual([]);
  });
  it("does not match across a field boundary", () => {
    // "Laying" ends one field and "Electrical" starts the next; the joined text must not read "layingelectrical".
    expect(names(filterPlansBySearch(plans, searchWords("layingelectrical"), itemsOf))).toEqual([]);
  });
});

describe("planMatchesSearch", () => {
  it("handles a plan with no fields and no materials", () => {
    expect(planMatchesSearch(emptyPlan, [], [])).toBe(true);
    expect(planMatchesSearch(emptyPlan, [], ["x"])).toBe(false);
  });
  it("tolerates a material with no name", () => {
    expect(planMatchesSearch(emptyPlan, items(null), ["x"])).toBe(false);
  });
});

describe("matchedItemIndexes", () => {
  const hits = (plan: typeof cablePlan | typeof plumbingPlan, query: string) =>
    [...matchedItemIndexes(plan, plan.mp_items, searchWords(query))].sort();

  it("marks nothing with no words", () => {
    expect(hits(cablePlan, "")).toEqual([]);
  });
  it("marks the materials whose name holds the word", () => {
    expect(hits(cablePlan, "mcb")).toEqual([0]);
    expect(hits(cablePlan, "cable")).toEqual([1, 2]);
  });
  it("marks no material when the search only matched the plan's own fields", () => {
    expect(hits(cablePlan, "0012")).toEqual([]);
    expect(hits(cablePlan, "electrical")).toEqual([]);
  });
  it("lets a word that names the plan's PO pass and marks the material for the rest", () => {
    expect(hits(cablePlan, "0012 mcb")).toEqual([0]);
  });
  it("needs every word not in the plan's fields to be in the material's name", () => {
    expect(hits(cablePlan, "mcb tray")).toEqual([]);
    expect(hits(cablePlan, "cable tray")).toEqual([2]);
  });
});
