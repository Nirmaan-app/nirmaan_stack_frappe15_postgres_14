/**
 * The Cheque Tracker (spec #1477, #1483): every cheque the company writes, on its own sidebar page. It was
 * Reports › Payment › Cheque Payment; old links to that report redirect here (`chequeTrackerPathFromLegacyReport`).
 *
 * Tabs (`utils/cheques/chequeTabs`), kept in `?tab=`: All Cheques, and Cheque Issued – Reconciliation Pending
 * (the Payment cheques waiting for the bank, whose payments Project Payments' Reconciliation Pending leaves out),
 * and Security Deposits (#1486: cheques held as a guarantee, never cashed).
 *
 * The route admits Admin, Accountant, Accountant Lead and Procurement (`CHEQUE_ACCESS_PROFILES`), as does every
 * `api/cheques/` endpoint.
 */

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { CHEQUE_TRACKER_TABS, chequeTrackerTabOf, type ChequeTrackerTab } from "@/utils/cheques/chequeTabs";
import { urlStateManager } from "@/utils/urlStateManager";

import { ChequeTrackerTable } from "./components/ChequeTrackerTable";
import { useChequeTabCounts } from "./config/useChequeTabCounts";

export default function ChequeTrackerPage() {
    const [tab, setTab] = useState<ChequeTrackerTab>(() => chequeTrackerTabOf(urlStateManager.getParam("tab")));
    const { counts, refresh } = useChequeTabCounts();

    // Back / forward between tabs.
    useEffect(() => urlStateManager.subscribe("tab", (_, value) => setTab(chequeTrackerTabOf(value))), []);

    const openTab = (value: ChequeTrackerTab) => {
        setTab(value);
        urlStateManager.updateParam("tab", value);
    };

    return (
        <div className="flex-1 space-y-4">
            <div>
                <h1 className="text-xl font-semibold tracking-tight">Cheque Tracker</h1>
                <p className="text-sm text-muted-foreground">
                    Every cheque the company writes: what it pays, when it was issued and when the bank paid it.
                </p>
            </div>

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
            <ChequeTrackerTable key={tab} tab={tab} onChanged={refresh} />
        </div>
    );
}
