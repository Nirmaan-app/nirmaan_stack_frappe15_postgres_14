/**
 * Totals for the Payment TDS Deduction ledger — Gross, TDS Withheld, Net Paid, and the count.
 *
 * The figures come from the backend aggregate pass, so they describe the WHOLE filtered set, not
 * the visible page. Net is derived here rather than aggregated: there is no `net` column to sum
 * (see `services/payment_tds.py` — once a deduction exists, `Project Payments.amount` IS the net),
 * and `sum(gross) - sum(tds)` is exactly the same number.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { TailSpin } from "react-loader-spinner";
import { ColumnFiltersState } from "@tanstack/react-table";
import { Percent } from "lucide-react";

interface PaymentTDSSummaryCardProps {
    aggregates: {
        sum_of_gross_amount?: number;
        sum_of_tds_amount?: number;
    } | null;
    isAggregatesLoading: boolean;
    totalCount: number;
    columnFilters: ColumnFiltersState;
    searchTerm: string;
}

const AppliedFiltersDisplay: React.FC<{
    filters: ColumnFiltersState;
    search: string;
}> = ({ filters, search }) => {
    if (filters.length === 0 && !search) return null;

    return (
        <div className="flex flex-wrap gap-1.5 items-center mt-2">
            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Filtered:
            </span>
            {search && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                    "{search}"
                </span>
            )}
            {filters.map((filter) => (
                <span
                    key={filter.id}
                    className="px-2 py-0.5 text-[10px] font-medium bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded-full capitalize"
                >
                    {filter.id.replace(/_/g, " ")}
                </span>
            ))}
        </div>
    );
};

export const PaymentTDSSummaryCard: React.FC<PaymentTDSSummaryCardProps> = ({
    aggregates,
    isAggregatesLoading,
    totalCount,
    columnFilters,
    searchTerm,
}) => {
    const gross = aggregates?.sum_of_gross_amount || 0;
    const tds = aggregates?.sum_of_tds_amount || 0;
    const net = gross - tds;

    if (isAggregatesLoading) {
        return (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                <CardContent className="p-4 sm:p-6">
                    <div className="flex justify-center items-center h-10 sm:h-16">
                        <TailSpin height={24} width={24} color="#0d9488" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
            {/* ===== COMPACT MOBILE VIEW ===== */}
            <div className="sm:hidden">
                <CardContent className="p-3">
                    {aggregates ? (
                        <div className="flex items-center gap-3">
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500 to-red-500 flex items-center justify-center">
                                <Percent className="h-5 w-5 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-bold text-red-700 dark:text-red-400 tabular-nums">
                                        {formatToRoundedIndianRupee(tds)}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        TDS Withheld
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-2 mt-0.5">
                                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                                        {formatToRoundedIndianRupee(gross)}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        Gross
                                    </span>
                                </div>
                            </div>
                            <div className="flex-shrink-0 text-right">
                                <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md tabular-nums">
                                    {totalCount}
                                </span>
                                <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                    deductions
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-xs text-center text-muted-foreground py-2">No data</div>
                    )}
                </CardContent>
            </div>

            {/* ===== EXPANDED DESKTOP VIEW ===== */}
            <div className="hidden sm:block">
                <CardHeader className="pb-2 pt-4 px-5">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                            TDS Summary
                        </CardTitle>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                            <Percent className="h-3.5 w-3.5" />
                            <span className="uppercase tracking-wider">
                                {totalCount} Deduction{totalCount !== 1 ? "s" : ""}
                            </span>
                        </div>
                    </div>
                    <AppliedFiltersDisplay filters={columnFilters} search={searchTerm} />
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                    {aggregates ? (
                        <>
                            <div className="grid grid-cols-3 gap-4">
                                {/* Gross — the amount BEFORE tax was withheld */}
                                <div className="bg-gradient-to-br from-sky-50 to-blue-50/50 dark:from-sky-950/40 dark:to-blue-950/30 rounded-lg p-4 border border-sky-100 dark:border-sky-900/50">
                                    <dt className="text-xs font-medium text-sky-600/80 dark:text-sky-400/80 uppercase tracking-wide mb-1">
                                        Gross Amount
                                    </dt>
                                    <dd className="text-2xl font-bold text-sky-700 dark:text-sky-400 tabular-nums">
                                        {formatToRoundedIndianRupee(gross)}
                                    </dd>
                                </div>
                                {/* TDS — the point of the screen */}
                                <div className="bg-gradient-to-br from-rose-50 to-red-50/50 dark:from-rose-950/40 dark:to-red-950/30 rounded-lg p-4 border border-rose-100 dark:border-rose-900/50">
                                    <dt className="text-xs font-medium text-rose-600/80 dark:text-rose-400/80 uppercase tracking-wide mb-1">
                                        TDS Withheld
                                    </dt>
                                    <dd className="text-2xl font-bold text-red-700 dark:text-red-400 tabular-nums">
                                        {formatToRoundedIndianRupee(tds)}
                                    </dd>
                                </div>
                                {/* Net — what actually left the bank */}
                                <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/40 dark:to-teal-950/30 rounded-lg p-4 border border-emerald-100 dark:border-emerald-900/50">
                                    <dt className="text-xs font-medium text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wide mb-1">
                                        Net Paid
                                    </dt>
                                    <dd className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                        {formatToRoundedIndianRupee(net)}
                                    </dd>
                                </div>
                            </div>
                            {/* ⚠️ The gap this line explains is real: `Service Requests.total_tds`
                                counts PAID payments only, while this ledger holds every recorded
                                deduction from `Approved` onwards. The two totals are meant to
                                differ, and without this note that reads as a bug. */}
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-3">
                                Includes every recorded deduction, including those on payments not yet
                                marked Paid — so this total can run ahead of the TDS shown on a Service Request.
                            </p>
                        </>
                    ) : (
                        <div className="text-sm text-center text-muted-foreground py-6">
                            No summary data available.
                        </div>
                    )}
                </CardContent>
            </div>
        </Card>
    );
};

export default PaymentTDSSummaryCard;
