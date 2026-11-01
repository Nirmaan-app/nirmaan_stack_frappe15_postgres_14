// src/utils/assetHistory.ts
//
// Turns an asset's `Asset History` rows (written by the server, see
// `nirmaan_stack/services/asset_history.py`) into the lines the asset page shows, newest first.

import { format } from "date-fns";

import { type AuditAnswer, auditHistorySummary, parseAuditAnswers } from "@/utils/assetAudit";

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
  /** Audit Fulfilled rows: the questions and the holder's answers (owner, 2026-10-15). */
  audit_answers?: unknown;
}

export type HistoryTone = "added" | "assigned" | "declaration" | "unassigned" | "department" | "audit" | "lost" | "found";

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
  /** The audit photo on an "Audit Fulfilled" row (the row's file field; the event says what it is). */
  photoUrl: string | null;
  /** Which audit event, for its own icon and colour; the "Audits" filter still groups them by `tone`. */
  auditKind: AuditKind | null;
  /** The audit's questions and answers on an "Audit Fulfilled" row; [] for every other row. */
  answers: AuditAnswer[];
  /**
   * An audit row's one short line ("For November 2026", "October 2026 was not sent"); null for every other row.
   * On an audit row `reason` holds only what the holder typed (the remarks), never the stored text.
   */
  auditLine: string | null;
}

export type AuditKind = "requested" | "fulfilled" | "missed";

const AUDIT_KINDS: Record<string, AuditKind> = {
  "Audit Requested": "requested",
  "Audit Fulfilled": "fulfilled",
  "Audit Missed": "missed",
};

const TONES: Record<string, HistoryTone> = {
  "Asset Added": "added",
  Assigned: "assigned",
  "Declaration Signed": "declaration",
  "Declaration Uploaded": "declaration",
  Unassigned: "unassigned",
  "Department Set": "department",
  "Audit Requested": "audit",
  "Audit Fulfilled": "audit",
  "Audit Missed": "audit",
  "Asset Lost/Damaged": "lost",
  "Asset Found/Repaired": "found",
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
    case "Audit Requested":
      return `Audit Requested for ${nameOf(row.assigned_to)}`;
    case "Audit Missed":
      return `Audit Missed by ${nameOf(row.assigned_to)}`;
    case "Audit Fulfilled":
      return `Audit Fulfilled by ${nameOf(row.done_by)}`;
    case "Asset Lost/Damaged":
      return row.assigned_to ? `Marked Lost/Damaged (was with ${nameOf(row.assigned_to)})` : "Marked Lost/Damaged";
    case "Asset Found/Repaired":
      return "Marked Found/Repaired";
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
      const audit = AUDIT_KINDS[row.event] ? auditHistorySummary(row.event, row.reason) : null;
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
        // The monthly cron runs as Administrator: its audit rows read "by System".
        by: (row.event === "Audit Requested" || row.event === "Audit Missed") && row.done_by === "Administrator"
          ? "System"
          : nameOf(row.done_by),
        when: formatHistoryTime(row.done_on),
        department,
        // An audit row's stored text is for the screens to read back: people get `auditLine` + the remarks.
        reason: audit ? audit.remarks : row.reason || null,
        declarationUrl: isDeclaration ? row.declaration || null : null,
        declarationMissing: isDeclaration && !row.declaration,
        photoUrl: row.event === "Audit Fulfilled" ? row.declaration || null : null,
        auditKind: AUDIT_KINDS[row.event] ?? null,
        answers: row.event === "Audit Fulfilled" ? parseAuditAnswers(row.audit_answers) : [],
        auditLine: audit?.line || null,
      };
    });
}
