/**
 * The Payment TDS Deduction ledger's summary strip — TDS Withheld and the deduction count.
 *
 * ⚠️ DELIBERATELY ONE SLIM ROW (owner ruling 2026-09-12). It was a three-tile card carrying Gross
 * Amount, TDS Withheld and Net Paid at `text-2xl`, plus a two-line footnote; inside the Reports hub
 * that pushed the table itself below the fold. Gross and Net are GONE from the screen, not merely
 * hidden — the ledger's own Gross and Net Paid columns still carry them per row, so nothing is
 * unreachable. Do not restore the tiles without the same ruling.
 *
 * The figure comes from the backend aggregate pass, so it describes the WHOLE filtered set, not the
 * visible page. `sum_of_gross_amount` still arrives in the payload (the aggregates config is
 * untouched) and is simply not rendered.
 */

import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { TailSpin } from "react-loader-spinner";
import { ColumnFiltersState } from "@tanstack/react-table";
import { FileText, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChallanListDialog } from "./ChallanListDialog";

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

/** ⚠️ The gap this explains is real: `Service Requests.total_tds` counts PAID payments only, while
 *  this ledger holds every recorded deduction from `Approved` onwards. The two totals are MEANT to
 *  differ, and with no note at all that reads as a bug — so it survives the compaction as a
 *  tooltip rather than the paragraph it used to be. */
const SCOPE_NOTE =
    "Includes every recorded deduction, including those on payments not yet marked Paid — so this total can run ahead of the TDS shown on a Service Request.";

const AppliedFiltersDisplay: React.FC<{
    filters: ColumnFiltersState;
    search: string;
}> = ({ filters, search }) => {
    if (filters.length === 0 && !search) return null;

    return (
        <div className="flex flex-wrap gap-1.5 items-center">
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
    const tds = aggregates?.sum_of_tds_amount || 0;
    const [isChallanListOpen, setIsChallanListOpen] = useState(false);

    if (isAggregatesLoading) {
        return (
            <Card className="border-0 shadow-sm bg-slate-50/60 dark:bg-slate-900/40">
                <CardContent className="flex items-center justify-center px-4 py-2 h-9">
                    <TailSpin height={16} width={16} color="#0d9488" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-0 shadow-sm bg-slate-50/60 dark:bg-slate-900/40">
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                {aggregates ? (
                    <>
                        <div className="flex items-baseline gap-2">
                            <span className="text-[11px] font-medium text-rose-600/80 dark:text-rose-400/80 uppercase tracking-wide">
                                TDS Withheld
                            </span>
                            <span className="text-lg font-bold text-red-700 dark:text-red-400 tabular-nums leading-none">
                                {formatToRoundedIndianRupee(tds)}
                            </span>
                        </div>
                        <span
                            className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 tabular-nums"
                            title={SCOPE_NOTE}
                        >
                            {totalCount} deduction{totalCount !== 1 ? "s" : ""}
                            <Info className="h-3 w-3" />
                        </span>
                        <AppliedFiltersDisplay filters={columnFilters} search={searchTerm} />
                    </>
                ) : (
                    <span className="text-xs text-muted-foreground">No summary data available.</span>
                )}

                {/* `ml-auto` parks this at the right end of the strip whatever sits to its left —
                    the filter chips grow and shrink, so a fixed position would drift. */}
                <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-7 text-xs"
                    onClick={() => setIsChallanListOpen(true)}
                >
                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                    View Challans
                </Button>
            </CardContent>

            <ChallanListDialog open={isChallanListOpen} onOpenChange={setIsChallanListOpen} />
        </Card>
    );
};

export default PaymentTDSSummaryCard;
