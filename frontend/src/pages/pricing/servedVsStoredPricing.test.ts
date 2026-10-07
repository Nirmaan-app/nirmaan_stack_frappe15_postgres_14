/**
 * SLICE 12d-2F (owner F1, 2026-10-07) -- PRICING FROM THE SERVED PAYLOAD = PRICING FROM THE STORED CATALOGUE.
 *
 * THE DEFECT THIS PINS. `get_rate_master_items` is the ONE read every pricing path consumes (the rate-helper
 * panel, the calculator, the impact panel). Slice 12c FINISH (owner F4) made it project the LIVE cladding
 * cost into `items[].rates.cost_cladding` so the grid could show the figure greyed -- and the Fiberglass /
 * Acoustic / Thermal `cladding` component reads that same cell as `base` ("the SKU's own foil rate") and ADDS
 * the GI framework it computes live. So on the LIVE page a Fiberglass + GI framework row priced the framework
 * twice: 2574 / 518 where the stored catalogue prices 1757 / 518. No fixture-driven test could see it,
 * because every pure fixture carried the STORED 0 -- except `parityMaster.json`, which was snapshotted
 * from the served endpoint and carried the 555, so the 12c-P parity proof agreed with itself on both paths
 * and the figure was wrong on both.
 *
 * THE RULE (owner F1): a price must never be computed from a value that is itself computed for DISPLAY.
 * The figure now rides in `computed_rates` (read by the greyed cell only); `items[].rates` is the stored
 * catalogue byte-for-byte. `test_rate_master.TestServedRatesAreStored` pins that join on the LIVE endpoint;
 * THIS file prices through it: every active Insulation SKU from the SERVED payload (the fixture, re-snapshotted
 * from the live endpoint after the fix) and from the STORED catalogue (the asset that went live), 0 differences.
 *
 * VACUITY, in-suite: re-apply the retired projection to a COPY of the served items and exactly the three GI
 * framework SKUs move (1757 -> 2574 on the 50 mm row); the 204 pipe rows that also receive a projected cell
 * move nothing, which is the measured proof that no pipeline reads that cell on them.
 *
 * ⚠️ The big fixtures are READ at runtime, never `import`ed (the tsc heap cliff, see calculatorPanelParity).
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { itemListPricingSpec, priceItemList } from "@/pages/boq-wizard/rate-helper/itemListPricing";
import { readJsonFixture } from "./calculatorPanelParity.harness";

// ── the SERVED payload: parityMaster.json, re-snapshotted from the live endpoint on 2026-10-07 after the fix ──
interface ServedFile {
  configs: Record<string, RateCategoryConfig | null>;
  items: Record<string, RateMasterItem[]>;
  computed_rate_keys: Record<string, Record<string, string[]>>;
  computed_rates: Record<string, Record<string, Record<string, number>>>;
}
const served = readJsonFixture<ServedFile>(new URL("./__fixtures__/parityMaster.json", import.meta.url));

// ── the STORED catalogue: the latest HVAC / Electrical asset on disk (what the loader put in the DB) ──
interface Asset {
  discipline: string;
  items: Array<{ item_uid: string; kind: string; brand?: string | null; unit?: string | null;
    attributes?: Record<string, string | number>; rates?: Record<string, number> }>;
  category_configs: RateCategoryConfig[];
}
const DATA_DIR = new URL("../../../../nirmaan_stack/services/boq_rate_master/data/", import.meta.url);
function latestAsset(prefix: string): string {
  const files = readdirSync(DATA_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  const n = (f: string) => Number(f.slice(prefix.length, -".json".length));
  return files.sort((a, b) => n(a) - n(b))[files.length - 1];
}
function readAsset(prefix: string): Asset {
  return readJsonFixture<Asset>(new URL(latestAsset(prefix), DATA_DIR));
}
function storedItems(a: Asset): RateMasterItem[] {
  return a.items.map((it) => ({
    item_uid: it.item_uid, discipline: a.discipline, kind: it.kind,
    brand: it.brand ?? undefined, unit: it.unit ?? undefined,
    attributes: { ...(it.attributes ?? {}) }, rates: { ...(it.rates ?? {}) },
  }));
}
const HVAC = readAsset("rate_master_hvac_all_v");
const ELEC = readAsset("rate_master_electrical_all_v");
const INS_CFG = HVAC.category_configs.find((c) => c.category_id === "hvac_insulation")!;
const SPEC = itemListPricingSpec(INS_CFG)!;
const KIND = "hvac_insulation_item";
const KEY = "cost_cladding";
const GI = "GI Framework with perforated Al sheet";

const servedHvac = served.items.HVAC;
const storedHvac = storedItems(HVAC);

/** ONE block per SKU, from the SKU's own attributes -- the replay_insulation instrument's construction. */
function skuBlock(it: RateMasterItem) {
  const attrs: Record<string, { value: string }> = {};
  for (const [k, v] of Object.entries(it.attributes ?? {})) {
    if (k === "unit_class" || v === null || v === undefined || v === "") continue;
    attrs[k] = { value: String(v) };
  }
  return { rowUnit: String(it.unit ?? "").toUpperCase() === "SQM" ? "sqm" : "mtr", attrs };
}
function priceEverySku(catalogue: RateMasterItem[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const it of catalogue) {
    if (it.kind !== KIND) continue;
    const { rowUnit, attrs } = skuBlock(it);
    const r = priceItemList(SPEC, catalogue, rowUnit, [{ attributes: attrs } as never]);
    out.set(String(it.item_uid), r.priced ? `${r.supply}/${r.install}` : `REFUSED:${r.reason ?? ""}`);
  }
  return out;
}
/** The RETIRED server write, re-applied to a copy: what the page used to receive. */
function withProjection(catalogue: RateMasterItem[], computed: Record<string, Record<string, number>>): RateMasterItem[] {
  return catalogue.map((it) => {
    const c = computed[String(it.item_uid)];
    return c ? { ...it, rates: { ...it.rates, ...c } } : it;
  });
}

