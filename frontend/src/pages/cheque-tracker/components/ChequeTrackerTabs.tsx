import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { CHEQUE_TRACKER_TABS, chequeTrackerTabOf, type ChequeTrackerTab } from "@/utils/cheques/chequeTabs";
import { urlStateManager } from "@/utils/urlStateManager";

import { useChequeTabCounts } from "../config/useChequeTabCounts";
import { ChequeTrackerTable } from "./ChequeTrackerTable";

interface ChequeTrackerTabsProps {
    /** The URL param that keeps the open tab: `tab` on the Cheque Tracker page, its own name inside another page. */
    tabParam: string;
    /** Only this vendor's cheques (the Vendor page's Cheques tab); every cheque when absent. */
    vendorId?: string;
}

/**
 * The Cheque Tracker's tab bar and table (spec #1477, #1483), shared by the Cheque Tracker page and the Vendor page's
 * Cheques tab. With `vendorId` every tab, count, summary, facet and export is narrowed to that vendor's cheques.
 */
export function ChequeTrackerTabs({ tabParam, vendorId }: ChequeTrackerTabsProps) {
    const [tab, setTab] = useState<ChequeTrackerTab>(() => chequeTrackerTabOf(urlStateManager.getParam(tabParam)));
    const { counts, refresh } = useChequeTabCounts(vendorId);

    // Back / forward between tabs.
    useEffect(
        () => urlStateManager.subscribe(tabParam, (_, value) => setTab(chequeTrackerTabOf(value))),
        [tabParam],
    );

    const openTab = (value: ChequeTrackerTab) => {
        setTab(value);
        urlStateManager.updateParam(tabParam, value);
    };

    return (
        <>
            <nav aria-label="Cheque Tracker tabs" className="flex flex-wrap gap-x-6 border-b">
                {CHEQUE_TRACKER_TABS.map((t) => {
                    const active = t.value === tab;
                    const count = counts[t.value];
                    return (
                        <button
                            key={t.value}
                            type="button"
                            onClick={() => openTab(t.value)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "-mb-px flex items-center gap-2 border-b-2 px-0.5 py-2 text-sm font-medium transition-colors",
                                active
                                    ? "border-primary text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {t.label}
                            {count !== undefined && (
                                <span className="rounded-full bg-muted px-2 text-xs font-semibold tabular-nums">{count}</span>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Keyed on the tab: each tab is its own table, with its own URL state. */}
            <ChequeTrackerTable key={tab} tab={tab} vendorId={vendorId} onChanged={refresh} />
        </>
    );
}
