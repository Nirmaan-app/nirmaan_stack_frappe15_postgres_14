// src/pages/ExpenseRequests/components/ReviewActionDialog.tsx
//
// Confirm an Approve or a Reject — and SHOW WHAT IS BEING DECIDED.
//
// The reviewer is authorising money and, on approve, creating a ledger row they will never
// see again from this screen. A confirm dialog that names only the type and the amount asks
// them to take the request on trust; the format answers ARE the request, so they belong here.
//
// The answers come from the server pre-labelled (`detail`), built by the SAME walk that
// writes the ledger description — so what the reviewer approves and what lands on the
// expense can never describe the request differently.

import React, { useEffect, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { AlertTriangle, ArrowRight, Paperclip } from "lucide-react";

import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import SITEURL from "@/constants/siteURL";
import { attachmentsFromSourceData } from "@/utils/expenseFormat";
import { getFrappeError } from "@/utils/frappeErrors";
import type { ExpenseRequest } from "@/types/NirmaanStack/ExpenseRequest";

export type ReviewAction = "approve" | "reject";

interface SimilarEntry {
    name: string;
    amount: number;
    status: string;
    period_from?: string | null;
    period_to?: string | null;
    context?: string;
    overlaps?: boolean;
}
interface SimilarResponse {
    /** ⚠️ `history` is returned by the endpoint but DELIBERATELY NOT RENDERED (owner,
     *  2026-08-20). The per-person strip is parked until the shape of a spend summary is
     *  decided — see the separate plan. The overlapping warning stays: it is the only thing
     *  that can still surface a duplicate pair raised BEFORE the submission guard existed. */
    subject: string;
    has_period_check: boolean;
    overlapping: SimilarEntry[];
    history: SimilarEntry[];
    nearby: { doctype: string; name: string; amount: number; status: string; on: string }[];
}

interface Props {
    action: ReviewAction | null;
    request: ExpenseRequest | null;
    /** The server-enriched twin of `request` (detail + target ledger), when available. */
    enriched?: ExpenseRequest | null;
    /** Resolves a user id (an email) to their full name -- the page owns the master. */
    getUserName?: (id?: string) => string;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}

/** One line of the history strip: a period, an amount, an id, a state. */
const HistoryLine: React.FC<{ e: SimilarEntry }> = ({ e }) => (
    <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 text-sm ${
        e.overlaps ? "font-medium text-amber-800 dark:text-amber-300" : ""}`}>
        <span className="tabular-nums">
            {e.period_from ? formatDate(e.period_from) : "—"}
            {e.period_to && e.period_to !== e.period_from && ` – ${formatDate(e.period_to)}`}
        </span>
        <span className="tabular-nums">{formatToRoundedIndianRupee(e.amount)}</span>
        <span className="text-muted-foreground">{e.name}</span>
        <span className="text-muted-foreground">{e.status}</span>
        {e.context && <span className="text-xs text-muted-foreground">{e.context}</span>}
        {e.overlaps && <span className="text-xs">&larr; overlaps this request</span>}
    </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 py-1 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="min-w-0 break-words">{children}</span>
    </div>
);

export const ReviewActionDialog: React.FC<Props> = ({
    action, request, enriched, getUserName, onOpenChange, onDone,
}) => {
    const { toast } = useToast();
    const [comment, setComment] = useState("");
    const [busy, setBusy] = useState(false);

    const { call: approve } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.review.approve_expense_request");
    const { call: reject } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.review.reject_expense_request");

    useEffect(() => { if (action) setComment(""); }, [action, request?.name]);

    const isReject = action === "reject";
    const blocked = busy || (isReject && !comment.trim());

    // MERGED, not picked. The two carry different things: the table row is fetched through
    // the data table, which injects `projects_name` from LINK_FIELD_MAP, while the scoped
    // endpoint carries `detail` + `target_doctype`. Taking the enriched one alone dropped the
    // project NAME and left the dialog showing a bare project id.
    const r = enriched && request ? { ...request, ...enriched } : (enriched ?? request);
    const detail = enriched?.detail ?? [];
    const attachments = attachmentsFromSourceData(enriched?.source_data);

    // Read-only, and fetched ONLY while the dialog is open -- the reviewer is the control
    // point, so this is where it earns its cost. `undefined` vs `null` as the swrKey is the
    // conditional-fetch idiom; `{ enabled }` would break SWR deduplication.
    const { data: similarData } = useFrappeGetCall<{ message: SimilarResponse }>(
        "nirmaan_stack.api.expense_requests.similar.get_similar",
        { name: request?.name },
        request?.name && action ? `exr_similar_${request.name}` : null
    );
    const similar = similarData?.message;
    // Fall back to deriving it only if the server did not say -- it is authoritative.
    // Both come from the server: which ledger, and what status it will be born at.
    const targetStatus = enriched?.target_status ?? "Approved";
    const landsApproved = targetStatus === "Approved";
    const ledger = enriched?.target_doctype
        ?? (request?.projects ? "Project Expenses" : "Non Project Expenses");

    const run = async () => {
        if (!request || !action || blocked) return;
        setBusy(true);
        try {
            if (isReject) {
                await reject({ name: request.name, comment: comment.trim() });
                toast({ title: "Rejected", description: request.name, variant: "success" });
            } else {
                const res = await approve({ name: request.name });
                const out = (res as any)?.message;
                toast({
                    title: "Approved",
                    description: `Created ${out?.created_expense} in ${out?.created_expense_doctype}.`,
                    variant: "success",
                });
            }
            onOpenChange(false);
            onDone();
        } catch (e: any) {
            toast({
                title: isReject ? "Could not reject" : "Could not approve",
                description: getFrappeError(e),
                variant: "destructive",
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <AlertDialog open={!!action && !!request} onOpenChange={(o) => !o && onOpenChange(false)}>
            <AlertDialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {isReject ? "Reject" : "Approve"} {request?.name}
                    </AlertDialogTitle>
                </AlertDialogHeader>

                <div className="rounded border bg-muted/30 px-3 py-2 divide-y">
                    <Row label="Expense Type">{r?.type}</Row>
                    <Row label="Amount">
                        <span className="font-semibold">
                            {formatToRoundedIndianRupee(r?.amount ?? 0)}
                        </span>
                    </Row>
                    <Row label="Project">
                        {r?.projects
                            ? <>{r.projects_name || r.projects}
                                {r.projects_name && (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                        {r.projects}
                                    </span>
                                )}</>
                            : <span className="text-muted-foreground">-- non-project --</span>}
                    </Row>
                    <Row label="Raised by">
                        {getUserName?.(r?.owner) || r?.owner}
                        {r?.creation ? ` \u00b7 ${formatDate(r.creation)}` : ""}
                        {getUserName && getUserName(r?.owner) !== r?.owner && (
                            <span className="block text-xs text-muted-foreground">{r?.owner}</span>
                        )}
                    </Row>
                    {r?.comment && <Row label="Comment">{r.comment}</Row>}
                </div>

                {detail.length > 0 && (
                    <div className="rounded border px-3 py-2 divide-y">
                        <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Request details
                        </p>
                        {detail.map((d, i) => (
                            <Row key={i} label={d.label || "—"}>{d.value}</Row>
                        ))}
                    </div>
                )}

                {(similar?.overlapping?.length ?? 0) > 0 && (
                    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
                        <p className="flex items-center gap-1.5 pb-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Already requested for this period
                        </p>
                        {similar!.overlapping.map((e) => <HistoryLine key={e.name} e={e} />)}
                    </div>
                )}

                {(similar?.nearby?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                        {similar!.nearby.length} expense{similar!.nearby.length > 1 ? "s" : ""} of
                        this type and amount recorded in the last 60 days
                        {similar!.has_period_check ? "" : " — this type declares no period, so the dates are not compared"}.
                    </p>
                )}

                {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                        {attachments.map((url) => (
                            <a key={url} href={SITEURL + url} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1 text-sm text-primary hover:underline">
                                <Paperclip className="h-3.5 w-3.5" /> View attachment
                            </a>
                        ))}
                    </div>
                )}

                <Separator />

                {isReject ? (
                    <div className="space-y-1.5">
                        <Label>Reason <span className="text-destructive">*</span></Label>
                        <Textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Why is this being rejected? The requester sees only this."
                        />
                        <p className="text-xs text-muted-foreground">
                            Rejection is final — a rejected request cannot be approved later.
                        </p>
                    </div>
                ) : (
                    <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                        <p className="flex flex-wrap items-center gap-1.5">
                            <span>Approving creates</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                            <span className="font-medium">{ledger}</span>
                            <span>at status</span>
                            {/* ⚠️ SERVER-RESOLVED. The status depends on the amount, and the
                                threshold lives on the ledger doctypes -- a copy of it here
                                would be free to disagree with what `validate` actually does. */}
                            <span className="font-medium">{targetStatus}</span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {landsApproved
                                ? "The answers above are written onto it, the bill is carried across, and the accountant marks it Paid. Money moves at that step, not this one."
                                : "The answers above are written onto it and the bill is carried across — but this amount still needs the expense itself to be approved before it can be paid. Money moves at that step, not this one."}
                        </p>
                    </div>
                )}

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(e) => { e.preventDefault(); run(); }}
                        disabled={blocked}
                        className={isReject ? "bg-destructive hover:bg-destructive/90" : undefined}
                    >
                        {busy ? <TailSpin color="white" height={18} width={18} />
                            : isReject ? "Reject" : "Approve"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default ReviewActionDialog;
