// src/utils/assetHistory.ts
//
// Turns an asset's `Asset History` rows (written by the server, see
// `nirmaan_stack/services/asset_history.py`) into the lines the asset page shows, newest first.

import { format } from "date-fns";

/** One `Asset History` child row as the asset document returns it. */
export interface AssetHistoryRow {
  name: string;
  idx?: number;
  event: string;
  assigned_to?: string | null;
  done_by?: string | null;
  done_on?: string | null;
  declaration?: string | null;
  from_department?: string | null;
  to_department?: string | null;
  reason?: string | null;
}

export type HistoryTone = "added" | "assigned" | "declaration" | "unassigned" | "department" | "return";

export interface HistoryEntry {
  key: string;
  tone: HistoryTone;
  title: string;
  by: string;
  when: string | null;
  /** "Projects → Accounts", or "Department: Projects" when one was first given. */
  department: string | null;
  reason: string | null;
  declarationUrl: string | null;
  /** A declaration was recorded but its file is gone (removed before history kept files). */
  declarationMissing: boolean;
}

const TONES: Record<string, HistoryTone> = {
  "Asset Added": "added",
  Assigned: "assigned",
  "Declaration Signed": "declaration",
  "Declaration Uploaded": "declaration",
  Unassigned: "unassigned",
  "Department Set": "department",
  "Return Requested": "return",
  "Return Rejected": "return",
};

/** "12-Oct-2026 04:05 PM" from a Frappe datetime ("2026-10-12 16:05:15.510342"); null if unreadable. */
export function formatHistoryTime(value: string | null | undefined): string | null {
  if (!value) return null;
  // Safari rejects more than 3 fractional digits, so parse only up to the seconds.
  const date = new Date(value.slice(0, 19).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : format(date, "dd-MMM-yyyy hh:mm a");
}

function titleFor(row: AssetHistoryRow, nameOf: (id?: string | null) => string): string {
  switch (row.event) {
    case "Asset Added":
      return "Asset added";
    case "Assigned":
      return `Assigned to ${nameOf(row.assigned_to)}`;
    case "Declaration Signed":
      return `Declaration signed by ${nameOf(row.done_by)}`;
    case "Declaration Uploaded":
      return row.assigned_to ? `Declaration uploaded for ${nameOf(row.assigned_to)}` : "Declaration uploaded";
    case "Unassigned":
      return `Unassigned from ${nameOf(row.assigned_to)}`;
    case "Department Set":
      return row.from_department ? "Department changed" : `Department set to ${row.to_department ?? ""}`.trim();
    case "Return Requested":
      return `Returned by ${nameOf(row.assigned_to)}, waiting for approval`;
    case "Return Rejected":
      return `Return rejected, ${nameOf(row.assigned_to)} keeps it`;
    default:
      return row.event;
  }
}

/**
 * The history as display lines, newest first. `nameOf` turns a user id (email) into a name and
 * should fall back to the id itself (e.g. "Administrator").
 */
export function describeHistory(rows: AssetHistoryRow[], nameOf: (id?: string | null) => string): HistoryEntry[] {
  return [...rows]
    .sort((a, b) => (b.idx ?? 0) - (a.idx ?? 0) || (b.done_on ?? "").localeCompare(a.done_on ?? ""))
    .map((row) => {
      const isDeclaration = row.event === "Declaration Signed" || row.event === "Declaration Uploaded";
      const department =
        row.from_department && row.to_department
          ? `${row.from_department} → ${row.to_department}`
          : row.to_department && row.event !== "Department Set"
            ? `Department: ${row.to_department}`
            : null;
      return {
        key: row.name,
        tone: TONES[row.event] ?? "added",
        title: titleFor(row, nameOf),
        by: nameOf(row.done_by),
        when: formatHistoryTime(row.done_on),
        department,
        reason: row.reason || null,
        declarationUrl: isDeclaration ? row.declaration || null : null,
        declarationMissing: isDeclaration && !row.declaration,
      };
    });
}
