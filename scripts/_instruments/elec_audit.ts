/** Owner item 5: Electrical's typed fields, re-stated against the THREE conditions. READ-ONLY.
 *  Mandatory is asked of the real helper: fill every other field, leave this one blank, see if it prices. */
import ELEC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v66.json";
import { makePricingSheetHelper, attributeOptions } from "../../frontend/src/pages/boq-wizard/rate-helper/pricingSheetHelper";
const a = ELEC as any;
const items = a.items as any[];
const pad = (s: any, n: number) => String(s).padEnd(n);

let totalTyped = 0, totalNeed = 0, voided = 0;
for (const cfg of a.category_configs) {
  const defs = (cfg.attribute_definitions ?? []).filter((d: any) => d.selector !== false && d.panel !== false);
  if (!defs.length) continue;
  const helper = makePricingSheetHelper({
    configsByCategory: new Map([[cfg.category_id, cfg]]), items,
    extractionByRow: new Map(), } as never);
  const ctx = { excelRow: 1, description: "", unit: "Nos", quantity: 1,
                category: cfg.category_id, discipline: "Electrical", displayKinds: [] } as any;
  const fill = (d: any) => {
    const opts = attributeOptions(d, items);
    if (opts.length) return opts.find((o: string) => o !== "None") ?? opts[0];
    return d.type === "number" || /qty|count|runs|points|length/.test(d.id) ? "1" : "1";
  };
  const all: Record<string, string> = {};
  for (const d of defs) all[d.id] = fill(d);
  const priced = (ov: Record<string, string>) => {
    try { const r: any = helper.compute(ctx, ov); return r.kind === "suggestion" && Object.keys(r.values ?? {}).length > 0; }
    catch { return false; }
  };
  if (!priced(all)) { voided++; console.log(`\n### ${cfg.category_id}: BASELINE DOES NOT PRICE -- not measurable here (${defs.length} defs)`); continue; }
  const typed = defs.filter((d: any) => !(attributeOptions(d, items).length) && d.type !== "choice");
  const rows: string[] = [];
  for (const d of typed) {
    const ov = { ...all }; delete ov[d.id];
    const mandatory = !priced(ov);
    totalTyped++; if (mandatory) totalNeed++;
    rows.push(`${pad(d.id, 26)} ${pad(mandatory ? "MANDATORY" : "optional", 11)} note: ${d.note ? "yes" : "NONE"}`);
  }
  if (rows.length) { console.log(`\n### ${cfg.category_id}  (${typed.length} typed fields on screen)`); rows.forEach((r) => console.log("   " + r)); }
}
console.log(`\n==> typed+rendered: ${totalTyped}; of those MANDATORY (would need a note): ${totalNeed}`);
console.log(`    categories whose baseline does not price (not measurable this way): ${voided}`);
