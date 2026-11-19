/**
 * DU-1 THE DERIVATION COVERAGE GUARD ON THE LATEST HVAC ASSET (owner 2026-11-15 13:41, verbatim: "going forwrad we need to add a
 * derivation coverage check before deployment to ensure all rules (model + code+ anywhere else) are captured in the dderivation tab
 * for that category in the rate master"). Every category this list names must read MISSING 0 / ORPHAN 0 on the newest asset -- a
 * mint that adds a rule without its Derivation line, or a code rule without its declared line, fails here before it can deploy.
 * The categories added by later slices join GUARDED with their own mint (Ducting: DU-1 Part B).
 */
import { readdirSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { derivationCoverage } from "./derivationCoverage";
import { RATE_MASTER_DISCIPLINES } from "./rateMasterRegistry";
import { readJsonFixture } from "../calculatorPanelParity.harness";

// eslint-friendly loose shapes: the asset is JSON read at test time
type Cfg = { category_id: string; list_spec: { sections?: Array<{ category_id?: string }>; pricing: { rule_lines: Array<{ rule: string }> } } };
type Asset = { items: Array<Record<string, unknown>>; category_configs: Cfg[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
// the latest HVAC asset by version number (a latest-asset reader by file prefix: rate_master_hvac_all_v)
const latest = readdirSync(DATA).filter((f) => /^rate_master_hvac_all_v\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/v(\d+)/)![1]) - Number(b.match(/v(\d+)/)![1])).pop()!;
const A = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, latest)));
const C: Record<string, Cfg> = Object.fromEntries(A.category_configs.map((c) => [c.category_id, c]));
const borrowOnly = RATE_MASTER_DISCIPLINES.flatMap((d) => d.categories.filter((c) => c.fetch_only === true).map((c) => c.category_id));
const sectionsOf = (cfg: Cfg): Record<string, Cfg> => Object.fromEntries((cfg?.list_spec?.sections ?? [])
  .map((s) => String(s?.category_id ?? "")).filter((id) => id && borrowOnly.includes(id) && C[id]).map((id) => [id, C[id]]));

/** the categories held to 0 / 0 (owner: Valve Package and Ducting before DONE; Misc through the Valve Package's section) */
// VAV-1 (HVAC v76; owner R8 2026-11-15 13:39 / 13:41): VAV Box joins GUARDED with its mint, and Sensors (borrow-only) as Misc did
const GUARDED = ["hvac_valve_package", "hvac_misc", "hvac_ducting", "hvac_vav_box", "hvac_sensors"];

describe(`DU-1 THE GUARD on ${latest}: MISSING / ORPHAN = 0`, () => {
  for (const id of GUARDED) {
    it(`${id}: every rule it prices by is on its Derivation tab, and every declared line names a rule`, () => {
      expect(C[id], id).toBeTruthy();
      const r = derivationCoverage(C[id], A.items, sectionsOf(C[id]));
      expect(r.missing).toEqual([]);
      expect(r.orphan).toEqual([]);
      // DU-1 Part B: a category that declares its reasons gives every line one (UNREASONED 0)
      if (Array.isArray((C[id].list_spec.pricing as { derivation_reasons?: unknown }).derivation_reasons)) expect(r.unreasoned).toEqual([]);
      // VAV-1: Sensors is a borrow-only category of 2 items (7 lines); every other guarded category has more than 10
      expect(r.lines.length).toBeGreaterThan(id === "hvac_sensors" ? 5 : 10);
    });
  }
  it("NEGATIVE: the guard bites on the same asset -- one declared valve line taken out is MISSING", () => {
    const cfg = structuredClone(C.hvac_valve_package);
    cfg.list_spec.pricing.rule_lines = cfg.list_spec.pricing.rule_lines.filter((r) => r.rule !== "E9");
    expect(derivationCoverage(cfg, A.items, sectionsOf(cfg)).missing).toEqual(["code rule E9: no declared line"]);
  });
});
