/**
 * Every TDS challan on record — read-only.
 *
 * Opened from the ledger's summary strip. Unlike the picker inside PayTdsDialog, this lists
 * EVERY challan including the fully-used ones: the picker answers "what can I pay from?", this
 * answers "what have we deposited?", and hiding a spent challan would break the second question.
 *
 * `remaining` is DERIVED here (`amount - reconciled_amount`), never a stored column — the same
 * arithmetic the server does when it decides whether a challan can absorb a payment.
 */

import React, { useMemo, useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ExternalLink, Loader2 } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { TDSChallanAttachment } from "@/types/NirmaanStack/TDSChallanAttachment";

const CHALLAN_DOCTYPE = "TDS Challan Attachment";

interface ChallanListDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const ChallanListDialog: React.FC<ChallanListDialogProps> = ({ open, onOpenChange }) => {
    const [search, setSearch] = useState("");

    // Third arg is the swrKey, never an options object: nothing is fetched while closed.
    const { data: challans, isLoading } = useFrappeGetDocList<TDSChallanAttachment>(
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-hidden">
                <DialogHeader>
                    <DialogTitle>TDS Challans</DialogTitle>
                    <DialogDescription>
                        {rows.length} challan{rows.length === 1 ? "" : "s"} ·{" "}
                        {formatToIndianRupee(totals.amount)} deposited ·{" "}
                        {formatToIndianRupee(totals.remaining)} unused
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
                                    <th className="p-2 text-right font-medium">Amount</th>
                                    <th className="p-2 text-right font-medium">Used</th>
                                    <th className="p-2 text-right font-medium">Remaining</th>
                                    <th className="p-2 text-center font-medium">Receipt</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((challan) => (
                                    <tr key={challan.name} className="border-t">
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
                                    </tr>
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
