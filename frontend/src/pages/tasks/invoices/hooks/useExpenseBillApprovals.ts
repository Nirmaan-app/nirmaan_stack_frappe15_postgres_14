/**
 * Pending Approval -> Cashbook / Credit Card (#1644): the list of Expense bills waiting for a person, Approve and
 * Reject, and their dialogs' state. The dialogs hold the bill's name, never a row snapshot, and read the live row
 * from the refetched list (frontend/CODING_STANDARDS § Fetching or mutating data).
 */
import { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { useToast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import { type ExpenseBillKind, type PendingExpenseBillRow, approveFormDefaults } from "../utils/expenseBillApprovalView";

const API = "nirmaan_stack.api.expenses.expense_bill_approval";

export const useExpenseBillApprovals = (kind: ExpenseBillKind) => {
    const { toast } = useToast();
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: PendingExpenseBillRow[] }>(
        `${API}.get_pending_expense_bills`, { kind }, `pending-expense-bills-${kind}`,
    );
    const rows = useMemo(() => data?.message ?? [], [data]);

    const { call: approveCall, loading: approving } = useFrappePostCall(`${API}.approve_expense_bill`);
    const { call: rejectCall, loading: rejecting } = useFrappePostCall(`${API}.reject_expense_bill`);

    const [approvingBill, setApprovingBill] = useState<string | null>(null);
    const [rejectingBill, setRejectingBill] = useState<string | null>(null);
    const [invoiceNo, setInvoiceNo] = useState("");
    const [invoiceDate, setInvoiceDate] = useState("");
    const [reason, setReason] = useState("");

    const approveRow = rows.find((r) => r.name === approvingBill) ?? null;
    const rejectRow = rows.find((r) => r.name === rejectingBill) ?? null;

    const onApprove = useCallback((row: PendingExpenseBillRow) => {
        const defaults = approveFormDefaults(row);
        setInvoiceNo(defaults.invoice_no);
        setInvoiceDate(defaults.invoice_date);
        setApprovingBill(row.name);
    }, []);

    const onReject = useCallback((row: PendingExpenseBillRow) => {
        setReason("");
        setRejectingBill(row.name);
    }, []);

    const submitApprove = useCallback(async () => {
        if (!approvingBill) return;
        try {
            await approveCall({ bill: approvingBill, invoice_no: invoiceNo.trim() || null, invoice_date: invoiceDate || null });
            toast({ title: "Bill approved", description: approvingBill, variant: "success" });
            setApprovingBill(null);
            mutate();
        } catch (e) {
            toast({ title: "Could not approve the bill", description: getFrappeError(e), variant: "destructive" });
        }
    }, [approveCall, approvingBill, invoiceDate, invoiceNo, mutate, toast]);

    const submitReject = useCallback(async () => {
        if (!rejectingBill || !reason.trim()) return;
        try {
            await rejectCall({ bill: rejectingBill, reason: reason.trim() });
            toast({ title: "Bill rejected", description: `${rejectingBill}: the spend waits in Pending Invoices Upload again.`, variant: "success" });
            setRejectingBill(null);
            mutate();
        } catch (e) {
            toast({ title: "Could not reject the bill", description: getFrappeError(e), variant: "destructive" });
        }
    }, [mutate, reason, rejectCall, rejectingBill, toast]);

    return {
        rows, error, isLoading, approvingBill, setApprovingBill, rejectingBill, setRejectingBill, approveRow, rejectRow,
        invoiceNo, setInvoiceNo, invoiceDate, setInvoiceDate, reason, setReason, approving, rejecting,
        onApprove, onReject, submitApprove, submitReject,
    };
};
