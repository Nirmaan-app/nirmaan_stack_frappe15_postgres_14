/**
 * Reimbursements (owner, 2026-10-21/22): a Nirmaan user's claims to be repaid money they spent for work. Every step
 * of a claim is here (ADR-0040 Amendment C, owner 2026-11-18); its Non-Project Expense is not in Project Payments.
 *
 * Tabs (`utils/reimbursements/rules.tabsFor`), kept in `?tab=`, laid out by `ReimbursementTabBar` (grouped HR / Admin /
 * Accounts for Admin and the CEO, a plain row for HR and Accounts), in order:
 * * Pending Approval -- new claims; HR, Admin and the CEO decide (the server's `can_decide`, `get_pending_for_me`).
 * * Pending L1 Approval -- HR approved at or above the monthly limit; Admin or the CEO decide.
 * * Pending CEO Approval -- Admin approved above ₹50,000; only the CEO sees it.
 * * Payment need to be paid -- Admin and Accounts: Export for Payment, Mark as Paid.
 * * Reconciliation Pending -- Admin and Accounts: Mark Reconciled (UTR and proof), which turns the claim Paid.
 * * Paid · Reimbursement Raised By Me (everyone; Edit / Delete their own) · All (rejected claims included).
 * Admin, Accounts and HR see every tab but the CEO's; the CEO sees all eight; everyone else only Raised By Me.
 * Each badge is the number of rows the tab lists (`queue.get_claim_tab_counts`). Paid and All have a month picker
 * with the month's totals for Admin, HR and Accounts, kept in `?reimb_<tab>_month=` (`utils/reimbursements/claimMonth`).
 *
 * The header's right action, "Raise Reimbursement", flips `newReimbursementDialog`; the dialog is mounted here. The
 * server is the boundary for every read and write (`api/reimbursements`, `api/approvals/expense_actions`); these tabs
 * only decide what renders.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";

import { useToast } from "@/components/ui/use-toast";
import { CEO_AUTHORIZED_USER } from "@/constants/ceoHold";
import { useUserData } from "@/hooks/useUserData";
import { UpdatePaymentDetailsDialog as NonProjectExpensePayDialog } from "@/pages/NonProjectExpenses/components/UpdatePaymentDetailsDialog";
import type { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import type { NonProjectExpenses } from "@/types/NirmaanStack/NonProjectExpenses";
import type { ClaimRow, ClaimTabCounts, PendingReimbursement } from "@/types/NirmaanStack/Reimbursement";
import { raiserLevelOf } from "@/utils/approvalTiers";
import { filtersByMonth, resolveMonth } from "@/utils/reimbursements/claimMonth";
import type { ApprovalStage } from "@/utils/reimbursements/monthLimit";
import {
    SELECTABLE_TABS,
    TAB_CEO,
    TAB_L1,
    TAB_LABELS,
    TAB_PENDING,
    actsOn,
    claimantName,
    groupsTabs,
    isReimbursementAdmin,
    resolveTab,
    tabsFor,
    type ReimbursementTab,
    type Viewer,
} from "@/utils/reimbursements/rules";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDialogStore } from "@/zustand/useDialogStore";

import { BulkDecisionDialog } from "./components/BulkDecisionDialog";
import { ClaimDetailSheet } from "./components/ClaimDetailSheet";
import { ClaimsTable } from "./components/ClaimsTable";
import { DecisionDialog, type Decision } from "./components/DecisionDialog";
import { DeleteClaimDialog } from "./components/DeleteClaimDialog";
import { ExportForPaymentDialog, MarkPaidDialog } from "./components/PayoutDialogs";
import { RaiseReimbursementDialog } from "./components/RaiseReimbursementDialog";
import { ReimbursementTabBar } from "./components/ReimbursementTabBar";
import { useRefreshClaimPayments } from "./hooks/useClaimPayments";
import type { DecisionOutcome } from "./hooks/useClaimDecisions";

const PENDING_API = "nirmaan_stack.api.reimbursements.review.get_pending_for_me";
const COUNTS_API = "nirmaan_stack.api.reimbursements.queue.get_claim_tab_counts";

const isApprovalStage = (tab: ReimbursementTab): tab is ApprovalStage =>
    tab === TAB_PENDING || tab === TAB_L1 || tab === TAB_CEO;

export default function ReimbursementsPage() {
    const { role, user_id } = useUserData();
    const viewer = useMemo<Viewer>(() => ({ role, userId: user_id }), [role, user_id]);
    // While the profile loads, the tab set isn't known yet: hold rather than open a tab the person can't see.
    if (role === "Loading") return null;
    return <Reimbursements viewer={viewer} />;
}

function Reimbursements({ viewer }: { viewer: Viewer }) {
    const { toast } = useToast();
    const userId = viewer.userId ?? "";
    const tabs = useMemo(() => tabsFor(viewer), [viewer]);
    const decidesNew = actsOn(TAB_PENDING, viewer);
    const deciderLevel = raiserLevelOf(viewer.role, viewer.userId, CEO_AUTHORIZED_USER);
    const [tab, setTab] = useState<ReimbursementTab>(() => resolveTab(urlStateManager.getParam("tab"), viewer));
    // Bumped after any change, to remount the open table so it refetches (and drops its ticks).
    const [reload, setReload] = useState(0);
    // The picked month on Paid and All, per tab, from the address (the current month when none).
    const byMonth = filtersByMonth(tab, viewer);
    const [months, setMonths] = useState<Record<string, string>>({});
    const month = byMonth ? (months[tab] ?? resolveMonth(urlStateManager.getParam(`reimb_${tab}_month`), tab)) : undefined;
    const changeMonth = useCallback((next: string) => {
        setMonths((m) => ({ ...m, [tab]: next }));
        urlStateManager.updateParam(`reimb_${tab}_month`, next);
    }, [tab]);

    // Back / forward between tabs.
    useEffect(() => urlStateManager.subscribe("tab", (_, value) => setTab(resolveTab(value, viewer))), [viewer]);

    const openTab = useCallback((value: ReimbursementTab) => {
        setTab(value);
        urlStateManager.updateParam("tab", value);
    }, []);

    const { data: users } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", { fields: ["name", "full_name"], limit: 0 });
    const getUserName = useCallback(
        memoize((id?: string | null) => users?.find((u) => u.name === id)?.full_name || id || "--"),
        [users],
    );
    const nameOf = useCallback((r: ClaimRow) => claimantName(r, getUserName), [getUserName]);

    // Who may decide each new claim: the server's `can_decide` (HR can't decide an HR-raised claim).
    const { data: pendingData, mutate: mutatePending } =
        useFrappeGetCall<{ message: PendingReimbursement[] }>(PENDING_API, undefined, decidesNew ? `reimb_pending:${userId}` : null);
    const pending = useMemo(() => new Map((pendingData?.message ?? []).map((r) => [r.name, r])), [pendingData]);

    const { data: countsData, mutate: mutateCounts } =
        useFrappeGetCall<{ message: ClaimTabCounts }>(COUNTS_API, undefined, `reimb_tab_counts:${userId}`);
    const counts = countsData?.message ?? {};

    // An approve creates a claim's expense and a delete removes it, but neither changes the claims on screen, so the
    // payments cached for them are refreshed explicitly (code review finding 5).
    const refreshPayments = useRefreshClaimPayments();
    const refreshAll = useCallback(() => {
        setReload((n) => n + 1);
        mutateCounts();
        refreshPayments();
        if (decidesNew) mutatePending();
    }, [mutateCounts, mutatePending, refreshPayments, decidesNew]);

    // What this person may do on a row of the open tab. The server decides; this only picks the buttons.
    const actsHere = actsOn(tab, viewer);
    const canAct = useCallback((r: ClaimRow) => {
        if (!actsHere) return false;
        if (tab === TAB_PENDING) return !!pending.get(r.name)?.can_decide;
        return !!r.expense;
    }, [actsHere, tab, pending]);
    const cannotActReason = useCallback((r: ClaimRow) => {
        if (tab === TAB_PENDING) {
            // Until the server has said who decides what, say so rather than "you can't" (browser walk 2026-11-19).
            if (!pendingData) return "Checking who can decide...";
            return pending.get(r.name)?.cannot_decide_reason ?? "You can't decide this claim.";
        }
        if (tab === TAB_CEO) return "Only the CEO approves here.";
        if (tab === TAB_L1) return "Only Admin or the CEO approves here.";
        return "Only Admin or Accounts can pay a claim.";
    }, [tab, pending, pendingData]);
    const selectable = actsHere && SELECTABLE_TABS.includes(tab);

    // Dialog and sheet state. Each holds a claim NAME or a snapshot it only reads before acting.
    const { newReimbursementDialog, setNewReimbursementDialog } = useDialogStore();
    const [editingName, setEditingName] = useState<string | null>(null);
    const [openName, setOpenName] = useState<string | null>(null);
    // Closing a dialog clears only its open flag: its claim stays, so it keeps showing while it animates out.
    const [decision, setDecision] = useState<{ action: Decision; claim: ClaimRow; stage: ApprovalStage } | null>(null);
    const [decisionOpen, setDecisionOpen] = useState(false);
    const [bulk, setBulk] = useState<{ action: Decision; rows: ClaimRow[]; stage: ApprovalStage } | null>(null);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [paying, setPaying] = useState<ClaimRow[]>([]);
    const [payOpen, setPayOpen] = useState(false);
    const [exporting, setExporting] = useState<ClaimRow[]>([]);
    const [exportOpen, setExportOpen] = useState(false);
    const [clearTicks, setClearTicks] = useState(0);
    const [reconciling, setReconciling] = useState<ClaimRow | null>(null);
    const [deleting, setDeleting] = useState<ClaimRow | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);
    // Mark Reconciled opens the Non-Project Expense pay dialog, which wants the stored expense.
    const { data: reconcileExpense } = useFrappeGetDoc<NonProjectExpenses>(
        "Non Project Expenses", reconciling?.expense ?? undefined, reconciling?.expense ? undefined : null,
    );

    const formOpen = newReimbursementDialog || !!editingName;
    const closeForm = (open: boolean) => {
        if (open) return;
        setNewReimbursementDialog(false);
        setEditingName(null);
    };

    const onOpen = useCallback((r: ClaimRow) => setOpenName(r.name), []);
    const onEdit = useCallback((r: ClaimRow) => { setOpenName(null); setEditingName(r.name); }, []);
    const onDelete = useCallback((r: ClaimRow) => { setDeleting(r); setDeleteOpen(true); }, []);
    const onDecide = useCallback((action: Decision, claim: ClaimRow) => {
        if (!isApprovalStage(tab)) return;
        setDecision({ action, claim, stage: tab });
        setDecisionOpen(true);
    }, [tab]);
    const onBulkDecide = useCallback((action: Decision, rows: ClaimRow[]) => {
        if (!isApprovalStage(tab)) return;
        setBulk({ action, rows, stage: tab });
        setBulkOpen(true);
    }, [tab]);
    const onMarkPaid = useCallback((rows: ClaimRow[]) => { setPaying(rows); setPayOpen(true); }, []);
    const onExport = useCallback((rows: ClaimRow[]) => { setExporting(rows); setExportOpen(true); }, []);
    const onReconcile = useCallback((r: ClaimRow) => setReconciling(r), []);

    /** Say where each decided claim went. No "Open tab" button on the toast (owner, 2026-11-19). */
    const reportOutcome = useCallback((outcome: DecisionOutcome, verb: string) => {
        const { moved, failed } = outcome;
        if (moved.length) {
            const tabsReached = [...new Set(moved.map((m) => m.tab))];
            const where = (t: ReimbursementTab | null) => (t ? TAB_LABELS[t] : "All (rejected)");
            const target = tabsReached.length === 1 ? tabsReached[0] : null;
            toast({
                title: moved.length === 1 ? `${verb} ${moved[0].claim}` : `${verb} ${moved.length} claims`,
                description: tabsReached.length === 1
                    ? `Now in ${where(target)}.`
                    : `Now in: ${tabsReached.map((t) => `${where(t)} (${moved.filter((m) => m.tab === t).length})`).join(", ")}.`,
                variant: "success",
            });
        }
        if (failed.length) {
            toast({
                title: failed.length === 1 ? `${failed[0].claim} wasn't changed` : `${failed.length} claims weren't changed`,
                description: failed.map((f) => `${f.claim}: ${f.reason}`).join("\n"),
                variant: "destructive",
            });
        }
        setClearTicks((n) => n + 1);
        setOpenName(null);
        refreshAll();
    }, [toast, refreshAll]);

    return (
        <div className="flex-1 space-y-4">
            <div>
                <h1 className="text-xl font-semibold tracking-tight">Reimbursements</h1>
                <p className="text-sm text-muted-foreground">
                    Claim back money you spent for work.
                </p>
            </div>

            <ReimbursementTabBar tabs={tabs} active={tab} counts={counts} grouped={groupsTabs(viewer)} onOpen={(t) => openTab(t)} />

            <ClaimsTable
                // The month is in the key: the table refetches on its own filters, not on a changed request parameter.
                key={`${tab}:${reload}:${month ?? ""}`}
                tab={tab}
                userId={userId}
                getUserName={getUserName}
                onOpen={onOpen}
                onEdit={onEdit}
                onDelete={onDelete}
                isAdmin={isReimbursementAdmin(viewer)}
                selectable={selectable}
                canAct={canAct}
                cannotActReason={cannotActReason}
                onDecide={onDecide}
                onBulkDecide={onBulkDecide}
                onMarkPaid={onMarkPaid}
                onExport={onExport}
                onReconcile={onReconcile}
                clearTicks={clearTicks}
                month={month}
                onMonthChange={byMonth ? changeMonth : undefined}
            />

            <RaiseReimbursementDialog open={formOpen} onOpenChange={closeForm} editingName={editingName} onSaved={refreshAll} />
            <ClaimDetailSheet
                claimName={openName}
                onOpenChange={(open) => !open && setOpenName(null)}
                userId={userId}
                getUserName={getUserName}
                canDecide={(name) => decidesNew && !!pending.get(name)?.can_decide}
                onDecide={(action, claim) => {
                    setDecision({ action, claim, stage: TAB_PENDING });
                    setDecisionOpen(true);
                }}
                onEdit={onEdit}
                onDelete={(r) => { setOpenName(null); onDelete(r); }}
                isAdmin={isReimbursementAdmin(viewer)}
            />
            <DecisionDialog
                open={decisionOpen}
                decision={decision?.action ?? null}
                stage={decision?.stage ?? TAB_PENDING}
                claim={decision?.claim ?? null}
                claimantName={decision ? nameOf(decision.claim) : ""}
                isOwn={decision?.claim.owner === userId}
                deciderLevel={deciderLevel}
                onOpenChange={setDecisionOpen}
                onDone={(outcome) => reportOutcome(outcome, decision?.action === "reject" ? "Rejected" : "Approved")}
            />
            <BulkDecisionDialog
                open={bulkOpen}
                decision={bulk?.action ?? null}
                stage={bulk?.stage ?? TAB_PENDING}
                rows={bulk?.rows ?? []}
                claimantName={nameOf}
                deciderLevel={deciderLevel}
                onOpenChange={setBulkOpen}
                onDone={(outcome) => reportOutcome(outcome, bulk?.action === "reject" ? "Rejected" : "Approved")}
            />
            <MarkPaidDialog
                open={payOpen}
                rows={paying}
                onOpenChange={setPayOpen}
                onDone={(moved) => {
                    if (moved.length) {
                        toast({
                            title: "Now in Reconciliation Pending",
                            description: "Add the UTR and proof there (Mark Reconciled) to finish.",
                        });
                    }
                    setClearTicks((n) => n + 1);
                    refreshAll();
                }}
            />
            <ExportForPaymentDialog
                open={exportOpen}
                rows={exporting}
                onOpenChange={setExportOpen}
                onExported={() => setClearTicks((n) => n + 1)}
            />
            {reconciling && reconcileExpense && reconcileExpense.name === reconciling.expense && (
                <NonProjectExpensePayDialog
                    isOpen={!!reconciling}
                    setIsOpen={(open) => { if (!open) setReconciling(null); }}
                    expense={reconcileExpense}
                    markAsPaid
                    onSuccess={() => {
                        toast({ title: `${reconciling.name} is Paid`, description: "Its expense is reconciled, so the claim is Paid.", variant: "success" });
                        setReconciling(null);
                        refreshAll();
                    }}
                />
            )}
            <DeleteClaimDialog open={deleteOpen} claim={deleting} onOpenChange={setDeleteOpen} onDone={refreshAll} />
        </div>
    );
}
