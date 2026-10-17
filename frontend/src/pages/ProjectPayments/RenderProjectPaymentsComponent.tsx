import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
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
    PP_TABS, PP_ADMIN_TAB_OPTIONS, PP_CEO_TAB_OPTIONS, PP_NEW_PAYMENTS_TAB_OPTIONS, PP_RECONCILIATION_TAB_OPTIONS, PP_BY_ME_TAB_OPTIONS, PP_ALL_TAB_OPTIONS, PPTabOption, PPTabValue,
} from "./config/ppTabs.constants";
// Which tabs a viewer sees, where it lands and what it may open: one tested rule.
// PO Wise has no button (2026-09-15) but stays ROUTED below; so does All Payments for the
// viewers outside its audience (#1476).
import { paymentsTabSet, resolvePaymentsTab } from "./config/paymentsTabSet";
import { ChequeTrackerNote } from "./components/ChequeTrackerNote";

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
        message: {
            counts: Record<string, number>;
            amounts: Record<string, number>;
            by_me?: number;
            all?: number;
            /** The payments Reconciliation Pending leaves out: they wait in the Cheque Tracker (#1483). */
            cheque_tracker?: { payments: number; cheques: number };
        };
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

    // --- Tab State Management ---
    const tabSet = useMemo(() => paymentsTabSet({ role, userId: user_id }), [role, user_id]);
    // The tab bodies below gate on the same set as the buttons, since every tab is reachable
    // by a hand-edited `?tab=` URL.
    const canApprovePayments = tabSet.tabs.includes(PP_TABS.APPROVE_PAYMENTS);
    const isCEO = tabSet.tabs.includes(PP_TABS.CEO_PENDING);
    // Who may SETTLE a payment: Mark as Paid ("Payment need to paid").
    const canSettlePayments = tabSet.tabs.includes(PP_TABS.NEW_PAYMENTS);
    // Reconciliation Pending is also VIEWABLE by HR -- without the Mark Reconciled action,
    // which AllPayments drops for anyone who cannot settle.
    const canViewReconciliation = tabSet.tabs.includes(PP_TABS.RECONCILIATION_PENDING);

    const initialTab = useMemo(() => getUrlStringParam("tab", tabSet.defaultTab), [tabSet.defaultTab]);

    const [selectedTab, setTab] = useState<string>(initialTab);
    // ⚠️ A view-only viewer (HR) is held to its set, whatever the state or a hand-edited `?tab=`
    // says. Derived rather than forced into state, so it also holds while the role is loading.
    const tab = resolvePaymentsTab(tabSet, selectedTab);

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

    // --- Tab buttons: label + badge per tab. WHICH tabs show is `tabSet.tabs`. ---
    /** Replace a tab option's payments-only count with the union count. */
    const withUnionCount = useCallback(
        (opt: PPTabOption, status: string) => ({ ...opt, countValue: unionCount(status, opt.countValue ?? 0) }),
        [unionCount]
    );

    const tabButtons = useMemo((): Partial<Record<PPTabValue, PPTabOption>> => ({
        [PP_TABS.APPROVE_PAYMENTS]: withUnionCount(PP_ADMIN_TAB_OPTIONS[0], APPROVAL_STATUS.REQUESTED),
        [PP_TABS.CEO_PENDING]: withUnionCount(PP_CEO_TAB_OPTIONS[0], APPROVAL_STATUS.CEO_PENDING),
        [PP_TABS.NEW_PAYMENTS]: withUnionCount(PP_NEW_PAYMENTS_TAB_OPTIONS[0], APPROVAL_STATUS.APPROVED),
        // Tab four. Empty until the fulfil path writes the new status.
        [PP_TABS.RECONCILIATION_PENDING]: withUnionCount(PP_RECONCILIATION_TAB_OPTIONS[0], APPROVAL_STATUS.RECONCILIATION_PENDING),
        // Tab five. `Paid` now means RECONCILED -- the label says so.
        [PP_TABS.PAYMENTS_DONE]: {
            label: "Payment Done / Reconciliation Done",
            value: PP_TABS.PAYMENTS_DONE,
            countValue: unionCount(APPROVAL_STATUS.PAID, counts.pay.paid),
        },
        // "Payments Pending" is HIDDEN from the strip (owner, 2026-10-07) but stays ROUTED; its
        // old badge summed the requested, CEO pending and approved union counts.
        // "Payment By Me" -- the badge stays hidden until the count loads (`countValue`
        // undefined renders no badge) rather than flashing a 0.
        [PP_TABS.PAYMENT_BY_ME]: { ...PP_BY_ME_TAB_OPTIONS[0], countValue: queueCounts?.message?.by_me },
        // "All Payments" (#1476) -- all three ledgers, every status (`all`), the same rows the tab
        // lists; never the payments-only store count. Hidden until it loads, like "Payment By Me".
        [PP_TABS.ALL_PAYMENTS]: { ...PP_ALL_TAB_OPTIONS[0], countValue: queueCounts?.message?.all },
    }), [withUnionCount, unionCount, counts, queueCounts]);

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
                    {/*
                      One button per tab in `tabSet.tabs`, a separator between each. PO Wise
                      has no button (owner 2026-09-15) and All Payments has one only for its
                      audience (#1476), but both ROUTES below stay: `paymentHref()` sends every
                      non-paid payment deep link to `?tab=All Payments`.
                    */}
                    {tabSet.tabs.map((value, i) => {
                        const option = tabButtons[value];
                        if (!option) return null;
                        return (
                            <React.Fragment key={value}>
                                {i > 0 && <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />}
                                {renderTabButton(option)}
                            </React.Fragment>
                        );
                    })}
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
                                <>
                                    {tab === PP_TABS.RECONCILIATION_PENDING && (
                                        <ChequeTrackerNote role={role} waiting={queueCounts?.message?.cheque_tracker} />
                                    )}
                                    <AllPayments tab={tab} />
                                </>
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