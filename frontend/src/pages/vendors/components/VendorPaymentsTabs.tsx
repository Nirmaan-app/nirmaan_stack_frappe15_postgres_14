import { useMemo } from "react";

import { useFrappeGetDocList } from "@/lib/frappe";
import { cn } from "@/lib/utils";
import { useUrlPill } from "@/hooks/useUrlPill";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import {
    CHEQUE_ISSUED_FILTERS,
    DEFAULT_VENDOR_PAYMENT_GROUP,
    groupCount,
    isVendorPaymentGroup,
    type PaymentGroupCountRow,
    type PaymentListFilter,
    summarisePaymentGroups,
    VENDOR_PAYMENT_GROUP,
    VENDOR_PAYMENT_GROUP_TEXT,
    VENDOR_PAYMENT_GROUPS,
    type VendorPaymentGroup,
    type VendorPaymentSummary,
    vendorPaymentGroupFilters,
} from "@/utils/vendorPayments/paymentGroups";

import { VendorPaymentsTable } from "./VendorPaymentsTable";

interface VendorPaymentsTabsProps {
    vendorId: string;
    projectOptions: Array<{ label: string; value: string }>;
}

/** The field expressions the grouped count query asks for, so the SDK accepts the aggregate aliases. */
type PaymentCountQueryFields = Record<
    "vendor" | "status" | "mode_of_payment" | "count(name) as count" | "sum(amount) as amount",
    unknown
>;

/** Each sub-tab's dot, so the three read apart at a glance. */
const GROUP_DOT: Record<VendorPaymentGroup, string> = {
    [VENDOR_PAYMENT_GROUP.PAID]: "bg-green-600",
    [VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED]: "bg-amber-600",
    [VENDOR_PAYMENT_GROUP.OTHERS]: "bg-blue-600",
};

/** The ₹ total and count line under the tab bar, for the open sub-tab. */
const groupSummaryText = (summary: VendorPaymentSummary, group: VendorPaymentGroup): { amount: string; sub: string } => {
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    switch (group) {
        case VENDOR_PAYMENT_GROUP.PAID:
            return {
                amount: formatToRoundedIndianRupee(summary.paid.amount),
                sub: `${plural(summary.paid.count, "payment")} (${summary.paid.onlineCount} online, ${summary.paid.chequeCount} cheque)`,
            };
        case VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED:
            return {
                amount: formatToRoundedIndianRupee(summary.chequeIssued.amount),
                sub: plural(summary.chequeIssued.count, "cheque payment"),
            };
        case VENDOR_PAYMENT_GROUP.OTHERS: {
            const { count, rejectedCount, rejectedAmount } = summary.others;
            const rejected = rejectedCount
                ? ` · ${rejectedCount} rejected (${formatToRoundedIndianRupee(rejectedAmount)}, not counted)`
                : "";
            return {
                amount: formatToRoundedIndianRupee(summary.others.amount),
                sub: `${count - rejectedCount} in progress${rejected}`,
            };
        }
    }
};

/**
 * The Vendor page's Payments tab: three sub-tabs, Paid, Cheque Issued and Other statuses (rules in
 * `utils/vendorPayments/paymentGroups.ts`). The counts and totals cover all of the vendor's payments; search and
 * the column filters narrow only the table.
 */
export const VendorPaymentsTabs = ({ vendorId, projectOptions }: VendorPaymentsTabsProps) => {
    const [group, setGroup] = useUrlPill("vendor_payments_group", isVendorPaymentGroup, DEFAULT_VENDOR_PAYMENT_GROUP);

    const { data: countRows } = useFrappeGetDocList<PaymentGroupCountRow, PaymentCountQueryFields>(
        "Project Payments",
        {
            fields: ["status", "mode_of_payment", "count(name) as count", "sum(amount) as amount"],
            filters: [["vendor", "=", vendorId]],
            groupBy: "status, mode_of_payment",
            limit: 0,
        },
        `vendor_payment_group_counts_${vendorId}`,
    );

    // Other statuses leaves these out by name: the list endpoint has no OR (see `vendorPaymentGroupFilters`).
    const { data: chequeIssuedRows, isLoading: chequeIssuedLoading } =
        useFrappeGetDocList<{ name: string }>(
            "Project Payments",
            {
                fields: ["name"],
                filters: [["vendor", "=", vendorId], ...CHEQUE_ISSUED_FILTERS],
                limit: 0,
            },
            `vendor_payment_cheque_issued_names_${vendorId}`,
        );

    const summary = useMemo(() => summarisePaymentGroups(countRows ?? []), [countRows]);
    const chequeIssuedNames = useMemo(() => (chequeIssuedRows ?? []).map((r) => r.name), [chequeIssuedRows]);

    const filters = useMemo<PaymentListFilter[]>(
        () => vendorPaymentGroupFilters(group, vendorId, chequeIssuedNames),
        [group, vendorId, chequeIssuedNames],
    );

    const { amount, sub } = groupSummaryText(summary, group);
    // Until the Cheque Issued names arrive, Other statuses would briefly list those cheques too.
    const tableReady = group !== VENDOR_PAYMENT_GROUP.OTHERS || !chequeIssuedLoading;

    return (
        <div className="space-y-4">
            <div role="tablist" aria-label="Payment groups" className="flex flex-wrap gap-1 border-b">
                {VENDOR_PAYMENT_GROUPS.map((g) => {
                    const active = g === group;
                    return (
                        <button
                            key={g}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setGroup(g)}
                            className={cn(
                                "-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors",
                                active
                                    ? "border-primary font-semibold text-primary"
                                    : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                            )}
                        >
                            <span className={cn("h-2 w-2 rounded-full", GROUP_DOT[g])} aria-hidden="true" />
                            {VENDOR_PAYMENT_GROUP_TEXT[g].label}
                            <span
                                className={cn(
                                    "min-w-[22px] rounded-full px-1.5 text-xs font-semibold tabular-nums",
                                    active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                                )}
                            >
                                {groupCount(summary, g)}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-bold tabular-nums">{amount}</span>
                <span className="text-sm text-foreground/80">{sub}</span>
                <span className="text-sm text-muted-foreground">· {VENDOR_PAYMENT_GROUP_TEXT[group].rule}</span>
            </div>

            {tableReady && (
                <VendorPaymentsTable
                    key={group}
                    vendorId={vendorId}
                    projectOptions={projectOptions}
                    group={group}
                    filters={filters}
                />
            )}
        </div>
    );
};

export default VendorPaymentsTabs;
