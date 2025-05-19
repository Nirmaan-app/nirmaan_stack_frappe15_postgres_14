import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { User } from "lucide-react";
import { useFrappeGetDocCount } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { CUSTOMER_DOCTYPE } from '../customers.constants';

export const CustomersSummaryCard: React.FC = () => {
    const { data: totalCustomers, isLoading, error } = useFrappeGetDocCount(CUSTOMER_DOCTYPE, undefined, true, false, `${CUSTOMER_DOCTYPE}_total_summary`);
    return (
        <Card className="hover:animate-shadow-drop-center">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold">Total Customers</CardTitle>
                <User className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">
                    {isLoading ? <TailSpin visible={true} height="28" width="28" color="#D03B45" radius="1" />
                     : error ? <span className='text-sm text-destructive'>Error</span>
                     : totalCustomers ?? '0'}
                </div>
                <p className="text-xs text-muted-foreground">Registered customers in the system</p>
            </CardContent>
        </Card>
    );
};