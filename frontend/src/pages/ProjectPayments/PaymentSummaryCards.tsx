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
    total_approval_done_today: number;
    total_approval_done_today_amount: number;
    total_approval_done_7_days: number;
    total_approval_done_7_days_amount: number;
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

// Define the Row Component for the desktop grid layout
const StatRow: React.FC<{ label: string; count: number; amount: number; type: string }> = ({ label, count, amount, type }) => {
    const getStyles = (type: string) => {
        if (type === "pending" || type === "requested") {
            return {
                text: "text-red-600 dark:text-red-400",
                bg: "bg-red-50 dark:bg-red-950/30",
                border: "border-red-100 dark:border-red-900/50",
                icon: <AlertCircle className="h-4 w-4" />,
            };
        }
        if (type === "approved") {
            return {
                text: "text-amber-600 dark:text-amber-400",
                bg: "bg-amber-50 dark:bg-amber-950/30",
                border: "border-amber-100 dark:border-amber-900/50",
                icon: <Clock className="h-4 w-4" />,
            };
        }
        if (type === "paid") {
            return {
                text: "text-emerald-600 dark:text-emerald-400",
                bg: "bg-emerald-50 dark:bg-emerald-950/30",
                border: "border-emerald-100 dark:border-emerald-900/50",
                icon: <CheckCircle2 className="h-4 w-4" />,
            };
        }
        return {
            text: "text-slate-600 dark:text-slate-400",
            bg: "bg-slate-50 dark:bg-slate-800/50",
            border: "border-slate-200 dark:border-slate-700",
            icon: <CreditCard className="h-4 w-4" />,
        };
    };

    const styles = getStyles(type);

    const getHoverText = (label: string) => {
        if (label.includes("Pending Payment Request")) return "Payments Requested but not yet Approved.";
        if (label.includes("Total Payment Due")) return "Total amount of all payments not yet Paid";
        if (label.includes("Approved")) return "Count and value of payments approved in the specified period.";
        if (label.includes("Paid")) return "Count and value of payments completed/paid in the specified period.";
        return label;
    };

    return (
        <div className={`rounded-lg p-3 ${styles.bg} border ${styles.border}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 group">
                    <span className={styles.text}>{styles.icon}</span>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                        {label}
                    </span>
                    <HoverCard>
                        <HoverCardTrigger asChild>
                            <Info className="w-3 h-3 text-muted-foreground cursor-pointer opacity-50 group-hover:opacity-100" />
                        </HoverCardTrigger>
                        <HoverCardContent className="text-xs w-auto p-2">
                            {getHoverText(label)}
                        </HoverCardContent>
                    </HoverCard>
                </div>
                <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 tabular-nums">
                    {count} {count === 1 ? 'item' : 'items'}
                </span>
            </div>
            <div className={`text-xl font-bold ${styles.text} tabular-nums mt-1`}>
                {formatToRoundedIndianRupee(amount)}
            </div>
        </div>
    );
};

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

    // Row definitions with type for color coding
    const rows = [
        {
            label: "Pending Requests",
            count: stats.total_requested_payment_count,
            amount: stats.total_requested_payment_amount,
            type: "requested",
        },
        {
            label: "Total Payment Due",
            count: stats.total_pending_payment_count,
            amount: stats.total_pending_payment_amount,
            type: "pending",
        },
        {
            label: "Approved Today",
            count: stats.total_approval_done_today,
            amount: stats.total_approval_done_today_amount,
            type: "approved",
        },
        {
            label: "Approved (7 Days)",
            count: stats.total_approval_done_7_days,
            amount: stats.total_approval_done_7_days_amount,
            type: "approved",
        },
        {
            label: "Paid Today",
            count: stats.payment_done_today,
            amount: stats.payment_done_today_amount,
            type: "paid",
        },
        {
            label: "Paid (7 Days)",
            count: stats.payment_done_7_days,
            amount: stats.payment_done_7_days_amount,
            type: "paid",
        },
    ];

    // Calculate totals for mobile summary
    const totalPendingAmount = stats.total_pending_payment_amount + stats.total_requested_payment_amount;
    const totalPaidAmount = stats.payment_done_today_amount + stats.payment_done_7_days_amount;
    const totalTransactions = stats.total_pending_payment_count + stats.total_requested_payment_count;

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
                            </span>
                        </div>
                    </div>
                </CardContent>
            </div>

            {/* ===== EXPANDED DESKTOP VIEW ===== */}
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
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                        {rows.map((row, i) => (
                            <StatRow key={i} {...row} />
                        ))}
                    </div>
                </CardContent>
            </div>
        </Card>
    );
};

export default PaymentSummaryTable;