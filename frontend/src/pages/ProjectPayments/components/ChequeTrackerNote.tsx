import { Info } from "lucide-react";
import { Link } from "react-router-dom";

import { CHEQUE_ACCESS_PROFILES } from "@/constants/roles";
import { CHEQUE_TRACKER_PATH } from "@/utils/cheques/chequeReportLink";
import { CHEQUE_TRACKER_TAB } from "@/utils/cheques/chequeTabs";

interface ChequeTrackerNoteProps {
    role: string;
    /** `get_approval_queue_counts`'s `cheque_tracker`: the payments this tab leaves out, and their cheques. */
    waiting?: { payments: number; cheques: number };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The one-line note on Payment Done › Reconciliation Pending (#1483): cheque payments wait in the Cheque Tracker
 * instead, and come back under Reconciliation Done once paid. The link shows to the roles that may open the
 * tracker (`CHEQUE_ACCESS_PROFILES`).
 */
export function ChequeTrackerNote({ role, waiting }: ChequeTrackerNoteProps) {
    const canOpen = CHEQUE_ACCESS_PROFILES.includes(role);
    const howMany = waiting && waiting.payments > 0
        ? ` (${plural(waiting.payments, "payment")} on ${plural(waiting.cheques, "cheque")})`
        : "";
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <Info className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
            <p className="min-w-0 flex-1">
                Cheque payments wait in <strong>Cheque Tracker › Cheque Issued – Reconciliation Pending</strong>
                {howMany}. They show under Reconciliation Done once the bank pays them.
            </p>
            {canOpen && (
                <Link
                    to={`${CHEQUE_TRACKER_PATH}?tab=${CHEQUE_TRACKER_TAB.ISSUED}`}
                    className="font-medium text-blue-700 underline-offset-2 hover:underline"
                >
                    Open Cheque Tracker
                </Link>
            )}
        </div>
    );
}
