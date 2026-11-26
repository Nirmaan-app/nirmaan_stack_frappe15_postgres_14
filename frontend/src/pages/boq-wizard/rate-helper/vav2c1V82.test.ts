/**
 * VAV-2c1 MINT PARITY + the untouched-rest proof, on the v82 FILE (read by name, sha-checked; never the newest file, never written).
 * (1) v82 = v81 + exactly the edits file, the same twin `vav2c1.harness.ts` builds; (2) undoing those edits gives v81 back (what a test that
 * compares an older file with the newest one reads through); (3) a planted undeclared change goes RED / is REFUSED.
 */
import { describe, expect, it } from "vitest";
import { assetByName } from "./v78ByName.harness";
import { EDITS, applyConfig, undoVav2c1, inputName81 } from "./vav2c1Edits.harness";
import { V81, byId82, cfg82, items82, ITEMS81 } from "./vav2c1.harness";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";

const V82 = assetByName("rate_master_hvac_all_v82.json", "3c9dc559");
const byIdOf = (a: typeof V81) => new Map([...a.byId.entries()].map(([k, v]) => [k, v as RateCategoryConfig]));
const text = (x: unknown) => JSON.stringify(x);
/** key order out of the comparison: every object's keys sorted */
const sorted = (x: unknown): unknown => (Array.isArray(x) ? x.map(sorted) : x && typeof x === "object"
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted((x as Record<string, unknown>)[k])])) : x);
const canon = (x: unknown) => JSON.stringify(sorted(x));

