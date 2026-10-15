// Pure rules for the Handover Documents screen (ADR-0010 F4). No React, no fetching.
//
// The S.No close-up mirrors `services/hod/checklist.printable_rows` (the printed checklist and the
// binder), so the numbers on screen are the numbers on paper.

import type {
  HodDocumentMeta,
  HodRow,
  HodStatus,
  InventoryEntry,
  InventoryItem,
  InventoryLocation,
} from "./types";

/** What a document is called on screen. A document the project FILLS is a Form, whatever its text comes
 *  from — the Recommended Tools List and the Maintenance Checklist read their items from the library but
 *  the project fills remarks and results, so calling them "Library" hid the work (owner 2026-09-23).
 *  Everything else is named by where its content comes from. */
export function documentChip(meta: Pick<HodDocumentMeta, "kind" | "fill">): {
  label: string;
  className: string;
} {
  if (meta.fill) return { label: "Form", className: "bg-blue-50 text-blue-700" };
  if (meta.kind === "app")
    return { label: "From Nirmaan", className: "bg-teal-50 text-teal-700" };
  return { label: "Library", className: "bg-purple-50 text-purple-700" };
}

/** Rows in index order (the server already sorts; this keeps the screen honest if it ever doesn't). */
export function orderRows(
  rows: HodRow[],
  documents: HodDocumentMeta[],
): HodRow[] {
  const order = new Map(documents.map((d, i) => [d.key, i]));
  return [...rows].sort(
    (a, b) => (order.get(a.document) ?? 99) - (order.get(b.document) ?? 99),
  );
}

/** document key -> the S.No it prints with; switched-off rows get none and the rest close up. */
export function printedNumbers(
  rows: HodRow[],
  documents: HodDocumentMeta[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of orderRows(rows, documents)) {
    if (!row.disabled) out.set(row.document, out.size + 1);
  }
  return out;
}

/** The status pill colours, shared by the Status column and the binder dialog. */
export const STATUS_STYLE: Record<HodStatus, string> = {
  Done: "bg-green-600 text-white border-green-600",
  WIP: "bg-amber-50 text-amber-700 border-amber-300",
  "Not Started": "bg-gray-100 text-gray-600 border-gray-300",
};

export interface BinderEntry {
  /** The S.No the document prints with on the checklist (switched-off rows closed up). */
  sno: number;
  row: HodRow;
  meta: HodDocumentMeta;
}

/** What "Download binder" builds, read off the screen's rows (owner 2026-10-06: the dialog before the
 *  download lists it). Mirrors `api/hod/binder.build_plan`'s selection -- `checklist.printable_rows` +
 *  `checklist.is_done` (ADR-0010 F1): every SWITCHED-ON document in checklist order with its S.No; the
 *  Done ones get a cover page, the logo page and their pages, the rest are skipped (no cover page, no
 *  pages -- they stay on the checklist as YES). Switched-off documents are not on the checklist at all. */
export function binderContents(
  rows: HodRow[],
  documents: HodDocumentMeta[],
): { included: BinderEntry[]; skipped: BinderEntry[]; off: number } {
  const metaByKey = new Map(documents.map((d) => [d.key, d]));
  const included: BinderEntry[] = [];
  const skipped: BinderEntry[] = [];
  let off = 0;
  let sno = 0;
  for (const row of orderRows(rows, documents)) {
    const meta = metaByKey.get(row.document);
    if (!meta) continue;
    if (row.disabled) {
      off += 1;
      continue;
    }
    sno += 1;
    (row.status === "Done" ? included : skipped).push({ sno, row, meta });
  }
  return { included, skipped, off };
}

/** Can this row's status / remarks / record be changed right now? */
/** Keys `form_data` carries for the screen's own bookkeeping, not as something a user entered.
 *  Mirrors `services/hod/checklist._META_KEYS`. */
const META_KEYS = new Set(["completed"]);

function hasUserInput(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUserInput);
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>).some(hasUserInput);
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean") return value;
  return value !== null && value !== undefined;
}

