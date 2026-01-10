import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { TailSpin } from "react-loader-spinner";
import { ColumnFiltersState } from "@tanstack/react-table";
import { ArrowDownLeft, Banknote } from "lucide-react";

interface InflowSummaryCardProps {
    aggregates: { sum_of_amount?: number } | null;
    isAggregatesLoading: boolean;
    totalCount: number;
    columnFilters: ColumnFiltersState;
    searchTerm: string;
    projectName?: string;
    customerName?: string;
}

// Helper component to display active filters
const AppliedFiltersDisplay: React.FC<{
    filters: ColumnFiltersState;
    search: string;
    projectName?: string;
    customerName?: string;
}> = ({ filters, search, projectName, customerName }) => {
    const hasFilters = filters.length > 0 || !!search || !!projectName || !!customerName;

    if (!hasFilters) {
        return null;
    }

    return (
        <div className="flex flex-wrap gap-1.5 items-center mt-2">
            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Filtered:</span>
            {projectName && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded-full">
                    {projectName}
                </span>
            )}
            {customerName && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 rounded-full">
                    {customerName}
                </span>
            )}
            {search && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                    "{search}"
                </span>
            )}
            {filters.map(filter => (
                <span
                    key={filter.id}
                    className="px-2 py-0.5 text-[10px] font-medium bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded-full capitalize"
                >
                    {filter.id.replace(/_/g, ' ')}
                </span>
            ))}
        </div>
    );
};

export const InflowSummaryCard: React.FC<InflowSummaryCardProps> = ({
    aggregates,
    isAggregatesLoading,
    totalCount,
    columnFilters,
    searchTerm,
    projectName,
    customerName,
}) => {
    const getTitle = () => {
        if (projectName) return `Inflow Summary — ${projectName}`;
        if (customerName) return `Inflow Summary — ${customerName}`;
        return "Inflow Summary";
    };

    const hasFilters = columnFilters.length > 0 || !!searchTerm || !!projectName || !!customerName;

    if (isAggregatesLoading) {
        return (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                <CardContent className="p-4 sm:p-6">
                    <div className="flex justify-center items-center h-10 sm:h-16">
                        <TailSpin height={24} width={24} color="#10b981" />
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
                            {/* Color accent + Icon */}
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                                <ArrowDownLeft className="h-5 w-5 text-white" />
                            </div>
                            {/* Primary metric */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                        {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        Total Inflow
                                    </span>
                                </div>
                                {/* Filters inline */}
                                {hasFilters && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {projectName && (
                                            <span className="px-1.5 py-0.5 text-[9px] font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded">
                                                {projectName.length > 15 ? projectName.slice(0, 15) + '...' : projectName}
                                            </span>
                                        )}
                                        {customerName && (
                                            <span className="px-1.5 py-0.5 text-[9px] font-medium bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 rounded">
                                                {customerName.length > 15 ? customerName.slice(0, 15) + '...' : customerName}
                                            </span>
                                        )}
                                        {searchTerm && (
                                            <span className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded">
                                                "{searchTerm.slice(0, 10)}"
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            {/* Count badge */}
                            <div className="flex-shrink-0 text-right">
                                <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md tabular-nums">
                                    {totalCount}
                                </span>
                                <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                    payments
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-xs text-center text-muted-foreground py-2">
                            No data
                        </div>
                    )}
                </CardContent>
            </div>

            {/* ===== EXPANDED DESKTOP VIEW ===== */}
            <div className="hidden sm:block">
                <CardHeader className="pb-2 pt-4 px-5">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                            {getTitle()}
                        </CardTitle>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                            <Banknote className="h-3.5 w-3.5" />
                            <span className="uppercase tracking-wider">
                                {totalCount} Payment{totalCount !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>
                    <AppliedFiltersDisplay
                        filters={columnFilters}
                        search={searchTerm}
                        projectName={projectName}
                        customerName={customerName}
                    />
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                    {aggregates ? (
                        <div className="grid grid-cols-2 gap-4">
                            {/* Primary Metric - Total Inflow Amount */}
                            <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/40 dark:to-teal-950/30 rounded-lg p-4 border border-emerald-100 dark:border-emerald-900/50">
                                <dt className="text-xs font-medium text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <ArrowDownLeft className="h-3 w-3" />
                                    Total Inflow Amount
                                </dt>
                                <dd className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                    {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                </dd>
                            </div>
                            {/* Secondary Metric - Payment Count */}
                            <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                                    Payment Count
                                </dt>
                                <dd className="text-2xl font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                    {totalCount}
                                </dd>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 block">
                                    {totalCount > 0
                                        ? `Avg: ${formatToRoundedIndianRupee((aggregates.sum_of_amount || 0) / totalCount)}`
                                        : 'No payments'
                                    }
                                </span>
                            </div>
                        </div>
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

export default InflowSummaryCard;
