// src/pages/outflow-import/components/PorterImportSummary.tsx

import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

import {
    PORTER_UPLOADED_NOTE,
    invoiceStateTone,
    porterCountsLine,
    type PorterStatus,
} from "../porterImport";

const TONE_CLASS: Record<ReturnType<typeof invoiceStateTone>, string> = {
    passed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed: "border-destructive/30 bg-destructive/5 text-destructive",
    pending: "border-muted-foreground/20 bg-muted text-muted-foreground",
};

/**
 * A Porter import once it is in (#1443): what the file held, and one line per Porter Invoice with the
 * statement's own figures and where its check stands. Rendered by `ImportStatementDialog`.
 */
export const PorterImportSummary = ({ status }: { status: PorterStatus }) => {
    const period =
        status.period_from && status.period_to && status.period_to !== status.period_from
            ? `${formatDate(status.period_from)} to ${formatDate(status.period_to)}`
            : status.period_from
              ? formatDate(status.period_from)
              : "not dated";
    return (
        <div className="space-y-4">
            <div className="space-y-2 rounded-md border bg-muted/30 p-4">
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        {porterCountsLine(status)}
                    </span>
                    <span className="text-muted-foreground">{period}</span>
                    <span className="tabular-nums text-muted-foreground">
                        Porter fare {formatToIndianRupee(status.fare_total)}
                    </span>
                </div>
                <p className="text-xs text-muted-foreground">{PORTER_UPLOADED_NOTE}</p>
            </div>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead>Billed by</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Fare</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                        <TableHead>Check</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {status.invoices.map((invoice) => (
                        <TableRow key={invoice.name}>
                            <TableCell className="whitespace-nowrap font-medium">
                                {invoice.invoice_number}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{invoice.city}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                                {invoice.billing_entity}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                                {invoice.completed_orders}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                                {formatToIndianRupee(invoice.fare_total)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                                {formatToIndianRupee(invoice.tax_total)}
                            </TableCell>
                            <TableCell>
                                <Badge
                                    variant="outline"
                                    className={TONE_CLASS[invoiceStateTone(invoice.validation_status)]}
                                    title={invoice.validation_message ?? undefined}
                                >
                                    {invoice.validation_status}
                                </Badge>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};
