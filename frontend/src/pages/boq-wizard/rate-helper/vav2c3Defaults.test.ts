/**
 * VAV-2c3 FIX (PIN FIX-0, accepted ANSWER 10; the owner 2026-11-24 16:52 / 16:58 / 17:00): the VAV helper prices from the model's answer
 * COMBINED with the ruled defaults, in the DefaultSpec pattern the other categories use (HVAC v85 `pricing.defaults`), each positive AND
 * negative, on a BoQ row with its sheet (the panel's own entry), on scratch copies of the v84 FILE with the v85 edits (vav2c3b.harness):
 *   integrator not mentioned -> "No" (a "None" answer AND a left-out answer); a stated "Yes" stays "Yes"; "Yes" with a separate integrator
 *   row on the sheet -> "No" by the existing own-row check; type not named -> "Nothing specific mentioned" (box and VAV Integrator); shape
 *   left out -> Rectangular; a STATED value always wins; each default is marked on the field with its note.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import type { ItemListView } from "./pricingSheetHelper";
import { box81, sheet81, type Row81 } from "./vav2b2.harness";
import { EDITS85, ITEMS84, V84, cfg85 } from "./vav2c3b.harness";

const VAV = "hvac_vav_box";
const C85 = cfg85(VAV), C84 = V84.byId.get(VAV)!;
const price = (rows: Record<number, Row81>, er: number, cfg: RateCategoryConfig = C85): ItemListView => sheet81(rows, { cfg, items: ITEMS84 })(er).itemList!;
const field = (v: ItemListView, id: string) => (v.items[0].fields as Array<{ id: string; value: string; defaulted?: boolean; rule?: string }>).find((f) => f.id === id)!;
/** a box row whose reading drops / blanks the named answers ("absent" removes the attribute from the reply) */
const box = (over: Record<string, string | null> = {}, absent: string[] = []): Row81 => {
  const r = box81(9, {}, over as Record<string, string | number | null>);
  const it = { ...(r.items![0] as Record<string, unknown>) };
  for (const a of absent) delete it[a];
  return { ...r, items: [it] } as Row81;
};
const INTEG: Row81 = { text: "VAV integrator / router for BMS", qty: 2, unit: "Nos", category: "hvac_misc" } as never;

describe("the edits file: the three defaults, VAV Box only", () => {
  it("3 edits, each a `defaults` key on hvac_vav_box", () => {
    expect(EDITS85.configs.map((e) => `${e.c}:${e.p.slice(2).join(".")}`)).toEqual(["hvac_vav_box:defaults.shape.absent_as_none",
      "hvac_vav_box:defaults.integrator_included", "hvac_vav_box:defaults.vav_type"]);
  });
});

describe("integrator not mentioned -> 'Integrator Included = No' (owner 2026-11-24 16:52)", () => {
  it("a 'None' answer prices on the No line, marked as a default with its note", () => {
    const v = price({ 10: box({ integrator_included: "None" }) }, 10);
    expect(v.rowPriced).toBe(true);
    const f = field(v, "integrator_included");
    expect(f.value).toBe("No");
    expect(f.defaulted).toBe(true);
    expect(f.rule).toBe("integrator not mentioned - priced on the 'Integrator Included = No' line (assumed)");
  });
  it("a reply that LEFT OUT the integrator answer prices the same (absent_as_none)", () => {
    const a = price({ 10: box({ integrator_included: "None" }) }, 10), b = price({ 10: box({}, ["integrator_included"]) }, 10);
    expect(b.rowPriced).toBe(true);
    expect(field(b, "integrator_included").value).toBe("No");
    expect(b.totals).toEqual(a.totals);
  });
  it("NEGATIVE / VACUITY: v84 (no default) refuses 'could not tell integrator included in this rate'", () => {
    const v = price({ 10: box({ integrator_included: "None" }) }, 10, C84);
    expect(v.rowPriced).toBe(false);
    expect(JSON.stringify(v)).toContain("could not tell integrator included in this rate");
  });
  it("NEGATIVE: a stated 'Yes' (the row puts the integrator in the rate) stays 'Yes' - not a default - and costs more than 'No'", () => {
    const y = price({ 10: box({ integrator_included: "Yes" }) }, 10), n = price({ 10: box({ integrator_included: "No" }) }, 10);
    expect(field(y, "integrator_included").value).toBe("Yes");
    expect(field(y, "integrator_included").defaulted ?? false).toBe(false);
    expect((y.totals!.supply_rate ?? 0)).toBeGreaterThan(n.totals!.supply_rate ?? 0);
  });
  it("'Yes' with a separate integrator row on the sheet -> the No line, the existing note naming the row (the own-row check, unchanged)", () => {
    const v = price({ 10: box({ integrator_included: "Yes" }), 60: INTEG }, 10);
    expect(field(v, "integrator_included").value).toBe("No");
    expect(v.sheetHeadingNotes ?? []).toContain("Priced without the integrator ('Integrator Included = No'): row 60 prices the VAV integrator for this sheet.");
    expect(v.totals).toEqual(price({ 10: box({ integrator_included: "No" }), 60: INTEG }, 10).totals);
  });
});

