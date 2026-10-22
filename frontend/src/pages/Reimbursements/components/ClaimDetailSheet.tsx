/**
 * One claim in full: the claim, where it will be paid, its receipts and its decision, with the actions this
 * person has on it. Holds the claim's NAME and reads the live claim, so it shows a decision the moment the
 * list refreshes.
 *
 * Approve / Reject show only when the server put the claim in this person's Pending Approval queue
 * (`canDecide`, from `review.get_pending_for_me`): who may decide is never re-derived here.
 */

import { useFrappeGetCall, useFrappeGetDoc } from "frappe-react-sdk";
import { Check, FileText, Paperclip, Pencil, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import { REIMBURSEMENT_DOCTYPE, type ClaimFile, type Reimbursement } from "@/types/NirmaanStack/Reimbursement";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { APPROVED, PENDING, REJECTED, claimantName, deleteProblem, editProblem, roleLabel } from "@/utils/reimbursements/rules";

import { STATUS_BADGE } from "../config/reimbursementColumns";
import { CLAIM_FILES_API } from "./RaiseReimbursementDialog";
import type { Decision } from "./DecisionDialog";

interface Props {
    claimName: string | null;
    onOpenChange: (open: boolean) => void;
    userId: string;
    getUserName: (id?: string | null) => string;
    canDecide: (name: string) => boolean;
    onDecide: (decision: Decision, claim: Reimbursement) => void;
    onEdit: (claim: Reimbursement) => void;
    onDelete: (claim: Reimbursement) => void;
}

export function ClaimDetailSheet({ claimName, onOpenChange, userId, getUserName, canDecide, onDecide, onEdit, onDelete }: Props) {
    const { data: claim } = useFrappeGetDoc<Reimbursement>(REIMBURSEMENT_DOCTYPE, claimName ?? undefined, claimName ? undefined : null);
    const { data: filesData } = useFrappeGetCall<{ message: ClaimFile[] }>(
        CLAIM_FILES_API, { name: claimName }, claimName ? `reimb_files:${claimName}` : null,
    );
    const files = filesData?.message ?? [];
    const isClaimant = claim?.owner === userId;

    return (
        <Sheet open={!!claimName} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
                {!claim ? (
                    <p className="p-6 text-sm text-muted-foreground">Loading the claim...</p>
                ) : (
                    <>
                        <SheetHeader className="border-b px-6 py-4 text-left">
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-sm text-muted-foreground">{claim.name}</span>
                                <span className={cn("rounded px-2 py-0.5 text-xs font-medium", STATUS_BADGE[claim.status])}>{claim.status}</span>
                            </div>
                            <SheetTitle className="text-lg">{claim.title}</SheetTitle>
                            <SheetDescription className="text-2xl font-semibold tabular-nums text-foreground">
                                {formatToIndianRupee(claim.amount)}
                            </SheetDescription>
                        </SheetHeader>

                        <div className="flex flex-1 flex-col gap-5 px-6 py-5">
                            {claim.status === PENDING && (
                                <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                                    Waiting for a decision.
                                </div>
                            )}
                            {claim.status === APPROVED && (
                                <div className="rounded-md bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
                                    <span className="font-semibold">Approved by {getUserName(claim.approved_by)}</span>
                                </div>
                            )}
                            {claim.status === REJECTED && (
                                <div className="rounded-md bg-red-50 px-3 py-2.5 text-sm text-red-900">
                                    <p className="font-semibold">Rejected</p>
                                    <p className="mt-0.5">{claim.rejection_reason}</p>
                                </div>
                            )}

                            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                                <dt className="text-muted-foreground">Claimant</dt>
                                <dd>
                                    {claimantName(claim, getUserName)}
                                    <span className="block text-xs text-muted-foreground">
                                        {claim.claimant_role ? `${roleLabel(claim.claimant_role)} · ` : ""}{claim.owner}
                                    </span>
                                </dd>
                                <dt className="text-muted-foreground">Raised on</dt>
                                <dd>{formatDate(claim.creation)}</dd>
                                <dt className="text-muted-foreground">Description</dt>
                                <dd className="whitespace-pre-wrap break-words">{claim.description || <span className="text-muted-foreground">None</span>}</dd>
                            </dl>

                            <section>
                                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pay to</h4>
                                <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md border p-3 text-sm">
                                    <dt className="text-muted-foreground">Account holder</dt><dd>{claim.pay_to_account_name}</dd>
                                    <dt className="text-muted-foreground">Account number</dt><dd className="font-mono">{claim.pay_to_account_number}</dd>
                                    <dt className="text-muted-foreground">IFSC</dt><dd className="font-mono">{claim.pay_to_ifsc}</dd>
                                    <dt className="text-muted-foreground">Bank</dt><dd>{claim.pay_to_bank_name}</dd>
                                    <dt className="text-muted-foreground">Branch</dt><dd>{claim.pay_to_bank_branch}</dd>
                                </dl>
                                <p className="mt-1.5 text-xs text-muted-foreground">Copied from the claimant's bank account when the claim was raised.</p>
                            </section>

                            <section>
                                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receipts</h4>
                                {files.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No receipts.</p>
                                ) : (
                                    <ul className="flex flex-col gap-1.5">
                                        {files.map((f) => (
                                            <li key={f.file_url}>
                                                <a href={`${SITEURL}${f.file_url}`} target="_blank" rel="noreferrer"
                                                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                                                    {f.is_receipts_pdf ? <FileText className="h-4 w-4 text-primary" /> : <Paperclip className="h-4 w-4 text-muted-foreground" />}
                                                    <span className="min-w-0 flex-1 truncate">{f.is_receipts_pdf ? "Receipts PDF" : f.file_name}</span>
                                                    <span className="text-xs text-muted-foreground">Open</span>
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-3">
                            {isClaimant && !deleteProblem(claim.status, true) && (
                                <Button variant="ghost" className="text-red-600" onClick={() => onDelete(claim)}>
                                    <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                                </Button>
                            )}
                            {isClaimant && !editProblem(claim.status, true) && (
                                <Button variant="outline" onClick={() => onEdit(claim)}>
                                    <Pencil className="mr-1.5 h-4 w-4" /> Edit
                                </Button>
                            )}
                            {canDecide(claim.name) && (
                                <>
                                    <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => onDecide("reject", claim)}>
                                        <X className="mr-1.5 h-4 w-4" /> Reject
                                    </Button>
                                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onDecide("approve", claim)}>
                                        <Check className="mr-1.5 h-4 w-4" /> Approve
                                    </Button>
                                </>
                            )}
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
