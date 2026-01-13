import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { TailSpin } from "react-loader-spinner";
import { ColumnFiltersState } from "@tanstack/react-table";
import { Receipt, TrendingDown } from "lucide-react";

interface GroupByResultItem {
    group_key: string;
    aggregate_value: number;
}

interface ProjectExpenseSummaryCardProps {
    aggregates: { sum_of_amount?: number } | null;
    isAggregatesLoading: boolean;
    totalCount: number;
    columnFilters: ColumnFiltersState;
    searchTerm: string;
    groupByResult?: GroupByResultItem[] | null;
    getExpenseTypeName: (id?: string) => string;
    projectName?: string;
}

// Helper component to display active filters
const AppliedFiltersDisplay: React.FC<{
    filters: ColumnFiltersState;
    search: string;
    projectName?: string;
}> = ({ filters, search, projectName }) => {
    const hasFilters = filters.length > 0 || !!search || !!projectName;

    if (!hasFilters) {
        return null;
    }

    return (
        <div className="flex flex-wrap gap-1.5 items-center mt-2">
            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Filtered:</span>
            {projectName && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full">
                    {projectName}
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
                    className="px-2 py-0.5 text-[10px] font-medium bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded-full capitalize"
                >
                    {filter.id.replace(/_/g, ' ')}
                </span>
            ))}
        </div>
    );
};

export const ProjectExpenseSummaryCard: React.FC<ProjectExpenseSummaryCardProps> = ({
    aggregates,
    isAggregatesLoading,
    totalCount,
    columnFilters,
    searchTerm,
    groupByResult,
    getExpenseTypeName,
    projectName,
}) => {
    const getTitle = () => {
        if (projectName) return `Expense Summary — ${projectName}`;
        return "Misc. Project Expenses Summary";
    };

    const hasFilters = columnFilters.length > 0 || !!searchTerm || !!projectName;

    if (isAggregatesLoading) {
        return (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                <CardContent className="p-4 sm:p-6">
                    <div className="flex justify-center items-center h-10 sm:h-16">
                        <TailSpin height={24} width={24} color="#f59e0b" />
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
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                                <TrendingDown className="h-5 w-5 text-white" />
                            </div>
                            {/* Primary metric */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                                        {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        Total Expense
                                    </span>
                                </div>
                                {/* Filters inline */}
                                {hasFilters && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {projectName && (
                                            <span className="px-1.5 py-0.5 text-[9px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded">
                                                {projectName.length > 15 ? projectName.slice(0, 15) + '...' : projectName}
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
                                    entries
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
                            <Receipt className="h-3.5 w-3.5" />
                            <span className="uppercase tracking-wider">
                                {totalCount} Entr{totalCount !== 1 ? 'ies' : 'y'}
                            </span>
                        </div>
                    </div>
                    <AppliedFiltersDisplay
                        filters={columnFilters}
                        search={searchTerm}
                        projectName={projectName}
                    />
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                    {aggregates ? (
                        <div className="grid grid-cols-2 gap-4">
                            {/* Primary Metric - Total Expense Amount */}
                            <div className="bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/40 dark:to-orange-950/30 rounded-lg p-4 border border-amber-100 dark:border-amber-900/50">
                                <dt className="text-xs font-medium text-amber-600/80 dark:text-amber-400/80 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <TrendingDown className="h-3 w-3" />
                                    Total Expense Amount
                                </dt>
                                <dd className="text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                                    {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                </dd>
                                <span className="text-[10px] text-amber-500/70 dark:text-amber-500/60 mt-1 block">
                                    {totalCount > 0
                                        ? `Avg: ${formatToRoundedIndianRupee((aggregates.sum_of_amount || 0) / totalCount)}`
                                        : 'No expenses'
                                    }
                                </span>
                            </div>

                            {/* Secondary - Top Expense Types */}
                            <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                                    Top Expense Types
                                </dt>
                                {groupByResult && groupByResult.length > 0 ? (
                                    <ul className="space-y-1.5">
                                        {groupByResult.slice(0, 4).map((item, index) => (
                                            <li key={item.group_key} className="flex justify-between items-center text-sm">
                                                <span className="text-slate-600 dark:text-slate-400 truncate pr-2 flex items-center gap-2">
                                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                                        index === 0 ? 'bg-amber-500' :
                                                        index === 1 ? 'bg-orange-400' :
                                                        index === 2 ? 'bg-yellow-400' :
                                                        'bg-slate-300 dark:bg-slate-600'
                                                    }`} />
                                                    <span className="truncate" title={getExpenseTypeName(item.group_key)}>
                                                        {getExpenseTypeName(item.group_key)}
                                                    </span>
                                                </span>
                                                <span className="font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums text-xs">
                                                    {formatToRoundedIndianRupee(item.aggregate_value)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-2">
                                        No breakdown available
                                    </p>
                                )}
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

export default ProjectExpenseSummaryCard;
