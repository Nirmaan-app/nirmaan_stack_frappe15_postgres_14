/**
 * The Cheque Tracker (spec #1477, #1483): every cheque the company writes, on its own sidebar page. It was
 * Reports › Payment › Cheque Payment; old links to that report redirect here (`chequeTrackerPathFromLegacyReport`).
 *
 * Tabs (`utils/cheques/chequeTabs`), kept in `?tab=`: All Cheques, and Cheque Issued – Reconciliation Pending
 * (the Payment cheques waiting for the bank, whose payments Project Payments' Reconciliation Pending leaves out),
 * and Security Deposits (#1486: cheques held as a guarantee, never cashed). The tab bar and table are
 * `ChequeTrackerTabs`, which the Vendor page's Cheques tab shares, narrowed to one vendor.
 *
 * The route admits Admin, Accountant, Accountant Lead and Procurement (`CHEQUE_ACCESS_PROFILES`), as does every
 * `api/cheques/` endpoint.
 */

import { ChequeTrackerTabs } from "./components/ChequeTrackerTabs";

export default function ChequeTrackerPage() {
    return (
        <div className="flex-1 space-y-4">
            <div>
                <h1 className="text-xl font-semibold tracking-tight">Cheque Tracker</h1>
                <p className="text-sm text-muted-foreground">
                    Every cheque the company writes: what it pays, when it was issued and when the bank paid it.
                </p>
            </div>

            <ChequeTrackerTabs tabParam="tab" />
        </div>
    );
}
