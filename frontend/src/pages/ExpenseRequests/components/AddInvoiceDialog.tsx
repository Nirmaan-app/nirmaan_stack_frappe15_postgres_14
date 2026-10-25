// Add (or replace) an expense's invoice after it was raised (#1502), from the request's page,
// until its Expense is Paid. The server writes it to the request AND to its Expense
// (`api/expense_requests/invoice.add_request_invoice`); a missing date or number only warns.

import React, { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";
import { invoiceNotes } from "@/utils/newExpenseForm";
import type { AddRequestInvoiceResponse, ExpenseRequestInvoice } from "@/types/NirmaanStack/ExpenseRequest";

import { checksLine, EMPTY_INVOICE, InvoiceFields, InvoiceValue } from "./InvoiceSection";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    requestName: string;
    /** The expense's amount, which the invoice total is checked against. */
    amount: number;
    current: ExpenseRequestInvoice;
    onSaved: () => void;
}

const seed = (current: ExpenseRequestInvoice): InvoiceValue => ({
    ...EMPTY_INVOICE,
    has: "yes",
    file_url: current.invoice_attachment ?? "",
    invoice_date: current.invoice_date ?? "",
    invoice_ref: current.invoice_ref ?? "",
});

export const AddInvoiceDialog: React.FC<Props> = ({
    open, onOpenChange, requestName, amount, current, onSaved,
}) => {
    const { toast } = useToast();
    const [value, setValue] = useState<InvoiceValue>(() => seed(current));
    const [saving, setSaving] = useState(false);
    const patch = useCallback((p: Partial<InvoiceValue>) => setValue((v) => ({ ...v, ...p })), []);
    const { call: addInvoice } = useFrappePostCall<{ message?: AddRequestInvoiceResponse }>(
        "nirmaan_stack.api.expense_requests.invoice.add_request_invoice"
    );

    const notes = invoiceNotes({
        hasFile: !!value.file_url, read: value.read,
        invoice_date: value.invoice_date, invoice_ref: value.invoice_ref, typedAmount: amount,
    });

    const handleOpenChange = (o: boolean) => {
        if (saving) return;
        if (o) setValue(seed(current));
        onOpenChange(o);
    };

    const save = async () => {
        setSaving(true);
        try {
            const res = await addInvoice({
                name: requestName,
                invoice_attachment: value.file_url,
                invoice_date: value.invoice_date || undefined,
                invoice_ref: value.invoice_ref.trim() || undefined,
            });
            const warnings = res?.message?.warnings ?? [];
            const onExpense = res?.message?.expense;
            toast({
                title: "Invoice added",
                description: [
                    onExpense ? "Copied to its expense too." : "It is carried onto the expense once approved.",
                    ...warnings,
                ].join(" "),
                variant: "success",
            });
            onOpenChange(false);
            onSaved();
        } catch (e) {
            toast({ title: "Could not add the invoice", description: getFrappeError(e), variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{current.invoice_attachment ? "Replace invoice" : "Add invoice"}</DialogTitle>
                    <DialogDescription>
                        The file, date and number are copied to the expense too, so Accounts sees them
                        when paying.
                    </DialogDescription>
                </DialogHeader>
                <InvoiceFields
                    value={value}
                    onChange={patch}
                    notes={notes}
                    docname={requestName}
                    onError={(title, description) => toast({ title, description, variant: "destructive" })}
                    disabled={saving}
                />
                <DialogFooter className="flex-wrap items-center gap-2">
                    {notes.count > 0 && (
                        <span className="mr-auto text-sm text-muted-foreground">{checksLine(notes.count)}</span>
                    )}
                    <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={save} disabled={!value.file_url || value.busy || saving}>
                        {saving ? <TailSpin color="white" height={18} width={18} /> : "Save invoice"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default AddInvoiceDialog;
