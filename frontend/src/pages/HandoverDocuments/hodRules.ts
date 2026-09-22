// Pure rules for the Handover Documents screen (ADR-0010 F4). No React, no fetching.
//
// The S.No close-up mirrors `services/hod/checklist.printable_rows` (the printed checklist and the
// binder), so the numbers on screen are the numbers on paper.

import type { HodDocumentMeta, HodRow } from "./types";

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

/** Can this row's status / remarks / upload / record be changed right now? */
export function rowEditable(row: HodRow, canEdit: boolean): boolean {
  return canEdit && !row.disabled;
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
