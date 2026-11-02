/**
 * Pending Invoices Upload -> Credit Card (#1570, ADR-0039 ruling 8): every card spend still waiting for its
 * invoice. Its own table, not the Reports "Pending Invoices" report the PO and WO sub-tabs mount.
 *
 * The server lists the waiting spends (`api/expenses/card_invoices.get_card_invoice_queue`); the rules of the
 * filters and the actions are `utils/cardInvoicesView.ts`. Attach invoice reuses the expense invoice dialog in
 * its card mode (file required, number and date optional); No invoice asks for a typed reason. The list, the two
 * actions and the table frame are the shell every expense queue shares (`InvoiceQueue.tsx`).
 */
import React, { useMemo, useState } from "react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell } from "@/components/ui/table";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

import {
    ALL,
    type CardInvoiceFilters,
    type CardInvoiceRow,
    cardInvoiceActions,
    cardInvoiceFilterOptions,
    filterCardInvoices,
    statementMonthsLabel,
} from "../utils/cardInvoicesView";
import { InvoiceQueueFrame, type QueueTarget, useInvoiceQueue } from "./InvoiceQueue";

const ENDPOINTS = {
    api: "nirmaan_stack.api.expenses.card_invoices",
    list: "get_card_invoice_queue",
    attach: "attach_card_invoice",
    noInvoice: "mark_card_no_invoice",
    cacheKey: "card-invoice-queue",
    targetArgs: (target: QueueTarget) => ({ expense: target.name }),
};

const HEADERS = [
    { label: "Date" },
    { label: "Merchant" },
    { label: "Amount", className: "text-right" },
    { label: "Expense Type" },
    { label: "Holder" },
    { label: "Statement" },
];

export const CardInvoiceUploads: React.FC = () => {
    const { role, user_id } = useUserData();
    const queue = useInvoiceQueue<CardInvoiceRow>(ENDPOINTS);
    const { holders, months } = useMemo(() => cardInvoiceFilterOptions(queue.rows), [queue.rows]);
    const [filters, setFilters] = useState<CardInvoiceFilters>({ holder: ALL, month: ALL });
    const shown = useMemo(() => filterCardInvoices(queue.rows, filters), [queue.rows, filters]);

    return (
        <InvoiceQueueFrame
            queue={queue}
            actions={cardInvoiceActions(role, user_id)}
            loadError="Could not load card spends."
            countText={`${shown.length} card spend${shown.length === 1 ? "" : "s"} waiting for an invoice`}
            filters={
                <>
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
                </>
            }
            headers={HEADERS}
            shown={shown}
            rowKey={(r) => r.name}
            targetOf={(r) => ({ name: r.name, doctype: "Non Project Expenses" })}
            cells={(r) => (
                <>
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
                </>
            )}
            emptyText="No card spend is waiting for an invoice."
            reasonInputId="card_no_invoice_reason"
        />
    );
};

export default CardInvoiceUploads;