/** Has someone actually done this document? The ONE test behind the Done gate, and the same rule for
 *  all three kinds: a form keeps its entries, a library text its included parts, a From Nirmaan
 *  document the records ticked for the handover — so "saved" is just `form_data` holding something a
 *  person put there. Mirrors `services/hod/checklist.is_saved` (ADR-0010 F1). */
export function isSaved(row: Pick<HodRow, "form_data">): boolean {
  const data = row.form_data || {};
  return hasUserInput(
    Object.fromEntries(
      Object.entries(data).filter(([k]) => !META_KEYS.has(k)),
    ),
  );
}

/** Must this document be SAVED before it can be Done? Only a FROM NIRMAAN document
 *  (owner 2026-09-28): what it hands over IS the records ticked on it, so with none ticked there is
 *  nothing to print. A FORM prints from its own layout whether or not anyone typed in it — a blank Key
 *  List or Attic Stock List is a real handover page, filled in by hand on site — and a library text
 *  carries the library's own content. Mirrors `checklist.needs_saving`. */
export function needsSaving(
  meta: Pick<HodDocumentMeta, "kind" | "fill">,
): boolean {
  return meta.kind === "app";
}

export function rowEditable(row: HodRow, canEdit: boolean): boolean {
  return canEdit && !row.disabled;
}

/** What a project starts with on the Escalation Chart, and the fewest rows the sheet prints
 *  (services/hod/escalation.DEFAULT_LEVELS). */
export const DEFAULT_ESCALATION_LEVELS = 3;

/** 0 → "1st Level", 3 → "4th Level" (mirrors services/hod/escalation.level_label). */
export function levelLabel(index: number): string {
  const n = index + 1;
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ??
        "th";
  return `${n}${suffix} Level`;
}

/** A form_data value as a list of plain objects (anything else becomes []). */
export function asObjectList<T extends object>(value: unknown): T[] {
  return Array.isArray(value)
    ? (value.filter(
        (v) => v && typeof v === "object" && !Array.isArray(v),
      ) as T[])
    : [];
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function asStringList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map(asString) : null;
}

/** Drop rows the user left completely empty, so a half-filled grid saves only what was typed. */
/** The rows a grid form SHOWS: the stored ones, or a blank starter block when nothing is stored yet.
 *
 *  The padding is deliberately keyed on "nothing stored", NOT on "fewer than minRows". Topping a short
 *  list back up to minRows on every render makes the per-row delete button DEAD -- the row goes and the
 *  pad puts an empty one straight back, so the count never drops below minRows and the user sees
 *  nothing happen. It also breaks the rule that what the dialog shows is what prints.
 *  Mirrors `BLANK_ROWS` in `api/hod/print_context.py`: the two are the same number on purpose. */
export function visibleRows<T extends object>(
  rows: T[],
  minRows: number,
  readOnly: boolean,
): T[] {
  if (rows.length > 0 || readOnly) return rows;
  return Array.from({ length: minRows }, () => ({}) as T);
}

export function compactRows<T extends object>(rows: T[]): T[] {
  return rows.filter((r) =>
    Object.values(r).some((v) => asString(v).trim() !== ""),
  );
}

/** A {key: text} map with blank values dropped (e.g. the remarks per tool, `form_data.tool_remarks`). */
export function compactTextMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const text = asString(v).trim();
      if (text) out[k] = text;
    }
  }
  return out;
}

/** Inventory totals per material column (blank / non-numeric cells count as 0). */
export function inventoryTotals(
  locations: Array<{ qty?: Array<number | string | null> }>,
  columns: number,
): number[] {
  const totals = new Array(columns).fill(0);
  for (const loc of locations) {
    for (let j = 0; j < columns; j++) {
      const n = Number(loc.qty?.[j]);
      if (Number.isFinite(n)) totals[j] += n;
    }
  }
  return totals;
}

