import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { ChequeLinesView } from "@/components/cheques/ChequeLinesView";
import { ChequePhoto } from "@/components/cheques/ChequePhotoLink";
import { ChequeStatusBadge } from "@/components/cheques/ChequeStatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ChequeStatus } from "@/types/NirmaanStack/Cheques";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { chequeDateText } from "@/utils/cheques/chequeChip";
import { getFrappeError } from "@/utils/frappeErrors";

import { useChequeDetail } from "./useChequeDetail";

interface ChequeDetailDialogProps {
    /** The Cheque shown; the dialog is closed while null. */
    cheque: string | null;
    onClose: () => void;
    /** Shown as a "Change status" button when given (accounts only). */
    onChangeStatus?: (cheque: string, status: ChequeStatus) => void;
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="break-words text-sm">{children || "--"}</div>
    </div>
);

/**
 * The Cheque detail view (#1412, spec #1407): photo, header, lines and the full status history.
 * Holds the Cheque's name and refetches on every Cheque change, so it stays live after a status move.
 */
export const ChequeDetailDialog = ({ cheque: name, onClose, onChangeStatus }: ChequeDetailDialogProps) => {
    const { cheque, error, isLoading } = useChequeDetail(name);

    return (
        <Dialog open={!!name} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-3">
                        Cheque {cheque?.cheque_no ?? ""}
                        {cheque && <ChequeStatusBadge status={cheque.status} />}
                        {cheque && onChangeStatus && (
                            <Button size="sm" variant="outline" className="ml-auto mr-6" onClick={() => onChangeStatus(cheque.name, cheque.status)}>
                                Change status
                            </Button>
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
                                <Field label="Bank">{cheque.bank_label}</Field>
                                <Field label="Cheque date">{chequeDateText(cheque.cheque_date)}</Field>
                                <Field label="Amount">{formatToRoundedIndianRupee(cheque.amount)}</Field>
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
