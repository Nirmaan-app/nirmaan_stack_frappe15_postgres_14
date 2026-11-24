/**
 * Payment need to be paid (ADR-0040 Amendment C point 4; owner 2026-11-18): Export for Payment and Mark as Paid on
 * the ticked claims, as Project Payments' "Payment need to paid" tab does them (`update-payment/AccountantTabs.tsx`),
 * on the claims' Non-Project Expenses:
 *
 * * Export for Payment -- the bank upload file (ICICI PAB_VENDOR or Cashfree, `bankUploadFile.buildBankFile`), with
 *   who each expense is paid to READ NOW (`get_paid_to`), so a claim with no account to pay into is left out and the
 *   toast names it. A reimbursement's expense is paid into the claimant's own account copied onto it.
 * * Mark as Paid -- `decide_expenses(..., "mark_done")`: Approved → Reconciliation Pending, the moment the money left.
 *   The UTR and proof come on Reconciliation Pending (Mark Reconciled), which moves the claim to Paid.
 *
 * Neither changes the claim itself; the claim turns Paid when its expense does (`expense_link`).
 */

import { useCallback, useState } from "react";
import { useFrappePostCall } from "@/lib/frappe";
import { Loader2 } from "lucide-react";

import { PAID_TO_API, type PaidTo } from "@/components/payees/paidToApi";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useExpenseDecision } from "@/hooks/useExpenseDecision";
import {
    ICICI_DEBIT_ACCOUNT, buildBankFile, describeLeftOut, type BankFileFormat, type BankFileRow,
} from "@/pages/ProjectPayments/bankUploadFile";
import type { ClaimRow } from "@/types/NirmaanStack/Reimbursement";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import { unpayableReason } from "@/utils/payees/paidTo";
import { toastList } from "@/utils/toastList";

const NPE = "Non Project Expenses";
/** A reimbursement's expense has no type (ADR-0040): it is paid into the claimant's account. */
const NO_TYPE = "";

/** Who each claim's expense is paid to, read now. */
function useReadPaidTo() {
    const { call } = useFrappePostCall<{ message: PaidTo[] }>(PAID_TO_API);
    return useCallback(
        async (rows: readonly ClaimRow[]): Promise<PaidTo[]> =>
            (await call({ rows: rows.map((r) => ({ doctype: NPE, name: r.expense as string })) })).message,
        [call],
    );
}

const totalOf = (rows: readonly ClaimRow[]) => rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

interface ExportProps {
    open: boolean;
    rows: readonly ClaimRow[];
    onOpenChange: (open: boolean) => void;
    /** After a file was saved: clear the ticks. */
    onExported: () => void;
}

