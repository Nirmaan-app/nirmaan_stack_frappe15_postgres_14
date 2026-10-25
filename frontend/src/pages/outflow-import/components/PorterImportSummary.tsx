// src/pages/outflow-import/components/PorterImportSummary.tsx

import { AlertTriangle, CheckCircle2, Circle, Loader2, RefreshCw, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

import { repeatsLeftOutNote } from "../porterDiscard";
import {
    createProgress,
    foldPassedInvoices,
    invoiceFigureRows,
    invoiceProgress,
    invoiceStateLabel,
    invoiceStateTone,
    notMatchingBanner,
    porterCountsLine,
    porterStateNote,
    porterStateTone,
    retryLabel,
    warningLine,
    type InvoiceDateWindow,
    type PorterInvoiceStatus,
    type PorterStatus,
    type ProgressMark,
} from "../porterImport";
import { shownPorterState } from "../porterProgress";

const TONE_CLASS: Record<ReturnType<typeof invoiceStateTone>, string> = {
    passed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed: "border-destructive/30 bg-destructive/5 text-destructive",
    retry: "border-amber-300 bg-amber-50 text-amber-800",
    pending: "border-muted-foreground/20 bg-muted text-muted-foreground",
};

/**
 * A Porter import once it is in (#1443), and its check against Porter's own invoices (#1444, #1559): what
 * the file held, the import's state, a red banner naming each invoice that doesn't match and the next step,
 * then one card per invoice with something to say — still being checked, couldn't be read ("Try again"),
 * doesn't match ("Read the PDF again", #1562; its fare and date against the PDF's, the failing one highlighted), or passed with a quiet
 * warning line — and the invoices that simply passed folded under one line; then Create's progress (#1445).
 * Rendered by `ImportStatementDialog`, which polls the status while it is Validating or the Create job
 * runs, and holds the Create button in its footer.
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
    const dateWindow = status.invoice_date_window;
    const { shown: shownInvoices, folded, foldLabel } = foldPassedInvoices(status.invoices, collapseInvoices);
    const banner = notMatchingBanner(status.invoices, dateWindow);
    const cards = (invoices: PorterInvoiceStatus[]) => (
        <ul className="space-y-3">
            {invoices.map((invoice) => (
                <InvoiceCard
                    key={invoice.name}
                    invoice={invoice}
                    dateWindow={dateWindow}
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

            {banner && (
                <div role="alert" className="space-y-1 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    <p className="font-semibold">{banner.title}</p>
                    {banner.lines.map((line) => (
                        <p key={line}>{line}</p>
                    ))}
                    <p>{banner.next}</p>
                </div>
            )}

            {shownInvoices.length > 0 && cards(shownInvoices)}
            {foldLabel && (
                <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">{foldLabel}</summary>
                    <div className="mt-2">{cards(folded)}</div>
                </details>
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
    dateWindow,
    onRetry,
    retrying,
}: {
    invoice: PorterInvoiceStatus;
    dateWindow: InvoiceDateWindow | null | undefined;
    onRetry?: (invoice: string) => void;
    retrying: boolean;
}) => {
    const state = invoice.validation_status;
    const tone = invoiceStateTone(state);
    const retry = retryLabel(invoice);
    const warning = state === "Passed" ? warningLine(invoice.warnings) : null;
    // The figures matter once something is wrong: a mismatch, or a reading that could not decide.
    const showFigures = state === "Failed" || (state === "Error" && Boolean(invoice.read));
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
                    {retry && onRetry && (
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
                            {retry}
                        </Button>
                    )}
                    <Badge variant="outline" className={TONE_CLASS[tone]}>
                        {invoiceStateLabel(state)}
                    </Badge>
                </div>
            </div>

            {tone !== "passed" && tone !== "failed" && (
                <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {invoiceProgress(invoice).map((step, index) => (
                        <li key={step.label} className="flex items-center gap-1">
                            {index > 0 && <span className="mr-2 text-muted-foreground/40">→</span>}
                            {MARK_ICON[step.mark]}
                            <span className={step.mark === "todo" ? "text-muted-foreground" : ""}>{step.label}</span>
                        </li>
                    ))}
                </ol>
            )}

            {state === "Error" && invoice.validation_message && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{invoice.validation_message}</span>
                </div>
            )}

            {showFigures && (
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-muted-foreground">
                            <th className="w-1/3 py-1 text-left font-normal" />
                            <th className="py-1 text-left font-normal">Statement</th>
                            <th className="py-1 text-left font-normal">PDF</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoiceFigureRows(invoice, dateWindow).map((row) => (
                            <tr key={row.label} className={row.differs ? "text-destructive" : ""}>
                                <td className={`py-0.5 ${row.differs ? "font-medium" : "text-muted-foreground"}`}>
                                    {row.label}
                                </td>
                                <td className="whitespace-nowrap py-0.5 tabular-nums">{row.statement}</td>
                                <td className={`whitespace-nowrap py-0.5 tabular-nums ${row.differs ? "font-semibold" : ""}`}>
                                    {row.read ?? "—"}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {warning && <p className="border-l-2 pl-2 text-xs text-muted-foreground">{warning}</p>}
        </li>
    );
};