// ------------------------------------------------------------------------- Inventory List entry
//
// The list is FILLED one location at a time -- the materials found there and their count (owner
// 2026-10-15) -- but STORED and printed as a matrix: `materials` are the columns, `locations[].qty[j]` the
// cells (`api/hod/print_context._inventory`). The screen converts both ways, so the stored shape never
// changed. While the dialog is open the draft carries `entries`; Mark as Done turns them back into the
// matrix and drops them.

/** The identity of a typed name -- a material or a location: case and spacing do not make a second one. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function tidyMaterial(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** The locations as the dialog shows them: the draft's own `entries` while it is being edited, else read
 *  out of the stored matrix. A blank cell -- or a 0, which the old grid made people type into every cell
 *  it had -- is a material that is not at that location. */
export function inventoryEntries(value: Record<string, unknown>): InventoryEntry[] {
  if (Array.isArray(value.entries)) {
    return asObjectList<Partial<InventoryEntry>>(value.entries).map((e) => ({
      name: asString(e.name),
      items: asObjectList<Partial<InventoryItem>>(e.items).map((i) => ({
        material: asString(i.material),
        qty: asString(i.qty),
      })),
    }));
  }
  const materials = asStringList(value.materials) ?? [];
  return asObjectList<InventoryLocation>(value.locations).map((l) => ({
    name: asString(l.name),
    items: materials.flatMap((material, j) => {
      const qty = asString(l.qty?.[j]).trim();
      return qty && Number(qty) !== 0 ? [{ material, qty }] : [];
    }),
  }));
}

/** The matrix the entries print as. Columns are every material in use, spelled as first entered; the
 *  `previous` (stored) order comes first so a re-save never shuffles the printed columns, and new ones
 *  follow in the order they were added. A material a location does not have -- or one entered with no
 *  count -- is a 0 cell (owner 2026-10-15: "empty means we show 0"); a second entry of the same material
 *  in one location adds nothing (the dialog will not save one -- see `inventoryProblem`). A location with
 *  no name and no material is dropped, as the old grid dropped an empty row. */
export function inventoryMatrix(
  entries: InventoryEntry[],
  previous: string[],
): { materials: string[]; locations: InventoryLocation[] } {
  const kept = entries.filter(
    (e) => e.name.trim() || e.items.some((i) => nameKey(i.material)),
  );
  const spelling = new Map<string, string>();
  for (const e of kept) {
    for (const i of e.items) {
      const k = nameKey(i.material);
      if (k && !spelling.has(k)) spelling.set(k, tidyMaterial(i.material));
    }
  }
  const keys = [
    ...new Set([
      ...previous.map(nameKey).filter((k) => spelling.has(k)),
      ...spelling.keys(),
    ]),
  ];
  return {
    materials: keys.map((k) => spelling.get(k) as string),
    locations: kept.map((e) => {
      const qty = keys.map(() => "");
      const taken = new Set<number>();
      for (const i of e.items) {
        const j = keys.indexOf(nameKey(i.material));
        if (j < 0 || taken.has(j)) continue;
        taken.add(j);
        qty[j] = i.qty.trim();
      }
      return { name: e.name.trim(), qty: qty.map((q) => q || "0") };
    }),
  };
}

/** What the Inventory List will store and print: the entries converted when the dialog edited them,
 *  else the stored matrix as it is, with only its EMPTY cells made 0 (the old grid let a cell be left
 *  blank) -- so the Preview and the PDF read 0 wherever a location has none of a material. */
export function inventoryMatrixOf(value: Record<string, unknown>): {
  materials: string[];
  locations: InventoryLocation[];
} {
  const previous = asStringList(value.materials) ?? [];
  if (Array.isArray(value.entries)) {
    return inventoryMatrix(inventoryEntries(value), previous);
  }
  return {
    materials: previous,
    locations: asObjectList<InventoryLocation>(value.locations).map((l) => ({
      ...l,
      qty: previous.map((_, j) => {
        const q = l.qty?.[j];
        return q == null || asString(q).trim() === "" ? "0" : q;
      }),
    })),
  };
}

