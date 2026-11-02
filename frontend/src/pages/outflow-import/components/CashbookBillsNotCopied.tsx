// src/pages/outflow-import/components/CashbookBillsNotCopied.tsx
//
// The import summary's bills not copied (#1591, story 19): each with the server's reason. Shown in the live import
// dialog and on the batch view (`CashbookJobPanel`, code review S3), so it can be read after the dialog is closed.

import { type BillNotCopied, type CashbookStatus, billNotCopiedLabel, billsNotCopiedHeading } from "../cashbookPreview";

/** The heading and one line per bill the job could not copy; nothing while the job runs or when every bill was copied. */
export const CashbookBillsNotCopied = ({ status }: { status: CashbookStatus | null }) => {
    const heading = billsNotCopiedHeading(status);
    if (!heading) return null;
    const lines: BillNotCopied[] = status?.bills_not_copied ?? [];
    return (
        <div className="space-y-1 text-xs">
            <p className="text-amber-700 dark:text-amber-500">{heading}</p>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                {lines.map((line) => (
                    <li key={`${line.transfer_id}:${line.expense ?? ""}`} className="break-words text-muted-foreground">
                        <span className="font-medium text-foreground">{billNotCopiedLabel(line)}</span>: {line.reason}
                    </li>
                ))}
            </ul>
        </div>
    );
};
