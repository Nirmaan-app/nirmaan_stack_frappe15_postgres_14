import { useFormContext, useWatch } from "react-hook-form";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";
import type { ChequeFormInput } from "@/utils/cheques/chequeForm";
import { LINE_LABELS, LINE_TYPE, type ChequeLineDraft } from "@/utils/cheques/chequeLines";
import { parseNumber } from "@/utils/parseNumber";

interface RecordedLineRowProps {
    index: number;
    disabled?: boolean;
    onRemove: () => void;
}

/**
 * A line recorded before spec #1477 that a Payment cheque no longer takes: a Work Order payment, or an
 * Old-type cheque's expense. Shown as it is, never edited (#1482); while the cheque is Pending it may still
 * come off.
 */
export const RecordedLineRow = ({ index, disabled, onRemove }: RecordedLineRowProps) => {
    const { control } = useFormContext<ChequeFormInput>();
    const line = useWatch({ control, name: `lines.${index}` }) as ChequeLineDraft;
    const record = line.line_type === LINE_TYPE.PO_WO
        ? `WO ${line.record_name}`
        : LINE_LABELS[line.line_type];

    return (
        <TableRow className="align-top text-sm">
            <TableCell className="truncate">{line.project || "—"}</TableCell>
            <TableCell className="truncate">{record}</TableCell>
            <TableCell className="truncate">
                {line.payment_name || "No payment yet"}
                {line.payment_status ? ` · ${line.payment_status}` : ""}
            </TableCell>
            <TableCell>{formatToIndianRupee(parseNumber(line.amount))}</TableCell>
            <TableCell>
                <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={onRemove} aria-label="Remove line">
                    <Trash2 className="h-4 w-4" />
                </Button>
            </TableCell>
        </TableRow>
    );
};
