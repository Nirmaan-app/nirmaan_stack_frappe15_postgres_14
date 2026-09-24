/**
 * "Pending Invoices Upload" -- the orders whose vendor invoice has not arrived yet.
 *
 * This is a SHELL, not a second implementation. Both sub-tabs mount the Reports screen's
 * own bodies (`POReports` / `SRReports`) with the report type pinned to "Pending
 * Invoices", so this tab and `/reports?report=Pending Invoices` can never quote
 * different numbers -- they are literally the same component, columns, export and rules.
 * A change to either report lands on both screens at once.
 *
 * Those two take no props: the tab strip and the "Report Type" dropdown live in
 * `ReportsContainer`, and the bodies read only `useReportStore.selectedReportType`.
 * Pinning that store is the whole integration.
 *
 * The sub-tab rides its OWN url param (`?upload_tab=`) so the parent tab strip stays flat
 * on `?tab=` and every existing invoice-reconciliation link keeps working. It never
 * writes `?report=` -- only `ReportsContainer` owns that param.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import { useReportStore } from "@/pages/reports/store/useReportStore";

const POReports = React.lazy(() => import("@/pages/reports/components/POReports"));
const SRReports = React.lazy(() => import("@/pages/reports/components/SRReports"));

const URL_PARAM = "upload_tab";

/** The one report both sub-tabs show. */
const REPORT_TYPE = "Pending Invoices" as const;

const PENDING_UPLOAD_TABS = [
    { key: "po", label: "PO" },
    { key: "wo", label: "WO" },
] as const;

type PendingUploadTab = typeof PENDING_UPLOAD_TABS[number]["key"];

const isPendingUploadTab = (value: string): value is PendingUploadTab =>
    PENDING_UPLOAD_TABS.some((t) => t.key === value);

export const PendingInvoiceUploads: React.FC = () => {
    /**
     * Pinned DURING the first render, not in an effect. An effect runs after the children
     * have already rendered once, so the first paint would show whichever report the
     * Reports page last selected -- on the WO side that is the 2B Reconcile screen, which
     * is a different table entirely.
     */
    const pinned = useRef(false);
    if (!pinned.current) {
        pinned.current = true;
        useReportStore.getState().setSelectedReportType(REPORT_TYPE);
    }

    const initialTab = useMemo<PendingUploadTab>(() => {
        const fromUrl = getUrlStringParam(URL_PARAM, "po");
        return isPendingUploadTab(fromUrl) ? fromUrl : "po";
    }, []);

    const [tab, setTab] = useState<PendingUploadTab>(initialTab);

    // Re-assert on every sub-tab switch: the store is app-global, so anything that
    // navigated through /reports in between could have left another report selected.
    useEffect(() => {
        useReportStore.getState().setSelectedReportType(REPORT_TYPE);
    }, [tab]);

    // state -> URL
    useEffect(() => {
        if (urlStateManager.getParam(URL_PARAM) !== tab) {
            urlStateManager.updateParam(URL_PARAM, tab);
        }
    }, [tab]);

    // URL -> state (back/forward, direct load)
    useEffect(() => {
        return urlStateManager.subscribe(URL_PARAM, (_, value) => {
            const next = value && isPendingUploadTab(value) ? value : initialTab;
            setTab((current) => (current === next ? current : next));
        });
    }, [initialTab]);

    const onClick = useCallback((value: PendingUploadTab) => {
        setTab((current) => (current === value ? current : value));
    }, []);

    return (
        <div className="flex flex-col gap-3">
            {/* Same pill styling as the parent tab strip, deliberately -- these read as a
                second row of the same navigation, not as a different kind of control. */}
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
                    {PENDING_UPLOAD_TABS.map((option) => (
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
                {/* The flag is what keeps these two narrowings OFF the Reports page:
                    PO measures delivered instead of paid, and both sides list only the
                    current financial year. Reports renders the same components with the
                    flag absent and is byte-unchanged. */}
                {tab === "po"
                    ? <POReports pendingUploadMode />
                    : <SRReports pendingUploadMode />}
            </Suspense>
        </div>
    );
};

export default PendingInvoiceUploads;
