/**
 * Pending Invoices Upload -> Cashbook (#1592, ADR-0015 Amendment B decision 4): every wallet spend the Cashbook
 * Statement import made that is still waiting for its invoice, Project and Non-Project. The Credit Card tab's twin
 * (`CardInvoiceUploads`): the same attach dialog (its card mode: file required, number and date optional), the
 * same No invoice dialog and the same role rule, through the shell both share (`InvoiceQueue.tsx`).
 *
 * The server lists the waiting spends (`api/expenses/cashbook_invoices.get_cashbook_invoice_queue`); the rules of
 * the filters and the actions are `utils/cashbookInvoicesView.ts`. Both writes name the spend's ledger.
 */
import React, { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell } from "@/components/ui/table";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

import {
    ALL,
    type CashbookInvoiceFilters,
    type CashbookInvoiceRow,
    cashbookInvoiceActions,
    cashbookInvoiceFilterOptions,
    cashbookLedgerLabel,
    filterCashbookInvoices,
} from "../utils/cashbookInvoicesView";
import { InvoiceQueueFrame, type QueueTarget, useInvoiceQueue } from "./InvoiceQueue";

const ENDPOINTS = {
    api: "nirmaan_stack.api.expenses.cashbook_invoices",
    list: "get_cashbook_invoice_queue",
    attach: "attach_cashbook_invoice",
    noInvoice: "mark_cashbook_no_invoice",
    cacheKey: "cashbook-invoice-queue",
    targetArgs: (target: QueueTarget) => ({ expense: target.name, doctype: target.doctype }),
};

const HEADERS = [
    { label: "Date" },
    { label: "Amount", className: "text-right" },
    { label: "Paid by" },
    { label: "Remark" },
    { label: "Expense" },
];

export const CashbookInvoiceUploads: React.FC = () => {
    const { role, user_id } = useUserData();
    const queue = useInvoiceQueue<CashbookInvoiceRow>(ENDPOINTS);
    const { payers, months } = useMemo(() => cashbookInvoiceFilterOptions(queue.rows), [queue.rows]);
    const [filters, setFilters] = useState<CashbookInvoiceFilters>({ paidBy: ALL, ledger: ALL, month: ALL });
    const shown = useMemo(() => filterCashbookInvoices(queue.rows, filters), [queue.rows, filters]);

    return (
        <InvoiceQueueFrame
            queue={queue}
            actions={cashbookInvoiceActions(role, user_id)}
            loadError="Could not load wallet spends."
            countText={`${shown.length} wallet spend${shown.length === 1 ? "" : "s"} waiting for an invoice`}
            filters={
                <>
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
                </>
            }
            headers={HEADERS}
            shown={shown}
            rowKey={(r) => `${r.doctype}:${r.name}`}
            targetOf={(r) => ({ name: r.name, doctype: r.doctype })}
            cells={(r) => {
                const ledger = cashbookLedgerLabel(r);
                return (
                    <>
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
                    </>
                );
            }}
            emptyText="No wallet spend is waiting for an invoice."
            reasonInputId="cashbook_no_invoice_reason"
        />
    );
};

export default CashbookInvoiceUploads;
