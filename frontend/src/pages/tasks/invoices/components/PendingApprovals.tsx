/**
 * Vendor Invoice Recon -> Pending Invoice Approvals, split into pills (#1644, spec #1637): PO / WO / Cashbook /
 * Credit Card (`reconPillsFor("pending")`).
 *
 * PO and WO are today's table of Pending Vendor Invoices (`PendingTasksTable`), each narrowed to its document type
 * and otherwise unchanged. Cashbook and Credit Card list the Expense bills waiting for a person
 * (`ExpenseBillApprovals`). The pill rides its own url param (`?approval_tab=`), so `?tab=pending` links still land.
 */
import React, { Suspense, useMemo } from "react";

import { PillBar } from "@/components/common/PillBar";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUrlPill } from "@/hooks/useUrlPill";
import { useUserData } from "@/hooks/useUserData";

import { isReconPillKey, reconPillsFor } from "../utils/reconPills";

const PendingTasksTable = React.lazy(() => import("./PendingTasksTable"));
const ExpenseBillApprovals = React.lazy(() => import("./ExpenseBillApprovals"));

export const PendingApprovals: React.FC = () => {
    const { role, user_id } = useUserData();
    const pills = useMemo(() => reconPillsFor("pending", role, user_id), [role, user_id]);
    const [tab, setTab] = useUrlPill("approval_tab", isReconPillKey, "po");

    // A pill this screen does not show (an old link, the role still loading) falls back to PO.
    const current = pills.find((p) => p.key === tab) ?? pills[0];

    return (
        <div className="flex flex-col gap-3">
            <PillBar pills={pills} value={current.key} onChange={setTab} />

            <Suspense fallback={<LoadingFallback />}>
                {/* Keyed, so a switch between PO and WO mounts the table afresh with its own filter. */}
                {current.kind === "vendor" ? <PendingTasksTable key={current.key} documentType={current.documentType} />
                    : current.kind === "expense" ? <ExpenseBillApprovals key={current.key} kind={current.key} />
                    : null}
            </Suspense>
        </div>
    );
};

export default PendingApprovals;
