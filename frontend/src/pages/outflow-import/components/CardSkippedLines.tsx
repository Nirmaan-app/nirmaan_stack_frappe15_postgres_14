// src/pages/outflow-import/components/CardSkippedLines.tsx

import formatToIndianRupee from "@/utils/FormatPrice";

import { cardSkippedLines, cardSkippedSummary } from "../cardCreditsView";
import { cardDay, type CardImport } from "../creditCardImport";

/**
 * Review's list of the lines the upload sorted out (#1567): payments into the card, cashback and refund pairs,
 * each with the server's reason, so nothing is dropped silently. Unskip lives in the main table's Skipped
 * popup, where a refund pair comes back whole.
 */
export const CardSkippedLines = ({ card }: { card: CardImport }) => {
    const summary = cardSkippedSummary(card);
    if (!summary) return null;
    return (
        <div className="space-y-2">
            <div className="text-sm font-medium">{summary}</div>
            <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Date</th>
                            <th className="px-3 py-2 text-left font-medium">Transaction details</th>
                            <th className="px-3 py-2 text-right font-medium">Amount</th>
                            <th className="px-3 py-2 text-left font-medium">Skipped because</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {cardSkippedLines(card).map((line) => (
                            <tr key={line.name} className="text-muted-foreground">
                                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cardDay(line.date)}</td>
                                <td className="px-3 py-1.5">
                                    {line.details}
                                    <div className="text-[11px] tabular-nums">{line.serno}</div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                                    {formatToIndianRupee(line.amount)}
                                    {line.is_credit ? " CR" : ""}
                                </td>
                                <td className="px-3 py-1.5">
                                    <div className="font-medium text-foreground">{line.skip_kind}</div>
                                    <div className="text-xs">{line.skip_reason}</div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
