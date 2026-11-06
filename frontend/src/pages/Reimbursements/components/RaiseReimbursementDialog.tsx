/**
 * Raise Reimbursement, and Edit while the claim is Pending Approval.
 *
 * Opened by the header's right action (the `newReimbursementDialog` store flag) or by Edit on a row
 * (`editingName`). The form mounts fresh each time it opens -- keyed on the claim, or "new" -- so its state
 * starts from the claim in a `useState` initialiser rather than an effect.
 *
 * Submit: every new receipt is uploaded loose (no doctype: claimants hold read only on the doctype), then
 * `raise_reimbursement` / `update_reimbursement` checks the account is the person's own, merges the PDFs
 * and pictures into one PDF and saves the claim (`api/reimbursements/claims.py`).
 *
 * While it submits nothing can change: every field is locked (a disabled fieldset, links included), Submit
 * runs once however fast it is clicked, and the dialog can't be closed (✕, Esc, outside click) until the
 * server answers -- so what is saved is exactly what was on screen.
 */

import { useEffect, useRef, useState } from "react";
import { useFrappeFileUpload, useFrappeGetCall, useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { Car, Loader2, MoreHorizontal, UtensilsCrossed, type LucideIcon } from "lucide-react";

import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import {
    REIMBURSEMENT_DOCTYPE,
    type ClaimFile,
    type OwnBankAccount,
    type Reimbursement,
} from "@/types/NirmaanStack/Reimbursement";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import {
    DESCRIPTION_REQUIRED_ABOVE,
    TYPES,
    descriptionRequired,
    type ReimbursementType,
} from "@/utils/reimbursements/rules";

import { BankAccountSection } from "./BankAccountSection";
import { ReceiptsSection } from "./ReceiptsSection";

const MY_ACCOUNT_API = "nirmaan_stack.api.reimbursements.bank_accounts.my_bank_account";
const RAISE_API = "nirmaan_stack.api.reimbursements.claims.raise_reimbursement";
const UPDATE_API = "nirmaan_stack.api.reimbursements.claims.update_reimbursement";
export const CLAIM_FILES_API = "nirmaan_stack.api.reimbursements.claims.get_claim_files";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The claim being edited; null raises a new one. */
    editingName: string | null;
    onSaved: () => void;
}

