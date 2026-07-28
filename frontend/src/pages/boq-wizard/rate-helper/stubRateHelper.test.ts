import { describe, it, expect } from "vitest";
import { stubRateHelper } from "./stubRateHelper";
import { isSuggestion, type RateHelperRowContext } from "./rateHelperTypes";

function ctx(category: string | null): RateHelperRowContext {
  return {
    excelRow: 7,
    description: "d",
    nodeType: "Line Item",
    category,
    discipline: null,
    rateKinds: ["supply_rate", "install_rate"],
  };
}

describe("stubRateHelper.compute", () => {
  it("suggests BOTH supply and install for a matching category (default attributes)", () => {
    const r = stubRateHelper.compute(ctx("earthing"));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.values.supply_rate).toBe(120);
    expect(r.values.install_rate).toBe(45);
    expect(r.basis).toContain("earthing");
    expect(r.workings.attributes.map((a) => a.id)).toEqual(["material", "size"]);
    expect(r.workings.finalValues.supply_rate).toBe(120);
  });

  it("recomputes live when an attribute changes to another matching combo", () => {
    const r = stubRateHelper.compute(ctx("earthing"), { size: "50x6" });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.values.supply_rate).toBe(210);
    expect(r.values.install_rate).toBe(60);
    // the edited attribute is reflected back in the workings
    expect(r.workings.attributes.find((a) => a.id === "size")?.value).toBe("50x6");
  });

  it("reaches an honest 'no match' state (empty values, attributes preserved) WITHOUT collapsing", () => {
    const r = stubRateHelper.compute(ctx("earthing"), { material: "Copper", size: "50x6" });
    expect(isSuggestion(r)).toBe(true); // still a Suggestion so attributes stay editable
    if (!isSuggestion(r)) return;
    expect(r.values.supply_rate).toBeUndefined();
    expect(r.values.install_rate).toBeUndefined();
    expect(r.basis).toBe("no match for these attributes");
    expect(r.workings.attributes.length).toBe(2); // editable attributes preserved
    expect(r.workings.derivation.join(" ")).toContain("Copper");
  });

  it("is supply-ONLY for wiring_cabling (no install value)", () => {
    const r = stubRateHelper.compute(ctx("wiring_cabling"));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.values.supply_rate).toBe(320);
    expect(r.values.install_rate).toBeUndefined();
  });

  it("declines with a reason for a category with no table", () => {
    const r = stubRateHelper.compute(ctx("panels"));
    expect(r.kind).toBe("none");
    if (r.kind !== "none") return;
    expect(r.reason).toBe("no rate table for this category");
  });

  it("declines for a null / blank category", () => {
    expect(stubRateHelper.compute(ctx(null)).kind).toBe("none");
  });
});
