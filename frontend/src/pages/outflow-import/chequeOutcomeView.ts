// src/pages/outflow-import/chequeOutcomeView.ts
//
// The Outcome cell's cheque chip (#1485, spec #1477): which Payment cheque a Settled ICICI line cleared, from
// what status, and the double-payment warning of a cancelled one the bank paid anyway. Pure: no React, no
// fetch. `chequeOutcomeView.test.ts` pins it; `OutflowRowsTable` renders it.
//
// ⚠️ NO RULE OF ITS OWN. Which cheque, where it started and which payments look doubled are the server's
// (`services/cheques/bank_import.cheque_outcomes`); the sentence under the chip is the line's own note.

import type { ChequeOutcome } from "@/types/NirmaanStack/OutflowImportBatch";
import { chequeReportPath } from "@/utils/cheques/chequeReportLink";

/** How the chip is coloured: by where the cheque stood before the line. */
export type ChequeOutcomeTone = "cleared" | "approved" | "revived" | "linked";

export interface ChequeOutcomeChip {
    label: string;
    href: string;
    tone: ChequeOutcomeTone;
    warning: { label: string; detail: string } | null;
}

const TONES: Record<ChequeOutcome["started"], ChequeOutcomeTone> = {
    Issued: "cleared",
    Pending: "approved",
    Cancelled: "revived",
    Cleared: "linked",
};

const joinNames = (parts: string[]): string =>
    parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

export const chequeOutcomeChip = (outcome: ChequeOutcome | null | undefined): ChequeOutcomeChip | null => {
    if (!outcome) return null;
    const move = outcome.started === "Cleared" ? "linked" : `${outcome.started} → Cleared`;
    const doubled = outcome.double_payments ?? [];
    return {
        label: `Cheque ${outcome.cheque_no} · ${move}`,
        href: chequeReportPath(outcome.cheque_no),
        tone: TONES[outcome.started] ?? "cleared",
        warning: doubled.length
            ? {
                  label: "Check for double payment",
                  detail: `${joinNames(doubled.map((d) => `${d.record} has ${d.payment} (${d.status})`))}, raised after this cheque was cancelled.`,
              }
            : null,
    };
};