export function RaiseReimbursementDialog({ open, onOpenChange, editingName, onSaved }: Props) {
    const { data: claim } = useFrappeGetDoc<Reimbursement>(
        REIMBURSEMENT_DOCTYPE, editingName ?? undefined, open && editingName ? undefined : null,
    );
    const { data: filesData } = useFrappeGetCall<{ message: ClaimFile[] }>(
        CLAIM_FILES_API, { name: editingName }, open && editingName ? `reimb_files:${editingName}` : null,
    );
    const ready = !editingName || (claim?.name === editingName && !!filesData);
    // True while the form submits: closing is refused until the server answers.
    const [busy, setBusy] = useState(false);

    return (
        <Dialog open={open} onOpenChange={(next) => { if (next || !busy) onOpenChange(next); }}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"
                onEscapeKeyDown={(e) => busy && e.preventDefault()}
                onInteractOutside={(e) => busy && e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle>{editingName ? `Edit ${editingName}` : "Raise Reimbursement"}</DialogTitle>
                    <DialogDescription>
                        Claim back money you spent for work.
                    </DialogDescription>
                </DialogHeader>
                {open && ready ? (
                    <ReimbursementForm
                        key={editingName ?? "new"}
                        claim={editingName ? claim! : null}
                        existingFiles={filesData?.message ?? []}
                        onDone={() => { onSaved(); onOpenChange(false); }}
                        onCancel={() => onOpenChange(false)}
                        onBusyChange={setBusy}
                    />
                ) : (
                    <p className="py-10 text-center text-sm text-muted-foreground">Loading the claim...</p>
                )}
            </DialogContent>
        </Dialog>
    );
}

interface FormProps {
    claim: Reimbursement | null;
    existingFiles: ClaimFile[];
    onDone: () => void;
    onCancel: () => void;
    /** Tells the dialog the form is submitting, so it refuses to close. */
    onBusyChange: (busy: boolean) => void;
}

const TYPE_ICONS: Record<ReimbursementType, LucideIcon> = { Travel: Car, Food: UtensilsCrossed, Others: MoreHorizontal };

interface Errors {
    type?: string;
    title?: string;
    amount?: string;
    description?: string;
    payee?: string;
    receipts?: string;
    submit?: string;
}

function ReimbursementForm({ claim, existingFiles, onDone, onCancel, onBusyChange }: FormProps) {
    const { user_id, full_name } = useUserData();
    const { toast } = useToast();
    const { upload } = useFrappeFileUpload();
    const { call: raise } = useFrappePostCall<{ message: { name: string; reviewer: string } }>(RAISE_API);
    const { call: update } = useFrappePostCall<{ message: { name: string; reviewer: string } }>(UPDATE_API);
    const { data: accountData, isLoading: accountLoading, mutate: mutateAccount } =
        useFrappeGetCall<{ message: OwnBankAccount | null }>(MY_ACCOUNT_API, undefined, "reimb_my_account");
    // One account per person, so it is always the one paid into: an edit re-copies it onto the claim.
    const account = accountData?.message ?? null;

    // No default: the claimant picks what the claim was spent on.
    const [kind, setKind] = useState<ReimbursementType | null>(claim?.reimbursement_type ?? null);
    const [title, setTitle] = useState(claim?.title ?? "");
    const [description, setDescription] = useState(claim?.description ?? "");
    const [amount, setAmount] = useState(claim ? String(claim.amount) : "");
    const [files, setFiles] = useState<File[]>([]);
    const [removed, setRemoved] = useState<string[]>([]);
    const [errors, setErrors] = useState<Errors>({});
    const [saving, setSaving] = useState<"uploading" | "saving" | null>(null);
    // Set synchronously on the first click, before `saving` re-renders the button disabled.
    const submitting = useRef(false);
    const busy = saving !== null;
    useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
    useEffect(() => () => onBusyChange(false), [onBusyChange]);

    const amountValue = Number(amount);
    const needsDescription = descriptionRequired(amountValue);
    const keptCount = existingFiles.filter((f) => !removed.includes(f.file_url)).length;

    // A field's error goes as soon as that field changes, rather than waiting for the next submit.
    const clear = (field: keyof Errors) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

    const validate = (): Errors => {
        const e: Errors = {};
        if (!kind) e.type = "Pick the type of claim: Travel, Food or Others.";
        if (!title.trim()) e.title = "Enter a title.";
        if (!(amountValue > 0)) e.amount = "Enter an amount above ₹0.";
        if (needsDescription && !description.trim()) {
            e.description = `Add a description. It's needed for a claim above ₹${DESCRIPTION_REQUIRED_ABOVE.toLocaleString("en-IN")}.`;
        }
        if (!account) e.payee = "Add the bank account to be repaid into.";
        if (files.length + keptCount < 1) e.receipts = "Attach at least one receipt.";
        return e;
    };

    const submit = async () => {
        if (submitting.current) return;
        const found = validate();
        setErrors(found);
        if (Object.keys(found).length) return;
        submitting.current = true;
        try {
            setSaving("uploading");
            const urls: string[] = [];
            for (const file of files) {
                urls.push((await upload(file, { isPrivate: true })).file_url as string);
            }
            setSaving("saving");
            const args = {
                reimbursement_type: kind,
                title: title.trim(),
                description: description.trim(),
                amount: amountValue,
                payee: account?.name,
                file_urls: JSON.stringify(urls),
            };
            const res = claim
                ? await update({ ...args, name: claim.name, remove_file_urls: JSON.stringify(removed) })
                : await raise(args);
            toast({
                title: claim ? `Saved ${res.message.name}` : `Raised ${res.message.name}`,
                description: claim ? "Your changes are saved." : "It's waiting for approval.",
                variant: "success",
            });
            onDone();
        } catch (e) {
            setErrors({ submit: getFrappeError(e) });
        } finally {
            submitting.current = false;
            setSaving(null);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            {/* A disabled fieldset locks every control inside it; pointer-events also stops the links. */}
            <fieldset disabled={busy} aria-busy={busy}
                className={cn("flex min-w-0 flex-col gap-6", busy && "pointer-events-none select-none opacity-60")}>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Claim details */}
                <section className="flex flex-col gap-4" aria-labelledby="reimb-claim-heading">
                    <h3 id="reimb-claim-heading" className="text-sm font-semibold">Claim</h3>
                    <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {(full_name || user_id || "?").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 text-sm">
                            <p className="truncate font-medium">{full_name || user_id}</p>
                            <p className="truncate text-xs text-muted-foreground">{user_id} · from your login</p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label id="reimb-type-label">Type <span className="text-destructive">*</span></Label>
                        <div role="radiogroup" aria-labelledby="reimb-type-label" className="grid grid-cols-3 gap-2">
                            {TYPES.map((t) => {
                                const Icon = TYPE_ICONS[t];
                                const active = kind === t;
                                return (
                                    <button key={t} type="button" role="radio" aria-checked={active}
                                        onClick={() => { setKind(t); clear("type"); }}
                                        className={cn(
                                            "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                                            active ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-muted/60",
                                        )}>
                                        <Icon className="h-4 w-4" />
                                        {t}
                                    </button>
                                );
                            })}
                        </div>
                        {errors.type && <p className="text-xs text-destructive">{errors.type}</p>}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reimb-title">Title <span className="text-destructive">*</span></Label>
                        <Input id="reimb-title" value={title} maxLength={140} disabled={busy}
                            placeholder="e.g. Cab to Whitefield site" onChange={(e) => { setTitle(e.target.value); clear("title"); }} />
                        {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reimb-amount">Amount <span className="text-destructive">*</span></Label>
                        <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                            <Input id="reimb-amount" type="number" inputMode="decimal" min="0" step="0.01" value={amount}
                                disabled={busy} placeholder="0.00" className="pl-7 text-base font-medium tabular-nums"
                                onChange={(e) => { setAmount(e.target.value); clear("amount"); }} />
                        </div>
                        {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reimb-description">
                            Description {needsDescription && <span className="text-destructive">*</span>}
                        </Label>
                        <Textarea id="reimb-description" rows={3} value={description} disabled={busy}
                            placeholder={needsDescription ? "What was it for? Needed for a larger claim." : "What was it for?"}
                            onChange={(e) => { setDescription(e.target.value); clear("description"); }} />
                        {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
                    </div>
                </section>

                <ReceiptsSection
                    files={files}
                    onFilesChange={(next) => { setFiles(next); clear("receipts"); }}
                    existing={existingFiles}
                    removed={removed}
                    onRemovedChange={setRemoved}
                    disabled={busy}
                    error={errors.receipts}
                />
            </div>

            <BankAccountSection
                account={account}
                loading={accountLoading}
                onAdded={(added) => { mutateAccount({ message: added }, { revalidate: false }); clear("payee"); }}
                disabled={busy}
                error={errors.payee}
            />
            </fieldset>

            {errors.submit && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{errors.submit}</p>}

            <DialogFooter className="flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                    {amountValue > 0 ? <span className="font-semibold text-foreground">{formatToIndianRupee(amountValue)}</span> : "Fill in the claim to raise it."}
                </p>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
                    <Button onClick={submit} disabled={busy}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {saving === "uploading" ? "Uploading receipts..." : saving === "saving" ? "Merging receipts..." : claim ? "Save changes" : "Raise Reimbursement"}
                    </Button>
                </div>
            </DialogFooter>
        </div>
    );
}