/** The materials already on the list, for the picker: each once, as first spelled, with how many
 *  locations have it. */
export function materialUse(
  entries: InventoryEntry[],
): Array<{ name: string; locations: number }> {
  const use = new Map<string, { name: string; locations: number }>();
  for (const e of entries) {
    const seen = new Set<string>();
    for (const i of e.items) {
      const k = nameKey(i.material);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const hit = use.get(k);
      if (hit) hit.locations += 1;
      else use.set(k, { name: tidyMaterial(i.material), locations: 1 });
    }
  }
  return [...use.values()];
}

/** A typed material snapped to the spelling it already has on the list ("fan coil unit " -> "Fan coil
 *  unit"), so it lands in the same printed column. `at` is the item being typed, which does not count. */
export function canonicalMaterial(
  entries: InventoryEntry[],
  typed: string,
  at: { entry: number; item: number },
): string {
  const k = nameKey(typed);
  if (k) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = 0; j < entries[i].items.length; j++) {
        if (i === at.entry && j === at.item) continue;
        const other = entries[i].items[j].material;
        if (nameKey(other) === k) return tidyMaterial(other);
      }
    }
  }
  return tidyMaterial(typed);
}

/** The items of one location that repeat a material listed above them. */
export function duplicateItems(items: InventoryItem[]): Set<number> {
  const seen = new Set<string>();
  const dupes = new Set<number>();
  items.forEach((i, j) => {
    const k = nameKey(i.material);
    if (!k) return;
    if (seen.has(k)) dupes.add(j);
    seen.add(k);
  });
  return dupes;
}

/** The locations whose name repeats an earlier one (case and spacing ignored), each mapped to the index
 *  of the first. A location is one row of the printed sheet, so it is entered once (owner 2026-10-15). */
export function duplicateLocations(entries: InventoryEntry[]): Map<number, number> {
  const first = new Map<string, number>();
  const dupes = new Map<number, number>();
  entries.forEach((e, i) => {
    const k = nameKey(e.name);
    if (!k) return;
    const at = first.get(k);
    if (at === undefined) first.set(k, i);
    else dupes.set(i, at);
  });
  return dupes;
}

/** Why the Inventory List cannot be marked Done yet, or "" when it can: a location entered twice, or a
 *  material entered twice in one location (it would print one count and silently lose the other). Only
 *  an EDITED list is checked -- unedited, the stored matrix is saved as it is. */
export function inventoryProblem(value: Record<string, unknown>): string {
  if (!Array.isArray(value.entries)) return "";
  const entries = inventoryEntries(value);
  const [repeat] = duplicateLocations(entries);
  if (repeat) {
    const [i, first] = repeat;
    return `Location ${i + 1} "${entries[i].name.trim()}" is already location ${first + 1}. Each location can be entered only once.`;
  }
  for (let i = 0; i < entries.length; i++) {
    const [j] = duplicateItems(entries[i].items);
    if (j !== undefined) {
      return `Location ${i + 1} has "${entries[i].items[j].material.trim()}" twice. Remove one of them.`;
    }
  }
  return "";
}

