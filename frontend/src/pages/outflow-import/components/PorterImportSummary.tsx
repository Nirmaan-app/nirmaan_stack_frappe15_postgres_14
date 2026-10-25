// src/pages/outflow-import/components/PorterImportSummary.tsx

import { AlertTriangle, CheckCircle2, Circle, Loader2, RefreshCw, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

import { repeatsLeftOutNote } from "../porterDiscard";
import {
    canRetryInvoice,
    createProgress,
    invoiceFigureRows,
    invoiceProgress,
    invoiceStateTone,
    porterCountsLine,
    porterStateNote,
    porterStateTone,
    type InvoiceFigureRow,
    type PorterInvoiceStatus,
    type PorterStatus,
    type ProgressMark,
} from "../porterImport";
import { shownPorterState } from "../porterProgress";

const TONE_CLASS: Record<ReturnType<typeof invoiceStateTone>, string> = {
    passed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed: "border-destructive/30 bg-destructive/5 text-destructive",
    pending: "border-muted-foreground/20 bg-muted text-muted-foreground",
};

/**
 * A Porter import once it is in (#1443), and its check against Porter's own invoices (#1444): what the
 * file held, the import's state, and one card per Porter Invoice showing Downloading → Reading →
 * Comparing → Passed / Failed / Error, the statement's figures beside what Gemini read, and Retry on
 * an Error; then Create's progress (#1445). Rendered by `ImportStatementDialog`, which polls the status while
 * it is Validating or the Create job runs, and holds the Create button in its footer.
 */
export const PorterImportSummary = ({
    status,
    onRetry,
    retrying,
    collapseInvoices = false,
}: {
    status: PorterStatus;
    onRetry?: (invoice: string) => void;
    retrying?: string | null;
    /** Once every invoice passed, the cards fold away under one line so the review leads (#1446). */
    collapseInvoices?: boolean;
}) => {
    const period =
        status.period_from && status.period_to && status.period_to !== status.period_from
            ? `${formatDate(status.period_from)} to ${formatDate(status.period_to)}`
            : status.period_from
              ? formatDate(status.period_from)
              : "not dated";
    const progress = createProgress(status);
    // "Creating" only while the Create job runs; a partly created import with none reads "Needs you" (#1556).
    const shown = shownPorterState(status);
    const invoiceCards = (
        <ul className="space-y-3">
            {status.invoices.map((invoice) => (
                <InvoiceCard
                    key={invoice.name}
                    invoice={invoice}
                    onRetry={onRetry}
                    retrying={retrying === invoice.name}
                />
            ))}
        </ul>
    );
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
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={TONE_CLASS[porterStateTone(shown)]}>
                        {(status.state === "Validating" || status.create_running) && (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
                        {shown}
                    </Badge>
                    <p className="text-xs text-muted-foreground">{porterStateNote(shown)}</p>
                </div>
                {repeatsLeftOutNote(status.repeats_not_saved) && (
                    <p className="text-xs text-muted-foreground">{repeatsLeftOutNote(status.repeats_not_saved)}</p>
                )}
                {progress && (
                    <p
                        className={`text-sm tabular-nums ${status.failed > 0 && !status.create_running ? "text-destructive" : ""}`}
                    >
                        {progress}
                    </p>
                )}
            </div>

            {collapseInvoices ? (
                <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                        Show the {status.invoices.length} invoice{status.invoices.length === 1 ? "" : "s"} checked
                    </summary>
                    <div className="mt-2">{invoiceCards}</div>
                </details>
            ) : (
                invoiceCards
            )}
        </div>
    );
};

const MARK_ICON: Record<ProgressMark, JSX.Element> = {
    todo: <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />,
    current: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
    done: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
    passed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
    failed: <XCircle className="h-3.5 w-3.5 text-destructive" />,
};

const InvoiceCard = ({
    invoice,
    onRetry,
    retrying,
}: {
    invoice: PorterInvoiceStatus;
    onRetry?: (invoice: string) => void;
    retrying: boolean;
}) => {
    const tone = invoiceStateTone(invoice.validation_status);
    return (
        <li className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="font-medium">{invoice.invoice_number}</div>
                    <div className="text-xs text-muted-foreground">
                        {invoice.city} · {invoice.billing_entity} · {invoice.completed_orders} order
                        {invoice.completed_orders === 1 ? "" : "s"}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {canRetryInvoice(invoice) && onRetry && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onRetry(invoice.name)}
                            disabled={retrying}
                        >
                            {retrying ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Retry
                        </Button>
                    )}
                    <Badge variant="outline" className={TONE_CLASS[tone]}>
                        {invoice.validation_status}
                    </Badge>
                </div>
            </div>

            <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {invoiceProgress(invoice).map((step, index) => (
                    <li key={step.label} className="flex items-center gap-1">
                        {index > 0 && <span className="mr-2 text-muted-foreground/40">→</span>}
                        {MARK_ICON[step.mark]}
                        <span className={step.mark === "todo" ? "text-muted-foreground" : ""}>{step.label}</span>
                    </li>
                ))}
            </ol>

            {invoice.validation_message && (
                <div
                    className={`flex items-start gap-2 rounded-md p-2 text-xs ${
                        tone === "failed" ? "bg-destructive/5 text-destructive" : "bg-muted text-muted-foreground"
                    }`}
                >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{invoice.validation_message}</span>
                </div>
            )}

            <table className="w-full text-xs">
                <thead>
                    <tr className="text-muted-foreground">
                        <th className="w-1/3 py-1 text-left font-normal" />
                        <th className="py-1 text-left font-normal">Statement</th>
                        <th className="py-1 text-left font-normal">Invoice (as read)</th>
                    </tr>
                </thead>
                <tbody>
                    {invoiceFigureRows(invoice).map((row) => (
                        <FigureRow key={row.label} row={row} />
                    ))}
                </tbody>
            </table>
            {invoice.read?.invoice_date && (
                <p className="text-xs text-muted-foreground">
                    Invoice dated {formatDate(invoice.read.invoice_date)}
                </p>
            )}
        </li>
    );
};

const FigureRow = ({ row }: { row: InvoiceFigureRow }) => {
    const show = (value: string | number | null) =>
        value === null || value === "" ? "—" : row.money ? formatToIndianRupee(Number(value)) : String(value);
    return (
        <tr className={row.differs ? "text-destructive" : ""}>
            <td className="py-0.5 text-muted-foreground">{row.label}</td>
            <td className="whitespace-nowrap py-0.5 tabular-nums">{show(row.statement)}</td>
            <td className={`whitespace-nowrap py-0.5 tabular-nums ${row.differs ? "font-medium" : ""}`}>
                {show(row.read)}
            </td>
        </tr>
    );
};