export function ExportForPaymentDialog({ open, rows, onOpenChange, onExported }: ExportProps) {
    const { toast } = useToast();
    const readPaidTo = useReadPaidTo();
    const [format, setFormat] = useState<BankFileFormat>("icici");
    const [debitAccountNumber, setDebitAccountNumber] = useState(ICICI_DEBIT_ACCOUNT);
    const [paymentMode, setPaymentMode] = useState("IMPS");
    const [busy, setBusy] = useState(false);

    const exportFile = async () => {
        setBusy(true);
        try {
            const paidTo = await readPaidTo(rows);
            const bankRows = rows.map((r, i): BankFileRow => ({
                kind: "expense",
                name: r.expense as string,
                // An expense has no PO / SR: its own ID is the remark.
                documentName: r.expense as string,
                amount: r.amount,
                description: `${r.name} · ${r.title}`,
                expenseType: NO_TYPE,
                projectLabel: "Non Project",
                paidTo: paidTo[i],
            }));
            // ⚠️ THE BANK FILE IS NOT THE SELECTION: a claim with no account to pay into is left out, and said.
            const file = buildBankFile(bankRows, { format, paymentMode, debitAccountNumber, now: new Date() });
            const leftOut = describeLeftOut(file.leftOut);
            if (file.rows.length === 0) {
                toast({ title: "Nothing to export", description: `No selected claim can go in the bank file: ${leftOut.join("; ")}.`, variant: "destructive" });
                return;
            }
            const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv;charset=utf-8;" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = file.fileName;
            link.style.visibility = "hidden";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast({
                title: "Export Successful",
                description: `${file.rows.length} ${file.rows.length === 1 ? "claim" : "claims"} exported.`
                    + (leftOut.length ? ` Left out: ${leftOut.join("; ")}.` : ""),
                variant: leftOut.length ? "default" : "success",
            });
            onOpenChange(false);
            onExported();
        } catch (e) {
            toast({ title: "Export failed", description: getFrappeError(e), variant: "destructive" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-center">Export for Payment</DialogTitle>
                </DialogHeader>
                <p className="text-center text-sm text-muted-foreground">
                    {rows.length} {rows.length === 1 ? "claim" : "claims"} · {formatToRoundedIndianRupee(totalOf(rows))}
                </p>
                <div className="space-y-4 py-2">
                    <h2 className="text-sm font-semibold text-primary">Debit Account Details</h2>
                    <RadioGroup value={format} className="space-y-2"
                        onValueChange={(v) => {
                            const next = v as BankFileFormat;
                            setFormat(next);
                            if (next === "icici") setDebitAccountNumber(ICICI_DEBIT_ACCOUNT);
                        }}>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="icici" id="reimb_icici" />
                            <Label htmlFor="reimb_icici">ICICI - XXXX{ICICI_DEBIT_ACCOUNT.slice(-4)}</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="cashfree" id="reimb_cashfree" />
                            <Label htmlFor="reimb_cashfree">Cashfree</Label>
                        </div>
                    </RadioGroup>
                    {format === "icici" && (
                        <div className="grid grid-cols-3 items-center gap-4">
                            <Label htmlFor="reimb-debit-acc" className="col-span-1">Custom Acc No:</Label>
                            <Input id="reimb-debit-acc" value={debitAccountNumber} className="col-span-2 h-8"
                                onChange={(e) => setDebitAccountNumber(e.target.value)} />
                        </div>
                    )}
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label className="col-span-1">Payment Mode:</Label>
                        <Select value={paymentMode} onValueChange={setPaymentMode}>
                            <SelectTrigger className="col-span-2 h-8"><SelectValue placeholder="Select mode" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="IMPS">IMPS</SelectItem>
                                <SelectItem value="NEFT">NEFT</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
                    <Button onClick={exportFile} disabled={busy || rows.length === 0}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm &amp; Export
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface MarkPaidProps {
    open: boolean;
    rows: readonly ClaimRow[];
    onOpenChange: (open: boolean) => void;
    /** After the server answered: the claims that moved to Reconciliation Pending. */
    onDone: (moved: string[]) => void;
}

export function MarkPaidDialog({ open, rows, onOpenChange, onDone }: MarkPaidProps) {
    const { toast } = useToast();
    const readPaidTo = useReadPaidTo();
    const { decide } = useExpenseDecision();
    const [busy, setBusy] = useState(false);

    const markPaid = async () => {
        setBusy(true);
        try {
            // Read who each is paid to now: a claim that can't be paid (no account) is left out, and said.
            const paidTo = await readPaidTo(rows);
            const payable: ClaimRow[] = [];
            const unpayable: string[] = [];
            rows.forEach((r, i) => {
                const reason = unpayableReason(paidTo[i], NO_TYPE, false);
                if (reason) unpayable.push(`${r.name}: ${reason}`);
                else payable.push(r);
            });
            const claimOf = new Map(payable.map((r) => [r.expense as string, r.name]));
            const result = payable.length
                ? await decide([...claimOf.keys()], "mark_done")
                : { succeeded: [], failed: [], statuses: {}, total: 0 };
            const moved = result.succeeded.map((e) => claimOf.get(e) ?? e);
            const refused = [
                ...unpayable,
                ...result.failed.map((f) => `${claimOf.get(f.name) ?? f.name}: ${f.reason}`),
            ];
            if (moved.length) {
                toast({
                    title: "Marked as Paid",
                    description: `${moved.length === 1 ? moved[0] : `${moved.length} claims`} moved to Reconciliation Pending.`,
                    variant: "success",
                });
            }
            if (refused.length) {
                toast({
                    title: refused.length === 1 ? "1 claim wasn't marked as Paid" : `${refused.length} claims weren't marked as Paid`,
                    description: toastList(refused),
                    variant: "destructive",
                });
            }
            onOpenChange(false);
            onDone(moved);
        } catch (e) {
            toast({ title: "Could not mark as Paid", description: getFrappeError(e), variant: "destructive" });
        } finally {
            setBusy(false);
        }
    };

    const many = rows.length > 1;
    return (
        <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{many ? `Mark ${rows.length} claims as Paid?` : `Mark ${rows[0]?.name ?? ""} as Paid?`}</AlertDialogTitle>
                    <AlertDialogDescription>
                        This records that the money has gone out ({formatToRoundedIndianRupee(totalOf(rows))}).{" "}
                        {many ? "They move" : "It moves"} to Reconciliation Pending, where the UTR and proof are added.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <Button onClick={markPaid} disabled={busy || rows.length === 0}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Mark as Paid
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
