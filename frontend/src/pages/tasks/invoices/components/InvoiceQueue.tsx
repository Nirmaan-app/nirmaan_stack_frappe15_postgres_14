/**
 * The page shell the expense queues of Pending Invoices Upload share: Credit Card (`CardInvoiceUploads`, #1570) and
 * Cashbook (`CashbookInvoiceUploads`, #1592). Each queue keeps its own columns, filters and endpoints; this holds
 * what they did twice: loading the list, the Attach invoice and No invoice actions (both take the spend off the
 * list, so the list is refetched after each) and their two dialogs (`InvoiceQueueDialogs`). Both queues show
 * their rows through the shared DataTable, around the same list and dialogs.
 */
import { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

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

/** The Attach invoice and No invoice dialogs of one queue, open while the queue names a spend for them. */
export const InvoiceQueueDialogs = <Row,>({ queue, reasonInputId }: { queue: InvoiceQueueState<Row>; reasonInputId: string }) => {
    const { attaching, setAttaching, mutate } = queue;
    // A stable object: the dialog resets its form whenever `expense` changes identity.
    const attachingExpense = useMemo(
        () => attaching
            ? { name: attaching.name, invoice_date: undefined, invoice_ref: undefined, invoice_attachment: undefined, porter_order: null }
            : null,
        [attaching],
    );

    return (
        <>
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
        </>
    );
};
