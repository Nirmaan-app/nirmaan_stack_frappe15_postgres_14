/**
 * ITEM 5 -- THE ALIGNMENT TABLE: every category of both disciplines x 3 render modes, the RETIRED
 * ordering against the one that ships, and how far each grid's cells were displaced before
 * `d9598dfbf`.
 *
 * Derived from code, not from the browser: the retired body order is reconstructed exactly as the
 * removed JSX emitted it (`unit` after the rate columns, whatever the mode), and compared with
 * `gridColumnKeys`. The first index at which the two disagree is where a reader's eye first saw a
 * value under the wrong heading.
 */
import ELECTRICAL from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v66.json";
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v25.json";
import { columnOrderForFile } from "../../frontend/src/pages/pricing/rate-master/rateMasterSpec";
import { gridColumnKeys, rateColKey, attrColKey, COL_UNIT } from "../../frontend/src/pages/pricing/rate-master/rateMasterGridColumns";
import CAT_KINDS from "./cat_kinds.json";

type AnyRec = Record<string, unknown>;
const ASSETS: Array<[string, any]> = [["Electrical", ELECTRICAL as any], ["HVAC", HVAC as any]];
const isPI = (id: string) => /pricing_inputs?$/.test(id);

/**
 * ⚠️ THE KINDS COME FROM THE EXPORTER, NOT FROM `item_kinds`. Two Electrical categories
 * (`wiring_cabling`, `point_wiring`) declare NO `item_kinds` in the asset, yet `wiring_cabling`
 * holds 588 rows -- the server derives the mapping itself (`csv_exporter._load`). Filtering on
 * `item_kinds` silently skipped the very grid whose misalignment was observed in the browser, so the
 * authoritative mapping is exported to `cat_kinds.json` and read here.
 */
function cats(asset: any, disc: string) {
  const out: Array<{ id: string; cfg: AnyRec; items: AnyRec[] }> = [];
  for (const cfg of asset.category_configs) {
    const entry = (CAT_KINDS as Record<string, { kinds: string[] }>)[`${disc}/${cfg.category_id}`];
    const kinds = new Set<string>(entry?.kinds ?? []);
    const items = asset.items.filter((i: AnyRec) => kinds.has(String(i.kind ?? "")));
    if (items.length) out.push({ id: cfg.category_id, cfg, items });
  }
  return out;
}

function inputsFor(cfg: AnyRec, items: AnyRec[], mode: string) {
  const { attrs, rates } = columnOrderForFile(cfg as never, items as never);
  const piMode = isPI(String(cfg.category_id));
  const specMode = cfg.attributes_from_spec === true;
  const specText = specMode ? ["item_name", "item_detail"] : [];
  const kinds = new Set<string>((cfg.item_kinds ?? []) as string[]);
  return {
    canEdit: mode === "editing",
    showKindCol: kinds.size > 1,
    piMode: mode === "pricingInputs" ? true : piMode,
    specMode,
    showImpactCol: false,
    textCols: specText.map((id) => ({ id })),
    attrCols: attrs.filter((a) => !specText.includes(a)).map((id) => ({ id })),
    rateCols: rates,
  };
}

/** Exactly what the removed JSX emitted: `unit` after the rate columns, in every mode. */
function retired(inp: ReturnType<typeof inputsFor>): string[] {
  const keys = gridColumnKeys(inp).filter((k) => k !== COL_UNIT);
  const last = inp.rateCols.length ? rateColKey(inp.rateCols[inp.rateCols.length - 1]) : null;
  const at = last ? keys.indexOf(last) + 1 : keys.length;
  return [...keys.slice(0, at), COL_UNIT, ...keys.slice(at)];
}

const MODES = ["normal", "editing", "pricingInputs"];
const rows: string[] = [];
rows.push("| discipline | category | mode | before `d9598dfbf` | first wrong column | columns displaced |");
rows.push("|---|---|---|---|---|---|");
let misaligned = 0, aligned = 0;

for (const [disc, asset] of ASSETS) {
  for (const c of cats(asset, disc)) {
    for (const mode of MODES) {
      const inp = inputsFor(c.cfg, c.items, mode);
      const good = gridColumnKeys(inp);
      const bad = retired(inp);
      let firstDiff = -1;
      for (let i = 0; i < Math.max(good.length, bad.length); i++) {
        if (good[i] !== bad[i]) { firstDiff = i; break; }
      }
      let displaced = 0;
      for (let i = 0; i < good.length; i++) if (good[i] !== bad[i]) displaced++;
      if (firstDiff === -1) {
        aligned++;
        rows.push(`| ${disc} | ${c.id} | ${mode} | **aligned** | — | 0 |`);
      } else {
        misaligned++;
        rows.push(`| ${disc} | ${c.id} | ${mode} | **MISALIGNED** | \`${good[firstDiff]}\` showed \`${bad[firstDiff]}\` | ${displaced} |`);
      }
    }
  }
}

console.log("### Item 5 -- grid alignment, every category x every mode, BEFORE vs AFTER `d9598dfbf`");
console.log("");
console.log(rows.join("\n"));
console.log("");
console.log(`**Totals: ${misaligned} grid/mode combinations were MISALIGNED before the fix; ${aligned} were already correct.**`);
console.log("");
console.log("Every combination is correct after `d9598dfbf` by construction: the header, the formula row and the body all map the one list.");
