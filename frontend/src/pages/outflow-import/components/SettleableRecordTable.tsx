// src/pages/outflow-import/components/SettleableRecordTable.tsx

import { AlertTriangle, Check } from "lucide-react";

import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    RECORD_COLUMNS,
    amountVerdict,
    ledgerLabel,
    recordDateLabel,
    recordKey,
    type SettleableRecord,
} from "../outflowTableModel";

interface Props {
    records: SettleableRecord[];
    /** The chosen record's `recordKey`, or `""` for none chosen. */
    selected: string;
    onSelect: (key: string) => void;
    /** The bank row's amount, for the per-row amount verdict. */
    bankAmount: number;
}

/**
 * The approved records this transfer could have paid, as a table with a radio per row.
 *
 * ⚠️ IT REPLACED A DROPDOWN, AND THE SHAPE IS THE POINT (owner, 2026-08-07). Each option used to
 * carry type, id, vendor, project, document, date, amount and a tolerance mark on two wrapped
 * lines, which meant a reviewer choosing between three approved records had to open the list, read
 * eight stacked facts three times over, and hold the comparison in their head. Comparison down a
 * column is what a table is for. The facts did not change -- their arrangement did.
 *
 * ⚠️ THE HEIGHT IS FIXED AND THE BODY SCROLLS INSIDE IT. The dialog already owns its own scrollbar
 * with a pinned header and footer; a list that grows with the result count pushes Confirm -- the one
 * control the dialog exists for -- down the body and out of reach. Bounding the table here is what
 * keeps the dialog's own height constant however many records come back.
 *
 * ⚠️ RECORDS OUTSIDE THE TOLERANCE ARE SHOWN AND MARKED, NEVER HIDDEN. Someone hunting a TDS
 * payment needs to SEE the one that differs by 2,000 in order to learn that it cannot be settled
 * here; filtering it out looks like the record does not exist.
 *
 * ⚠️ IT IS A REAL `<input type="radio">` IN A REAL RADIOGROUP. Arrow-key navigation between options,
 * the roving tab stop and the announced group name all come free from the platform and are
 * fiddly to rebuild on divs -- and this is the control that decides where money is written.
 */
