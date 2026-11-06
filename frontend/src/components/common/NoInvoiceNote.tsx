// An expense marked "No invoice": who marked it, when and why, shown where its invoice ref would be.
// One rendering for the Non Project Expenses table and a project's Misc. Project Expenses tab (stories 32, 45).
import { noInvoiceNote, type NoInvoiceFields } from "@/utils/expenses/noInvoiceView";

/** The note for a marked expense with no ref; null on any other, so the caller renders its own ref cell. */
export function NoInvoiceNote({
    expense,
    userName,
}: {
    expense: NoInvoiceFields;
    userName: (id?: string) => string;
}) {
    const note = !expense.invoice_ref && noInvoiceNote(expense, userName);
    if (!note) return null;
    return (
        <div className="min-w-0" title={note.detail}>
            <div className="font-medium text-amber-700">{note.label}</div>
            <div className="truncate text-[11px] text-muted-foreground">{note.detail}</div>
        </div>
    );
}
