// src/features/vendors/components/VendorsOverallSummaryCard.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package } from "lucide-react";
import { useFrappeGetDocCount } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { VENDOR_DOCTYPE } from '../vendors.constants';

export const VendorsOverallSummaryCard: React.FC = () => {
    const { data: totalVendors, isLoading, error } = useFrappeGetDocCount(VENDOR_DOCTYPE, undefined, true, false, `${VENDOR_DOCTYPE}_overall_total`);
    return (
        <Card className="hover:animate-shadow-drop-center">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold">Total Registered Vendors</CardTitle>
                <Package className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">
                    {isLoading ? <TailSpin visible={true} height="28" width="28" color="#D03B45" radius="1" />
                     : error ? <span className="text-sm text-destructive">Error</span>
                     : totalVendors ?? '0'}
                </div>
            </CardContent>
        </Card>
    );
};