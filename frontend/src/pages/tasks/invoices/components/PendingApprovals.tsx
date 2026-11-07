/**
 * Vendor Invoice Recon -> Pending Invoice Approvals, split into pills (#1644, spec #1637): PO / WO / Cashbook /
 * Credit Card, with the pill pattern of Pending Invoices Upload (`PendingInvoiceUploads.tsx`).
 *
 * PO and WO are today's table of Pending Vendor Invoices (`PendingTasksTable`), each narrowed to its document type
 * and otherwise unchanged. Cashbook and Credit Card list the Expense bills waiting for a person
 * (`ExpenseBillApprovals`). The pill rides its own url param (`?approval_tab=`), so `?tab=pending` links still land.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";

import { PENDING_APPROVAL_PILLS, type PendingApprovalPill, isPendingApprovalPill } from "../utils/expenseBillApprovalView";

const PendingTasksTable = React.lazy(() => import("./PendingTasksTable"));
const ExpenseBillApprovals = React.lazy(() => import("./ExpenseBillApprovals"));

const URL_PARAM = "approval_tab";

export const PendingApprovals: React.FC = () => {
    const initialTab = useMemo<PendingApprovalPill>(() => {
        const fromUrl = getUrlStringParam(URL_PARAM, "po");
        return isPendingApprovalPill(fromUrl) ? fromUrl : "po";
    }, []);

    const [tab, setTab] = useState<PendingApprovalPill>(initialTab);

    // state -> URL
    useEffect(() => {
        if (urlStateManager.getParam(URL_PARAM) !== tab) {
            urlStateManager.updateParam(URL_PARAM, tab);
        }
    }, [tab]);

    // URL -> state (back/forward, direct load)
    useEffect(() => {
        return urlStateManager.subscribe(URL_PARAM, (_, value) => {
            const next = value && isPendingApprovalPill(value) ? value : initialTab;
            setTab((current) => (current === next ? current : next));
        });
    }, [initialTab]);

    const onClick = useCallback((value: PendingApprovalPill) => {
        setTab((current) => (current === value ? current : value));
    }, []);

    const current = PENDING_APPROVAL_PILLS.find((p) => p.key === tab) ?? PENDING_APPROVAL_PILLS[0];

    return (
        <div className="flex flex-col gap-3">
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
                    {PENDING_APPROVAL_PILLS.map((option) => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => onClick(option.key)}
                            className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                                transition-colors flex items-center gap-1.5 whitespace-nowrap
                                ${tab === option.key
                                    ? "bg-sky-500 text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <Suspense fallback={<LoadingFallback />}>
                {/* Keyed, so a switch between PO and WO mounts the table afresh with its own filter. */}
                {current.kind === "expense"
                    ? <ExpenseBillApprovals key={current.key} kind={current.key} />
                    : <PendingTasksTable key={current.key} documentType={current.documentType} />}
            </Suspense>
        </div>
    );
};

export default PendingApprovals;
