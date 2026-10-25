/**
 * Every TDS challan on record — read-only.
 *
 * Opened from the ledger's summary strip. Unlike the picker inside PayTdsDialog, this lists
 * EVERY challan including the fully-used ones: the picker answers "what can I pay from?", this
 * answers "what have we deposited?", and hiding a spent challan would break the second question.
 *
 * `remaining` is DERIVED here (`amount - reconciled_amount`), never a stored column — the same
 * arithmetic the server does when it decides whether a challan can absorb a payment.
 *
 * EXPENSE (#1544). Each challan is a deposit already made, so each should be linked to the non-project
 * TDS Payment expense that books it. A challan with none carries a warning and a Link action; nothing is
 * linked or created automatically. The server decides what may be linked (`set_challan_expense`).
 */

import React, { useMemo, useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import ReactSelect from "react-select";
import { AlertTriangle, ExternalLink, Link2, Loader2, Unlink } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { getSelectStyles } from "@/config/selectTheme";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import { TDSChallanAttachment } from "@/types/NirmaanStack/TDSChallanAttachment";
import { lacksExpense, linkableExpenses } from "../challanExpense";
import { TdsPaymentExpense, useChallanExpenseLink } from "../hooks/useChallanExpenseLink";

const CHALLAN_DOCTYPE = "TDS Challan Attachment";

interface ChallanListDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** A challan's expense was linked or unlinked: the strip's warning count is stale. */
    onExpenseChanged?: () => void;
}

interface ExpenseOption {
    value: string;
    label: string;
}

const expenseOption = (expense: TdsPaymentExpense): ExpenseOption => ({
    value: expense.name,
    label: [
        expense.name,
        formatToIndianRupee(expense.amount),
        expense.payment_date ? formatDate(expense.payment_date) : null,
        expense.status && expense.status !== "Paid" ? expense.status : null,
        expense.description || null,
    ]
        .filter(Boolean)
        .join(" · "),
});