describe("the served fixture is the live endpoint's payload, and its rates ARE the stored catalogue", () => {
  it("331 HVAC items, computed_rates for 219 of them, and 1,402 Electrical items with none", () => {
    expect(servedHvac).toHaveLength(331);
    expect(Object.keys(served.computed_rates.HVAC)).toHaveLength(219);
    expect(served.computed_rate_keys.HVAC).toEqual(
      Object.fromEntries(Object.entries(served.computed_rates.HVAC).map(([u, m]) => [u, Object.keys(m).sort()])),
    );
    expect(served.items.Electrical).toHaveLength(1402);
    expect(served.computed_rates.Electrical).toEqual({});
  });

  it("every served item's rates deep-equal the asset's stored rates -- both disciplines, every uid NAMED on failure", () => {
    for (const [label, s, a] of [["HVAC", servedHvac, storedHvac], ["Electrical", served.items.Electrical, storedItems(ELEC)]] as const) {
      const stored = new Map(a.map((it) => [String(it.item_uid), it.rates]));
      expect(new Set(s.map((it) => String(it.item_uid))), `${label}: the same uids`).toEqual(new Set(stored.keys()));
      const bad = s.filter((it) => JSON.stringify(it.rates) !== JSON.stringify(stored.get(String(it.item_uid))))
        .map((it) => `${label} ${it.kind} ${it.item_uid}`);
      expect(bad).toEqual([]);
    }
  });

  it("the three GI framework SKUs: stored 0, displayed 555, SERVED 0", () => {
    const gi = servedHvac.filter((it) => it.kind === KIND && it.attributes?.cladding === GI);
    expect(gi).toHaveLength(3);
    for (const it of gi) {
      expect(it.rates[KEY]).toBe(0);
      expect(served.computed_rates.HVAC[String(it.item_uid)]).toEqual({ [KEY]: 555 });
    }
  });
});

describe("every active Insulation SKU prices IDENTICALLY from the served payload and from the stored catalogue", () => {
  const fromServed = priceEverySku(servedHvac);
  const fromStored = priceEverySku(storedHvac);

  it("229 SKUs over the 6 families, 0 differences, the per-family counts NAMED", () => {
    expect(fromServed.size).toBe(229);
    expect(fromStored.size).toBe(229);
    const perFamily: Record<string, number> = {};
    for (const it of storedHvac) if (it.kind === KIND) perFamily[String(it.attributes.item)] = (perFamily[String(it.attributes.item)] ?? 0) + 1;
    expect(perFamily).toEqual({
      " Fiberglass Rigid Board Insulation, Density 48Kg/m3": 6,
      "Acoustic Nitrile Insulation": 4,
      "Cladding Only": 5,
      "Nitrile Rubber Insulation": 168,
      "Thermal Nitrile Insulation": 10,
      "Tubular Puf Insulation": 36,
    });
    const diffs = [...fromStored].filter(([u, v]) => fromServed.get(u) !== v).map(([u, v]) => `${u}: stored ${v} served ${fromServed.get(u)}`);
    expect(diffs).toEqual([]);
    // the sweep is not vacuous: most SKUs price, and the three GI rows are among them
    expect([...fromStored.values()].filter((v) => !v.startsWith("REFUSED")).length).toBeGreaterThan(200);
  });

  it("the FG + GI framework SKUs price at the STORED figures (the 50 mm row: 1757 / 518 -- the E2E-1 figure)", () => {
    const gi = storedHvac.filter((it) => it.kind === KIND && it.attributes?.cladding === GI);
    const by = Object.fromEntries(gi.map((it) => [String(it.attributes.thickness_mm), fromStored.get(String(it.item_uid))]));
    expect(by["50"]).toBe("1757/518");
    expect(by["25"]).toBe("1346/385");
    for (const it of gi) expect(fromServed.get(String(it.item_uid))).toBe(fromStored.get(String(it.item_uid)));
  });

  it("VACUITY: re-applying the retired projection to the served items moves EXACTLY the three GI SKUs (1757 -> 2574), and no pipe row", () => {
    const projected = priceEverySku(withProjection(servedHvac, served.computed_rates.HVAC));
    const moved = [...fromServed].filter(([u, v]) => projected.get(u) !== v).map(([u]) => u).sort();
    const gi = servedHvac.filter((it) => it.kind === KIND && it.attributes?.cladding === GI).map((it) => String(it.item_uid)).sort();
    expect(moved).toEqual(gi);
    const fifty = servedHvac.find((it) => it.kind === KIND && it.attributes?.cladding === GI && Number(it.attributes.thickness_mm) === 50)!;
    expect(fromServed.get(String(fifty.item_uid))).toBe("1757/518");
    expect(projected.get(String(fifty.item_uid))).toBe("2574/518");      // the live figure 12d-2 photographed
    // the 204 pipe rows received a projected cell too, and NONE of them moved: no pipeline reads it there
    const pipeRowsProjected = Object.keys(served.computed_rates.HVAC).filter((u) => !gi.includes(u) && servedHvac.find((it) => String(it.item_uid) === u)?.rates[KEY] === undefined);
    expect(pipeRowsProjected).toHaveLength(204);
    for (const u of pipeRowsProjected) expect(projected.get(u)).toBe(fromServed.get(u));
  });
});
