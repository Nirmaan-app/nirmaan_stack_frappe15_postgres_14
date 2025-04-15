import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import formatToIndianRupee from '@/utils/FormatPrice'; // Adjust path as needed
import { OrderData, Quote, PRItem } from '../types';
import { MessageCircleMore, AlertTriangle } from 'lucide-react';

interface SummaryViewProps {
    orderData: OrderData;
    quoteData?: Quote[];
    categoryMakesMap: Map<string, string[]>; // Map of category name to makes array
    // uploadedFiles?: Record<string, File>; // Add back if file uploads are implemented
}

export const SummaryView: React.FC<SummaryViewProps> = ({ orderData, quoteData = [], categoryMakesMap }) => {

    // Helper to find the minimum quote for an item
    const getMinQuote = (itemId: string): number | undefined => {
        const quotesForItem = quoteData
            .filter(q => q.item_id === itemId && typeof q.quote === 'number')
            .map(q => q.quote as number); // Assert as number after filtering

        return quotesForItem.length > 0 ? Math.min(...quotesForItem) : undefined;
    };

    // Get unique categories present in the final list (including potentially updated requested items)
    const finalCategories = React.useMemo(() => {
        const categories = new Map<string, { name: string; makes?: string[] }>();
        orderData.procurement_list.list.forEach(item => {
            if (!categories.has(item.category)) {
                categories.set(item.category, {
                    name: item.category, // This should ideally be the category_name, fetch if needed
                    makes: categoryMakesMap.get(item.category),
                });
            }
        });
         // TODO: Fetch actual category_name if `item.category` is just the docname
         // For now, using the docname as the display name.
        return Array.from(categories.values());
    }, [orderData.procurement_list.list, categoryMakesMap]);


    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Items Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {finalCategories.map((catInfo) => {
                    const itemsInCategory = orderData.procurement_list.list.filter(item => item.category === catInfo.name);
                    if (itemsInCategory.length === 0) return null;

                    const makes = catInfo.makes ?? [];

                    return (
                        <div key={catInfo.name} className='border rounded-md overflow-hidden'>
                            <div className='bg-gray-100 p-2 px-3 border-b'>
                                <h3 className="text-sm font-semibold text-gray-800">
                                    {catInfo.name} {/* Display Category Name */}
                                </h3>
                                {makes.length > 0 && (
                                    <p className="text-xs font-medium text-muted-foreground italic">
                                        (Makes: {makes.join(', ')})
                                    </p>
                                )}
                                {/* Add file attachment info here if needed */}
                            </div>
                            <Table>
                                <TableHeader>
                                    <TableRow className='hover:bg-white'>
                                        <TableHead className="w-[50%] text-xs h-8">Item</TableHead>
                                        <TableHead className="w-[15%] text-xs text-center h-8">Unit</TableHead>
                                        <TableHead className="w-[15%] text-xs text-center h-8">Quantity</TableHead>
                                        <TableHead className="w-[20%] text-xs text-right h-8">Est. Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {itemsInCategory.map((item) => {
                                        const minQuote = getMinQuote(item.name);
                                        const estimatedAmount = (minQuote !== undefined && item.quantity !== undefined)
                                            ? minQuote * item.quantity
                                            : null;

                                        const isRequested = item.status === 'Request'; // Check original status if needed

                                        return (
                                            <TableRow key={item.name} className={isRequested ? 'bg-yellow-50' : ''}>
                                                <TableCell className="text-sm py-2 align-top">
                                                     {item.item}
                                                     {isRequested && (
                                                         <span className='ml-1 text-yellow-600 text-xs font-semibold'>(Requested)</span>
                                                     )}
                                                    {item.comment && (
                                                        <div className="flex items-start gap-1 mt-1 text-xs text-muted-foreground max-w-md">
                                                            <MessageCircleMore className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                                            <span>{item.comment}</span>
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-sm text-center py-2 align-top">{item.unit}</TableCell>
                                                <TableCell className="text-sm text-center py-2 align-top">{item.quantity}</TableCell>
                                                <TableCell className="text-sm text-right py-2 align-top font-medium">
                                                     {isRequested ? "N/A" : formatToIndianRupee(estimatedAmount)}
                                                 </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    );
                })}
                {orderData.procurement_list.list.some(i => i.status === 'Request') && (
                    <div className='flex items-center gap-2 text-sm text-yellow-700 p-2 bg-yellow-100 rounded-md border border-yellow-200'>
                        <AlertTriangle className='h-4 w-4' />
                         Note: Items marked as (Requested) will not be included if you Approve now. Please resolve them first. Estimated amounts for these are N/A.
                    </div>
                )}
            </CardContent>
        </Card>
    );
};