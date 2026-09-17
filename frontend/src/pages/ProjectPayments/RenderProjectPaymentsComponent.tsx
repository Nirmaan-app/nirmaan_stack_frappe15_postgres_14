import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { parseNumber } from "@/utils/parseNumber";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { APPROVAL_COUNTS_API, APPROVAL_COUNTS_SWR_KEY, APPROVAL_STATUS } from "./config/approvalsTable.config";
import { NewProjectExpenseDialog } from "../ProjectExpenses/components/NewProjectExpenseDialog";
import { NewNonProjectExpense } from "../NonProjectExpenses/components/NewNonProjectExpense";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrappeDocTypeEventListener, useFrappeGetCall } from "frappe-react-sdk";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
// --- Tab Configuration ---
import {
    PP_TABS, PP_ADMIN_TAB_OPTIONS, PP_CEO_TAB_OPTIONS, PP_NEW_PAYMENTS_TAB_OPTIONS, PP_RECONCILIATION_TAB_OPTIONS, PP_BY_ME_TAB_OPTIONS, PP_ADMIN_ROLES, PP_ACCOUNTANT_ROLES, PP_PROJECT_ROLES, PPTabOption,
} from "./config/ppTabs.constants";
// PP_REM_TAB_OPTIONS (PO Wise) and PP_ALL_TAB_OPTIONS (All Payments) are intentionally
// NOT imported: their buttons were removed 2026-09-15. Both tabs remain ROUTED via
// PP_TABS below, so deep links still resolve. Re-import + .map(renderTabButton) to restore.
import { CEO_AUTHORIZED_USER } from "@/constants/ceoHold";
import { HR_EXECUTIVE_PROFILE, PMO_EXECUTIVE_PROFILE } from "@/constants/roles";

/** The tabs HR Executive may open on this page -- all view-only for HR. */
const HR_TABS = [
    PP_TABS.RECONCILIATION_PENDING,
    PP_TABS.PAYMENTS_DONE,
    PP_TABS.PAYMENTS_PENDING,
    PP_TABS.PAYMENT_BY_ME,
] as const;

const ApprovePayments = React.lazy(() => import("./approve-payments/ApprovePayments"));
const AccountantTabs = React.lazy(() => import("./update-payment/AccountantTabs"));
const ProjectPaymentsList = React.lazy(() => import("./project-payments-list"));
const AllPayments = React.lazy(() => import("./AllPayments"));
const PaymentSummaryCards = React.lazy(() => import("./PaymentSummaryCards"));

