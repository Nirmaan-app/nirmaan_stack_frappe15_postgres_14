/**
 * The Payee page's Linked Expenses tab (#1423, mockup screen 2): Project and Non Project Expenses
 * naming this Payee, at any status. Expenses have no page of their own, so the ID is plain text.
 */

import { Link } from "react-router-dom";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PAYEE_EXPENSE_KIND, type PayeeLinkedExpense } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";

const KIND_LABEL = {
    [PAYEE_EXPENSE_KIND.PROJECT]: "Project Expense",
    [PAYEE_EXPENSE_KIND.NON_PROJECT]: "Non Project Expense",
};

const kindChip = (kind: PayeeLinkedExpense["kind"]) =>
    kind === PAYEE_EXPENSE_KIND.PROJECT
        ? "bg-violet-50 text-violet-700 ring-violet-200"
        : "bg-amber-50 text-amber-800 ring-amber-200";

const statusChip = (status: string) =>
    status === "Paid"
        ? "bg-sky-100 text-sky-800"
        : status === "Approved"
          ? "bg-amber-100 text-amber-800"
          : "bg-zinc-100 text-zinc-700";

export function PayeeLinkedExpensesTab({ expenses }: { expenses: PayeeLinkedExpense[] }) {
    return (
        <div className="flex flex-col gap-2.5">
            <p className="text-sm text-zinc-600">Project and Non Project Expenses that name this payee.</p>
            <div className="overflow-x-auto rounded-md border">
                <Table className="min-w-[820px]">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Expense ID</TableHead>
                            <TableHead>Kind</TableHead>
                            <TableHead>Expense type</TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Paid on</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {expenses.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                                    No expense names this payee.
                                </TableCell>
                            </TableRow>
                        )}
                        {expenses.map((e) => (
                            <TableRow key={e.name}>
                                <TableCell className="whitespace-nowrap font-medium">{e.name}</TableCell>
                                <TableCell>
                                    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", kindChip(e.kind))}>
                                        {KIND_LABEL[e.kind]}
                                    </span>
                                </TableCell>
                                <TableCell>{e.expense_type || "--"}</TableCell>
                                <TableCell className="font-medium">
                                    {e.project ? (
                                        <Link to={`/projects/${encodeURIComponent(e.project)}`} className="text-blue-600 hover:underline">
                                            {e.project_name || e.project}
                                        </Link>
                                    ) : (
                                        <span className="font-normal text-muted-foreground">None</span>
                                    )}
                                </TableCell>
                                <TableCell className="whitespace-nowrap font-medium tabular-nums">{formatToIndianRupeeOrZero(e.amount)}</TableCell>
                                <TableCell>
                                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", statusChip(e.status))}>{e.status}</span>
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                    {e.paid_on ? formatDate(e.paid_on) : <span className="text-muted-foreground">Not yet</span>}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