export const ChallanListDialog: React.FC<ChallanListDialogProps> = ({
    open,
    onOpenChange,
    onExpenseChanged,
}) => {
    const [search, setSearch] = useState("");
    // The challan's NAME, not the row: the row is re-read after each link (frontend/CODING_STANDARDS.md).
    const [linkingChallan, setLinkingChallan] = useState<string | null>(null);
    const [pickedExpense, setPickedExpense] = useState<ExpenseOption | null>(null);
    const { expenses, isExpensesLoading, setChallanExpense, isSaving } = useChallanExpenseLink(open);

    // Third arg is the swrKey, never an options object: nothing is fetched while closed.
    const { data: challans, isLoading, mutate } = useFrappeGetDocList<TDSChallanAttachment>(
        CHALLAN_DOCTYPE,
        {
            fields: [
                "name",
                "financial_year",
                "challan_no",
                "date_of_deposit",
                "bank_name",
                "amount",
                "reconciled_amount",
                "challan_attachment",
                "tds_payment_expense",
            ],
            limit: 500,
            orderBy: { field: "date_of_deposit", order: "desc" },
        },
        open ? undefined : null
    );

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        return (challans || [])
            .map((challan) => ({
                ...challan,
                remaining: (challan.amount || 0) - (challan.reconciled_amount || 0),
            }))
            .filter((challan) =>
                term
                    ? [challan.challan_no, challan.financial_year, challan.bank_name, challan.name]
                          .filter(Boolean)
                          .some((value) => String(value).toLowerCase().includes(term))
                    : true
            );
    }, [challans, search]);

    const totals = useMemo(
        () =>
            rows.reduce(
                (acc, challan) => ({
                    amount: acc.amount + (challan.amount || 0),
                    remaining: acc.remaining + challan.remaining,
                }),
                { amount: 0, remaining: 0 }
            ),
        [rows]
    );

    const withoutExpense = useMemo(() => (challans || []).filter(lacksExpense).length, [challans]);

    const expenseOptions = useMemo(
        () =>
            linkingChallan
                ? linkableExpenses(expenses, challans || [], linkingChallan).map(expenseOption)
                : [],
        [expenses, challans, linkingChallan]
    );

    const closePicker = () => {
        setLinkingChallan(null);
        setPickedExpense(null);
    };

    const saveExpense = async (challan: string, expense: string | null) => {
        try {
            await setChallanExpense(challan, expense);
            toast({
                title: expense ? "Expense linked" : "Expense unlinked",
                description: expense
                    ? `${expense} records challan ${challan}.`
                    : `Challan ${challan} has no expense now.`,
                variant: "success",
            });
            closePicker();
            await mutate();
            onExpenseChanged?.();
        } catch (e) {
            toast({
                title: "Couldn't save the expense",
                description: getFrappeError(e),
                variant: "destructive",
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden">
                <DialogHeader>
                    <DialogTitle>TDS Challans</DialogTitle>
                    <DialogDescription>
                        {rows.length} challan{rows.length === 1 ? "" : "s"} ·{" "}
                        {formatToIndianRupee(totals.amount)} paid ·{" "}
                        {formatToIndianRupee(totals.remaining)} unreconciled
                        {withoutExpense > 0 && (
                            <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">
                                · {withoutExpense} without a TDS Payment expense
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <Input
                    placeholder="Search challan no, financial year, bank…"
                    className="h-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />

                <div className="max-h-[55vh] overflow-y-auto rounded-md border">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                    ) : rows.length === 0 ? (
                        <p className="p-6 text-center text-xs text-muted-foreground">
                            {search ? "No challan matches that search." : "No challans recorded yet."}
                        </p>
                    ) : (
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-muted/70 text-muted-foreground backdrop-blur">
                                <tr>
                                    <th className="p-2 text-left font-medium">Challan No</th>
                                    <th className="p-2 text-left font-medium">FY</th>
                                    <th className="p-2 text-left font-medium">Deposited</th>
                                    <th className="p-2 text-left font-medium">Bank</th>
                                    {/* Owner wording 2026-09-15. The three are one sentence read
                                        left to right: what was PAID to the department, how much of
                                        it has been matched to deductions, and what is still
                                        unmatched. "Used"/"Remaining" read like stock, not tax. */}
                                    <th className="p-2 text-right font-medium">Amount Paid</th>
                                    <th className="p-2 text-right font-medium">Amount Recon</th>
                                    <th className="p-2 text-right font-medium">Amount Unrecon</th>
                                    <th className="p-2 text-center font-medium">Receipt</th>
                                    <th className="p-2 text-left font-medium">Expense</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((challan) => (
                                    <React.Fragment key={challan.name}>
                                    <tr className="border-t">
                                        <td className="p-2 font-medium tabular-nums whitespace-nowrap">
                                            {challan.challan_no}
                                        </td>
                                        <td className="p-2 whitespace-nowrap">{challan.financial_year}</td>
                                        <td className="p-2 whitespace-nowrap">
                                            {challan.date_of_deposit ? formatDate(challan.date_of_deposit) : "--"}
                                        </td>
                                        <td className="p-2">{challan.bank_name || "--"}</td>
                                        <td className="p-2 text-right tabular-nums">
                                            {formatToIndianRupee(challan.amount)}
                                        </td>
                                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                                            {formatToIndianRupee(challan.reconciled_amount || 0)}
                                        </td>
                                        <td
                                            className={cn(
                                                "p-2 text-right font-semibold tabular-nums",
                                                challan.remaining > 0.01
                                                    ? "text-emerald-700 dark:text-emerald-400"
                                                    : "text-muted-foreground"
                                            )}
                                        >
                                            {formatToIndianRupee(challan.remaining)}
                                        </td>
                                        <td className="p-2 text-center">
                                            {challan.challan_attachment ? (
                                                <a
                                                    href={challan.challan_attachment}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center text-blue-600 hover:underline"
                                                    aria-label={`Open challan ${challan.challan_no}`}
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </a>
                                            ) : (
                                                <span className="text-muted-foreground">--</span>
                                            )}
                                        </td>
                                        <td className="p-2 whitespace-nowrap">
                                            {lacksExpense(challan) ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span
                                                        className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
                                                        title="This deposit isn't in the expenses until its TDS Payment expense is linked."
                                                    >
                                                        <AlertTriangle className="h-3.5 w-3.5" />
                                                        No expense
                                                    </span>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-6 px-2 text-[11px]"
                                                        disabled={isSaving}
                                                        onClick={() => {
                                                            setLinkingChallan(challan.name);
                                                            setPickedExpense(null);
                                                        }}
                                                    >
                                                        <Link2 className="mr-1 h-3 w-3" />
                                                        Link
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1">
                                                    <span className="tabular-nums">{challan.tds_payment_expense}</span>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 w-6 p-0 text-muted-foreground"
                                                        disabled={isSaving}
                                                        aria-label={`Unlink expense from challan ${challan.challan_no}`}
                                                        title="Unlink this expense"
                                                        onClick={() => saveExpense(challan.name, null)}
                                                    >
                                                        <Unlink className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                    {linkingChallan === challan.name && (
                                        <tr className="bg-muted/30">
                                            <td colSpan={9} className="p-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="min-w-[280px] flex-1">
                                                        <ReactSelect<ExpenseOption>
                                                            inputId={`challan-expense-${challan.name}`}
                                                            aria-label={`TDS Payment expense for challan ${challan.challan_no}`}
                                                            placeholder="Pick the TDS Payment expense…"
                                                            options={expenseOptions}
                                                            value={pickedExpense}
                                                            onChange={(option) => setPickedExpense(option)}
                                                            isLoading={isExpensesLoading}
                                                            noOptionsMessage={() =>
                                                                "No unlinked TDS Payment expense. Record it under Expenses first."
                                                            }
                                                            styles={getSelectStyles<ExpenseOption>()}
                                                            menuPortalTarget={document.body}
                                                            menuPosition="fixed"
                                                            isDisabled={isSaving}
                                                        />
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        className="h-8"
                                                        disabled={!pickedExpense || isSaving}
                                                        onClick={() =>
                                                            pickedExpense && saveExpense(challan.name, pickedExpense.value)
                                                        }
                                                    >
                                                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8"
                                                        disabled={isSaving}
                                                        onClick={closePicker}
                                                    >
                                                        Cancel
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ChallanListDialog;
