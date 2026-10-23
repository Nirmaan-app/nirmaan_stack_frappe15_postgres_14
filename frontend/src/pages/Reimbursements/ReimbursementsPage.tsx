/**
 * Reimbursements (owner, 2026-10-21/22): a Nirmaan user's claims to be repaid money they spent for work.
 *
 * Tabs (`utils/reimbursements/rules.tabsFor`), kept in `?tab=`:
 * * All -- HR, Admin and Accounts: every claim, every status.
 * * Reimbursement Raised By Me -- everyone: their own claims; Edit while pending, Delete while pending or rejected.
 * * Pending Approval -- HR and Admin: every pending claim; Approve / Reject where the server says they may.
 * * Payment need to be paid (Approved) -- Admin, HR, Accounts: claims waiting on their Non-Project Expense,
 *   which Accounts pays from Project Payments & Expenses (ADR-0040), with where each payment is.
 * * Paid -- Admin, HR, Accounts: claims whose expense is Paid.
 * * Rejected -- Admin, HR, Accounts.
 *
 * The header's right action, "Raise Reimbursement", flips `newReimbursementDialog`; the dialog is mounted
 * here. The server is the boundary for every read and write (`api/reimbursements`,
 * `integrations/controllers/reimbursement.py`); these tabs only decide what renders.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";

import { useCounts } from "@/hooks/useCounts";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";
import type { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { REIMBURSEMENT_DOCTYPE, type PendingReimbursement, type Reimbursement } from "@/types/NirmaanStack/Reimbursement";
import {
    APPROVED,
    PAID,
    REJECTED,
    TAB_ALL,
    TAB_APPROVED,
    TAB_LABELS,
    TAB_MINE,
    TAB_PAID,
    TAB_PENDING,
    TAB_REJECTED,
    claimantName,
    resolveTab,
    tabsFor,
    type ReimbursementTab,
    type Viewer,
} from "@/utils/reimbursements/rules";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDialogStore } from "@/zustand/useDialogStore";

import { ClaimDetailSheet } from "./components/ClaimDetailSheet";
import { ClaimsTable } from "./components/ClaimsTable";
import { DecisionDialog, type Decision } from "./components/DecisionDialog";
import { DeleteClaimDialog } from "./components/DeleteClaimDialog";
import { RaiseReimbursementDialog } from "./components/RaiseReimbursementDialog";
import { useRefreshClaimPayments } from "./hooks/useClaimPayments";

const PENDING_API = "nirmaan_stack.api.reimbursements.review.get_pending_for_me";

export default function ReimbursementsPage() {
    const { role, user_id } = useUserData();
    const viewer = useMemo<Viewer>(() => ({ role, userId: user_id }), [role, user_id]);
    // While the profile loads, the tab set isn't known yet: hold rather than open a tab the person can't see.
    if (role === "Loading") return null;
    return <Reimbursements viewer={viewer} />;
}

function Reimbursements({ viewer }: { viewer: Viewer }) {
    const userId = viewer.userId ?? "";
    const tabs = useMemo(() => tabsFor(viewer), [viewer]);
    const decides = tabs.includes(TAB_PENDING);
    const [tab, setTab] = useState<ReimbursementTab>(() => resolveTab(urlStateManager.getParam("tab"), viewer));
    // Bumped after any change, to remount the open table so it refetches.
    const [reload, setReload] = useState(0);

    // Back / forward between tabs.
    useEffect(() => urlStateManager.subscribe("tab", (_, value) => setTab(resolveTab(value, viewer))), [viewer]);

    const openTab = (value: ReimbursementTab) => {
        setTab(value);
        urlStateManager.updateParam("tab", value);
    };

    const { data: users } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", { fields: ["name", "full_name"], limit: 0 });
    const getUserName = useCallback(
        memoize((id?: string | null) => users?.find((u) => u.name === id)?.full_name || id || "--"),
        [users],
    );

    const { data: pendingData, mutate: mutatePending } =
        useFrappeGetCall<{ message: PendingReimbursement[] }>(PENDING_API, undefined, decides ? `reimb_pending:${userId}` : null);
    const pending = useMemo(() => pendingData?.message ?? [], [pendingData]);
    // The claims this person may decide: Approve / Reject show only for these (the server's `can_decide`).
    const pendingNames = useMemo(() => new Set(pending.filter((r) => r.can_decide).map((r) => r.name)), [pending]);
    const canDecide = useCallback((name: string) => pendingNames.has(name), [pendingNames]);
    const cannotDecideReason = useCallback(
        (name: string) => pending.find((r) => r.name === name)?.cannot_decide_reason,
        [pending],
    );

    const { data: countsData, mutate: mutateCounts } = useCounts(
        [
            { key: TAB_ALL, doctype: REIMBURSEMENT_DOCTYPE },
            { key: TAB_MINE, doctype: REIMBURSEMENT_DOCTYPE, filters: [["owner", "=", userId]] },
            { key: TAB_APPROVED, doctype: REIMBURSEMENT_DOCTYPE, filters: [["status", "=", APPROVED]] },
            { key: TAB_PAID, doctype: REIMBURSEMENT_DOCTYPE, filters: [["status", "=", PAID]] },
            { key: TAB_REJECTED, doctype: REIMBURSEMENT_DOCTYPE, filters: [["status", "=", REJECTED]] },
        ],
        `reimb_counts:${userId}`,
    );
    const counts: Partial<Record<ReimbursementTab, number>> = {
        [TAB_ALL]: tabs.includes(TAB_ALL) ? (countsData?.message?.[TAB_ALL] as number | undefined) : undefined,
        [TAB_MINE]: countsData?.message?.[TAB_MINE] as number | undefined,
        // Every pending claim, as the table lists them (HR's include the ones they can't decide).
        [TAB_PENDING]: decides ? pending.length : undefined,
        [TAB_APPROVED]: countsData?.message?.[TAB_APPROVED] as number | undefined,
        [TAB_PAID]: countsData?.message?.[TAB_PAID] as number | undefined,
        [TAB_REJECTED]: countsData?.message?.[TAB_REJECTED] as number | undefined,
    };

    // An approve creates a claim's expense and a delete removes it, but neither changes the claims on screen, so
    // the payments cached for them are refreshed explicitly (code review finding 5).
    const refreshPayments = useRefreshClaimPayments();
    const refreshAll = useCallback(() => {
        setReload((n) => n + 1);
        mutateCounts();
        refreshPayments();
        if (decides) mutatePending();
    }, [mutateCounts, mutatePending, refreshPayments, decides]);

    // Dialog and sheet state. Each holds a claim NAME or a snapshot it only reads before acting.
    const { newReimbursementDialog, setNewReimbursementDialog } = useDialogStore();
    const [editingName, setEditingName] = useState<string | null>(null);
    const [openName, setOpenName] = useState<string | null>(null);
    // Closing a decision or delete dialog clears only its open flag: the claim stays, so the dialog keeps
    // showing it while it animates out (clearing it flashed "Reject ?" / "Delete ?"). The next open replaces it.
    const [decision, setDecision] = useState<{ action: Decision; claim: Reimbursement } | null>(null);
    const [decisionOpen, setDecisionOpen] = useState(false);
    const [deleting, setDeleting] = useState<Reimbursement | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);

    const formOpen = newReimbursementDialog || !!editingName;
    const closeForm = (open: boolean) => {
        if (open) return;
        setNewReimbursementDialog(false);
        setEditingName(null);
    };

    const onOpen = useCallback((r: Reimbursement) => setOpenName(r.name), []);
    const onEdit = useCallback((r: Reimbursement) => { setOpenName(null); setEditingName(r.name); }, []);
    const onDelete = useCallback((r: Reimbursement) => { setDeleting(r); setDeleteOpen(true); }, []);
    const onDecide = useCallback((action: Decision, claim: Reimbursement) => {
        setDecision({ action, claim });
        setDecisionOpen(true);
    }, []);

    return (
        <div className="flex-1 space-y-4">
            <div>
                <h1 className="text-xl font-semibold tracking-tight">Reimbursements</h1>
                <p className="text-sm text-muted-foreground">
                    Claim back money you spent for work.
                </p>
            </div>

            {/* Pills, as the Payees page and Expense Requests show their tabs. */}
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Reimbursement tabs">
                {tabs.map((t) => {
                    const active = t === tab;
                    const count = counts[t];
                    return (
                        <button
                            key={t}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => openTab(t)}
                            className={cn(
                                "flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition-colors",
                                active ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                            )}
                        >
                            {TAB_LABELS[t]}
                            {count !== undefined && <b className="text-xs tabular-nums">{count}</b>}
                        </button>
                    );
                })}
            </div>

            <ClaimsTable
                key={`${tab}:${reload}`}
                tab={tab}
                userId={userId}
                getUserName={getUserName}
                onOpen={onOpen}
                onEdit={onEdit}
                onDelete={onDelete}
                canDecide={canDecide}
                cannotDecideReason={cannotDecideReason}
                onDecide={onDecide}
            />

            <RaiseReimbursementDialog open={formOpen} onOpenChange={closeForm} editingName={editingName} onSaved={refreshAll} />
            <ClaimDetailSheet
                claimName={openName}
                onOpenChange={(open) => !open && setOpenName(null)}
                userId={userId}
                getUserName={getUserName}
                canDecide={canDecide}
                onDecide={onDecide}
                onEdit={onEdit}
                onDelete={(r) => { setOpenName(null); onDelete(r); }}
            />
            <DecisionDialog
                open={decisionOpen}
                decision={decision?.action ?? null}
                claim={decision?.claim ?? null}
                claimantName={decision ? claimantName(decision.claim, getUserName) : ""}
                isOwn={decision?.claim.owner === userId}
                onOpenChange={setDecisionOpen}
                onDone={() => { setOpenName(null); refreshAll(); }}
            />
            <DeleteClaimDialog open={deleteOpen} claim={deleting} onOpenChange={setDeleteOpen} onDone={refreshAll} />
        </div>
    );
}
