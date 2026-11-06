// src/pages/outflow-import/components/CardInternalTransfers.tsx

import formatToIndianRupee from "@/utils/FormatPrice";

import { cardInternalTransferLines } from "../cardCreditsView";
import { cardDay, type CardImport } from "../creditCardImport";
import { internalTransfersHeading } from "../internalTransferView";

interface CardInternalTransfersProps {
    card: CardImport;
}

/**
 * Review's "Internal transfers" list (#1624, spec #1619): the bank's auto-debit paying the card, each with its note
 * naming From, To and the card. Its own short list, so the skipped lines below mean only "set aside", as on the
 * main table, where these lines sit in the Internal Transfers tab.
 */
export const CardInternalTransfers = ({ card }: CardInternalTransfersProps) => {
    const lines = cardInternalTransferLines(card);
    const heading = internalTransfersHeading(lines.length);
    if (!heading) return null;
    return (
        <div className="space-y-2">
            <div className="text-sm font-medium">{heading}</div>
            <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Date</th>
                            <th className="px-3 py-2 text-left font-medium">Transaction details</th>
                            <th className="px-3 py-2 text-right font-medium">Amount</th>
                            <th className="px-3 py-2 text-left font-medium">Recorded as</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {lines.map((line) => (
                            <tr key={line.name}>
                                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cardDay(line.date)}</td>
                                <td className="px-3 py-1.5">
                                    {line.details}
                                    <div className="text-[11px] tabular-nums text-muted-foreground">{line.serno}</div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                                    {formatToIndianRupee(line.amount)}
                                    {line.is_credit ? " CR" : ""}
                                </td>
                                <td className="px-3 py-1.5 text-xs">{line.outcome_note}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
