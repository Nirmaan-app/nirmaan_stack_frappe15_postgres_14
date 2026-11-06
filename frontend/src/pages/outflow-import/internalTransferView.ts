// src/pages/outflow-import/internalTransferView.ts
//
// The hand actions on an Internal Transfer (#1626, spec #1619, ADR-0044): Mark as Internal Transfer on an open line,
// and Send back to Mismatched on an Internal Transfer line. Pure: no React. The server decides, under the line's row
// lock (`services/outflow_import/internal_transfer_rules.py`); this only decides which button a row shows, and the
// choices the dialog offers. The places are pinned to `internal_transfers.PLACES` by test.

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";

import { ROW_INTERNAL_TRANSFER, ROW_PENDING_MATCH, isOpen } from "./outflowImportStatus";

/** From and To, a fixed list (owner, 2026-11-06). */
export const INTERNAL_TRANSFER_PLACES = [
    "ICICI Current Account",
    "ICICI Bank Ledger",
    "Cashfree Wallet",
    "Cashbook Virtual Account",
    "Cashbook Employee Wallet",
    "Porter Wallet",
    "ICICI Credit Card",
] as const;

/** The line's own side when marked by hand, by its source. Any other source cannot be marked by hand. */
const OWN_PLACE: Record<string, string> = {
    "ICICI Bank Statement": "ICICI Current Account",
    Cashfree: "Cashfree Wallet",
    Cashbook: "Cashbook Employee Wallet",
};

export const ownPlace = (source: string | null | undefined): string | null => OWN_PLACE[source ?? ""] ?? null;

/**
 * Whether the row offers Mark as Internal Transfer: an open ICICI, Cashfree or Cashbook line, bar a Cashbook line
 * its import's job still owns (`Pending match run`).
 */
export const canMarkInternalTransfer = (row: Pick<OutflowImportRow, "row_status" | "source">): boolean =>
    isOpen(row.row_status) &&
    ownPlace(row.source) !== null &&
    !(row.source === "Cashbook" && row.row_status === ROW_PENDING_MATCH);

/** Whether the row offers Send back to Mismatched: an Internal Transfer line, whoever made it. */
export const canSendBack = (row: Pick<OutflowImportRow, "row_status">): boolean =>
    row.row_status === ROW_INTERNAL_TRANSFER;

/** The other ends the dialog offers: every place but the line's own side. */
export const otherEndChoices = (row: Pick<OutflowImportRow, "source">): string[] => {
    const own = ownPlace(row.source);
    return INTERNAL_TRANSFER_PLACES.filter((place) => place !== own);
};

/** "Marked by hand · who · date · why" for a record a person made, or `null` for one a rule made. */
export const markedByHandLine = (
    row: Pick<OutflowImportRow, "transfer_made_by" | "transfer_marked_by" | "transfer_marked_at" | "transfer_mark_reason">
): string | null => {
    if (row.transfer_made_by !== "by hand") return null;
    const parts = ["Marked by hand"];
    if (row.transfer_marked_by) parts.push(row.transfer_marked_by);
    const day = (row.transfer_marked_at ?? "").split(/[ T]/)[0];
    if (day) parts.push(formatDate(day));
    if (row.transfer_mark_reason) parts.push(row.transfer_mark_reason);
    return parts.join(" · ");
};
