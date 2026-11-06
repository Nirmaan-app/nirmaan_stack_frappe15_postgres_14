/**
 * PaymentVoucherSteps — a project's or vendor's payment vouchers, one row per paid payment.
 *
 * - WO: paid Work Order payments that HAVE an uploaded voucher (the wizard lists no other).
 * - PO: paid PO payments. They carry no uploaded voucher, so the server generates each one, as the
 *   PO page does for Paid payments.
 */
import { useMemo } from "react";
import { BulkScopeKind, BulkTableLimits, scopeFacets, scopeNoun } from "@/utils/bulkDownload/bulkDownloadTypes";
import { BulkSelectTable } from "./BulkSelectTable";
import { forScope, poVoucherColumns, voucherSummaryAmounts, woVoucherColumns } from "./bulkTableColumns";
import { PaymentVoucherRow } from "../useBulkDownloadWizard";

const KIND = {
    PO: {
        columns: poVoucherColumns,
        subtitle: "Paid payments; each voucher is generated, as on the PO page",
        emptyMessage: "No paid PO payments found",
    },
    WO: {
        columns: woVoucherColumns,
        subtitle: "Paid payments with an uploaded voucher",
        emptyMessage: "No paid WO payments with an uploaded voucher found",
    },
} as const;

interface PaymentVoucherStepsProps {
    kind: keyof typeof KIND;
    items: PaymentVoucherRow[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    scopeKind: BulkScopeKind;
    /** All scope: page size + selection limit (the project / vendor tabs pass none). */
    tableLimits?: BulkTableLimits;
}

export const PaymentVoucherSteps = ({
    kind, items, isLoading, selectedIds, onSelectAll, scopeKind, tableLimits = {},
}: PaymentVoucherStepsProps) => {
    const config = KIND[kind];
    const facet = scopeFacets(scopeKind);
    const columns = useMemo(() => forScope(config.columns, scopeKind), [config, scopeKind]);

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select {kind} Payment Vouchers</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{config.subtitle}</p>
            </div>

            <BulkSelectTable
                data={items}
                columns={columns}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onSelectedIdsChange={onSelectAll}
                facetColumns={{ ...facet.columns }}
                dateFilterColumns={["payment_date"]}
                searchPlaceholder={`Search by ${kind} ID, UTR or ${facet.title}`}
                emptyMessage={`${config.emptyMessage} for ${scopeNoun(scopeKind)}.`}
                {...tableLimits}
                summaryAmounts={voucherSummaryAmounts}
            />
        </div>
    );
};
