/**
 * Vendor Invoice Recon -> All Invoices, split into pills (#1646, spec #1637): PO / WO / Cashbook / Credit Card /
 * Porter (`reconPillsFor("all")`).
 *
 * PO and WO are today's table of Vendor Invoices (`TaskHistoryTable`), each narrowed to its document type and
 * otherwise unchanged. Cashbook and Credit Card list every Expense bill (`AllExpenseBills`); Porter every Porter
 * Invoice (`AllPorterInvoices`). Those three show for the Vendor Invoice approvers only; the server checks it too.
 * The pill rides its own url param (`?invoices_tab=`), so `?tab=history` links still land.
 */
import React, { Suspense, useMemo } from "react";

import { PillBar } from "@/components/common/PillBar";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUrlPill } from "@/hooks/useUrlPill";
import { useUserData } from "@/hooks/useUserData";

import { isReconPillKey, reconPillsFor } from "../utils/reconPills";

const TaskHistoryTable = React.lazy(() => import("./TaskHistoryTable"));
const AllExpenseBills = React.lazy(() => import("./AllExpenseBills"));
const AllPorterInvoices = React.lazy(() => import("./AllPorterInvoices"));

export const AllInvoices: React.FC = () => {
    const { role, user_id } = useUserData();
    const pills = useMemo(() => reconPillsFor("all", role, user_id), [role, user_id]);
    const [tab, setTab] = useUrlPill("invoices_tab", isReconPillKey, "po");

    // A pill this person may not see (an old link, the role still loading) falls back to PO.
    const current = pills.find((p) => p.key === tab) ?? pills[0];

    return (
        <div className="flex flex-col gap-3">
            <PillBar pills={pills} value={current.key} onChange={setTab} />

            <Suspense fallback={<LoadingFallback />}>
                {/* Keyed, so a switch between pills mounts each table afresh with its own filter. */}
                {current.kind === "vendor" ? <TaskHistoryTable key={current.key} documentType={current.documentType} />
                    : current.kind === "expense" ? <AllExpenseBills key={current.key} kind={current.key} />
                    : <AllPorterInvoices key={current.key} />}
            </Suspense>
        </div>
    );
};

export default AllInvoices;