describe("type not named -> 'Nothing specific mentioned' (2026-11-18 23:53 point 10)", () => {
  it("a box with type 'None' (and one with it left out) prices as Nothing specific mentioned, marked", () => {
    for (const r of [box({ integrator_included: "No", vav_type: "None" }), box({ integrator_included: "No" }, ["vav_type"])]) {
      const v = price({ 10: r }, 10);
      expect(v.rowPriced).toBe(true);
      expect(field(v, "vav_type").value).toBe("Nothing specific mentioned");
      expect(field(v, "vav_type").defaulted).toBe(true);
      expect(field(v, "vav_type").rule).toBe("type not named - priced as 'Nothing specific mentioned' (assumed)");
    }
  });
  it("a claimed VAV Integrator row with no type is priced (the 10 rows of R7)", () => {
    const rows: Record<number, Row81> = { 10: box({ integrator_included: "No" }), 60: { ...INTEG, claim: { from: "hvac_misc", item: "VAV integrator", kind: "integrator" },
      items: [{ vav_item: "VAV Integrator", vav_item_as_written: "VAV integrator", vav_type: "None", qty_per_box: "None", scope: "None" }] } as never };
    expect(price(rows, 60).rowPriced).toBe(true);
    expect(price(rows, 60, C84).rowPriced).toBe(false);
  });
  it("NEGATIVE: a stated AHRI type wins", () => {
    const v = price({ 10: box({ integrator_included: "No", vav_type: "AHRI Certified" }) }, 10);
    expect(field(v, "vav_type").value).toBe("AHRI Certified");
    expect(field(v, "vav_type").defaulted ?? false).toBe(false);
  });
});

describe("shape left out -> Rectangular (2026-11-18 22:16 ruling B)", () => {
  it("a reply that left the shape OUT prices as Rectangular, marked; v84 refused it", () => {
    const v = price({ 10: box({ integrator_included: "No" }, ["shape"]) }, 10);
    expect(v.rowPriced).toBe(true);
    expect(field(v, "shape").value).toBe("Rectangular");
    expect(field(v, "shape").defaulted).toBe(true);
    expect(price({ 10: box({ integrator_included: "No" }, ["shape"]) }, 10, cfg85(VAV, (e) => e.p.join(".").endsWith("shape.absent_as_none"))).rowPriced).toBe(false);
  });
  it("NEGATIVE: a stated Oval wins", () => {
    const v = price({ 10: box({ integrator_included: "No", shape: "Oval" }) }, 10);
    expect(field(v, "shape").value).toBe("Oval");
  });
});

describe("nothing else moves", () => {
  it("a fully stated box prices exactly as on v84; the only differences on its card: a field a default fills is not marked '*' needed and offers no 'None' choice (the DefaultSpec pattern)", () => {
    const r = { 10: box({ integrator_included: "No", vav_type: "Nothing specific mentioned", shape: "Rectangular" }) };
    const strip = (x: unknown): unknown => Array.isArray(x) ? x.map(strip)
      : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([k, y]) => k !== "required" && y !== undefined)
        .map(([k, y]) => [k, k === "options" && Array.isArray(y) ? y.filter((o) => o !== "None") : strip(y)])) : x;
    expect(strip(price(r, 10))).toEqual(strip(price(r, 10, C84)));
    const req = (v: ItemListView) => (v.items[0].fields as Array<{ id: string; required?: boolean }>).filter((f) => f.required).map((f) => f.id).sort();
    expect(req(price(r, 10, C84))).toEqual(expect.arrayContaining(["integrator_included", "shape", "vav_type"]));
    expect(req(price(r, 10))).not.toEqual(expect.arrayContaining(["integrator_included"]));
    const opts = (v: ItemListView, id: string) => (v.items[0].fields as Array<{ id: string; options?: string[] }>).find((f) => f.id === id)!.options ?? [];
    expect(opts(price(r, 10, C84), "integrator_included")).toContain("None");
    expect(opts(price(r, 10), "integrator_included")).not.toContain("None");
  });
});
