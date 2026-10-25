// src/pages/outflow-import/components/CardImportReview.tsx

import { CheckCircle2, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import formatToIndianRupee from "@/utils/FormatPrice";

import {
    CARD_UPLOADED_NOTE,
    cardCountsLine,
    cardDay,
    cardPeriodLabel,
    cardTotalsRows,
    type CardImport,
} from "../creditCardImport";
import { cardWorkLines } from "../cardCreditsView";
import { CardSkippedLines } from "./CardSkippedLines";

/**
 * A Credit Card Statement import once it is in (#1566): the statement's header (holder, company, statement
 * date, billing period), its five summary totals and every line, READ-ONLY. Rendered by
 * `ImportStatementDialog`, which holds Discard in its footer. Type suggestion and Create are later slices.
 */
export const CardImportReview = ({ card }: { card: CardImport }) => (
    <div className="space-y-4">
        <div className="space-y-3 rounded-md border bg-muted/30 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <span className="text-base font-semibold">{card.holder}</span>
                <span className="text-sm text-muted-foreground">{cardPeriodLabel(card)}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
                <dt className="text-muted-foreground">Company</dt>
                <dd>{card.company}</dd>
                <dt className="text-muted-foreground">Statement date</dt>
                <dd>{cardDay(card.statement_date)}</dd>
                <dt className="text-muted-foreground">File</dt>
                <dd className="flex min-w-0 items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {card.statement_file ? (
                        <a
                            href={card.statement_file}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-primary underline-offset-2 hover:underline"
                        >
                            {card.original_filename}
                        </a>
                    ) : (
                        <span className="truncate">{card.original_filename}</span>
                    )}
                </dd>
                <dt className="text-muted-foreground">Import</dt>
                <dd>{card.batch}</dd>
            </dl>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {cardTotalsRows(card).map((row) => (
                    <div key={row.label} className="rounded-md border bg-background px-3 py-2">
                        <div className="text-[11px] text-muted-foreground">{row.label}</div>
                        <div className="whitespace-nowrap text-sm font-medium tabular-nums">
                            {formatToIndianRupee(row.amount)}
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    {cardCountsLine(card)}
                </span>
                <span className="text-xs text-muted-foreground">{CARD_UPLOADED_NOTE}</span>
            </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                        <th className="px-3 py-2 text-left font-medium">Date</th>
                        <th className="px-3 py-2 text-left font-medium">SerNo</th>
                        <th className="px-3 py-2 text-left font-medium">Transaction details</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {cardWorkLines(card).map((line) => (
                        <tr key={line.name}>
                            <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cardDay(line.date)}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
                                {line.serno}
                            </td>
                            <td className="px-3 py-1.5">{line.details}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                                {formatToIndianRupee(line.amount)}
                                {line.is_credit && (
                                    <Badge
                                        variant="outline"
                                        className="ml-1.5 border-emerald-200 bg-emerald-50 px-1 py-0 text-[10px] text-emerald-700"
                                    >
                                        CR
                                    </Badge>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        <CardSkippedLines card={card} />
    </div>
);
