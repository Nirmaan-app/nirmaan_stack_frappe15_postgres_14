// import React, { useCallback, useMemo } from "react";
// import { Card } from "@/components/ui/card";
// import {
//     Table,
//     TableBody,
//     TableCell,
//     TableHead,
//     TableHeader,
//     TableRow,
// } from "@/components/ui/table";
// import { TailSpin } from "react-loader-spinner";
// import { useFrappeGetCall } from "frappe-react-sdk";
// import { toast } from "@/components/ui/use-toast"
// import {useEffect} from "react";


// interface FrappeApiResponse<T> { message: T; }
// interface PaymentStats {
//     total_pending_payment_count: number;
//     total_pending_payment_amount: number;
//     total_requested_payment_count: number;
//     total_requested_payment_amount: number;
//     total_approval_done_today: number;
//     total_approval_done_today_amount: number;
//     total_approval_done_7_days: number;
//     total_approval_done_7_days_amount: number;
//     payment_done_today: number;
//     payment_done_today_amount: number;
//     payment_done_7_days: number;
//     payment_done_7_days_amount: number;
// }

// const formatToRoundedIndianRupee = (value: number) =>
//     new Intl.NumberFormat("en-IN", {
//         style: "currency",
//         currency: "INR",
//         minimumFractionDigits: 0,
//     }).format(value);

// const PaymentSummaryTable: React.FC = ({totalCount}) => {

//   const {
//         data: statsApiResponse,
//         isLoading,
//         error,
//         mutate: refetchPaymentSummary
//     } = useFrappeGetCall<PaymentStats>(
//         "nirmaan_stack.api.payments.get_project_payment_summary.get_payment_dashboard_stats",
//         undefined,
//         "payment_dashboard_stats_summary"
//     );




// //     useFrappeDocumentEventListener("doc_update", (event) => {
// //   if (event.doctype === "Project Payments") {
// //     refetchPaymentSummary();
// //   }
// // });

//     // const handleRefetch = useCallback((event: { doctype: string, name: string }) => {
//     //     console.log("Project Payments DocType changed (real-time)%%%:", event);

//     //     // Use a simple check to avoid unnecessary revalidation if the DocType name is empty
//     //     if (!event.name) return; 

//     //     toast({
//     //         title: "Summary Update",
//     //         description: `Payment document ${event.name} modified. Refreshing summary.`,
//     //         duration: 1500
//     //     });

//     //     // This is the core action: triggering the SWR/Query revalidation
//     //     refetchPaymentSummary(); 

//     // }, [toast, refetchPaymentSummary,totalCount]); // <-- CRITICAL: Include refetchPaymentSummary here

// console.log("totalCount in PaymentSummaryCards:", totalCount);
// useEffect(() => {
//   refetchPaymentSummary();
// }, [totalCount]);
//   // Corrected logic for listening to ALL updates on the DocType
// // useFrappeDocTypeEventListener(
// //     "Project Payments",  // Listen to all documents in this DocType
// //     handleRefetch

// // );
//     const stats = useMemo(() => statsApiResponse?.message || null, [statsApiResponse]);

//     if (isLoading) {
//         return (
//             <div className="flex justify-center items-center py-8">
//                 <TailSpin height={24} width={24} color="#4f46e5" />
//             </div>
//         );
//     }

//     if (error) {
//         return (
//             <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
//                 <p className="font-bold">Error Loading Summary</p>
//                 <p className="text-sm">Failed to fetch payment statistics.</p>
//             </div>
//         );
//     }

//     if (!stats) return null;

//     // ✅ Row definitions with dynamic color logic
//     const rows = [
//         {
//             label: "Total Payment Due",
//             count: stats.total_pending_payment_count,
//             amount: stats.total_pending_payment_amount,
//             type: "pending",
//         },
//          {
//             label: "Pending Payment Request",
//             count: stats.total_requested_payment_count,
//             amount: stats.total_requested_payment_amount,
//             type: "requested",
//         },
//         {
//             label: "Approved Today",
//             count: stats.total_approval_done_today,
//             amount: stats.total_approval_done_today_amount,
//             type: "approved",
//         },
//         {
//             label: "Approved Last 7 Days",
//             count: stats.total_approval_done_7_days,
//             amount: stats.total_approval_done_7_days_amount,
//             type: "approved",
//         },
//         {
//             label: "Paid Today",
//             count: stats.payment_done_today,
//             amount: stats.payment_done_today_amount,
//             type: "paid",
//         },
//         {
//             label: "Paid Last 7 Days",
//             count: stats.payment_done_7_days,
//             amount: stats.payment_done_7_days_amount,
//             type: "paid",
//         },

