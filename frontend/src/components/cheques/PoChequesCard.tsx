import { useState } from "react";
import { useFrappeEventListener, useFrappeGetCall } from "frappe-react-sdk";
import { Loader2, Plus } from "lucide-react";

import { ChequeDetailDialog } from "@/components/cheques/ChequeDetailDialog";
import { ChequeStatusBadge } from "@/components/cheques/ChequeStatusBadge";
import { SecurityDepositChequeForm } from "@/components/cheques/SecurityDepositChequeForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHEQUE_ACCESS_PROFILES } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";
import { CHEQUE_PAYMENT_DATE_LABEL, CHEQUE_TYPE, CHEQUES_CHANGED_EVENT } from "@/types/NirmaanStack/Cheques";
import { CHEQUES_LIST_API, chequeTypeLabel, type ChequeRow } from "@/pages/cheque-tracker/config/chequePaymentTable.config";
import { chequeDateText } from "@/utils/cheques/chequeChip";
import type { DepositPageRecord } from "@/utils/cheques/chequeDeposit";
import { alsoFor, poChequeAmount, poChequesFilters } from "@/utils/cheques/poCheques";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";

interface PoChequesCardProps {
    /** The PO the page shows, with its Vendor and project. Nothing renders until it is known. */
    record: Partial<DepositPageRecord> & Pick<DepositPageRecord, "doctype">;
    className?: string;
}

/**
 * The PO page's "Cheques issued for this PO" card (#1521, spec #1514, stories 20-24): the Payment cheques with a
 * line on this PO and the Security Deposit cheques that secure it (the Cheque Tracker's list, filtered by the PO).
 * A Payment cheque's amount is what it pays for this PO, with the whole cheque below when it also pays another.
 * "Add Security Deposit Cheque" makes one out to the PO's Vendor, naming the PO (spec #1477, stories 60, 61).
 * Shown to whoever may use the Cheque Tracker (`CHEQUE_ACCESS_PROFILES`, as every `api/cheques/` endpoint
 * checks); the number opens the cheque, with its actions. Work Orders have no cheques, so no Work Order page
 * has this card (spec #1514).
 */
export const PoChequesCard = ({ record, className }: PoChequesCardProps) => {
    const { role } = useUserData();
    const allowed = CHEQUE_ACCESS_PROFILES.includes(role);
    const ready = allowed && Boolean(record.name && record.vendor);
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: { data: ChequeRow[] } }>(
        CHEQUES_LIST_API,
        { filters: JSON.stringify(poChequesFilters(record.name ?? "")), order_by: "creation desc", limit_page_length: 100 },
        ready ? `cheques-of-po-${record.name}` : null,
    );
    useFrappeEventListener(CHEQUES_CHANGED_EVENT, () => {
        if (ready) mutate();
    });
    const [adding, setAdding] = useState(false);
    const [open, setOpen] = useState<string | null>(null);

    if (!ready) return null;
    const rows = data?.message?.data ?? [];

    return (
        <Card className={className ?? "rounded-sm shadow-m col-span-6 overflow-x-auto"}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                    <CardTitle className="text-lg">Cheques issued for this PO</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Payment cheques that pay this PO, and Security Deposit cheques handed to its vendor as a guarantee.
                    </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                    <Plus className="mr-1 h-4 w-4" /> Add Security Deposit Cheque
                </Button>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                ) : error ? (
                    <p className="text-sm text-destructive">{getFrappeError(error)}</p>
                ) : rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No cheque has been issued for this PO.</p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Type</TableHead>
                                <TableHead>Cheque No</TableHead>
                                <TableHead>Bank</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>{CHEQUE_PAYMENT_DATE_LABEL}</TableHead>
                                <TableHead>Issue Date</TableHead>
                                <TableHead>Also for</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row) => {
                                const others = alsoFor(row.lines, record.name ?? "");
                                const { forPo, whole } = poChequeAmount(row);
                                return (
                                    <TableRow key={row.name}>
                                        <TableCell>
                                            <span
                                                className={cn(
                                                    "whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium",
                                                    row.cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT
                                                        ? "bg-purple-50 text-purple-800"
                                                        : "bg-blue-50 text-blue-800",
                                                )}
                                            >
                                                {chequeTypeLabel(row.cheque_type)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <button
                                                type="button"
                                                className="font-medium text-blue-600 hover:underline"
                                                onClick={() => setOpen(row.name)}
                                                title="Open the cheque"
                                            >
                                                {row.cheque_no}
                                            </button>
                                        </TableCell>
                                        <TableCell>{row.bank_label}</TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {formatToRoundedIndianRupee(forPo)}
                                            {whole !== null ? (
                                                <div
                                                    className="text-xs text-muted-foreground"
                                                    title="The whole cheque, which also pays other POs"
                                                >
                                                    of {formatToRoundedIndianRupee(whole)}
                                                </div>
                                            ) : null}
                                        </TableCell>
                                        <TableCell>
                                            <ChequeStatusBadge status={row.status} />
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">{chequeDateText(row.cheque_date) || "--"}</TableCell>
                                        <TableCell className="whitespace-nowrap">{chequeDateText(row.issue_date) || "--"}</TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {others.length ? others.join(", ") : "Only this PO"}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
            <AddDepositChequeDialog
                open={adding}
                onOpenChange={setAdding}
                onSaved={() => mutate()}
                from={{
                    doctype: record.doctype,
                    name: record.name ?? "",
                    project: record.project ?? "",
                    vendor: record.vendor ?? "",
                }}
            />
            <ChequeDetailDialog cheque={open} onClose={() => setOpen(null)} />
        </Card>
    );
};

interface AddDepositChequeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
    /** The PO the deposit secures, with its Vendor (#1486). */
    from: DepositPageRecord;
}

/** "Add Security Deposit Cheque": the one place a cheque is added by hand (spec #1514). */
const AddDepositChequeDialog = ({ open, onOpenChange, onSaved, from }: AddDepositChequeDialogProps) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
                <DialogTitle>Add Security Deposit Cheque</DialogTitle>
                <DialogDescription>
                    Made out to this Vendor, naming {from.name}. Upload its photo, then add anything else it secures.
                </DialogDescription>
            </DialogHeader>
            {/* The content mounts with each opening, so the form starts fresh. */}
            <SecurityDepositChequeForm
                from={from}
                onDone={() => {
                    onOpenChange(false);
                    onSaved();
                }}
                onCancel={() => onOpenChange(false)}
            />
        </DialogContent>
    </Dialog>
);
