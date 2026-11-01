// src/utils/assetLostDamaged.ts
//
// Marking an asset Lost/Damaged and bringing it back Found/Repaired (owner, 2026-10-31). The rules are the
// server's, `nirmaan_stack/services/asset_lost_damaged.py`; this copy only decides when the dialog's button is
// enabled and what the dialog tells Admin / HR about the holder's audits before they mark it.

import { AUDIT_PENDING, type AuditAnswer, auditMonthName, parseAuditAnswers, parseFulfilledText } from "@/utils/assetAudit";
import type { AssetHistoryRow } from "@/utils/assetHistory";
import { formatHistoryTime } from "@/utils/assetHistory";

/** The history events (mirrors `ASSET_LOST_DAMAGED` / `ASSET_FOUND_REPAIRED` in `services/asset_history.py`). */
export const ASSET_LOST_DAMAGED_EVENT = "Asset Lost/Damaged";
export const ASSET_FOUND_REPAIRED_EVENT = "Asset Found/Repaired";

/** Mirrors `MIN_REASON_LENGTH` (services/asset_department.py), which the server checks. */
export const MIN_LOST_DAMAGED_REASON = 10;

/** True when the typed reason is long enough to send. Any wording counts (owner, 2026-10-31). */
export function isLostDamagedReasonValid(reason: string | null | undefined): boolean {
  return (reason ?? "").trim().length >= MIN_LOST_DAMAGED_REASON;
}

/** The asset's newest "Asset Lost/Damaged" history row (who had it, who marked it, when, why); null if none. */
export function latestLostDamaged(history: readonly AssetHistoryRow[] | null | undefined): AssetHistoryRow | null {
  return (
    [...(history ?? [])]
      .filter((row) => row.event === ASSET_LOST_DAMAGED_EVENT)
      .sort((a, b) => (b.idx ?? 0) - (a.idx ?? 0))[0] ?? null
  );
}

/** The assignment fields the audit record reads. */
export interface HolderAssignmentFields {
  asset_declaration_attachment?: string | null;
  audit_status?: string | null;
  audit_month?: string | null;
  audit_overdue_since?: string | null;
}

/** What the Mark as Lost/Damaged dialog shows about the holder's audits (owner, 2026-10-31). */
export interface HolderAuditRecord {
  /** "Last audit sent: for October 2026, on 29-Sep-2026 06:02 PM", or that none was sent. */
  lastSent: string;
  /** The last sent audit's answers (the holder's own words), [] when none. */
  lastAnswers: AuditAnswer[];
  /** The open audit, overdue run or why none is open -- one line. */
  openNow: string;
  /** True when the holder owes something right now (an unsent or overdue audit): the line shows in amber. */
  owes: boolean;
}

/**
 * The holder's audit record for this asset: the last audit THEY sent (from the asset's history, newest first) and
 * what is open on their assignment now. Information only -- it never blocks marking the asset.
 */
export function holderAuditRecord(
  holder: string,
  assignment: HolderAssignmentFields | null | undefined,
  history: readonly AssetHistoryRow[] | null | undefined,
): HolderAuditRecord {
  const last = [...(history ?? [])]
    .filter((row) => row.event === "Audit Fulfilled" && row.assigned_to === holder)
    .sort((a, b) => (b.idx ?? 0) - (a.idx ?? 0))[0];

  let lastSent = "No audit sent yet for this asset.";
  if (last) {
    const forMonth = parseFulfilledText(last.reason).forMonth;
    const when = formatHistoryTime(last.done_on);
    lastSent = `Last audit sent: ${forMonth ? `for ${auditMonthName(forMonth)}` : "month not recorded"}${when ? `, on ${when}` : ""}.`;
  }

  const pending = assignment?.audit_status === AUDIT_PENDING;
  let openNow = "No audit open right now.";
  if (assignment && !assignment.asset_declaration_attachment) {
    openNow = "Declaration not signed yet, so no audit was due.";
  } else if (pending && assignment?.audit_overdue_since) {
    openNow = `Overdue since ${auditMonthName(assignment.audit_overdue_since)}; ${auditMonthName(assignment.audit_month)} not sent. It ends with no result.`;
  } else if (pending) {
    openNow = `${auditMonthName(assignment?.audit_month)} audit not sent yet. It ends with no result and won't count as missed.`;
  }

  return { lastSent, lastAnswers: last ? parseAuditAnswers(last.audit_answers) : [], openNow, owes: pending };
}
