/**
 * PaymentVoucherSteps — paid Work Order payments; only a payment with an uploaded voucher can be
 * selected (the others stay listed, greyed out, so a missing voucher is visible).
 */
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { hasVoucher } from "@/utils/paymentVoucher";
import { BulkScopeKind, scopeFacet } from "@/utils/bulkDownload/bulkDownloadTypes";
import { BulkSelectTable } from "./BulkSelectTable";
import { forScope, voucherColumns } from "./bulkTableColumns";
import { PaymentVoucherRow } from "../useBulkDownloadWizard";

interface PaymentVoucherStepsProps {
    items: PaymentVoucherRow[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    scopeKind: BulkScopeKind;
}

export const PaymentVoucherSteps = ({
    items, isLoading, selectedIds, onSelectAll, onBack, onDownload, loading, scopeKind,
}: PaymentVoucherStepsProps) => {
    const facet = scopeFacet(scopeKind);
    const columns = useMemo(() => forScope(voucherColumns, scopeKind), [scopeKind]);

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Payment Vouchers</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Only payments with an uploaded voucher can be selected
                </p>
            </div>

            <BulkSelectTable
                data={items}
                columns={columns}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onSelectedIdsChange={onSelectAll}
                facetColumns={{ [facet.id]: facet.title, voucher: "Voucher" }}
                dateFilterColumns={["payment_date"]}
                searchPlaceholder={`Search by WO ID, UTR or ${facet.title}`}
                emptyMessage={`No paid WO payments found for this ${scopeKind}.`}
                isRowSelectable={hasVoucher}
                unselectableLabel="without voucher"
            />

            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select vouchers to download" : `Download ${selectedIds.length} Voucher${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
