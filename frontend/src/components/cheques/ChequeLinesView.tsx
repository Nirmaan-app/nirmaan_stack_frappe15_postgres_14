import { Info } from "lucide-react";
import { Link } from "react-router-dom";

import type { ChequeLineType } from "@/types/NirmaanStack/Cheques";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { LINE_TYPE } from "@/utils/cheques/chequeLines";
import { recordPagePath } from "@/utils/cheques/chequeRecordLink";

/** One line as a read-only view shows it. `payment_status` only where the caller has it (the detail view). */
export interface ChequeLineViewRow {
    line_type: ChequeLineType;
    project?: string | null;
    project_name?: string | null;
    record_doctype?: string | null;
    record_name?: string | null;
    payment_name?: string | null;
    payment_status?: string | null;
    amount: number;
}

/**
 * A Cheque's lines, read-only (spec #1407): type, project, PO/WO, payment, amount. Shared by the detail
 * view and the report's expanded row. The caller says what to show for an Ad-hoc cheque (no lines). A Security
 * Deposit's Secured PO/WO line is a record only: no payment, no amount (#1486).
 *
 * The ⓘ beside a PO / WO opens its page (`recordPagePath`), as the tracker's Vendor / Payee ⓘ opens the vendor.
 * `linkRecords={false}` drops it where leaving the page would lose work (Edit cheque).
 */
export function ChequeLinesView({ lines, linkRecords = true }: { lines: ChequeLineViewRow[]; linkRecords?: boolean }) {
    return (
        <div className="overflow-x-auto rounded border bg-background">
            <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Project</th>
                        <th className="px-3 py-2">PO / WO</th>
                        <th className="px-3 py-2">Payment</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((line, i) => {
                        const secured = line.line_type === LINE_TYPE.SECURED;
                        const recordPath = linkRecords ? recordPagePath(line.record_doctype, line.record_name) : null;
                        return (
                            <tr key={i} className="border-t">
                                <td className="px-3 py-2 whitespace-nowrap">{line.line_type}</td>
                                <td className="px-3 py-2">{line.project_name || line.project || "--"}</td>
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-1">
                                        {line.record_name || "--"}
                                        {recordPath && (
                                            <Link
                                                to={recordPath}
                                                title={`Open ${line.record_name}`}
                                                aria-label={`Open ${line.record_name}`}
                                                className="shrink-0"
                                            >
                                                <Info className="h-3.5 w-3.5 text-blue-500" />
                                            </Link>
                                        )}
                                    </div>
                                </td>
                                <td className="px-3 py-2">
                                    {secured ? (
                                        <span className="text-muted-foreground">Secured, pays nothing</span>
                                    ) : line.payment_name ? (
                                        <>
                                            {line.payment_name}
                                            {line.payment_status && (
                                                <span className="ml-1 text-xs text-muted-foreground">({line.payment_status})</span>
                                            )}
                                        </>
                                    ) : (
                                        <span className="text-muted-foreground">No payment yet</span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                    {secured ? "--" : formatToIndianRupeeOrZero(line.amount)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
