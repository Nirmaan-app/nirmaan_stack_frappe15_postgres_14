/**
 * Pending Invoices Upload -> Credit Card (#1570, ADR-0037 ruling 8): every card spend still waiting for its
 * invoice. Its own table, not the Reports "Pending Invoices" report the PO and WO sub-tabs mount.
 *
 * The server lists the waiting spends (`api/expenses/card_invoices.get_card_invoice_queue`); the rules of the
 * filters and the actions are `utils/cardInvoicesView.ts`. Attach invoice reuses the expense invoice dialog in
 * its card mode (file required, number and date optional); No invoice asks for a typed reason. Either way the
 * spend leaves the list, so the list is refetched after each.
 */
import React, { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import {
    type CardInvoiceValues,
    UpdateInvoiceDetailsDialog,
} from "@/pages/NonProjectExpenses/components/UpdateInvoiceDetailsDialog";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";

import {
    ALL,
    type CardInvoiceFilters,
    type CardInvoiceRow,
    cardInvoiceActions,
    cardInvoiceFilterOptions,
    filterCardInvoices,
    statementMonthsLabel,
} from "../utils/cardInvoicesView";

const API = "nirmaan_stack.api.expenses.card_invoices";

export const CardInvoiceUploads: React.FC = () => {
    const { role, user_id } = useUserData();
    const actions = cardInvoiceActions(role, user_id);
    const { toast } = useToast();

    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: CardInvoiceRow[] }>(
        `${API}.get_card_invoice_queue`, undefined, "card-invoice-queue",
    );
    const rows = useMemo(() => data?.message ?? [], [data]);
    const { holders, months } = useMemo(() => cardInvoiceFilterOptions(rows), [rows]);
    const [filters, setFilters] = useState<CardInvoiceFilters>({ holder: ALL, month: ALL });
    const shown = useMemo(() => filterCardInvoices(rows, filters), [rows, filters]);

    const { call: attach } = useFrappePostCall(`${API}.attach_card_invoice`);
    const { call: markNoInvoice, loading: marking } = useFrappePostCall(`${API}.mark_card_no_invoice`);

    // The dialogs hold the spend's NAME, never a row snapshot.
    const [attaching, setAttaching] = useState<string | null>(null);
    // A stable object: the dialog resets its form whenever `expense` changes identity.
    const attachingExpense = useMemo(
        () => attaching
            ? { name: attaching, invoice_date: undefined, invoice_ref: undefined, invoice_attachment: undefined, porter_order: null }
            : null,
        [attaching],
    );
    const [noInvoiceFor, setNoInvoiceFor] = useState<string | null>(null);
    const [reason, setReason] = useState("");

    const saveInvoice = useCallback(
        async (values: CardInvoiceValues) => {
            if (!attaching) return;
            await attach({ expense: attaching, ...values });
        },
        [attach, attaching],
    );

    const openNoInvoice = (name: string) => {
        setReason("");
        setNoInvoiceFor(name);
    };

    const submitNoInvoice = async () => {
        if (!noInvoiceFor || !reason.trim()) return;
        try {
            await markNoInvoice({ expense: noInvoiceFor, reason });
            toast({ title: "Marked No invoice", description: noInvoiceFor, variant: "success" });
            setNoInvoiceFor(null);
            mutate();
        } catch (e) {
            toast({ title: "Could not mark No invoice", description: getFrappeError(e), variant: "destructive" });
        }
    };

    if (isLoading) {
        return <div className="flex justify-center py-10"><TailSpin color="#0ea5e9" height={28} width={28} /></div>;
    }
    if (error) {
        return <div className="py-10 text-center text-sm text-destructive">{getFrappeError(error) || "Could not load card spends."}</div>;
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">Card holder</Label>
                    <Select value={filters.holder} onValueChange={(holder) => setFilters((f) => ({ ...f, holder }))}>
                        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All holders</SelectItem>
                            {holders.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">Statement month</Label>
                    <Select value={filters.month} onValueChange={(month) => setFilters((f) => ({ ...f, month }))}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All months</SelectItem>
                            {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <span className="text-sm text-muted-foreground pb-2">
                    {shown.length} card spend{shown.length === 1 ? "" : "s"} waiting for an invoice
                </span>
            </div>

            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Merchant</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Expense Type</TableHead>
                            <TableHead>Holder</TableHead>
                            <TableHead>Statement</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {shown.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                    No card spend is waiting for an invoice.
                                </TableCell>
                            </TableRow>
                        ) : shown.map((r) => (
                            <TableRow key={r.name}>
                                <TableCell className="whitespace-nowrap">{formatDate(r.payment_date)}</TableCell>
                                <TableCell>
                                    <div className="font-medium">{r.merchant}</div>
                                    <div className="text-xs text-muted-foreground">{r.details}</div>
                                </TableCell>
                                <TableCell className="text-right whitespace-nowrap">{formatToIndianRupee(r.amount)}</TableCell>
                                <TableCell>{r.expense_type}</TableCell>
                                <TableCell className="whitespace-nowrap">{r.holder}</TableCell>
                                <TableCell className="whitespace-nowrap">
                                    <div>{statementMonthsLabel(r.statement_months)}</div>
                                    <div className="text-xs text-muted-foreground">{r.credit_card_statement}</div>
                                </TableCell>
                                <TableCell className="text-right whitespace-nowrap">
                                    <div className="flex justify-end gap-2">
                                        {actions.attach && (
                                            <Button size="sm" variant="outline" onClick={() => setAttaching(r.name)}>
                                                Attach invoice
                                            </Button>
                                        )}
                                        {actions.noInvoice && (
                                            <Button size="sm" variant="ghost" onClick={() => openNoInvoice(r.name)}>
                                                No invoice
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {attachingExpense && (
                <UpdateInvoiceDetailsDialog
                    isOpen
                    setIsOpen={(open) => { if (!open) setAttaching(null); }}
                    expense={attachingExpense}
                    doctype="Non Project Expenses"
                    cardSave={saveInvoice}
                    onSuccess={() => mutate()}
                />
            )}

            <AlertDialog open={!!noInvoiceFor} onOpenChange={(open) => { if (!open && !marking) setNoInvoiceFor(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Mark No invoice</AlertDialogTitle>
                        <AlertDialogDescription>
                            {noInvoiceFor}: this spend will never have an invoice. Your name, the time and the reason
                            are kept on the expense.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="card_no_invoice_reason">Reason <sup className="text-destructive">*</sup></Label>
                        <Textarea id="card_no_invoice_reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={marking}>Cancel</AlertDialogCancel>
                        <Button onClick={submitNoInvoice} disabled={marking || !reason.trim()}>
                            {marking ? "Saving..." : "Mark No invoice"}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default CardInvoiceUploads;
