/**
 * Vendor Invoice activity summary for the reconciliation screen.
 *
 * A standing backlog band (invoices awaiting approval right now) over three FLOW
 * measures (added / auto-approved / manually approved) across three windows
 * (today / 7 days / 30 days), each as value + count.
 *
 * The backlog is separated deliberately: it is a LEVEL, not a flow. "Pending
 * today" is not a meaningful question, so it gets its own band rather than a
 * fourth row in the window grid, where it could only repeat one number three
 * times or leave two cells blank.
 *
 * GLOBAL by design — it never follows the table's search, facets or pagination,
 * so the numbers mean the same thing on all four tabs. That mirrors how
 * PaymentSummaryCards behaves on the payments screen.
 *
 * All 20 numbers come from ONE aggregate query
 * (`get_vendor_invoice_totals.get_invoice_dashboard_stats`). The visual language
 * intentionally echoes PaymentSummaryCards; the tile primitives are duplicated
 * locally rather than shared, because extracting them is an ADR-0010 F3 refactor
 * that would have to touch the payments screen — tracked as debt, not hidden.
 */
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrappeDocTypeEventListener, useFrappeGetCall } from "frappe-react-sdk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TailSpin } from "react-loader-spinner";
import { Clock, FileText, Info, Sparkles, UserCheck } from "lucide-react";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

const STATS_METHOD =
    "nirmaan_stack.api.invoices.get_vendor_invoice_totals.get_invoice_dashboard_stats";

export interface InvoiceDashboardStats {
    added_today_count: number;
    added_today_amount: number;
    added_7d_count: number;
    added_7d_amount: number;
    added_30d_count: number;
    added_30d_amount: number;
    auto_today_count: number;
    auto_today_amount: number;
    auto_7d_count: number;
    auto_7d_amount: number;
    auto_30d_count: number;
    auto_30d_amount: number;
    manual_today_count: number;
    manual_today_amount: number;
    manual_7d_count: number;
    manual_7d_amount: number;
    manual_30d_count: number;
    manual_30d_amount: number;
    /** Standing backlog — awaiting approval right now, no time window. */
    pending_approval_count: number;
    pending_approval_amount: number;
}

type MeasureKey = "added" | "auto" | "manual";
type WindowKey = "today" | "7d" | "30d";

const WINDOWS: Array<{ key: WindowKey; label: string }> = [
    { key: "today", label: "Today" },
    { key: "7d", label: "7 Days" },
    { key: "30d", label: "30 Days" },
];

const MEASURES: Array<{
    key: MeasureKey;
    label: string;
    hint: string;
    icon: React.ReactNode;
    stripe: string;
    accent: string;
}> = [
        {
            key: "added",
            label: "Invoice value added",
            hint: "Vendor invoices uploaded in the period, whatever their approval status. Credit notes net the value down.",
            icon: <FileText className="h-4 w-4 text-blue-500 dark:text-blue-400" />,
            stripe: "bg-blue-500 dark:bg-blue-600",
            accent: "text-blue-600 dark:text-blue-400",
        },
        {
            key: "auto",
            label: "Auto-approved",
            hint: "Invoices the system approved on upload after passing all 13 auto-approve gates.",
            icon: <Sparkles className="h-4 w-4 text-violet-500 dark:text-violet-400" />,
            stripe: "bg-violet-500 dark:bg-violet-600",
            accent: "text-violet-600 dark:text-violet-400",
        },
        {
            key: "manual",
            label: "Manually approved",
            hint: "Invoices a person reviewed and approved in the period.",
            icon: <UserCheck className="h-4 w-4 text-amber-500 dark:text-amber-400" />,
            stripe: "bg-amber-500 dark:bg-amber-600",
            accent: "text-amber-600 dark:text-amber-400",
        },
    ];

const pick = (
    stats: InvoiceDashboardStats,
    measure: MeasureKey,
    window: WindowKey
): { amount: number; count: number } => ({
    amount: stats[`${measure}_${window}_amount` as keyof InvoiceDashboardStats] ?? 0,
    count: stats[`${measure}_${window}_count` as keyof InvoiceDashboardStats] ?? 0,
});

/**
 * One window's figure. Amount and count share a SINGLE line — stacking them was
 * what made each row tall, and the count reads fine as a trailing "· n" once the
 * amount carries the weight. Zero-count cells recede rather than shouting a ₹0.
 */
const MetricCell: React.FC<{
    amount: number;
    count: number;
    accent: string;
}> = ({ amount, count, accent }) => {
    const idle = count === 0;
    return (
        <div className="min-w-0 flex items-baseline gap-1.5">
            <span
                className={`text-xs tabular-nums font-semibold truncate ${idle ? "text-slate-400 dark:text-slate-600" : "text-slate-800 dark:text-slate-100"
                    }`}
            >
                {formatToRoundedIndianRupee(amount)}
            </span>
            <span
                className={`text-[10px] tabular-nums shrink-0 ${idle ? "text-slate-300 dark:text-slate-700" : accent
                    }`}
            >
                · {count}
            </span>
        </div>
    );
};

