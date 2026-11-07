/**
 * Pending Approval -> Cashbook / Credit Card (#1644): the list of Expense bills waiting for a person, Approve and
 * Reject, and which bill each dialog decides; Read again on a Not read bill (#1645), which takes it off the list while
 * it is Checking. The dialogs hold the bill's name, never a row snapshot, and read the live row
 * from the refetched list (frontend/CODING_STANDARDS § Fetching or mutating data).
 */
import { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { useToast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import {
    type ApproveBillValues, type ExpenseBillKind, type PendingExpenseBillRow, type RejectBillValues,
} from "../utils/expenseBillApprovalView";
import { useReadExpenseBillAgain } from "./useReadExpenseBillAgain";

const API = "nirmaan_stack.api.expenses.expense_bill_approval";

export const useExpenseBillApprovals = (kind: ExpenseBillKind) => {
    const { toast } = useToast();
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: PendingExpenseBillRow[] }>(
        `${API}.get_pending_expense_bills`, { kind }, `pending-expense-bills-${kind}`,
    );
    const rows = useMemo(() => data?.message ?? [], [data]);

    const { call: approveCall, loading: approving } = useFrappePostCall(`${API}.approve_expense_bill`);
    const { call: rejectCall, loading: rejecting } = useFrappePostCall(`${API}.reject_expense_bill`);
    const { onReadAgain, readingAgainBill } = useReadExpenseBillAgain(mutate);

    const [approvingBill, setApprovingBill] = useState<string | null>(null);
    const [rejectingBill, setRejectingBill] = useState<string | null>(null);

    const approveRow = rows.find((r) => r.name === approvingBill) ?? null;
    const rejectRow = rows.find((r) => r.name === rejectingBill) ?? null;

    const onApprove = useCallback((row: PendingExpenseBillRow) => setApprovingBill(row.name), []);
    const onReject = useCallback((row: PendingExpenseBillRow) => setRejectingBill(row.name), []);

    const submitApprove = useCallback(async ({ invoice_no, invoice_date }: ApproveBillValues) => {
        if (!approvingBill) return;
        try {
            await approveCall({ bill: approvingBill, invoice_no: invoice_no || null, invoice_date: invoice_date || null });
            toast({ title: "Bill approved", description: approvingBill, variant: "success" });
            setApprovingBill(null);
            mutate();
        } catch (e) {
            toast({ title: "Could not approve the bill", description: getFrappeError(e), variant: "destructive" });
        }
    }, [approveCall, approvingBill, mutate, toast]);

    const submitReject = useCallback(async ({ reason }: RejectBillValues) => {
        if (!rejectingBill) return;
        try {
            await rejectCall({ bill: rejectingBill, reason });
            toast({ title: "Bill rejected", description: `${rejectingBill}: the spend waits in Pending Invoices Upload again.`, variant: "success" });
            setRejectingBill(null);
            mutate();
        } catch (e) {
            toast({ title: "Could not reject the bill", description: getFrappeError(e), variant: "destructive" });
        }
    }, [mutate, rejectCall, rejectingBill, toast]);

    return {
        rows, error, isLoading, setApprovingBill, setRejectingBill, approveRow, rejectRow, approving, rejecting,
        onApprove, onReject, submitApprove, submitReject, onReadAgain, readingAgainBill,
    };
};
