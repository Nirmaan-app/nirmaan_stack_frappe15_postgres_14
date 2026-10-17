import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { ChequeLinesView } from "@/components/cheques/ChequeLinesView";
import { ChequePhoto } from "@/components/cheques/ChequePhotoLink";
import { ChequeStatusBadge } from "@/components/cheques/ChequeStatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHEQUE_TYPE } from "@/types/NirmaanStack/Cheques";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { chequeDateText } from "@/utils/cheques/chequeChip";
import type { ChequeRowAction } from "@/utils/cheques/chequeRowActions";
import { getFrappeError } from "@/utils/frappeErrors";

import { type ChequeDetail, useChequeDetail } from "./useChequeDetail";

/** The Clear and Cancel buttons the detail view shows, as the Tracker row offers them (`chequeRowActions`). */
export interface ChequeDetailActions {
    actionsOf: (cheque: ChequeDetail) => ChequeRowAction[];
    onClear: (cheque: ChequeDetail) => void;
    onCancel: (cheque: ChequeDetail) => void;
}

interface ChequeDetailDialogProps {
    /** The Cheque shown; the dialog is closed while null. */
    cheque: string | null;
    onClose: () => void;
    /** Clear and Cancel, when the viewer may (the Cheque Tracker passes them). */
    actions?: ChequeDetailActions;
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="break-words text-sm">{children || "--"}</div>
    </div>
);

/** "12-10-2026 · By hand", or just the date. */
const clearedText = (cheque: ChequeDetail) =>
    cheque.clearance_date
        ? [chequeDateText(cheque.clearance_date), cheque.cleared_by].filter(Boolean).join(" · ")
        : "";

/**
 * The Cheque detail view (#1412, spec #1407; #1484): photo, header (type, the cheque, issue and clearance dates,
 * how it was cleared and the bank line), lines and the full status history, with Clear and Cancel when the
 * viewer may. Holds the Cheque's name and refetches on every Cheque change, so it stays live after a move.
 */
export const ChequeDetailDialog = ({ cheque: name, onClose, actions }: ChequeDetailDialogProps) => {
    const { cheque, error, isLoading } = useChequeDetail(name);
    const offered = cheque && actions ? actions.actionsOf(cheque) : [];
    const line = cheque?.bank_line_detail;

    return (
        <Dialog open={!!name} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-3">
                        Cheque {cheque?.cheque_no ?? ""}
                        {cheque && <ChequeStatusBadge status={cheque.status} />}
                        {cheque && actions && (offered.includes("clear") || offered.includes("cancel")) && (
                            <span className="ml-auto mr-6 flex gap-2">
                                {offered.includes("clear") && (
                                    <Button size="sm" variant="outline" onClick={() => actions.onClear(cheque)}>
                                        Clear
                                    </Button>
                                )}
                                {offered.includes("cancel") && (
                                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => actions.onCancel(cheque)}>
                                        Cancel cheque
                                    </Button>
                                )}
                            </span>
                        )}
                    </DialogTitle>
                </DialogHeader>

                {isLoading && (
                    <div className="flex justify-center py-10">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                )}
                {error && <p className="text-sm text-destructive">{getFrappeError(error)}</p>}

                {cheque && (
                    <div className="space-y-5">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                            <div>
                                {cheque.attachment ? (
                                    <ChequePhoto
                                        url={cheque.attachment}
                                        chequeNo={cheque.cheque_no}
                                        className="max-h-72 w-full rounded border object-contain"
                                    />
                                ) : (
                                    <div className="flex h-40 items-center justify-center rounded border border-dashed text-sm text-muted-foreground">
                                        No photo
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3 content-start">
                                <Field label="Type">
                                    {cheque.cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT ? "Security Deposit" : "Payment cheque"}
                                    {cheque.old_type ? " · Old-type" : ""}
                                </Field>
                                <Field label="Bank">{cheque.bank_label}</Field>
                                <Field label="Cheque date">{chequeDateText(cheque.cheque_date)}</Field>
                                <Field label="Issue date">{chequeDateText(cheque.issue_date)}</Field>
                                <Field label="Clearance date">{clearedText(cheque)}</Field>
                                <Field label="Bank line">
                                    {line
                                        ? `${chequeDateText(line.added_on)} · ${formatToIndianRupeeOrZero(line.amount)} · No. ${line.reference_id ?? ""} (${line.name})`
                                        : cheque.bank_line}
                                </Field>
                                <Field label="Amount">{formatToIndianRupeeOrZero(cheque.amount)}</Field>
                                <Field label={cheque.vendor ? "Vendor" : "Payee"}>
                                    {cheque.vendor ? cheque.vendor_name || cheque.vendor : cheque.payee_name}
                                </Field>
                                <Field label="Made from">{cheque.made_from}</Field>
                                <Field label="Created by">
                                    {cheque.owner_name || cheque.owner} · {chequeDateText(cheque.creation) || "--"}
                                </Field>
                                <div className="col-span-2">
                                    <Field label="Description">{cheque.description}</Field>
                                </div>
                            </div>
                        </div>

                        <section>
                            <h3 className="mb-2 text-sm font-semibold">Lines</h3>
                            {cheque.lines.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No lines: an Ad-hoc cheque.</p>
                            ) : (
                                <ChequeLinesView lines={cheque.lines} />
                            )}
                        </section>

                        <section>
                            <h3 className="mb-2 text-sm font-semibold">Status history</h3>
                            <ol className="space-y-2">
                                {[...cheque.history].reverse().map((h, i) => (
                                    <li key={i} className="rounded border px-3 py-2 text-sm">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {h.from_status ? (
                                                <>
                                                    <ChequeStatusBadge status={h.from_status} />
                                                    <span className="text-muted-foreground">→</span>
                                                </>
                                            ) : (
                                                <span className="text-muted-foreground">Recorded at</span>
                                            )}
                                            <ChequeStatusBadge status={h.to_status} />
                                            <span className="ml-auto text-xs text-muted-foreground">
                                                by {h.changed_by_name || h.changed_by} · {chequeDateText(h.changed_at) || "--"}
                                            </span>
                                        </div>
                                        {h.note && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{h.note}</p>}
                                    </li>
                                ))}
                            </ol>
                        </section>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
