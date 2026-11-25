// #1741 -- THE CATALOGUE MEMO (itemListPricing.ts): the projected catalogue and each family's rows are built once per
// (spec, items) pair, not on every projectUnitClass / fieldOptionsFromSkus call. A new items array, or the same array
// grown or shrunk (the length tripwire), is projected afresh; the options a dropdown offers are unchanged.
import { describe, it, expect } from "vitest";
import HVAC_V7 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v7.json";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { fieldOptionsFromSkus, itemListPricingSpec, projectUnitClass } from "./itemListPricing";

type Asset = { items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const asset = HVAC_V7 as unknown as Asset;
const adp = asset.category_configs.find((c) => c.category_id === "hvac_adp")!;
const freshItems = () => asset.items.map((i) => ({ ...i, discipline: "HVAC" }));

describe("#1741 the catalogue memo", () => {
  it("returns the same projected array for the same spec and items", () => {
    const spec = itemListPricingSpec(adp)!;
    const items = freshItems();
    expect(projectUnitClass(spec, items)).toBe(projectUnitClass(spec, items));
  });

  it("projects a new items array afresh", () => {
    const spec = itemListPricingSpec(adp)!;
    const a = freshItems(), b = freshItems();
    const pa = projectUnitClass(spec, a), pb = projectUnitClass(spec, b);
    expect(pb).not.toBe(pa);
    expect(pb).toEqual(pa);
  });

  it("projects again when the same array changed length (the tripwire)", () => {
    const spec = itemListPricingSpec(adp)!;
    const items = freshItems();
    const before = projectUnitClass(spec, items);
    const extra = { ...items.find((i) => i.unit === "SQM")!, name: "made-up-extra-sku", item_name: "Made-up Extra" };
    items.push(extra);
    const after = projectUnitClass(spec, items);
    expect(after).not.toBe(before);
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1].attributes.unit_class).toBe("area");
  });

  it("another spec object for the same config is projected on its own", () => {
    const items = freshItems();
    expect(projectUnitClass(itemListPricingSpec(adp)!, items)).not.toBe(projectUnitClass(itemListPricingSpec(adp)!, items));
  });

  it("a dropdown's options are the same through the memo, call after call, and follow a grown catalogue", () => {
    const spec = itemListPricingSpec(adp)!;
    const items = freshItems();
    const fam = String(projectUnitClass(spec, items).find((i) => i.attributes[spec.family_attribute_id ?? "family"])!.attributes[spec.family_attribute_id ?? "family"]);
    const attr = Object.keys(spec.numbers)[0];
    const first = fieldOptionsFromSkus(spec, items, fam, "area", attr);
    expect(fieldOptionsFromSkus(spec, items, fam, "area", attr)).toEqual(first);
    const proto = projectUnitClass(spec, items).find((i) => i.attributes[spec.family_attribute_id ?? "family"] === fam && i.unit === "SQM" && attr in i.attributes);
    if (!proto) return;
    items.push({ ...proto, name: "made-up-size", attributes: { ...proto.attributes, [attr]: 98765 } } as RateMasterItem);
    expect(fieldOptionsFromSkus(spec, items, fam, "area", attr)).toContain("98765");
  });
});
