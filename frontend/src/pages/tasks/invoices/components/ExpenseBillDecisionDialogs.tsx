/**
 * Pending Approval -> Cashbook / Credit Card (#1644): the Approve and Reject forms of one waiting Expense bill.
 * Approve starts from the number and date the row offers for a person to correct; Reject needs a reason. Mount one
 * keyed by the bill, so each opens with a fresh form.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { useMemo } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/utils/FormatDate";

import {
    type ApproveBillValues, type PendingExpenseBillRow, type RejectBillValues,
    approveBillSchema, approveFormDefaults, billCheckText, rejectBillSchema,
} from "../utils/expenseBillApprovalView";

interface BillDecisionDialogProps<V> {
    row: PendingExpenseBillRow;
    submitting: boolean;
    onSubmit: (values: V) => void;
    onClose: () => void;
}

export const ApproveBillDialog = ({ row, submitting, onSubmit, onClose }: BillDecisionDialogProps<ApproveBillValues>) => {
    const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
    const form = useForm<ApproveBillValues>({
        resolver: zodResolver(approveBillSchema(today)),
        defaultValues: approveFormDefaults(row),
    });

    return (
        <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Approve bill</DialogTitle>
                    <DialogDescription>
                        {`${row.expense}, spent ${formatDate(row.payment_date)}. ${billCheckText(row)}`}
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
                        <FormField
                            control={form.control}
                            name="invoice_no"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Invoice number</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="invoice_date"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Invoice date</FormLabel>
                                    <FormControl><Input type="date" max={today} {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <p className="text-xs text-muted-foreground">Correct them if the bill says otherwise. They are copied onto the expense.</p>
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
                            <Button type="submit" disabled={submitting}>{submitting ? "Approving..." : "Approve"}</Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export const RejectBillDialog = ({ row, submitting, onSubmit, onClose }: BillDecisionDialogProps<RejectBillValues>) => {
    const form = useForm<RejectBillValues>({ resolver: zodResolver(rejectBillSchema), defaultValues: { reason: "" } });

    return (
        <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reject bill</DialogTitle>
                    <DialogDescription>
                        {row.expense}: the bill comes off the expense, which waits in Pending Invoices Upload for a new
                        one, showing your reason.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
                        <FormField
                            control={form.control}
                            name="reason"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Reason <sup className="text-destructive">*</sup></FormLabel>
                                    <FormControl><Textarea {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
                            <Button type="submit" variant="destructive" disabled={submitting}>
                                {submitting ? "Rejecting..." : "Reject"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};
