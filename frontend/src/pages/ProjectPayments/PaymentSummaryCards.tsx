import React, { useMemo } from "react";
import { Card } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { TailSpin } from "react-loader-spinner";
import { useFrappeGetCall } from "frappe-react-sdk";

interface FrappeApiResponse<T> { message: T; }
interface PaymentStats {
    total_pending_payment_count: number;
    total_pending_payment_amount: number;
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

const PaymentSummaryTable: React.FC = () => {
    const {
        data: statsApiResponse,
        isLoading,
        error,
    } = useFrappeGetCall<PaymentStats>(
        "nirmaan_stack.api.payments.get_project_payment_summary.get_payment_dashboard_stats",
        undefined,
        "payment_dashboard_stats_summary"
    );

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

    // ✅ Row definitions with dynamic color logic
    const rows = [
        {
            label: "Total Pending Amount",
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
            label: "Approved Last 7 Days",
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
            label: "Paid Last 7 Days",
            count: stats.payment_done_7_days,
            amount: stats.payment_done_7_days_amount,
            type: "paid",
        },
        
    ];

    // ✅ Dynamic color assignment
    const getColorClass = (type: string) => {
        if (type === "pending") return "text-red-600";
        if (type === "approved") return "text-yellow-600";
        if (type === "paid") return "text-green-600";
        return "";
    };

    return (
        <Card className="p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Payment Summary Card</h2>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="">Metric</TableHead>
                        <TableHead className="">Count</TableHead>
                        <TableHead className="">Value</TableHead>
                    </TableRow>
                </TableHeader>

                <TableBody>
                    {rows.map((row, i) => {
                        const color = getColorClass(row.type);

                        return (
                            <TableRow key={i}>
                                <TableCell className="font-medium">{row.label}</TableCell>

                                {/* ✅ Count color updated */}
                                <TableCell className={`font-medium ${color}`}>
                                    {row.count}
                                </TableCell>

                                {/* ✅ Amount color updated */}
                                <TableCell className={`font-medium ${color}`}>
                                    {formatToRoundedIndianRupee(row.amount)}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </Card>
    );
};

export default PaymentSummaryTable;
