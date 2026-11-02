/**
 * Pending Invoices Upload -> Cashbook (#1592, ADR-0015 Amendment B decision 4): every wallet spend the Cashbook
 * Statement import made that is still waiting for its invoice, Project and Non-Project. The Credit Card tab's twin
 * (`CardInvoiceUploads`): the same attach dialog (its card mode: file required, number and date optional), the
 * same No invoice dialog and the same role rule.
 *
 * The server lists the waiting spends (`api/expenses/cashbook_invoices.get_cashbook_invoice_queue`); the rules of
 * the filters and the actions are `utils/cashbookInvoicesView.ts`. Either action takes the spend off the list, so
 * the list is refetched after each.
 */
import React, { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    type CashbookInvoiceFilters,
    type CashbookInvoiceRow,
    type CashbookLedger,
    cashbookInvoiceActions,
    cashbookInvoiceFilterOptions,
    cashbookLedgerLabel,
    filterCashbookInvoices,
} from "../utils/cashbookInvoicesView";
import { NoInvoiceDialog } from "./NoInvoiceDialog";

const API = "nirmaan_stack.api.expenses.cashbook_invoices";

/** The spend an action is on: its name and ledger, never a row snapshot. */
interface Target {
    name: string;
    doctype: CashbookLedger;
}

export const CashbookInvoiceUploads: React.FC = () => {
    const { role, user_id } = useUserData();
    const actions = cashbookInvoiceActions(role, user_id);
    const { toast } = useToast();

    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: CashbookInvoiceRow[] }>(
        `${API}.get_cashbook_invoice_queue`, undefined, "cashbook-invoice-queue",
    );
    const rows = useMemo(() => data?.message ?? [], [data]);
    const { payers, months } = useMemo(() => cashbookInvoiceFilterOptions(rows), [rows]);
    const [filters, setFilters] = useState<CashbookInvoiceFilters>({ paidBy: ALL, ledger: ALL, month: ALL });
    const shown = useMemo(() => filterCashbookInvoices(rows, filters), [rows, filters]);

    const { call: attach } = useFrappePostCall(`${API}.attach_cashbook_invoice`);
    const { call: markNoInvoice, loading: marking } = useFrappePostCall(`${API}.mark_cashbook_no_invoice`);

    const [attaching, setAttaching] = useState<Target | null>(null);
    // A stable object: the dialog resets its form whenever `expense` changes identity.
    const attachingExpense = useMemo(
        () => attaching
            ? { name: attaching.name, invoice_date: undefined, invoice_ref: undefined, invoice_attachment: undefined, porter_order: null }
            : null,
        [attaching],
    );
    const [noInvoiceFor, setNoInvoiceFor] = useState<Target | null>(null);
    const [reason, setReason] = useState("");

    const saveInvoice = useCallback(
        async (values: CardInvoiceValues) => {
            if (!attaching) return;
            await attach({ expense: attaching.name, doctype: attaching.doctype, ...values });
        },
        [attach, attaching],
    );

    const openNoInvoice = (target: Target) => {
        setReason("");
        setNoInvoiceFor(target);
    };

    const submitNoInvoice = async () => {
        if (!noInvoiceFor || !reason.trim()) return;
        try {
            await markNoInvoice({ expense: noInvoiceFor.name, doctype: noInvoiceFor.doctype, reason });
            toast({ title: "Marked No invoice", description: noInvoiceFor.name, variant: "success" });
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
        return <div className="py-10 text-center text-sm text-destructive">{getFrappeError(error) || "Could not load wallet spends."}</div>;
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">Paid by</Label>
                    <Select value={filters.paidBy} onValueChange={(paidBy) => setFilters((f) => ({ ...f, paidBy }))}>
                        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All wallet holders</SelectItem>
                            {payers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">Expense</Label>
                    <Select value={filters.ledger} onValueChange={(ledger) => setFilters((f) => ({ ...f, ledger }))}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>Project and Non-Project</SelectItem>
                            <SelectItem value="Project Expenses">Project</SelectItem>
                            <SelectItem value="Non Project Expenses">Non-Project</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">Month</Label>
                    <Select value={filters.month} onValueChange={(month) => setFilters((f) => ({ ...f, month }))}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All months</SelectItem>
                            {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <span className="text-sm text-muted-foreground pb-2">
                    {shown.length} wallet spend{shown.length === 1 ? "" : "s"} waiting for an invoice
                </span>
            </div>

            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Paid by</TableHead>
                            <TableHead>Remark</TableHead>
                            <TableHead>Expense</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {shown.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                    No wallet spend is waiting for an invoice.
                                </TableCell>
                            </TableRow>
                        ) : shown.map((r) => {
                            const ledger = cashbookLedgerLabel(r);
                            const target = { name: r.name, doctype: r.doctype };
                            return (
                                <TableRow key={`${r.doctype}:${r.name}`}>
                                    <TableCell className="whitespace-nowrap">{formatDate(r.payment_date)}</TableCell>
                                    <TableCell className="text-right whitespace-nowrap">{formatToIndianRupee(r.amount)}</TableCell>
                                    <TableCell className="whitespace-nowrap">{r.paid_by || "--"}</TableCell>
                                    <TableCell className="max-w-xs">
                                        <div className="truncate" title={r.remark}>{r.remark || "--"}</div>
                                        <div className="text-xs text-muted-foreground">{r.expense_type}</div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{ledger.kind}</Badge>
                                        {ledger.project && <div className="text-xs text-muted-foreground mt-1">{ledger.project}</div>}
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        <div className="flex justify-end gap-2">
                                            {actions.attach && (
                                                <Button size="sm" variant="outline" onClick={() => setAttaching(target)}>
                                                    Attach invoice
                                                </Button>
                                            )}
                                            {actions.noInvoice && (
                                                <Button size="sm" variant="ghost" onClick={() => openNoInvoice(target)}>
                                                    No invoice
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {attaching && attachingExpense && (
                <UpdateInvoiceDetailsDialog
                    isOpen
                    setIsOpen={(open) => { if (!open) setAttaching(null); }}
                    expense={attachingExpense}
                    doctype={attaching.doctype}
                    cardSave={saveInvoice}
                    onSuccess={() => mutate()}
                />
            )}

            <NoInvoiceDialog
                expense={noInvoiceFor?.name ?? null}
                reason={reason}
                setReason={setReason}
                saving={marking}
                onClose={() => setNoInvoiceFor(null)}
                onSubmit={submitNoInvoice}
                inputId="cashbook_no_invoice_reason"
            />
        </div>
    );
};

export default CashbookInvoiceUploads;