export const InvoiceSummaryCards: React.FC = () => {
    const {
        data: response,
        isLoading,
        error,
        mutate: refetch,
    } = useFrappeGetCall<{ message: InvoiceDashboardStats }>(
        STATS_METHOD,
        undefined,
        "invoice_dashboard_stats"
    );

    // Any invoice add / approve / reject changes these numbers. Debounced so a
    // burst (e.g. a bulk approval) collapses into one refetch.
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleRefetch = useCallback(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            void refetch();
        }, 400);
    }, [refetch]);

    useFrappeDocTypeEventListener("Vendor Invoices", scheduleRefetch);

    useEffect(
        () => () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        },
        []
    );

    const stats = useMemo(() => response?.message ?? null, [response]);

    if (isLoading) {
        return (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                <CardContent className="p-4">
                    <div className="flex justify-center items-center h-16">
                        <TailSpin height={24} width={24} color="#7c3aed" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    // Non-fatal: the tables below are the real content, so a failed summary
    // reports itself quietly instead of blocking the screen.
    if (error || !stats) {
        return (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-slate-800">
                <CardContent className="p-3">
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">
                        Invoice summary unavailable
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-300">
                        The tables below are unaffected.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
            <CardHeader className="pb-2 pt-3 px-4 sm:px-5">
                <CardTitle className="text-sm sm:text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                    Invoice Summary
                </CardTitle>
            </CardHeader>
            <CardContent className="px-4 sm:px-5 pb-3 pt-0">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                    {/* Standing backlog, given its own band ABOVE the window grid.
                        The three rows below are FLOW — what happened in a period.
                        This is STOCK — what is queued right now — so it has no
                        today/7d/30d reading, and forcing it into those columns
                        would mean either repeating one number three times or
                        leaving two cells empty. It also happens to be the number
                        someone opening this screen most wants, so it leads. */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50/70 dark:bg-amber-950/20 border-b border-amber-200/70 dark:border-amber-900/50">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                        <span className="text-[11px] font-medium text-amber-900 dark:text-amber-200 truncate">
                            Pending Invoice Approvals
                        </span>
                        <span className="ml-auto flex items-baseline gap-2 shrink-0">
                            <span className="text-sm font-bold tabular-nums text-amber-900 dark:text-amber-200">
                                {stats.pending_approval_count}
                            </span>
                            <span className="text-[10px] text-amber-700/80 dark:text-amber-400/80">
                                {stats.pending_approval_count === 1 ? "invoice" : "invoices"}
                            </span>
                            <span className="text-amber-300 dark:text-amber-800">|</span>
                            <span className="text-sm font-bold tabular-nums text-amber-900 dark:text-amber-200">
                                {formatToRoundedIndianRupee(stats.pending_approval_amount)}
                            </span>
                        </span>
                    </div>

                    {/* Window header — hidden on the narrowest screens, where each
                        measure stacks its own labelled 3-up grid instead. */}
                    <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 px-3 py-1 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Metric
                        </span>
                        {WINDOWS.map((w) => (
                            <span
                                key={w.key}
                                className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500"
                            >
                                {w.label}
                            </span>
                        ))}
                    </div>

                    {MEASURES.map((measure) => (
                        <div
                            key={measure.key}
                            className="flex border-b border-slate-100 dark:border-slate-800 last:border-b-0"
                        >
                            <div className={`w-1 shrink-0 ${measure.stripe}`} />
                            <div className="flex-1 min-w-0 px-3 py-1.5">
                                {/* Desktop: label + 3 window columns on one row */}
                                <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 items-center">
                                    <div className="flex items-center gap-1.5 min-w-0 group">
                                        {measure.icon}
                                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                                            {measure.label}
                                        </span>
                                        <HoverCard>
                                            <HoverCardTrigger asChild>
                                                <Info className="w-3 h-3 text-muted-foreground cursor-pointer opacity-50 group-hover:opacity-100 shrink-0" />
                                            </HoverCardTrigger>
                                            <HoverCardContent className="text-xs w-64 p-2">
                                                {measure.hint}
                                            </HoverCardContent>
                                        </HoverCard>
                                    </div>
                                    {WINDOWS.map((w) => {
                                        const { amount, count } = pick(stats, measure.key, w.key);
                                        return (
                                            <MetricCell
                                                key={w.key}
                                                amount={amount}
                                                count={count}
                                                accent={measure.accent}
                                            />
                                        );
                                    })}
                                </div>

                                {/* Mobile: label above its own labelled 3-up grid */}
                                <div className="sm:hidden space-y-1">
                                    <div className="flex items-center gap-1.5">
                                        {measure.icon}
                                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                            {measure.label}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {WINDOWS.map((w) => {
                                            const { amount, count } = pick(stats, measure.key, w.key);
                                            return (
                                                <div key={w.key} className="min-w-0">
                                                    <div className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                                        {w.label}
                                                    </div>
                                                    <MetricCell
                                                        amount={amount}
                                                        count={count}
                                                        accent={measure.accent}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
};

export default InvoiceSummaryCards;
