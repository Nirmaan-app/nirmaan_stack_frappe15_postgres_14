// src/pages/outflow-import/components/ReconciliationReport.tsx

import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { OutflowReconciliationReport } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { rowStatusTone } from "../outflowImportStatus";

/**
 * The batch's two findings lists.
 *
 * They answer different questions and neither substitutes for the other. Matching a bank row to a
 * payment answers "is this transfer recorded?". Only the reverse list answers "is every payment we
 * recorded backed by a real transfer?" -- and that second question is the one nobody asks until an
 * audit does.
 */
export const ReconciliationReport = ({ report }: { report: OutflowReconciliationReport }) => (
    <div className="space-y-6">
        <section className="space-y-2">
            <h3 className="text-sm font-semibold">Reported findings</h3>
            <p className="text-xs text-muted-foreground">
                Read-only. This import never edits a payment, so each of these is a description of
                something to look at, not a change that was made.
            </p>
            {report.exceptions.length ? (
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="p-2 font-medium">Beneficiary</th>
                                <th className="p-2 text-right font-medium">Amount</th>
                                <th className="p-2 font-medium">Finding</th>
                                <th className="p-2 font-medium">Detail</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.exceptions.map((e) => (
                                <tr key={e.name} className="border-t align-top">
                                    <td className="p-2">{e.beneficiary_name || "--"}</td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums">
                                        {formatToRoundedIndianRupee(e.amount)}
                                    </td>
                                    <td className="p-2">
                                        <Badge
                                            variant="outline"
                                            className={`whitespace-nowrap border-0 ${rowStatusTone(e.row_status)}`}
                                        >
                                            {e.row_status}
                                        </Badge>
                                    </td>
                                    <td className="p-2 text-xs text-muted-foreground">
                                        {e.outcome_note}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                    Nothing flagged. Every matched transfer agreed with the payment behind it.
                </p>
            )}
        </section>

        <section className="space-y-2">
            <h3 className="text-sm font-semibold">
                Payments in this period with no transfer in the statement
            </h3>
            <p className="text-xs text-muted-foreground">
                Informational, not an alarm - a payment may legitimately have gone out through
                another channel.{" "}
                {report.unmatched_payments.length > 0 && (
                    <span className="font-medium">
                        {report.unmatched_payments.length} payments,{" "}
                        {formatToRoundedIndianRupee(report.unmatched_payment_total)}.
                    </span>
                )}
            </p>
            {report.unmatched_payments.length ? (
                <div className="max-h-96 overflow-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="p-2 font-medium">Payment</th>
                                <th className="p-2 font-medium">Vendor</th>
                                <th className="p-2 text-right font-medium">Amount</th>
                                <th className="p-2 font-medium">Paid on</th>
                                <th className="p-2 font-medium">Recorded reference</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.unmatched_payments.map((p) => (
                                <tr key={p.name} className="border-t">
                                    <td className="p-2">
                                        <Link
                                            to={`/project-payments/${p.name}`}
                                            className="text-primary underline underline-offset-2"
                                        >
                                            {p.name}
                                        </Link>
                                    </td>
                                    <td className="max-w-[220px] truncate p-2">
                                        {p.vendor_name || "--"}
                                    </td>
                                    <td className="whitespace-nowrap p-2 text-right tabular-nums">
                                        {formatToRoundedIndianRupee(p.amount)}
                                    </td>
                                    <td className="whitespace-nowrap p-2">
                                        {p.payment_date ? formatDate(p.payment_date) : "--"}
                                    </td>
                                    <td className="p-2 font-mono text-xs">{p.utr || "--"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                    Every payment recorded in this period has a transfer behind it.
                </p>
            )}
        </section>
    </div>
);
