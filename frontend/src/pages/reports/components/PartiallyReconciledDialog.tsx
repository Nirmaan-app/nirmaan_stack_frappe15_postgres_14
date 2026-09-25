import React from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ExpenseBankLinesPopover } from "@/pages/ProjectPayments/components/ExpenseBankLinesPopover";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import type { PartiallyReconciledFigure } from "../hooks/usePartiallyReconciled";

/**
 * The records behind an Outflow Report's "+ Partially Reconciled" line (owner, 2026-09-24).
 *
 * ⚠️ A LIST BEHIND THE FIGURE, NOT ROWS IN THE TABLE. The report table stays Paid records only
 * (owner, 2026-09-23); this is where a reader checks WHICH open records make up the added money.
 *
 * ⚠️ THE TOTAL ROW IS THE FIGURE, by construction: each row's "Bank-matched" is the item's
 * `amount`, the very number the summary adds. Bill and Still pending are context, never summed
 * into the headline.
 *
 * Clicking a record's id opens the SAME read-only Bank lines card the Payments table uses -- one
 * definition of "the lines that paid this record", not a second list here.
 */
export const PartiallyReconciledDialog: React.FC<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    done: PartiallyReconciledFigure;
}> = ({ open, onOpenChange, done }) => {
    const showProject = done.items.some((i) => i.project);
    const billTotal = done.items.reduce((sum, i) => sum + (i.bill_amount || 0), 0);
    const pendingTotal = done.items.reduce((sum, i) => sum + (i.pending_amount || 0), 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Partially Reconciled ({done.count})</DialogTitle>
                    <DialogDescription>
                        Records still Reconciliation Pending that bank lines already part-cover.
                        Only the bank-matched part is added to the total. A record counts on the
                        date of its newest bank line. Click an id to see its bank lines.
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-auto">
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Record</TableHead>
                                <TableHead>Type / Description</TableHead>
                                {showProject && <TableHead>Project</TableHead>}
                                <TableHead className="text-right">Bill amount</TableHead>
                                <TableHead className="text-right">Bank-matched</TableHead>
                                <TableHead className="text-right">Still pending</TableHead>
                                <TableHead className="whitespace-nowrap">Newest bank line</TableHead>
                                <TableHead className="text-right">Lines</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {done.items.map((item) => {
                                const label = item.type || item.document_name || "—";
                                return (
                                    <TableRow key={`${item.doctype}:${item.name}`} className="align-top">
                                        <TableCell className="whitespace-nowrap font-mono">
                                            <ExpenseBankLinesPopover
                                                doctype={item.doctype}
                                                name={item.name}
                                                subtitle={label}
                                                description={item.description ?? undefined}
                                                status="Reconciliation Pending"
                                                lineCount={item.line_count}
                                            >
                                                {item.name}
                                            </ExpenseBankLinesPopover>
                                        </TableCell>
                                        <TableCell className="max-w-[18rem]">
                                            <span className="block font-medium">{label}</span>
                                            {item.description && (
                                                <span
                                                    className="block truncate text-muted-foreground"
                                                    title={item.description}
                                                >
                                                    {item.description}
                                                </span>
                                            )}
                                        </TableCell>
                                        {showProject && (
                                            <TableCell>{item.project_name || item.project || "—"}</TableCell>
                                        )}
                                        <TableCell className="text-right tabular-nums">
                                            {formatToRoundedIndianRupee(item.bill_amount)}
                                        </TableCell>
                                        <TableCell className="text-right font-semibold tabular-nums">
                                            {formatToRoundedIndianRupee(item.amount)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-400">
                                            {formatToRoundedIndianRupee(item.pending_amount)}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap tabular-nums">
                                            {item.latest_line_date ? formatDate(item.latest_line_date) : "—"}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{item.line_count}</TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                        <TableFooter>
                            <TableRow>
                                <TableCell colSpan={showProject ? 3 : 2} className="font-semibold">
                                    Total
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatToRoundedIndianRupee(billTotal)}
                                </TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">
                                    {formatToRoundedIndianRupee(done.amount)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatToRoundedIndianRupee(pendingTotal)}
                                </TableCell>
                                <TableCell colSpan={2} />
                            </TableRow>
                        </TableFooter>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    );
};
