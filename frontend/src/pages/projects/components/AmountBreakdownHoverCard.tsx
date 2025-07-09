// src/pages/projects/components/AmountBreakdownHoverCard.tsx
// Create this new component file.

import React from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';

interface AmountBreakdownHoverCardProps {
    poAmount: number;
    srAmount: number;
    projectExpensesAmount: number;
    children: React.ReactNode; // The element that triggers the hover card
}

export const AmountBreakdownHoverCard: React.FC<AmountBreakdownHoverCardProps> = ({
    poAmount,
    srAmount,
    projectExpensesAmount,
    children
}) => {
    return (
        <HoverCard>
            <HoverCardTrigger asChild>
                {children}
            </HoverCardTrigger>
            <HoverCardContent className="w-auto text-sm">
                <div className="space-y-1">
                    <h4 className="font-semibold text-center mb-2">Outflow Breakdown</h4>
                    <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">PO Payments:</span>
                        <span className="font-medium text-right">{formatToRoundedIndianRupee(poAmount)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">SR Payments:</span>
                        <span className="font-medium text-right">{formatToRoundedIndianRupee(srAmount)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Project Expenses:</span>
                        <span className="font-medium text-right">{formatToRoundedIndianRupee(projectExpensesAmount)}</span>
                    </div>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
};