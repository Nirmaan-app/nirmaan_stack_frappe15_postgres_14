// @vitest-environment jsdom
//
// ELR-4b AC2 / AC7 (owner R-Q4; R-APPROVE; the P6 answer 2026-10-29, "aliases b"): the Derivation TAB as rendered --
// the eight new lists draw no pointer line and no extraction Rules card; HVAC Cables / Raceway show the Electrical
// list word for word under one lead line, read from the Electrical config and items (the page's own two reads).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
type Asset = { items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const elec = readJsonFixture<never>(pathToFileURL(path.join(DATA, "rate_master_electrical_all_v70.json"))) as Asset;
const hvac = readJsonFixture<never>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v54.json"))) as Asset;
const PAGE = "Electrical Pricing";

// the alias tab's two reads, answered from the Electrical asset the way the server answers them; every call recorded
const calls: Array<{ method: string; params: Record<string, unknown>; key: unknown }> = [];
vi.mock("frappe-react-sdk", () => ({
  useFrappeGetCall: (method: string, params: Record<string, unknown>, key: unknown) => {
    calls.push({ method, params, key });
    if (/get_rate_master_items$/.test(method)) return { data: { message: { items: elec.items } } };
    const c = elec.category_configs.find((x) => x.category_id === params.category_id) ?? null;
    return { data: { message: { config: c } } };
  },
}));
const { RateMasterDerivation, aliasLeadLine, aliasTarget } = await import("./RateMasterDerivation");
const { attributeRuleOrder } = await import("./itemListRuleOrder");

function tab(asset: Asset, categoryId: string): HTMLElement {
  const host = document.createElement("div");
  const root = createRoot(host);
  const config = asset.category_configs.find((c) => c.category_id === categoryId)!;
  act(() => { root.render(<StrictMode><RateMasterDerivation items={asset.items} config={config} calculatorPage={PAGE} /></StrictMode>); });
  return host;
}
const lis = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="rate-master-item-list-order"] li')].map((li) => li.textContent ?? "");

describe("ELR-4b: the eight new tabs", () => {
  it("each shows 'How a row is priced', no pointer line, no extraction Rules card (R-Q4), no raw id or field name", () => {
    const counts: Record<string, number> = {};
    for (const id of ["db_switchgear", "industrial_sockets", "earthing", "conduit_piping", "cabletray_raceway", "junction_box_raceway", "lighting_mgmt_system", "miscellaneous"]) {
      const host = tab(elec, id);
      counts[id] = lis(host).length;
      expect(host.querySelector('[data-testid="rate-master-derivation-notice"]'), id).toBeNull();
      expect(host.querySelector('[data-testid="rate-master-rules-panel"]'), id).toBeNull();
      for (const raw of ["R2", "R3", "R4", "R7", "R8", "R11", "R12", "R13", "applies_to", "mcb_present", "thickness_swg", "installation_type"]) expect(host.textContent, `${id} ${raw}`).not.toContain(raw);
    }
    expect(counts).toEqual({ db_switchgear: 9, industrial_sockets: 8, earthing: 3, conduit_piping: 3, cabletray_raceway: 6, junction_box_raceway: 2, lighting_mgmt_system: 2, miscellaneous: 2 });
    // the eight own tabs read nothing (the alias reads live in the alias tab only)
    expect(calls).toEqual([]);
  });

  it("UNCHANGED: Electrical Pricing Inputs keeps its line; no Electrical tab is left on the pointer line", () => {
    for (const c of elec.category_configs) {
      const notice = tab(elec, c.category_id).querySelector('[data-testid="rate-master-derivation-notice"]')?.textContent ?? null;
      if (c.category_id === "electrical_pricing_inputs") expect(notice, c.category_id).toContain("Pricing Inputs hold shared numbers");
      else expect(notice, c.category_id).toBeNull();
    }
  });
});

describe("ELR-4b: the HVAC aliases (P6 'aliases b')", () => {
  it("aliasTarget reads alias_of; every other config is not an alias", () => {
    expect(aliasTarget(hvac.category_configs.find((c) => c.category_id === "hvac_cables"))).toEqual({ discipline: "Electrical", category_id: "wiring_cabling" });
    expect(aliasTarget(hvac.category_configs.find((c) => c.category_id === "hvac_raceway"))).toEqual({ discipline: "Electrical", category_id: "cabletray_raceway" });
    for (const c of [...elec.category_configs, ...hvac.category_configs].filter((x) => !["hvac_cables", "hvac_raceway"].includes(x.category_id))) expect(aliasTarget(c), c.category_id).toBeNull();
  });

  it("HVAC Cables / Raceway: the lead line, then the Electrical list word for word, from the Electrical config and items", () => {
    for (const [id, target, name] of [["hvac_cables", "wiring_cabling", "Wiring, Cabling & Termination"], ["hvac_raceway", "cabletray_raceway", "CableTray & Raceway"]] as const) {
      calls.length = 0;
      const host = tab(hvac, id);
      const t = elec.category_configs.find((c) => c.category_id === target)!;
      expect(host.querySelector('[data-testid="rate-master-derivation-alias"]')?.textContent, id).toBe(`Priced exactly as Electrical -> ${name}: the same rules and the same Pricing Inputs.`);
      expect(aliasLeadLine("Electrical", t)).toBe(`Priced exactly as Electrical -> ${name}: the same rules and the same Pricing Inputs.`);
      const want = attributeRuleOrder(t, elec.items).map((l) => `${l.n}${l.title} — ${l.detail}`);
      expect(lis(host), id).toEqual(want);
      expect(want.length, id).toBe(target === "wiring_cabling" ? 15 : 6);
      expect(host.querySelector('[data-testid="rate-master-derivation-notice"]'), id).toBeNull();
      expect(host.querySelector('[data-testid="rate-master-rules-panel"]'), id).toBeNull();
      // the page's own two reads, under the page's own SWR keys (one cache with the Electrical page)
      expect(calls.map((c) => c.key)).toContain("rate-master-items-Electrical");
      expect(calls.map((c) => c.key)).toContain(`rate-master-config-Electrical-${target}`);
    }
  });

  it("NEGATIVE: every other HVAC tab reads nothing and is unchanged (the ADP / Insulation / Piping lists, the pointer line elsewhere)", () => {
    calls.length = 0;
    for (const c of hvac.category_configs.filter((x) => !["hvac_cables", "hvac_raceway"].includes(x.category_id))) {
      const host = tab(hvac, c.category_id);
      expect(host.querySelector('[data-testid="rate-master-derivation-alias"]'), c.category_id).toBeNull();
    }
    expect(calls).toEqual([]);
  });
});
