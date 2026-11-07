/**
 * Vendor Invoice Recon -> All Invoices, split into pills (#1646, spec #1637): PO / WO / Cashbook / Credit Card /
 * Porter, with the pill pattern of Pending Approval (`PendingApprovals.tsx`).
 *
 * PO and WO are today's table of Vendor Invoices (`TaskHistoryTable`), each narrowed to its document type and
 * otherwise unchanged. Cashbook and Credit Card list every Expense bill (`AllExpenseBills`); Porter every Porter
 * Invoice (`AllPorterInvoices`). Those three show for the Vendor Invoice approvers only (`allInvoicesPillsFor`); the
 * server checks it too. The pill rides its own url param (`?invoices_tab=`), so `?tab=history` links still land.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { urlStateManager } from "@/utils/urlStateManager";

import { type AllInvoicesPillKey, allInvoicesPillsFor, isAllInvoicesPill } from "../utils/allInvoicesView";

const TaskHistoryTable = React.lazy(() => import("./TaskHistoryTable"));
const AllExpenseBills = React.lazy(() => import("./AllExpenseBills"));
const AllPorterInvoices = React.lazy(() => import("./AllPorterInvoices"));

const URL_PARAM = "invoices_tab";

export const AllInvoices: React.FC = () => {
    const { role, user_id } = useUserData();
    const pills = useMemo(() => allInvoicesPillsFor(role, user_id), [role, user_id]);

    const initialTab = useMemo<AllInvoicesPillKey>(() => {
        const fromUrl = getUrlStringParam(URL_PARAM, "po");
        return isAllInvoicesPill(fromUrl) ? fromUrl : "po";
    }, []);

    const [tab, setTab] = useState<AllInvoicesPillKey>(initialTab);

    // state -> URL
    useEffect(() => {
        if (urlStateManager.getParam(URL_PARAM) !== tab) {
            urlStateManager.updateParam(URL_PARAM, tab);
        }
    }, [tab]);

    // URL -> state (back/forward, direct load)
    useEffect(() => {
        return urlStateManager.subscribe(URL_PARAM, (_, value) => {
            const next = value && isAllInvoicesPill(value) ? value : initialTab;
            setTab((current) => (current === next ? current : next));
        });
    }, [initialTab]);

    const onClick = useCallback((value: AllInvoicesPillKey) => {
        setTab((current) => (current === value ? current : value));
    }, []);

    // A pill this person may not see (an old link, the role still loading) falls back to PO.
    const current = pills.find((p) => p.key === tab) ?? pills[0];

    return (
        <div className="flex flex-col gap-3">
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
                    {pills.map((option) => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => onClick(option.key)}
                            className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                                transition-colors flex items-center gap-1.5 whitespace-nowrap
                                ${current.key === option.key
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
                {/* Keyed, so a switch between pills mounts each table afresh with its own filter. */}
                {current.kind === "vendor" ? <TaskHistoryTable key={current.key} documentType={current.documentType} />
                    : current.kind === "expense" ? <AllExpenseBills key={current.key} kind={current.key} />
                    : <AllPorterInvoices key={current.key} />}
            </Suspense>
        </div>
    );
};

export default AllInvoices;
