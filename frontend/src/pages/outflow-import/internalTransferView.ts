// src/pages/outflow-import/internalTransferView.ts
//
// The hand actions on an Internal Transfer (#1626, spec #1619, ADR-0044): Mark as Internal Transfer on an open line,
// and Send back to Mismatched on an Internal Transfer line. Pure: no React. The server decides: it sends each open
// line's offer (`row.hand_mark`: its own side, the places to choose from, the Detail to start with) and asks the same
// rules again under the line's row lock (`services/outflow_import/internal_transfer_rules.py`). This keeps no copy of
// the places or the rule (frontend F1); it only decides which button a row shows.

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";

import { ROW_INTERNAL_TRANSFER } from "./outflowImportStatus";
import { amountToneClass } from "./outflowTableModel";

/** Whether the row offers Mark as Internal Transfer: exactly when the server sent its offer. */
export const canMarkInternalTransfer = (row: Pick<OutflowImportRow, "hand_mark">): boolean => row.hand_mark != null;

/** Whether the row offers Send back to Mismatched: an Internal Transfer line, whoever made it. */
export const canSendBack = (row: Pick<OutflowImportRow, "row_status">): boolean =>
    row.row_status === ROW_INTERNAL_TRANSFER;

/**
 * "Marked by hand · who · date · why" for a record a person made, or `null` for one a rule made. Only a hand mark
 * records who marked it, so `transfer_marked_by` is the test.
 */
export const markedByHandLine = (
    row: Pick<OutflowImportRow, "transfer_marked_by" | "transfer_marked_at" | "transfer_mark_reason">
): string | null => {
    if (!row.transfer_marked_by) return null;
    const parts = ["Marked by hand", row.transfer_marked_by];
    const day = (row.transfer_marked_at ?? "").split(/[ T]/)[0];
    if (day) parts.push(formatDate(day));
    if (row.transfer_mark_reason) parts.push(row.transfer_mark_reason);
    return parts.join(" · ");
};

/** The heading over a list of Internal Transfer lines (card Review, Cashbook preview), or `null` for none. */
export const internalTransfersHeading = (count: number): string | null =>
    count > 0 ? `Internal transfers · ${count} ${count === 1 ? "line" : "lines"}` : null;

/** The Internal Transfers tab's Amount tone: by the record's direction where it has one, else the line's. */
export const transferAmountToneClass = (
    row: Pick<OutflowImportRow, "direction" | "transfer_record_direction">
): string => {
    if (row.transfer_record_direction === "In") return amountToneClass({ direction: "Credit" });
    if (row.transfer_record_direction === "Out") return amountToneClass({ direction: "Debit" });
    return amountToneClass(row);
};

/** The line's Internal Transfer record in Desk, or `null` for a line with none (spec #1619 story 48). */
export const internalTransferRecordHref = (row: Pick<OutflowImportRow, "internal_transfer">): string | null =>
    row.internal_transfer ? `/app/internal-transfer/${encodeURIComponent(row.internal_transfer)}` : null;

const oldRecords = (n: number) => `${n} old Internal Transfer ${n === 1 ? "record" : "records"}`;

/** The Cashbook preview's line about the ₹0 records this file fills (owner decision 2, #1619), or `null` for none. */
export const recordsToFillText = (n: number): string | null =>
    n > 0 ? `${oldRecords(n)} ${n === 1 ? "gets its" : "get their"} amount from this file` : null;

/** The result after Create: how many ₹0 records this file filled, or `null` for none. */
export const recordsFilledText = (n: number): string | null =>
    n > 0 ? `${oldRecords(n)} got ${n === 1 ? "its" : "their"} amount from this file.` : null;
