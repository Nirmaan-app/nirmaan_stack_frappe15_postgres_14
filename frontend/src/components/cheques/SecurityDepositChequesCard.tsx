import { useState } from "react";
import { useFrappeEventListener, useFrappeGetCall } from "frappe-react-sdk";
import { Loader2, Plus } from "lucide-react";

import { AddChequeDialog } from "@/components/cheques/AddChequeDialog";
import { ChequeDetailDialog } from "@/components/cheques/ChequeDetailDialog";
import { ChequeStatusBadge } from "@/components/cheques/ChequeStatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHEQUE_ACCESS_PROFILES } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { CHEQUES_CHANGED_EVENT } from "@/types/NirmaanStack/Cheques";
import { CHEQUES_LIST_API, type ChequeRow } from "@/pages/cheque-tracker/config/chequePaymentTable.config";
import { chequeDateText } from "@/utils/cheques/chequeChip";
import { alsoSecures, depositCardFilters, type DepositPageRecord } from "@/utils/cheques/chequeDeposit";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";

interface SecurityDepositChequesCardProps {
    /** The PO the page shows, with its Vendor and project. Nothing renders until it is known. */
    record: Partial<DepositPageRecord> & Pick<DepositPageRecord, "doctype">;
    className?: string;
}

/**
 * The PO page's Security Deposit Cheques card (#1486, spec #1477, story 67): the deposit cheques whose lines
 * name this PO (the Cheque Tracker's list, filtered by type and record), and "Add Security Deposit Cheque",
 * made out to the PO's Vendor and naming it (story 60, 61). Shown to whoever may use the Cheque Tracker
 * (`CHEQUE_ACCESS_PROFILES`, as every `api/cheques/` endpoint checks); the number opens the cheque. Work
 * Orders have no cheques, so the Work Order page has no such card (spec #1514).
 */
export const SecurityDepositChequesCard = ({ record, className }: SecurityDepositChequesCardProps) => {
    const { role } = useUserData();
    const allowed = CHEQUE_ACCESS_PROFILES.includes(role);
    const ready = allowed && Boolean(record.name && record.vendor);
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: { data: ChequeRow[] } }>(
        CHEQUES_LIST_API,
        { filters: JSON.stringify(depositCardFilters(record.name ?? "")), order_by: "issue_date desc", limit_page_length: 100 },
        ready ? `deposit-cheques-of-${record.name}` : null,
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
                    <CardTitle className="text-lg">Security Deposit Cheques</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Cheques handed to this vendor as a guarantee for this PO. Never cashed, never a payment.
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
                    <p className="text-sm text-muted-foreground">No Security Deposit cheque names this PO.</p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Cheque No</TableHead>
                                <TableHead>Bank</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead>Issue Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Also secures</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row) => {
                                const others = alsoSecures(row.lines, record.name ?? "");
                                return (
                                    <TableRow key={row.name}>
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
                                        <TableCell className="text-right tabular-nums">{formatToRoundedIndianRupee(row.amount)}</TableCell>
                                        <TableCell className="whitespace-nowrap">{chequeDateText(row.issue_date) || "--"}</TableCell>
                                        <TableCell>
                                            <ChequeStatusBadge status={row.status} />
                                        </TableCell>
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
            <AddChequeDialog
                open={adding}
                onOpenChange={setAdding}
                onSaved={() => mutate()}
                depositFrom={{
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