export const SettleableRecordTable = ({
    records,
    selected,
    onSelect,
    bankAmount,
}: Props) => (
    // The bound is on the SCROLL CONTAINER, not on the table, so the header can be sticky INSIDE it:
    // a max-height on the table itself would scroll the header away with the rows.
    <div className="max-h-[260px] overflow-y-auto rounded-md border">
        <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
                {/* The radio column, then one per model column -- so the header cells and the body
                    cells cannot drift apart. */}
                <col style={{ width: "40px" }} />
                {RECORD_COLUMNS.map((column) => (
                    <col key={column.id} style={{ width: column.width }} />
                ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr>
                    <th className="w-10 border-b px-2 py-2">
                        <span className="sr-only">Choose</span>
                    </th>
                    {RECORD_COLUMNS.map((column) => (
                        <th
                            key={column.id}
                            className={`border-b px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground ${
                                column.align === "right" ? "text-right" : ""
                            }`}
                        >
                            {column.title}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody role="radiogroup" aria-label="Approved records this transfer could have paid">
                {records.map((record) => (
                    <RecordRow
                        key={recordKey(record)}
                        record={record}
                        chosen={recordKey(record) === selected}
                        onSelect={onSelect}
                        bankAmount={bankAmount}
                    />
                ))}
            </tbody>
        </table>
    </div>
);

const RecordRow = ({
    record,
    chosen,
    onSelect,
    bankAmount,
}: {
    record: SettleableRecord;
    chosen: boolean;
    onSelect: (key: string) => void;
    bankAmount: number;
}) => {
    const key = recordKey(record);
    const verdict = amountVerdict(record.amount, bankAmount);
    const date = recordDateLabel(record, formatDate);

    return (
        <tr
            // The whole row is the hit target -- a 14px radio is not. `cursor-pointer` and the hover
            // tint say so; the radio stays as the thing that LOOKS chosen.
            className={`cursor-pointer border-b last:border-b-0 transition-colors focus-within:bg-primary/10 ${
                chosen ? "bg-primary/5" : "hover:bg-muted/50"
            }`}
            onClick={() => onSelect(key)}
        >
            <td className="px-2 py-2 align-top">
                <input
                    type="radio"
                    // One group per dialog. Without a shared name the browser treats each input as
                    // its own group and arrow keys stop moving between them.
                    name="settleable-record"
                    className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-primary"
                    value={key}
                    checked={chosen}
                    onChange={() => onSelect(key)}
                    aria-label={`${ledgerLabel(record.target_doctype)} ${record.name}${
                        record.vendor_name ? `, ${record.vendor_name}` : ""
                    }, ${formatToRoundedIndianRupee(record.amount)}`}
                />
            </td>

            {/* ⚠️ THE TYPE IS NOT DECORATION, AND IT IS NOT ITS OWN COLUMN EITHER (owner ruling
                2026-08-10). One list holds all three ledgers, so the label is the only thing on the
                row saying whether this is a payment against a PO or an expense somebody booked --
                which is what three separate cards used to say by existing. But as a sixth column it
                pushed AMOUNT past the right edge, and the amount is the fact that decides whether a
                record can be settled at all. It stacks above the id it qualifies instead. */}
            <td className="px-2 py-2 align-top" title={record.name}>
                <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
                    {ledgerLabel(record.target_doctype)}
                </span>
                <div className="mt-0.5 truncate font-mono text-xs">{record.name}</div>
            </td>

            {/* ⚠️ `PAY-00105-034` SAYS NOTHING ABOUT WHOSE MONEY IT IS. A reviewer with three
                approved records in front of them picks by vendor and project. An em dash rather
                than a blank, so an absent vendor reads as absent rather than as a rendering gap. */}
            <td
                className="truncate px-2 py-2 align-top"
                title={record.vendor_name || undefined}
            >
                {record.vendor_name || <span className="text-muted-foreground">—</span>}
            </td>

            <td
                className="truncate px-2 py-2 align-top text-muted-foreground"
                title={record.project_name || undefined}
            >
                {record.project_name || "—"}
            </td>

            {/* "approved" vs "updated" -- see `recordDateLabel`; the word is the guard. */}
            <td className="truncate px-2 py-2 align-top text-xs text-muted-foreground" title={date}>
                {date || "—"}
            </td>

            <td className="px-2 py-2 align-top text-right">
                <span className="block tabular-nums">
                    {formatToRoundedIndianRupee(record.amount)}
                </span>
                <AmountMark suggested={record.suggested} difference={verdict.difference} />
            </td>
        </tr>
    );
};

/**
 * Whether this record's amount can be settled, in the cell where the amount already is.
 *
 * ⚠️ THREE STATES, NOT TWO. Exact / within the tolerance / outside it. Two states would have to
 * call a 31-paise difference either "same" (untrue) or a warning (misleading, since the system
 * settles it happily) -- and the bank rounds to the rupee on about a third of all payments, so the
 * middle case is the common one, not the rare one.
 *
 * The tolerance's VALUE is deliberately not named: it lives on the server, and a number repeated in
 * the client would drift the moment the owner changed it -- which has now happened twice.
 */
const AmountMark = ({
    suggested,
    difference,
}: {
    suggested: boolean;
    difference: number;
}) => {
    if (difference === 0) {
        return (
            <span className="flex items-center justify-end gap-1 text-[11px] text-emerald-700">
                <Check className="h-3 w-3" /> same
            </span>
        );
    }
    const gap = formatToRoundedIndianRupee(Math.abs(difference));
    if (suggested) {
        return (
            <span
                className="flex items-center justify-end gap-1 text-[11px] text-emerald-700"
                title={`Differs by ${gap} — within the accepted rounding tolerance, so this can be settled`}
            >
                <Check className="h-3 w-3" /> off by {gap}
            </span>
        );
    }
    return (
        <span
            className="flex items-center justify-end gap-1 text-[11px] text-amber-700"
            title={`Differs by ${gap} — too far apart to settle here. A deduction such as TDS looks like this; settle it in the payments screen`}
        >
            <AlertTriangle className="h-3 w-3" /> off by {gap}
        </span>
    );
};
