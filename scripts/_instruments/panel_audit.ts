/** The CALCULATOR REVIEW TABLE (owner item 7): every field on screen, its three properties, its note. */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v25.json";
import ELEC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v66.json";
import { auditPanelFields } from "../../frontend/src/pages/boq-wizard/rate-helper/panelFieldAudit";

const pad = (s: string, n: number) => String(s).padEnd(n);
function table(title: string, asset: any, categoryId: string) {
  const cfg = asset.category_configs.find((c: any) => c.category_id === categoryId);
  if (!cfg) { console.log(`\n### ${title}: no config`); return; }
  const items = asset.items.filter((i: any) => (cfg.item_kinds ?? []).includes(i.kind) || i.kind === `${categoryId}_item`
    || i.kind === (cfg.list_spec?.pricing?.kind));
  const rows = auditPanelFields(cfg, items);
  console.log(`\n### ${title}  (${rows.length} fields on screen)`);
  console.log(pad("field", 18), pad("control", 17), pad("options from", 13), pad("mandatory", 10), pad("note?", 6), "note");
  for (const r of rows) {
    console.log(pad(r.attr, 18), pad(r.control, 17), pad(r.optionsFrom, 13),
                pad(r.mandatory ? "YES" : "optional", 10),
                pad(r.needsNote ? (r.note ? "req/ok" : "REQ/MISSING") : "-", 6),
                r.note ? `"${r.note.slice(0, 60)}"` : "");
  }
  const need = rows.filter((r) => r.needsNote);
  console.log(`   -> typed+rendered+mandatory: ${need.length}; of those WITHOUT a note: ${need.filter((r) => !r.note).length}`);
}
table("HVAC / ADP", HVAC, "hvac_adp");
table("HVAC / Insulation", HVAC, "hvac_insulation");
console.log("\n\n### ELECTRICAL -- READ-ONLY, nothing changed");
for (const c of (ELEC as any).category_configs) {
  if (!c.list_spec?.pricing) continue;
  table(`Electrical / ${c.category_id}`, ELEC, c.category_id);
}
