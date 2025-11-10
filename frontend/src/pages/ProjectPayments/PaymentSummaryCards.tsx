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
// Import CardHeader/CardContent for better structure with the Card component
import { Card, CardHeader, CardContent } from "@/components/ui/card"; 
import { TailSpin } from "react-loader-spinner";
import { useFrappeGetCall } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { Info } from "lucide-react";
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
    }).format(value);

// Define the Row Component for the new grid layout
const StatRow: React.FC<{ label: string, count: number, amount: number, type: string }> = ({ label, count, amount, type }) => {
    
    const getColorClass = (type: string) => {
        if (type === "pending" || type === "requested") return "text-red-600";
        if (type === "approved") return "text-yellow-600";
        if (type === "paid") return "text-green-600";
        return "text-gray-900";
    };

    const color = getColorClass(type);

    // Dynamic hover text based on type
    const getHoverText = (label: string) => {
        if (label.includes("Pending Payment Request")) return "Payments Requested but not yet Approved.";
        if (label.includes("Total Payment Due")) return "Total amount of all payments not yet Paid";
        if (label.includes("Approved")) return "Count and value of payments approved in the specified period.";
        if (label.includes("Paid")) return "Count and value of payments completed/paid in the specified period.";
        return label;
    }

    return (
        <div className="flex justify-between items-center py-2 border-b last:border-b-0">
            <div className="flex items-center gap-1 group text-sm font-medium text-gray-700">
                {label}
                <HoverCard>
                    <HoverCardTrigger asChild>
                        <Info className="w-3 h-3 text-muted-foreground cursor-pointer opacity-70 group-hover:opacity-100" />
                    </HoverCardTrigger>
                    <HoverCardContent className="text-xs w-auto p-1.5">
                        {getHoverText(label)}
                    </HoverCardContent>
                </HoverCard>
            </div>
            <div className="flex flex-col items-end">
                <span className={`text-base font-semibold ${color}`}>
                    {formatToRoundedIndianRupee(amount)}
                </span>
                <span className={`text-xs font-medium ${color}`}>
                    ({count} Count)
                </span>
            </div>
        </div>
    );
}

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
            <div className="flex justify-center items-center py-8">
                <TailSpin height={24} width={24} color="#4f46e5" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                <p className="font-bold">Error Loading Summary</p>
                <p className="text-sm">Failed to fetch payment statistics.</p>
            </div>
        );
    }

    if (!stats) return null;

    // ✅ Row definitions
    const rows = [
       
         {
            label: "Pending Payment Request",
            count: stats.total_requested_payment_count,
            amount: stats.total_requested_payment_amount,
            type: "requested",
        },
        
        {
            label: "Approved Today",
            count: stats.total_approval_done_today,
            amount: stats.total_approval_done_today_amount,
            type: "approved",
        },
        {
            label: "Approved Last 7 Days",
            count: stats.total_approval_done_7_days,
            amount: stats.total_approval_done_7_days_amount,
            type: "approved",
        },
         {
            label: "Total Payment Due",
            count: stats.total_pending_payment_count,
            amount: stats.total_pending_payment_amount,
            type: "pending",
        },
        {
            label: "Paid Today",
            count: stats.payment_done_today,
            amount: stats.payment_done_today_amount,
            type: "paid",
        },
        {
            label: "Paid Last 7 Days",
            count: stats.payment_done_7_days,
            amount: stats.payment_done_7_days_amount,
            type: "paid",
        },
    ];

    // Split rows into two columns for desktop view
    const half = Math.ceil(rows.length / 2);
    const leftRows = rows.slice(0, half);
    const rightRows = rows.slice(half);

    return (
        <Card className="p-4 shadow-sm">
            <CardHeader className="p-0 pb-3">
                <h2 className="text-lg font-semibold">Payment Summary Card</h2>
            </CardHeader>
            <CardContent className="p-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-0">
                    
                    {/* Column 1 (Mobile: Full Width) */}
                    <div className="border-b md:border-b-0 md:border-r lg:pr-6">
                        {leftRows.map((row, i) => (
                            <StatRow key={i} {...row} />
                        ))}
                    </div>

                    {/* Column 2 (Mobile: Full Width, Desktop: Right of Column 1) */}
                    <div className="lg:pl-6 lg:pt-0 pt-2">
                        {rightRows.map((row, i) => (
                            <StatRow key={i} {...row} />
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default PaymentSummaryTable;