/**
 * Edit Holder Name (#1423, spec #1420, approved mockup screen 4): fix how the bank spells a Payee's
 * holder name, after an "Are you sure?" that says how many vendors share the account.
 *
 * The account number and IFSC show read-only with a lock: they never change here. The server
 * (`api/payees/payee_page.edit_holder_name`, the Payee `validate` controller) allows the edit to
 * Accountant, Accountant Lead and Admin only.
 */

import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2, Lock } from "lucide-react";

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
import { holderNameWarning } from "@/utils/payees/payeePage";

export const EDIT_HOLDER_NAME_API = "nirmaan_stack.api.payees.payee_page.edit_holder_name";

interface EditHolderNameDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    payee: Pick<PayeeSummary, "name" | "account_name" | "account_number" | "ifsc" | "vendors">;
    onSaved?: (payee: PayeeSummary) => void;
    /** What the name box starts with; the saved holder name when not given. The vendor rename prompt
     * (#1426) passes the vendor's new name. */
    initialName?: string;
}

const LockedValue = ({ value }: { value: string }) => (
    <div className="flex h-9 items-center gap-2 rounded-md bg-muted px-3 text-sm tabular-nums text-muted-foreground">
        <Lock className="h-3.5 w-3.5" role="img" aria-label="Locked" />
        {value}
    </div>
);

export function EditHolderNameDialog({ open, onOpenChange, payee, onSaved, initialName }: EditHolderNameDialogProps) {
    const startName = initialName ?? payee.account_name;
    const [holder, setHolder] = useState(startName);
    const { call, loading } = useFrappePostCall<{ message: { payee: PayeeSummary } }>(EDIT_HOLDER_NAME_API);

    // Closing without saving drops what was typed, so the next open starts from the same name.
    const change = (next: boolean) => {
        if (!next) setHolder(startName);
        onOpenChange(next);
    };

    const trimmed = holder.replace(/\s+/g, " ").trim();
    const unchanged = trimmed === payee.account_name;

    const save = async () => {
        try {
            const res = await call({ name: payee.name, account_name: trimmed });
            toast({ title: "Holder name saved", description: `${payee.name}, ${res.message.payee.account_name}.`, variant: "success" });
            onSaved?.(res.message.payee);
            onOpenChange(false);
        } catch (e) {
            toast({ title: "Could not save the holder name", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={change}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Edit Holder Name</AlertDialogTitle>
                    <AlertDialogDescription className="text-center">{payee.name}</AlertDialogDescription>
                </AlertDialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
                        <Label htmlFor="payee-holder-name" className="text-right">Account Holder Name</Label>
                        <Input
                            id="payee-holder-name"
                            value={holder}
                            onChange={(e) => setHolder(e.target.value)}
                            disabled={loading}
                            autoComplete="off"
                        />
                    </div>
                    <div className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
                        <span className="text-right text-sm font-medium">Account Number</span>
                        <LockedValue value={payee.account_number} />
                    </div>
                    <div className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
                        <span className="text-right text-sm font-medium">IFSC Code</span>
                        <LockedValue value={payee.ifsc} />
                    </div>

                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] leading-relaxed text-amber-900">
                        <p className="font-semibold">Are you sure?</p>
                        <p className="mt-0.5">{holderNameWarning(payee.vendors)}</p>
                    </div>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <Button onClick={save} disabled={loading || !trimmed || unchanged}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Yes, save new name
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