//     ];

//     // ✅ Dynamic color assignment
//     const getColorClass = (type: string) => {
//         if (type === "pending") return "text-red-600";
//         if (type === "approved") return "text-yellow-600";
//         if (type === "paid") return "text-green-600";
//         return "";
//     };

//     return (
//         <Card className="p-4 shadow-sm">
//             <h2 className="text-lg font-semibold mb-4">Payment Summary Card</h2>

//             <Table>
//                 <TableHeader>
//                     <TableRow>
//                         <TableHead className="">Metric</TableHead>
//                         <TableHead className="">Count</TableHead>
//                         <TableHead className="">Value</TableHead>
//                     </TableRow>
//                 </TableHeader>

//                 <TableBody>
//                     {rows.map((row, i) => {
//                         const color = getColorClass(row.type);

//                         return (
//                             <TableRow key={i}>
//                                 <TableCell className="font-medium">{row.label}</TableCell>

//                                 {/* ✅ Count color updated */}
//                                 <TableCell className={`font-medium ${color}`}>
//                                     {row.count}
//                                 </TableCell>

//                                 {/* ✅ Amount color updated */}
//                                 <TableCell className={`font-medium ${color}`}>
//                                     {formatToRoundedIndianRupee(row.amount)}
//                                 </TableCell>
//                             </TableRow>
//                         );
//                     })}
//                 </TableBody>
//             </Table>
//         </Card>
//     );
// };

// export default PaymentSummaryTable;
// function useCallack(event: Event | undefined) {
//   throw new Error("Function not implemented.");
// }



import React, { useMemo, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TailSpin } from "react-loader-spinner";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Info, Wallet, Clock, CheckCircle2, AlertCircle, CreditCard } from "lucide-react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";


interface FrappeApiResponse<T> { message: T; }
interface PaymentStats {
    total_pending_payment_count: number;
    total_pending_payment_amount: number;
    total_requested_payment_count: number;
    total_requested_payment_amount: number;
    total_ceo_pending_count: number;
    total_ceo_pending_amount: number;
    total_approval_done_today: number;
    total_approval_done_today_amount: number;
    total_approval_done_7_days: number;
    total_approval_done_7_days_amount: number;
    total_ceo_approval_done_today: number;
    total_ceo_approval_done_today_amount: number;
    total_ceo_approval_done_7_days: number;
    total_ceo_approval_done_7_days_amount: number;
    payment_done_today: number;
    payment_done_today_amount: number;
    payment_done_7_days: number;
    payment_done_7_days_amount: number;
}

const formatToRoundedIndianRupee = (value: number) =>
    new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);

// Per-phase accent (stripe + icon color). Body of the tile stays neutral.
const getAccent = (type: string) => {
    if (type === "pending" || type === "requested") {
        return {
            stripe: "bg-red-500 dark:bg-red-600",
            icon: <AlertCircle className="h-4 w-4 text-red-500 dark:text-red-400" />,
        };
    }
    if (type === "approved") {
        return {
            stripe: "bg-amber-500 dark:bg-amber-600",
            icon: <Clock className="h-4 w-4 text-amber-500 dark:text-amber-400" />,
        };
    }
    if (type === "ceo_approved") {
        return {
            stripe: "bg-blue-500 dark:bg-blue-600",
            icon: <CheckCircle2 className="h-4 w-4 text-blue-500 dark:text-blue-400" />,
        };
    }
    if (type === "paid") {
        return {
            stripe: "bg-emerald-500 dark:bg-emerald-600",
            icon: <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />,
        };
    }
    return {
        stripe: "bg-slate-300 dark:bg-slate-600",
        icon: <CreditCard className="h-4 w-4 text-slate-500 dark:text-slate-400" />,
    };
};

const getHoverText = (label: string) => {
    if (label.includes("Pending Payment Request")) return "Payments Requested but not yet Approved.";
    if (label.includes("Pending Payment Approval")) return "All payments awaiting an approval gate (Requested + CEO Pending).";
    if (label.includes("Total Payment Due")) return "Total amount of all payments not yet Paid.";
    if (label.includes("Approval Today")) return "Payments approved today by L1 + CEO combined.";
    if (label.includes("Approval (7 Days)")) return "Payments approved in the last 7 days by L1 + CEO combined.";
    if (label.includes("CEO Approved")) return "Count and value of payments CEO-approved in the specified period.";
    if (label.includes("Approved")) return "Count and value of payments approved in the specified period.";
    if (label.includes("Paid")) return "Count and value of payments completed/paid in the specified period.";
    return label;
};

