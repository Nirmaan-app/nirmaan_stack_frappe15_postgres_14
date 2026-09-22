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