export const RenderProjectPaymentsComponent: React.FC = () => {

    const { role, user_id } = useUserData();

    const { counts } = useDocCountStore()

    // ── Tab badges count ALL THREE money-out ledgers ──────────────────────────
    //
    // `useDocCountStore` counts `Project Payments` ONLY, so every badge disagreed
    // with the table beside it the moment expenses appeared (36 vs 44, 7,566 vs
    // 10,840). A badge that contradicts its own list is worse than no badge.
    //
    // `countValue` wins over `countKey` in renderTabButton, so overriding here
    // leaves the sidebar store — shared with other screens — completely untouched.
    const { data: queueCounts, mutate: mutateQueueCounts } = useFrappeGetCall<{
        message: { counts: Record<string, number>; amounts: Record<string, number>; by_me?: number };
    }>(APPROVAL_COUNTS_API, undefined, APPROVAL_COUNTS_SWR_KEY);

    // ── Keep the badges live ──────────────────────────────────────────────────
    // Actions on this page refresh them directly (`useRefreshApprovalCounts`). These
    // listeners cover everything else — another user approving or paying, a bulk
    // import settling rows — which would otherwise leave the badges stale until a
    // reload. Debounced so a bulk action's burst of events costs one refetch.
    const countsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleCountsRefresh = useCallback(() => {
        if (countsDebounceRef.current) clearTimeout(countsDebounceRef.current);
        countsDebounceRef.current = setTimeout(() => { mutateQueueCounts(); }, 500);
    }, [mutateQueueCounts]);
    useFrappeDocTypeEventListener("Project Payments", scheduleCountsRefresh);
    useFrappeDocTypeEventListener("Project Expenses", scheduleCountsRefresh);
    useFrappeDocTypeEventListener("Non Project Expenses", scheduleCountsRefresh);
    useEffect(() => () => {
        if (countsDebounceRef.current) clearTimeout(countsDebounceRef.current);
    }, []);

    const unionCount = useCallback(
        (status: string, fallback: number | string) => {
            const c = queueCounts?.message?.counts;
            // Until the call resolves, fall back to the payments-only number rather
            // than flashing 0 — an empty badge reads as "nothing to do".
            return c ? (c[status] ?? 0) : fallback;
        },
        [queueCounts]
    );

    const canApprovePayments = user_id === "Administrator" || role === "Nirmaan Admin Profile";
    const isCEO = user_id === CEO_AUTHORIZED_USER;

    // --- Tab State Management ---
    const isAdmin = useMemo(() => PP_ADMIN_ROLES.includes(role), [role]);
    const isAccountant = useMemo(() => PP_ACCOUNTANT_ROLES.includes(role), [role]);
    const isProjectRole = useMemo(() => PP_PROJECT_ROLES.includes(role), [role]);
    const isPMO = role === PMO_EXECUTIVE_PROFILE;
    // HR Executive sees FOUR tabs here, all view-only (owner, 17 Sep 2026): Reconciliation
    // Pending (no Actions column), Payment Done / Reconciliation Done, Payments Pending and
    // Payment By Me. See `tab` below.
    const isHR = role === HR_EXECUTIVE_PROFILE;
    // Who may SETTLE a payment: Mark as Paid ("Payment need to paid") and Mark Reconciled
    // ("Reconciliation Pending"). Gates the tab buttons AND the tab bodies below, since both
    // tabs are reachable by a hand-edited `?tab=` URL.
    const canSettlePayments = isAdmin || isAccountant;
    // Reconciliation Pending is also VIEWABLE by HR -- without the Mark Reconciled action,
    // which AllPayments drops for anyone who cannot settle.
    const canViewReconciliation = canSettlePayments || isHR;

    const initialTab = useMemo(() => {
        const adminDefault = PP_TABS.APPROVE_PAYMENTS;
        const ceoDefault = PP_TABS.CEO_PENDING;
        const accountantDefault = PP_TABS.NEW_PAYMENTS;
        const userDefault = PP_TABS.PAYMENTS_DONE;
        const remDefault = PP_TABS.PO_WISE;
        // PMO sees neither the approval nor the settle tabs (2026-09-17), so it defaults to
        // Payments Pending -- falling through to PO Wise would open a tab with no button.
        const pmoDefault = PP_TABS.PAYMENTS_PENDING;
        return getUrlStringParam("tab", isHR ? PP_TABS.PAYMENT_BY_ME : isCEO ? ceoDefault : canApprovePayments ? adminDefault : isPMO ? pmoDefault : isAccountant ? accountantDefault : isProjectRole ? userDefault : remDefault);
    }, [isHR, isCEO, canApprovePayments, isPMO, isAccountant, isProjectRole]); // Calculate only once based on role

    const [selectedTab, setTab] = useState<string>(initialTab);
    // ⚠️ HR IS HELD TO ITS FOUR TABS, whatever the state or a hand-edited `?tab=` says -- any
    // other tab falls back to "Payment By Me", since HR has no button for it and a bookmarked
    // URL must not open one. Derived rather than forced into state, so it also holds while
    // the role is still loading.
    const tab = isHR && !(HR_TABS as readonly string[]).includes(selectedTab) ? PP_TABS.PAYMENT_BY_ME : selectedTab;

    // Effect to sync tab state TO URL
    useEffect(() => {
        // Only update URL if the state `tab` is different from the URL's current 'tab' param
        if (urlStateManager.getParam("tab") !== tab) {
            urlStateManager.updateParam("tab", tab);
        }
    }, [tab]);

    // Effect to sync URL state TO tab state (for popstate/direct URL load)
    useEffect(() => {
        const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
            // Update state only if the new URL value is different from current state
            const newTab = value || initialTab; // Fallback to initial if param removed
            if (tab !== newTab) {
                setTab(newTab);
            }
        });
        return unsubscribe; // Cleanup subscription
    }, [initialTab]); // Depend on `tab` to avoid stale closures

    // const [tab, setTab] = useStateSyncedWithParams<string>("tab", (role === "Nirmaan Admin Profile" ? "Approve Payments" : role === "Nirmaan Accountant Profile" ?  "New Payments" : ["Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile", "Nirmaan Project Manager Profile"].includes(role) ? "Payments Done" : "PO Wise"))

    // --- Tab Change Handler ---
    const handleTabClick = useCallback((value: string) => {
        if (tab !== value) {
            setTab(value);
        }
    }, [tab]);

    // --- Filter tabs based on role ---
    // Approve Payments: Admin / Administrator only. Everyone else never sees the tab.
    /** Replace a tab option's payments-only count with the union count. */
    const withUnionCount = useCallback(
        (opts: PPTabOption[], status: string) =>
            opts.map((o) => ({ ...o, countValue: unionCount(status, o.countValue ?? 0) })),
        [unionCount]
    );

    const adminTabsFiltered = useMemo(
        () => (canApprovePayments ? withUnionCount(PP_ADMIN_TAB_OPTIONS, APPROVAL_STATUS.REQUESTED) : []),
        [canApprovePayments, withUnionCount]
    );
    const ceoTabsFiltered = useMemo(
        () => (isCEO ? withUnionCount(PP_CEO_TAB_OPTIONS, APPROVAL_STATUS.CEO_PENDING) : []),
        [isCEO, withUnionCount]
    );
    const newPaymentsTabsFiltered = useMemo(
        () => canSettlePayments ? withUnionCount(PP_NEW_PAYMENTS_TAB_OPTIONS, APPROVAL_STATUS.APPROVED) : [],
        [canSettlePayments, withUnionCount]
    );
    // Tab four. Same audience as "Payment need to paid" -- the accountant owns both
    // sides of the settlement. Empty until the fulfil path writes the new status.
    const reconciliationTabsFiltered = useMemo(
        () => canViewReconciliation ? withUnionCount(PP_RECONCILIATION_TAB_OPTIONS, APPROVAL_STATUS.RECONCILIATION_PENDING) : [],
        [canViewReconciliation, withUnionCount]
    );
    const paymentTypeTabsFiltered = useMemo(() => [
        {
            // Tab five. `Paid` now means RECONCILED -- the label says so.
            label: "Payment Done / Reconciliation Done",
            value: PP_TABS.PAYMENTS_DONE,
            countValue: unionCount(APPROVAL_STATUS.PAID, counts.pay.paid)
        },
        {
            // ⚠️ NOT in the owner's five-tab list, and NOT in the hide list either --
            // left visible deliberately rather than quietly dropped. It is exactly the
            // sum of tabs one, two and three, so it is a candidate to retire; say the
            // word and it is this one object.
            label: "Payments Pending",
            value: PP_TABS.PAYMENTS_PENDING,
            countValue:
                parseNumber(unionCount(APPROVAL_STATUS.REQUESTED, counts.pay.requested))
                + parseNumber(unionCount(APPROVAL_STATUS.CEO_PENDING, counts.pay.ceopending))
                + parseNumber(unionCount(APPROVAL_STATUS.APPROVED, counts.pay.approved))
        }
    ], [counts, unionCount]);
    // "Payment By Me" — every role on the page. The badge stays hidden until the count
    // loads (`countValue` undefined renders no badge) rather than flashing a 0.
    const byMeTabsFiltered = useMemo(
        () => PP_BY_ME_TAB_OPTIONS.map((o) => ({ ...o, countValue: queueCounts?.message?.by_me })),
        [queueCounts]
    );

    /**
     * Refresh after an expense is created from this page.
     *
     * A new expense lands in one of THESE tabs, so leaving the screen stale would show
     * a queue that does not contain the row the user just created. The badges are ours
     * to refresh; the ledger tables are owned by the lazy children, so they are
     * invalidated by SWR key prefix rather than through a lifted handle.
     */
    const handleExpenseCreated = useCallback(() => {
        mutateQueueCounts();
        // The three queue TABLES refresh themselves: each now listens for realtime
        // events on both expense doctypes (see the listeners in ApprovePayments /
        // AllPayments / AccountantTabs). Only the badges are ours.
    }, [mutateQueueCounts]);

    // Render a single tab button
    const renderTabButton = (option: PPTabOption | { label: string, value: string, countValue: number | string }) => {
        // Resolve count either straight from passed value or via dot notation from countKey
        const count = 'countValue' in option && option.countValue !== undefined
            ? option.countValue
            : ('countKey' in option && option.countKey)
                ? option.countKey.split('.').reduce((acc: any, part: string) => acc && acc[part], counts) ?? 0
                : null;
        const isActive = tab === option.value;
        return (
            <button
                key={option.value}
                type="button"
                onClick={() => handleTabClick(option.value)}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                    transition-colors flex items-center gap-1.5 whitespace-nowrap
                    ${isActive
                        ? "bg-sky-500 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
            >
                {option.label}
                {count !== null && count !== undefined && (
                    <span className={`text-xs font-bold ${isActive ? "opacity-90" : "opacity-70"}`}>
                        {count}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="flex-1 space-y-4">
            {/* <PaymentSummaryCards/> */}

            {/* Tab Navigation - Custom Tailwind buttons */}
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 pb-1 sm:pb-0">
                    {/* Admin Tabs */}
                    {adminTabsFiltered.length > 0 && (
                        <>
                            {adminTabsFiltered.map(renderTabButton)}
                            {/* Separator */}
                            <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                        </>
                    )}
                    {/* CEO Pending Tab (CEO user only) */}
                    {ceoTabsFiltered.length > 0 && (
                        <>
                            {ceoTabsFiltered.map(renderTabButton)}
                            <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                        </>
                    )}
                    {/* New Payments Tab */}
                    {newPaymentsTabsFiltered.length > 0 && (
                        <>
                            {newPaymentsTabsFiltered.map(renderTabButton)}
                            <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                        </>
                    )}
                    {/* Tab four -- Payment Done / Reconciliation Pending */}
                    {reconciliationTabsFiltered.length > 0 && (
                        <>
                            {reconciliationTabsFiltered.map(renderTabButton)}
                            <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                        </>
                    )}
                    {/* Payment Type Tabs */}
                    {paymentTypeTabsFiltered.length > 0 && (
                        <>
                            {paymentTypeTabsFiltered.map(renderTabButton)}
                        </>
                    )}
                    {/* Payment By Me -- the viewer's own rows, every status */}
                    {paymentTypeTabsFiltered.length > 0 && (
                        <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                    )}
                    {byMeTabsFiltered.map(renderTabButton)}
                    {/*
                      PO Wise and All Payments are HIDDEN from the strip (owner 2026-09-15).
                      Their BUTTONS are gone; their ROUTES below are not. `paymentHref()` sends
                      every non-paid payment deep link to `?tab=All Payments`, and dropping the
                      route would turn those links into an empty default view instead of the row
                      they point at. Restoring either tab = re-adding its `.map(renderTabButton)`.
                    */}
                </div>
            </div>
            <Suspense fallback={
                <LoadingFallback />
            }>
                {
                    tab === PP_TABS.APPROVE_PAYMENTS ? (
                        canApprovePayments ? (
                            <ApprovePayments />
                        ) : (
                            // Reachable only via a hand-edited / bookmarked `?tab=Approve Payments`
                            // URL -- the tab button is not rendered for these roles.
                            <Alert variant="default" className="border-blue-200 bg-blue-50 mb-4">
                                <Info className="h-4 w-4 text-blue-600" />
                                <AlertDescription className="text-sm text-blue-800">
                                    Payment approvals are restricted to admins. Contact an admin for urgent cases.
                                </AlertDescription>
                            </Alert>
                        )
                    ) : tab === PP_TABS.CEO_PENDING ? (
                        <ApprovePayments mode="ceo" readOnly={!isCEO} />
                    ) : ((tab === PP_TABS.NEW_PAYMENTS && !canSettlePayments) || (tab === PP_TABS.RECONCILIATION_PENDING && !canViewReconciliation)) ? (
                        // Reachable only via a hand-edited / bookmarked `?tab=` URL -- the tab
                        // buttons are not rendered for these roles (PMO removed 2026-09-17).
                        role === "Loading" ? <LoadingFallback /> : (
                            <Alert variant="default" className="border-blue-200 bg-blue-50 mb-4">
                                <Info className="h-4 w-4 text-blue-600" />
                                <AlertDescription className="text-sm text-blue-800">
                                    Marking payments as paid or reconciled is restricted to admins and accountants.
                                </AlertDescription>
                            </Alert>
                        )
                    ) :

                        [PP_TABS.NEW_PAYMENTS].includes(tab as any) ?
                            (
                                <AccountantTabs />
                            ) : [PP_TABS.PAYMENTS_PENDING, PP_TABS.PAYMENTS_DONE, PP_TABS.ALL_PAYMENTS, PP_TABS.RECONCILIATION_PENDING, PP_TABS.PAYMENT_BY_ME].includes(tab as any) ? (
                                <AllPayments tab={tab} />
                            )
                                : (
                                    <ProjectPaymentsList />
                                )
                }
            </Suspense >

            {/*
              The "Expense Request" dropdown in the top bar (renderRightActionButton.tsx)
              only flips these two zustand flags. Both dialogs are bare controlled
              AlertDialogs that render no trigger of their own and were mounted ONLY on
              their own list pages -- so without these two lines the button would look
              wired and do nothing.

              `projectId` is deliberately OMITTED: this page has no project in scope, and
              with it absent the dialog renders its own ProjectSelect. The two take
              differently-named callbacks (`onSuccess` vs `refetchList`), so they cannot
              share one prop even though both point at the same refresh.
            */}
            <NewProjectExpenseDialog onSuccess={handleExpenseCreated} />
            <NewNonProjectExpense refetchList={handleExpenseCreated} />
        </div >
    );
};