// Shared tile shell — neutral white body + thin colored left stripe.
// `amount` is optional: when omitted, the big bold number row is hidden
// (used by tiles whose total is already represented as a breakdown row).
const TileShell: React.FC<{
    type: string;
    label: string;
    amount?: number;
    count?: number;
    children?: React.ReactNode;
}> = ({ type, label, amount, count, children }) => {
    const accent = getAccent(type);
    return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden flex h-full">
            <div className={`w-1 shrink-0 ${accent.stripe}`} />
            <div className="flex-1 p-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 group">
                        {accent.icon}
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                            {label}
                        </span>
                        <HoverCard>
                            <HoverCardTrigger asChild>
                                <Info className="w-3 h-3 text-muted-foreground cursor-pointer opacity-50 group-hover:opacity-100 shrink-0" />
                            </HoverCardTrigger>
                            <HoverCardContent className="text-xs w-auto p-2">
                                {getHoverText(label)}
                            </HoverCardContent>
                        </HoverCard>
                    </div>
                    {count !== undefined && (
                        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
                            {count} {count === 1 ? 'item' : 'items'}
                        </span>
                    )}
                </div>
                {amount !== undefined && (
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums mt-1">
                        {formatToRoundedIndianRupee(amount)}
                    </div>
                )}
                {children}
            </div>
        </div>
    );
};