describe("MINT PARITY: the v82 file", () => {
  it("every category config is the harness's, key for key; 16 configs, 853 items", () => {
    const have = byIdOf(V82), want = byId82();
    expect([...have.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [id, c] of want) expect(text(have.get(id)), id).toBe(text(c));
    expect(V82.items.length).toBe(853);
  });
  it("every item is the harness's: same uids in order, same rates, the declared Pricing Input texts", () => {
    const want = items82() as unknown as Array<Record<string, unknown>>;
    expect(V82.items.map((i) => i.item_uid)).toEqual(want.map((i) => i.item_uid));
    V82.items.forEach((i, n) => {
      const w = want[n] as { rates?: unknown; unit?: unknown; attributes?: Record<string, unknown> };
      expect(text(i.rates), String(i.item_uid)).toBe(text(w.rates));
      expect(text({ unit: i.unit, name: i.attributes?.name, remarks: i.attributes?.remarks }), String(i.item_uid)).toBe(text({ unit: w.unit, name: w.attributes?.name, remarks: w.attributes?.remarks }));
    });
    expect(V82.items.filter((i, n) => text(i.rates) !== text(V81.items[n].rates))).toEqual([]);
  });
});

describe("the undo a comparing test reads through", () => {
  const changed = new Set(EDITS.configs.map((e) => e.c));
  it("undoing v82's edits gives v81 back, byte for byte, for every changed category; an untouched one is returned as it is", () => {
    for (const [id, c] of byIdOf(V82)) {
      expect(canon(undoVav2c1(c)), id).toBe(canon(V81.byId.get(id)));
      // byte for byte wherever no key was taken out (VAV Box's one removed key comes back at the end of its block: same content, other order)
      if (!EDITS.configs.some((e) => e.c === id && e.to === null)) expect(text(undoVav2c1(c)), id).toBe(text(V81.byId.get(id)));
      if (!changed.has(id)) expect(undoVav2c1(c)).toBe(c);
    }
  });
  it("on v81 (and an older file's shape) it changes nothing", () => {
    for (const [id, c] of byIdOf(V81)) expect(undoVav2c1(c), id).toBe(c);
  });
  it("REFUSED: a text of v82 that was altered (one character), one edit missing, one text reverted to v81's", () => {
    for (const id of ["hvac_ducting", "hvac_valve_package", "hvac_vav_box"]) {
      const e = EDITS.configs.find((x) => x.c === id && typeof x.to === "string" && typeof x.from === "string")!;
      const at = (c: RateCategoryConfig) => e.p.slice(0, -1).reduce<unknown>((n, p) => (n as Record<string | number, unknown>)[p], c) as Record<string | number, unknown>;
      const last = e.p[e.p.length - 1];
      const altered = cfg82(id); at(altered)[last] = `${String(e.to)}!`;
      expect(() => undoVav2c1(altered), id).toThrow(/holds neither/);
      const missing = cfg82(id); delete at(missing)[last];
      expect(() => undoVav2c1(missing), id).toThrow(/holds neither/);
      const half = cfg82(id); at(half)[last] = e.from;
      expect(() => undoVav2c1(half), id).toThrow(/holds neither/);
    }
  });
  it("A PLANTED UNDECLARED CHANGE cannot hide: it is not reversed and the byte-compare with v81 goes red", () => {
    const planted = structuredClone(cfg82("hvac_ducting")) as unknown as { category_display: string };
    planted.category_display = "Ducting (changed)";
    const back = undoVav2c1(planted as unknown as RateCategoryConfig);
    expect(text(back)).not.toBe(text(V81.byId.get("hvac_ducting")));
    expect((back as unknown as { category_display: string }).category_display).toBe("Ducting (changed)");
  });
  it("the one renamed Pricing Input: v82's name gives v81's back, every other name is its own", () => {
    const moved = V82.items.filter((i) => inputName81(i as never) !== String(i.attributes?.name ?? ""));
    expect(moved.map((i) => [inputName81(i as never), i.attributes?.name])).toEqual([["VAV - refixing (dismantling on its own row)", "VAV - refixing when dismantling is priced separately"]]);
    expect(ITEMS81.every((i) => inputName81(i as never) === String(i.attributes?.name ?? ""))).toBe(true);
  });
});

/** PURE. Everything on which a copy of the v82 file differs from "v81 + the edits file" (the mint parity, as a function): what a planted
 *  undeclared change trips. Empty = nothing but the declared edits. */
function unexpected(a: { items: ReadonlyArray<Record<string, unknown>>; byId: Map<string, RateCategoryConfig> }): string[] {
  const out: string[] = [];
  const want = items82() as unknown as Array<Record<string, unknown>>;
  const ids = (l: ReadonlyArray<Record<string, unknown>>) => l.map((i) => String(i.item_uid));
  const have = ids(a.items), expected = ids(want);
  for (const u of expected) if (!have.includes(u)) out.push(`item removed ${u}`);
  for (const u of have) if (!expected.includes(u)) out.push(`item added ${u}`);
  a.items.forEach((i) => {
    const w = want.find((x) => String(x.item_uid) === String(i.item_uid));
    if (w && canon(i) !== canon({ ...w })) out.push(`item ${String(i.item_uid)}`);
  });
  for (const [id, c] of byId82()) if (canon(a.byId.get(id)) !== canon(c)) out.push(`config ${id}`);
  return out;
}
describe("PLANTED UNDECLARED CHANGES (ANSWER 20 a): each kind goes red", () => {
  const copy = () => ({ items: structuredClone(V82.items) as unknown as Array<Record<string, unknown> & { rates: Record<string, number>; attributes: Record<string, unknown> }>, byId: new Map([...V82.byId.entries()].map(([k, c]) => [k, structuredClone(c as RateCategoryConfig)] as [string, RateCategoryConfig])) });
  const cfg = (a: ReturnType<typeof copy>, id: string) => a.byId.get(id) as unknown as Record<string, unknown>;
  it("the untouched file trips nothing", () => expect(unexpected(copy())).toEqual([]));
  it("a rate changed on one item", () => {
    const a = copy(); const it0 = a.items.find((i) => i.kind === "hvac_duct_item")!; const k = Object.keys(it0.rates)[0]; it0.rates[k] += 1;
    expect(unexpected(a)).toEqual([`item ${String(it0.item_uid)}`]);
  });
  it("a markup changed", () => {
    const a = copy(); const it0 = a.items.find((i) => i.kind === "hvac_vav_item" && "supply_markup" in i.rates)!; it0.rates.supply_markup += 0.01;
    expect(unexpected(a)).toEqual([`item ${String(it0.item_uid)}`]);
  });
  it("an item added / removed", () => {
    const a = copy(); a.items.push({ ...structuredClone(a.items[0]), item_uid: "planted-uid" }); expect(unexpected(a)).toEqual(["item added planted-uid"]);
    const b = copy(); const gone = b.items.splice(5, 1)[0]; expect(unexpected(b)).toEqual([`item removed ${String(gone.item_uid)}`]);
  });
  it("a config key outside the edits changed (and a new key)", () => {
    const a = copy(); cfg(a, "hvac_vrf").category_display = "VRF (changed)"; expect(unexpected(a)).toEqual(["config hvac_vrf"]);
    const b = copy(); cfg(b, "hvac_piping").planted = true; expect(unexpected(b)).toEqual(["config hvac_piping"]);
    // and undoing the edits does not swallow it: the byte-compare with v81 the older tests make stays red
    expect(canon(undoVav2c1(cfg(a, "hvac_vrf") as unknown as RateCategoryConfig))).not.toBe(canon(V81.byId.get("hvac_vrf")));
  });
  it("a text that is not in the edits file changed", () => {
    const a = copy(); const list = (cfg(a, "hvac_piping").list_spec as { pricing: Record<string, unknown> }).pricing; list.planted_text = "the text of nobody"; delete (list as { x?: unknown }).x;
    expect(unexpected(a)).toEqual(["config hvac_piping"]);
    const b = structuredClone(cfg82("hvac_ducting")) as unknown as { list_spec: { pricing: { derivation_reasons: Array<{ why: string }> } } };
    const i = b.list_spec.pricing.derivation_reasons.findIndex((_, n) => !EDITS.configs.some((e) => e.c === "hvac_ducting" && e.p.join("/").includes(`derivation_reasons/${n}/`)));
    expect(i).toBeGreaterThanOrEqual(0);
    b.list_spec.pricing.derivation_reasons[i].why += " planted";
    expect(canon(undoVav2c1(b as unknown as RateCategoryConfig))).not.toBe(canon(V81.byId.get("hvac_ducting")));
  });
  it("an edit whose 'before' does not match v81 is REFUSED (by the same rule as the mint)", () => {
    const e = EDITS.configs.find((x) => x.c === "hvac_ducting" && typeof x.from === "string")!;
    expect(() => applyConfig(V81.byId.get("hvac_ducting") as RateCategoryConfig, [{ ...e, from: `${String(e.from)} (other)` }])).toThrow(/the file holds/);
    expect(() => applyConfig(V81.byId.get("hvac_ducting") as RateCategoryConfig, [e])).not.toThrow();
  });
});
