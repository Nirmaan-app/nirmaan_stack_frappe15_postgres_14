// DU-2 M8 THE DERIVATION DUMP FOR THE WORDING READ (no browser, no database): every line of Rate Master > HVAC > <category> > Derivation
// EXACTLY as the page renders it -- the page's own generator `itemListRuleOrder(config, items, sectionConfigs)` (RateMasterDerivation.tsx
// calls the same) over the newest asset, nested lines included, each with its "-- why:" reason and the rule id it maps to -- plus the
// guard's result (`derivationCoverage`: MISSING / ORPHAN / UNREASONED). Env: DD_ASSET (HVAC asset path), DD_CATS (comma), DD_OUT.
import { readFileSync, writeFileSync } from "node:fs";
import { itemListRuleOrder } from "../../frontend/src/pages/pricing/rate-master/itemListRuleOrder";
import { derivationCoverage } from "../../frontend/src/pages/pricing/rate-master/derivationCoverage";

const A = JSON.parse(readFileSync(process.env.DD_ASSET!, "utf8"));
const cfg = new Map<string, any>(A.category_configs.map((c: any) => [c.category_id, { ...c, discipline: A.discipline }]));
const items = A.items.map((i: any) => ({ ...i, discipline: A.discipline }));
const sections: Record<string, unknown> = {};
for (const [k, v] of cfg) sections[k] = v;
const out: string[] = [];
for (const cat of (process.env.DD_CATS ?? "").split(",").filter(Boolean)) {
  const c = cfg.get(cat);
  const lines = itemListRuleOrder(c, items, sections as never);
  const cov = derivationCoverage(c, items, sections as never);
  out.push(`================ Rate Master > HVAC > ${c.category_display ?? cat} > Derivation (${A.source_workbook ? "" : ""}${process.env.DD_ASSET!.split("/").pop()})`);
  out.push(`GUARD: MISSING ${cov.missing.length} | ORPHAN ${cov.orphan.length} | UNREASONED ${cov.unreasoned.length}`);
  for (const m of [...cov.missing, ...cov.orphan, ...cov.unreasoned]) out.push(`  ! ${m}`);
  let n = 0;
  for (const l of lines as any[]) {
    n++;
    out.push(`${String(n).padStart(3)}. ${l.title}${l.rule ? `  [rule ${l.rule}]` : ""}`);
    // the page renders "title -- detail" (RateMasterDerivation.tsx); the detail already carries "-- why: <reason>"
    if (l.detail) out.push(`       ${l.detail}`);
    let m = 0;
    for (const s of (l.sub ?? []) as any[]) {
      m++;
      out.push(`     ${n}.${m} ${s.title}${s.rule ? `  [rule ${s.rule}]` : ""}`);
      if (s.detail) out.push(`          ${s.detail}`);
    }
  }
  out.push(`(${n} top-level lines)`, "");
}
writeFileSync(process.env.DD_OUT!, out.join("\n") + "\n");
console.log(out.filter((l) => l.startsWith("GUARD") || l.startsWith("(")).join("\n"));