// Breakdown row used inside composite tiles.
type BreakdownTone = "red" | "amber" | "blue" | "emerald";
const TONE_CLASSES: Record<BreakdownTone, { dot: string; text: string }> = {
    red: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
    amber: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
    blue: { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
    emerald: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
};

const BreakdownRow: React.FC<{
    tone: BreakdownTone;
    label: string;
    labelLong?: string;
    amount: number;
    count: number;
}> = ({ tone, label, labelLong, amount, count }) => {
    const c = TONE_CLASSES[tone];
    return (
        <div className="grid grid-cols-[auto,1fr,auto] gap-x-2 items-center text-[11px]">
            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
            <div className="flex items-center gap-1 min-w-0">
                <span className="text-slate-700 dark:text-slate-200 truncate font-semibold min-w-0">
                    {labelLong ? (
                        <>
                            <span className="lg:hidden">{label}</span>
                            <span className="hidden lg:inline">{labelLong}</span>
                        </>
                    ) : (
                        label
                    )}
                </span>
                <span className={`${c.text} font-semibold tabular-nums whitespace-nowrap shrink-0`}>
                    ({count})
                </span>
            </div>
            <span className="text-slate-900 dark:text-slate-100 tabular-nums font-semibold whitespace-nowrap">
                {formatToRoundedIndianRupee(amount)}
            </span>
        </div>
    );
};

// Define the Row Component for the desktop grid layout
const StatRow: React.FC<{ label: string; count: number; amount: number; type: string }> = ({ label, count, amount, type }) => (
    <TileShell type={type} label={label} amount={amount} count={count} />
);

// Composite tile: umbrella "Pending Payment Approval" with L1 + CEO breakdown,
// plus a footer line for "Total Payment Due" (status=Approved, awaiting fulfilment).
const PendingApprovalTile: React.FC<{
    totalAmount: number;
    totalCount: number;
    l1Amount: number;
    l1Count: number;
    ceoAmount: number;
    ceoCount: number;
    totalDueAmount: number;
    totalDueCount: number;
}> = ({
    totalAmount, totalCount,
    l1Amount, l1Count,
    ceoAmount, ceoCount,
    totalDueAmount, totalDueCount,
}) => (
        <TileShell type="pending" label="Summary" count={totalCount + totalDueCount}>
            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1">
                <BreakdownRow tone="red" label="Total Pending" labelLong="Pending Payment Approval" amount={totalAmount} count={totalCount} />
                <BreakdownRow tone="amber" label="L1 Pending" labelLong="L1 Pending Approval" amount={l1Amount} count={l1Count} />
                <BreakdownRow tone="blue" label="CEO Pending" labelLong="CEO Pending Approval" amount={ceoAmount} count={ceoCount} />
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <BreakdownRow tone="red" label="Approved – Not Paid" labelLong="Approved But not Paid" amount={totalDueAmount} count={totalDueCount} />
            </div>
        </TileShell>
    );

// Combined "Recent Activity" tile — Approval (L1 + CEO, Today / 7 Days) and Paid (Today / 7 Days).
const RecentActivityTile: React.FC<{
    l1TodayAmount: number;
    l1TodayCount: number;
    ceoTodayAmount: number;
    ceoTodayCount: number;
    l17dAmount: number;
    l17dCount: number;
    ceo7dAmount: number;
    ceo7dCount: number;
    paidTodayAmount: number;
    paidTodayCount: number;
    paid7dAmount: number;
    paid7dCount: number;
}> = ({
    l1TodayAmount, l1TodayCount,
    ceoTodayAmount, ceoTodayCount,
    l17dAmount, l17dCount,
    ceo7dAmount, ceo7dCount,
    paidTodayAmount, paidTodayCount,
    paid7dAmount, paid7dCount,
}) => (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden flex h-full">
            <div className="w-1 shrink-0 bg-amber-500 dark:bg-amber-600" />
            <div className="flex-1 p-3 min-w-0">
                <div className="flex items-center gap-2 group">
                    <Clock className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                        Payments Statics
                    </span>
                    <HoverCard>
                        <HoverCardTrigger asChild>
                            <Info className="w-3 h-3 text-muted-foreground cursor-pointer opacity-50 group-hover:opacity-100 shrink-0" />
                        </HoverCardTrigger>
                        <HoverCardContent className="text-xs w-auto p-2">
                            Approvals (L1 + CEO) and payments fulfilled, for today and the last 7 days.
                        </HoverCardContent>
                    </HoverCard>
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-slate-200 dark:divide-slate-700 gap-y-2">
                    {/* TODAY column */}
                    <div className="space-y-1 sm:pr-4">

                        <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Approved<span className="lg:hidden"> Today</span>
                        </div>
                        <BreakdownRow tone="amber" label="L1" labelLong="L1 Approval Today" amount={l1TodayAmount} count={l1TodayCount} />
                        <BreakdownRow tone="blue" label="CEO" labelLong="CEO Approval Today" amount={ceoTodayAmount} count={ceoTodayCount} />
                        <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 pt-1">
                            Paid<span className="lg:hidden"> Today</span>
                        </div>
                        <BreakdownRow tone="emerald" label="Paid" labelLong="Paid Today" amount={paidTodayAmount} count={paidTodayCount} />
                    </div>
                    {/* 7 DAYS column */}
                    <div className="space-y-1 sm:pl-4">

                        <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Approved<span className="lg:hidden"> (7 Days)</span>
                        </div>
                        <BreakdownRow tone="amber" label="L1" labelLong="L1 Approval (7 days)" amount={l17dAmount} count={l17dCount} />
                        <BreakdownRow tone="blue" label="CEO" labelLong="CEO Approval (7 days)" amount={ceo7dAmount} count={ceo7dCount} />
                        <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 pt-1">
                            Paid<span className="lg:hidden"> (7 Days)</span>
                        </div>
                        <BreakdownRow tone="emerald" label="Paid" labelLong="Paid (7 days)" amount={paid7dAmount} count={paid7dCount} />
                    </div>
                </div>
            </div>
        </div>
    );

// NOTE: We assume `totalCount` is passed down from the `useServerDataTable` hook in the parent.
const PaymentSummaryTable: React.FC<{ totalCount: number }> = ({ totalCount }) => {

    const {
        data: statsApiResponse,
        isLoading,
        error,
        mutate: refetchPaymentSummary
    } = useFrappeGetCall<PaymentStats>(
        "nirmaan_stack.api.payments.get_project_payment_summary.get_payment_dashboard_stats",
        undefined,
        "payment_dashboard_stats_summary"
    );

    // --- EFFECT TO REFETCH ON TOTAL COUNT CHANGE (As requested) ---
    console.log("totalCount in PaymentSummaryCards:", totalCount);
    useEffect(() => {
        // Only trigger a refetch if totalCount is a positive number, indicating data has loaded
        if (typeof totalCount === 'number' && totalCount >= 0) {
            refetchPaymentSummary();
            // A toast is often redundant here since it runs frequently, but keep the previous console log
            console.log(`Summary Refetched: Triggered by Parent Total Count Change to ${totalCount}`);
        }
    }, [totalCount, refetchPaymentSummary]);
    // --- END EFFECT ---


    const stats = useMemo(() => statsApiResponse?.message || null, [statsApiResponse]);

    if (isLoading) {
        return (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                <CardContent className="p-4 sm:p-6">
                    <div className="flex justify-center items-center h-10 sm:h-16">
                        <TailSpin height={24} width={24} color="#7c3aed" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-slate-800">
                <CardContent className="p-4">
                    <p className="font-bold text-red-700 dark:text-red-400">Error Loading Summary</p>
                    <p className="text-sm text-red-600 dark:text-red-300">Failed to fetch payment statistics.</p>
                </CardContent>
            </Card>
        );
    }

    if (!stats) return null;

    // Composite "Pending Payment Approval" totals (L1 + CEO Pending)
    const pendingApprovalCount =
        stats.total_requested_payment_count + stats.total_ceo_pending_count;
    const pendingApprovalAmount =
        stats.total_requested_payment_amount + stats.total_ceo_pending_amount;

    // Calculate totals for mobile summary
    const totalPendingAmount =
        stats.total_pending_payment_amount
        + stats.total_requested_payment_amount
        + stats.total_ceo_pending_amount;
    const totalPaidAmount = stats.payment_done_7_days_amount;
    const totalTransactions =
        stats.total_pending_payment_count
        + stats.total_requested_payment_count
        + stats.total_ceo_pending_count;

    return (
        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
            {/* ===== COMPACT MOBILE VIEW ===== */}
            <div className="sm:hidden">
                <CardContent className="p-3">
                    <div className="flex items-center gap-3 mb-2">
                        {/* Color accent + Icon */}
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
                            <Wallet className="h-5 w-5 text-white" />
                        </div>
                        {/* Primary metric - Payment Due */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                                <span className="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">
                                    {formatToRoundedIndianRupee(totalPendingAmount)}
                                </span>
                                <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                    Due
                                </span>
                            </div>
                        </div>
                        {/* Count badge */}
                        <div className="flex-shrink-0 text-right">
                            <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md tabular-nums">
                                {totalTransactions}
                            </span>
                            <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                pending
                            </span>
                        </div>
                    </div>
                    {/* Secondary metrics row */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-amber-50 dark:bg-amber-950/30 rounded-md p-2 border border-amber-100 dark:border-amber-900/50">
                            <span className="text-[9px] font-medium text-amber-600 dark:text-amber-400 uppercase block">Approved</span>
                            <span className="text-sm font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                                {formatToRoundedIndianRupee(stats.total_approval_done_7_days_amount)}
                            </span>
                        </div>
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-md p-2 border border-emerald-100 dark:border-emerald-900/50">
                            <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 uppercase block">Paid (7d)</span>
                            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                {formatToRoundedIndianRupee(totalPaidAmount)}
                            </span>
                        </div>
                        <div className="bg-red-50 dark:bg-red-950/30 rounded-md p-2 border border-red-100 dark:border-red-900/50">
                            <span className="text-[9px] font-medium text-red-600 dark:text-red-400 uppercase block">Requests</span>
                            <span className="text-sm font-bold text-red-700 dark:text-red-400 tabular-nums">
                                {stats.total_requested_payment_count}
                                <span className="text-blue-600 dark:text-blue-400"> + {stats.total_ceo_pending_count}</span>
                            </span>
                        </div>
                    </div>
                </CardContent>
            </div>

            {/* ===== EXPANDED TABLET + DESKTOP VIEW ===== */}
            <div className="hidden sm:block">
                <CardHeader className="pb-2 pt-4 px-5">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                            Payment Summary
                        </CardTitle>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                            <Wallet className="h-3.5 w-3.5" />
                            <span className="uppercase tracking-wider">
                                {totalTransactions} Pending
                            </span>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                        <div className="sm:col-span-2">
                            <PendingApprovalTile
                                totalAmount={pendingApprovalAmount}
                                totalCount={pendingApprovalCount}
                                l1Amount={stats.total_requested_payment_amount}
                                l1Count={stats.total_requested_payment_count}
                                ceoAmount={stats.total_ceo_pending_amount}
                                ceoCount={stats.total_ceo_pending_count}
                                totalDueAmount={stats.total_pending_payment_amount}
                                totalDueCount={stats.total_pending_payment_count}
                            />
                        </div>
                        <div className="sm:col-span-3">
                            <RecentActivityTile
                                l1TodayAmount={stats.total_approval_done_today_amount}
                                l1TodayCount={stats.total_approval_done_today}
                                ceoTodayAmount={stats.total_ceo_approval_done_today_amount}
                                ceoTodayCount={stats.total_ceo_approval_done_today}
                                l17dAmount={stats.total_approval_done_7_days_amount}
                                l17dCount={stats.total_approval_done_7_days}
                                ceo7dAmount={stats.total_ceo_approval_done_7_days_amount}
                                ceo7dCount={stats.total_ceo_approval_done_7_days}
                                paidTodayAmount={stats.payment_done_today_amount}
                                paidTodayCount={stats.payment_done_today}
                                paid7dAmount={stats.payment_done_7_days_amount}
                                paid7dCount={stats.payment_done_7_days}
                            />
                        </div>
                    </div>
                </CardContent>
            </div>
        </Card>
    );
};

export default PaymentSummaryTable;