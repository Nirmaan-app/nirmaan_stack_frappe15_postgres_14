import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from '@/components/ui/label';
import formatToIndianRupee, { formatToRoundedIndianRupee } from '@/utils/FormatPrice';

interface SRFinancialSummaryProps {
    totalExclusiveGST: number;
    totalInclusiveGST: number;
    amountPaid: number;
    amountPendingForRequest: number;
    gstEnabled?: boolean;
}

export const SRFinancialSummary: React.FC<SRFinancialSummaryProps> = ({
    totalExclusiveGST,
    totalInclusiveGST,
    amountPaid,
    amountPendingForRequest,
    gstEnabled,
}) => {
    const dueAmount = Math.max(0, totalInclusiveGST - amountPaid - amountPendingForRequest);

    return (
        <Card className="shadow-sm">
            <CardHeader><CardTitle className="text-lg text-muted-foreground">Financial Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <InfoItem label="Total (Excl. GST)" value={formatToRoundedIndianRupee(totalExclusiveGST)} />
                {gstEnabled && (
                    <InfoItem label="Total (Incl. GST)" value={formatToRoundedIndianRupee(totalInclusiveGST)} />
                )}
                <InfoItem label="Amount Paid" value={formatToRoundedIndianRupee(amountPaid)} className="text-green-600" />
                <InfoItem label="Pending Requests" value={formatToRoundedIndianRupee(amountPendingForRequest)} className="text-orange-600" />
                <InfoItem label="Amount Due" value={formatToRoundedIndianRupee(dueAmount)} className="font-semibold" />
            </CardContent>
        </Card>
    );
};

// Reusable InfoItem component (can be moved to a shared location)
const InfoItem: React.FC<{ label: string; value: string | number; className?: string }> = ({ label, value, className }) => (
    <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-base font-medium ${className || 'text-foreground'}`}>{value}</p>
    </div>
);