/** Defects Liability Period end: 12 months from commissioning, minus one day (services/hod/dates.dlp_end). */
export function dlpEnd(start: string, months = 12): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start || "");
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + months;
  const d = Number(m[3]);
  const ty = y + Math.floor(mo / 12);
  const tm = ((mo % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(ty, tm, Math.min(d, lastDay)));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ Maintenance Checklist results
// Shape of `form_data.checks` (services/hod/maintenance.py): block name -> list key -> { results, comments },
// results keyed by the item's TEXT so an edited library item never inherits a neighbour's result.

/** The two item lists of a maintenance block and the sheet each prints as. */
export const MAINTENANCE_PERIODS = [
  { list: "list_1", label: "Six Months Report" },
  { list: "list_2", label: "Yearly Report" },
] as const;
export type MaintenanceList = (typeof MAINTENANCE_PERIODS)[number]["list"];
export const MAINTENANCE_RESULTS = ["OK", "Not OK", "NA"] as const;

export interface MaintenanceItemCheck {
  result?: string;
  remarks?: string;
}
export interface MaintenanceSheetCheck {
  results?: Record<string, MaintenanceItemCheck>;
  comments?: string;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

/** One sheet's stored results + comments (empty when nothing was entered). */
export function maintenanceSheet(
  value: Record<string, unknown>,
  block: string,
  list: MaintenanceList,
): MaintenanceSheetCheck {
  return asRecord(asRecord(asRecord(value.checks)[block])[list]);
}

/** A copy of the form value with one sheet's fields patched. */
export function withMaintenanceSheet(
  value: Record<string, unknown>,
  block: string,
  list: MaintenanceList,
  patch: MaintenanceSheetCheck,
): Record<string, unknown> {
  const checks = asRecord(value.checks);
  const perBlock = asRecord(checks[block]);
  return {
    ...value,
    checks: {
      ...checks,
      [block]: { ...perBlock, [list]: { ...asRecord(perBlock[list]), ...patch } },
    },
  };
}

/** A copy of the form value with one item's result / remarks patched. */
export function withMaintenanceResult(
  value: Record<string, unknown>,
  block: string,
  list: MaintenanceList,
  item: string,
  patch: MaintenanceItemCheck,
): Record<string, unknown> {
  const results = asRecord(maintenanceSheet(value, block, list).results);
  return withMaintenanceSheet(value, block, list, {
    results: { ...results, [item]: { ...asRecord(results[item]), ...patch } },
  });
}

/** The date of ONE period's check. The six-monthly and the yearly checks are separate VISITS, so each
 *  carries its own date (mirrors `services/hod/maintenance.period_date`). The single pre-split `date` is
 *  the fallback, so a row saved before the two dates still shows the one it had. */
export function maintenanceDate(
  value: Record<string, unknown>,
  list: MaintenanceList,
): string {
  return asString(asRecord(value.dates)[list]).trim() || asString(value.date).trim();
}

/** A copy of the form value with one period's date set.
 *
 *  BOTH periods are written on the first edit: the other one keeps the date it was already SHOWING — the
 *  legacy single `date` on a row saved before the split — so dropping that key on save cannot lose it. */
export function withMaintenanceDate(
  value: Record<string, unknown>,
  list: MaintenanceList,
  date: string,
): Record<string, unknown> {
  const other = MAINTENANCE_PERIODS.find((p) => p.list !== list)!.list;
  return {
    ...value,
    dates: {
      ...asRecord(value.dates),
      [other]: maintenanceDate(value, other),
      [list]: date,
    },
  };
}

/** Before saving: drop items with neither a result nor remarks, then sheets and blocks left empty. */
export function compactMaintenanceChecks(
  checks: unknown,
): Record<string, Partial<Record<MaintenanceList, MaintenanceSheetCheck>>> {
  const out: Record<string, Partial<Record<MaintenanceList, MaintenanceSheetCheck>>> = {};
  for (const [block, perBlock] of Object.entries(asRecord(checks))) {
    const sheets: Partial<Record<MaintenanceList, MaintenanceSheetCheck>> = {};
    for (const { list } of MAINTENANCE_PERIODS) {
      const sheet = asRecord(asRecord(perBlock)[list]);
      const results: Record<string, MaintenanceItemCheck> = {};
      for (const [item, check] of Object.entries(asRecord(sheet.results))) {
        const result = asString(asRecord(check).result).trim();
        const remarks = asString(asRecord(check).remarks).trim();
        if (result || remarks) results[item] = { result, remarks };
      }
      const comments = asString(sheet.comments).trim();
      if (Object.keys(results).length || comments) sheets[list] = { results, comments };
    }
    if (Object.keys(sheets).length) out[block] = sheets;
  }
  return out;
}
