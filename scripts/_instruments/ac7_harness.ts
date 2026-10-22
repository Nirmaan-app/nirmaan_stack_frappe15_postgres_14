// 12d-8 AC7 -- every stored row of every active run through the PANEL path, recording figures, status,
// reasons, notes, working AND each field's option list + the unit choices, so an A/B between two code states
// names every row that moved and what moved. No writes.
// Tracked in ADP-1 (2026-10-19) from container scratch; the only change: the data directory is $REPLAY_DIR
// (default /tmp/replay17883) and the frontend modules are imported relative to this file. Run through
// replay.sh, which bundles it with the frontend's own esbuild.
import { readFileSync, writeFileSync } from "node:fs";
import { makePricingSheetHelper } from "../../frontend/src/pages/boq-wizard/rate-helper/pricingSheetHelper";
import { mergeItemsByName } from "../../frontend/src/pages/boq-wizard/rate-helper/rateHelperPlumbing";
import { rowHeadingNotes } from "../../frontend/src/pages/boq-wizard/rate-helper/rateSuggestionModel";

const label = process.argv[2] ?? "run";
const S = process.env.REPLAY_DIR ?? "/tmp/replay17883";
const cfgs = JSON.parse(readFileSync(`${S}/ac5_configs.json`, "utf8"));
const rawItems = JSON.parse(readFileSync(`${S}/ac5_items.json`, "utf8"));
const configsByCategory = new Map<string, any>(Object.entries(cfgs));
const byDisc: Record<string, any[]> = {};
for (const it of rawItems) (byDisc[it.discipline] ??= []).push(it);
const items = mergeItemsByName(...Object.values(byDisc));
const lines = readFileSync(`${S}/ac5_rows.jsonl`, "utf8").split("\n").filter(Boolean);
// ADP-5a CERT-C5 / C5c (owner 2026-10-22): the row context's headingNotes are built by the PAGE's own function from the
// page's own rows (dumped by ac5_dump.py), so the replay sees exactly what the page sees; how many rows differ from the
// payload's notes (`payloadHeadingNotes`, reference only) is REPORTED, never a reason to stop
const PAGE_ROWS: Record<string, any[]> = JSON.parse(readFileSync(`${S}/ac5_page_rows.json`, "utf8"));
const hnMismatch: string[] = [];
let hnRows = 0;
function pageHeadingNotes(r: any): string[] {
  const rows = PAGE_ROWS[`${r.boq}|${r.sheet_name}`] ?? [];
  const row = rows.find((x: any) => x.source_row_number === r.excel_row);
  const got = row ? rowHeadingNotes(row, rows) : [];
  hnRows++;
  if (JSON.stringify(got) !== JSON.stringify(r.payloadHeadingNotes ?? [])) hnMismatch.push(`${r.boq}|${r.sheet_name}|${r.excel_row}`);
  return got;
}
const out: string[] = [];
let n = 0;
for (const line of lines) {
  const r = JSON.parse(line);
  const cat = r.resolved_category || r.category_id;
  const ext = new Map<number, any>();
  const extRow: any = { excelRow: r.excel_row, description: r.description, attributes: r.attributes ?? {} };
  if (Array.isArray(r.items)) extRow.items = r.items;
  ext.set(r.excel_row, extRow);
  const helper = makePricingSheetHelper({ configsByCategory, items, extractionByRow: ext });
  let res: any;
  try {
    res = helper.compute({ excelRow: r.excel_row, description: r.description, nodeType: "Line Item", category: cat, discipline: r.discipline, rateKinds: ["supply_rate", "install_rate", "combined_rate"] as any, headings: r.headings ?? [], ownNotes: r.ownNotes ?? [], headingNotes: pageHeadingNotes(r), unit: r.unit ?? "" } as any, {});
  } catch (e: any) {
    res = { kind: "error", error: String(e?.message ?? e) };
  }
  const il = res.itemList;
  const rec = {
    key: `${r.boq}|${r.sheet_name}|${r.excel_row}`, cat, disc: r.discipline, kind: res.kind, reason: res.reason ?? null,
    values: res.values ?? null,
    list: il ? { rowPriced: il.rowPriced, reason: il.reason ?? null, totals: il.totals ?? null, unitChoices: il.unitChoices ?? null, unitNote: il.unitNote ?? null,
      items: (il.items ?? []).map((b: any) => ({ family: b.family, state: b.state, reason: b.reason ?? null, figures: b.figures,
        fields: b.fields.map((f: any) => ({ id: f.id, value: f.value, typed: f.typedValue, other: f.otherMode, note: f.note ?? null, options: f.options ?? null, labels: f.optionLabels ?? null, defaulted: !!f.defaulted })),
        working: b.working })) } : null,
    attrs: res.workingsAttrs ? res.workingsAttrs.map((a: any) => ({ id: a.id, value: a.value, computed: a.computed ?? null, note: a.note ?? null })) : null,
    derivation: res.derivation ?? null,
  };
  out.push(JSON.stringify(rec)); n++;
}
writeFileSync(`${S}/ac7_${label}.jsonl`, out.join("\n") + "\n");
console.log(`${label}: priced ${n} rows; configs ${configsByCategory.size}; items ${items.length}`);
console.log(`${label}: heading notes, page vs payload: equal on ${hnRows - hnMismatch.length} / ${hnRows} rows; differ on ${hnMismatch.length} (hn_differ_${label}.txt)`);
writeFileSync(`${S}/hn_differ_${label}.txt`, hnMismatch.join("\n") + (hnMismatch.length ? "\n" : ""));
