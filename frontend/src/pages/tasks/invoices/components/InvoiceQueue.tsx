/**
 * The page shell the expense queues of Pending Invoices Upload share: Credit Card (`CardInvoiceUploads`, #1570) and
 * Cashbook (`CashbookInvoiceUploads`, #1592). Each queue keeps its own columns, filters and endpoints; this holds
 * what they did twice: loading the list, the Attach invoice and No invoice actions (both take the spend off the
 * list, so the list is refetched after each), the loading and error states, the filter bar with its count, and
 * the table frame with its Actions column and its two dialogs.
 */
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import {
    type CardInvoiceValues,
    UpdateInvoiceDetailsDialog,
} from "@/pages/NonProjectExpenses/components/UpdateInvoiceDetailsDialog";
import { getFrappeError } from "@/utils/frappeErrors";

import { NoInvoiceDialog } from "./NoInvoiceDialog";

export type ExpenseLedger = "Project Expenses" | "Non Project Expenses";

/** The spend an action is on: its name and ledger, never a row snapshot. */
export interface QueueTarget {
    name: string;
    doctype: ExpenseLedger;
}

interface QueueEndpoints {
    /** The module path, e.g. `nirmaan_stack.api.expenses.card_invoices`. */
    api: string;
    list: string;
    attach: string;
    noInvoice: string;
    /** The SWR key of the list. */
    cacheKey: string;
    /** What both writes send to name the spend (the Cashbook queue also sends its ledger). */
    targetArgs: (target: QueueTarget) => Record<string, string>;
}

/** The list, the two writes and the dialogs' state of one queue. */
export const useInvoiceQueue = <Row,>({ api, list, attach, noInvoice, cacheKey, targetArgs }: QueueEndpoints) => {
    const { toast } = useToast();
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: Row[] }>(`${api}.${list}`, undefined, cacheKey);
    const rows = useMemo(() => data?.message ?? [], [data]);

    const { call: attachCall } = useFrappePostCall(`${api}.${attach}`);
    const { call: markCall, loading: marking } = useFrappePostCall(`${api}.${noInvoice}`);

    const [attaching, setAttaching] = useState<QueueTarget | null>(null);
    const [noInvoiceFor, setNoInvoiceFor] = useState<QueueTarget | null>(null);
    const [reason, setReason] = useState("");

    const saveInvoice = useCallback(
        async (values: CardInvoiceValues) => {
            if (!attaching) return;
            await attachCall({ ...targetArgs(attaching), ...values });
        },
        [attachCall, attaching, targetArgs],
    );

    const openNoInvoice = useCallback((target: QueueTarget) => {
        setReason("");
        setNoInvoiceFor(target);
    }, []);

    const submitNoInvoice = useCallback(async () => {
        if (!noInvoiceFor || !reason.trim()) return;
        try {
            await markCall({ ...targetArgs(noInvoiceFor), reason });
            toast({ title: "Marked No invoice", description: noInvoiceFor.name, variant: "success" });
            setNoInvoiceFor(null);
            mutate();
        } catch (e) {
            toast({ title: "Could not mark No invoice", description: getFrappeError(e), variant: "destructive" });
        }
    }, [markCall, mutate, noInvoiceFor, reason, targetArgs, toast]);

    return {
        rows, error, isLoading, mutate, attaching, setAttaching, noInvoiceFor, setNoInvoiceFor, reason, setReason,
        marking, saveInvoice, openNoInvoice, submitNoInvoice,
    };
};

export type InvoiceQueueState<Row> = ReturnType<typeof useInvoiceQueue<Row>>;

interface InvoiceQueueFrameProps<Row> {
    queue: InvoiceQueueState<Row>;
    /** Which of the two actions this viewer gets. */
    actions: { attach: boolean; noInvoice: boolean };
    /** Shown when the list fails to load and the server gave no sentence. */
    loadError: string;
    /** The queue's own filter controls; the count sits after them. */
    filters: ReactNode;
    /** "3 card spends waiting for an invoice". */
    countText: string;
    /** The column headings before Actions. */
    headers: { label: string; className?: string }[];
    /** The rows after filtering. */
    shown: Row[];
    rowKey: (row: Row) => string;
    targetOf: (row: Row) => QueueTarget;
    /** The cells of one row, before its Actions cell. */
    cells: (row: Row) => ReactNode;
    emptyText: string;
    /** The No invoice textarea's id, unique per queue. */
    reasonInputId: string;
}

export const InvoiceQueueFrame = <Row,>({
    queue, actions, loadError, filters, countText, headers, shown, rowKey, targetOf, cells, emptyText, reasonInputId,
}: InvoiceQueueFrameProps<Row>) => {
    const { attaching, setAttaching, mutate } = queue;
    // A stable object: the dialog resets its form whenever `expense` changes identity.
    const attachingExpense = useMemo(
        () => attaching
            ? { name: attaching.name, invoice_date: undefined, invoice_ref: undefined, invoice_attachment: undefined, porter_order: null }
            : null,
        [attaching],
    );

    if (queue.isLoading) {
        return <div className="flex justify-center py-10"><TailSpin color="#0ea5e9" height={28} width={28} /></div>;
    }
    if (queue.error) {
        return <div className="py-10 text-center text-sm text-destructive">{getFrappeError(queue.error) || loadError}</div>;
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
                {filters}
                <span className="text-sm text-muted-foreground pb-2">{countText}</span>
            </div>

            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {headers.map((h) => <TableHead key={h.label} className={h.className}>{h.label}</TableHead>)}
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {shown.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={headers.length + 1} className="h-24 text-center text-muted-foreground">
                                    {emptyText}
                                </TableCell>
                            </TableRow>
                        ) : shown.map((row) => {
                            const target = targetOf(row);
                            return (
                                <TableRow key={rowKey(row)}>
                                    {cells(row)}
                                    <TableCell className="text-right whitespace-nowrap">
                                        <div className="flex justify-end gap-2">
                                            {actions.attach && (
                                                <Button size="sm" variant="outline" onClick={() => setAttaching(target)}>
                                                    Attach invoice
                                                </Button>
                                            )}
                                            {actions.noInvoice && (
                                                <Button size="sm" variant="ghost" onClick={() => queue.openNoInvoice(target)}>
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
                    cardSave={queue.saveInvoice}
                    onSuccess={() => mutate()}
                />
            )}

            <NoInvoiceDialog
                expense={queue.noInvoiceFor?.name ?? null}
                reason={queue.reason}
                setReason={queue.setReason}
                saving={queue.marking}
                onClose={() => queue.setNoInvoiceFor(null)}
                onSubmit={queue.submitNoInvoice}
                inputId={reasonInputId}
            />
        </div>
    );
};

export default InvoiceQueueFrame;
