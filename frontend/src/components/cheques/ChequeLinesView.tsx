import type { ChequeLineType } from "@/types/NirmaanStack/Cheques";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";

/** One line as a read-only view shows it. `payment_status` only where the caller has it (the detail view). */
export interface ChequeLineViewRow {
    line_type: ChequeLineType;
    project?: string | null;
    project_name?: string | null;
    record_name?: string | null;
    payment_name?: string | null;
    payment_status?: string | null;
    amount: number;
}

/**
 * A Cheque's lines, read-only (spec #1407): type, project, PO/WO, payment, amount. Shared by the detail
 * view and the report's expanded row. The caller says what to show for an Ad-hoc cheque (no lines).
 */
export function ChequeLinesView({ lines }: { lines: ChequeLineViewRow[] }) {
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
                    {lines.map((line, i) => (
                        <tr key={i} className="border-t">
                            <td className="px-3 py-2 whitespace-nowrap">{line.line_type}</td>
                            <td className="px-3 py-2">{line.project_name || line.project || "--"}</td>
                            <td className="px-3 py-2">{line.record_name || "--"}</td>
                            <td className="px-3 py-2">
                                {line.payment_name ? (
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
                                {formatToIndianRupeeOrZero(line.amount)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
