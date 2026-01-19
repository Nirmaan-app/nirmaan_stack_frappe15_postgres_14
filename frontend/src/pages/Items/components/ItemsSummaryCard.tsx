// src/features/items/components/ItemsSummaryCard.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart } from "lucide-react";
import { useFrappeGetDocCount } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { ITEM_DOCTYPE } from '../items.constants';

export const ItemsSummaryCard: React.FC = () => {
    const { data: totalItemsCount, isLoading, error } = useFrappeGetDocCount(ITEM_DOCTYPE, undefined, false, `${ITEM_DOCTYPE}_total_summary`);
    return (
        <Card className="hover:animate-shadow-drop-center">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold">Total Products</CardTitle>
                <ShoppingCart className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">
                    {isLoading ? <TailSpin visible={true} height="28" width="28" color="#D03B45" radius="1" />
                     : error ? <span className='text-sm text-destructive'>Error</span>
                     : totalItemsCount ?? '0'}
                </div>
                <p className="text-xs text-muted-foreground">Unique products in the system</p>
            </CardContent>
        </Card>
    );
};