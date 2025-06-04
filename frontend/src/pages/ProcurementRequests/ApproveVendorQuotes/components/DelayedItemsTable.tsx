import React from 'react';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"; // Adjust path
import { ProcurementRequestItemDetail } from '@/types/NirmaanStack/ProcurementRequests'; // Adjust path

interface DelayedItemsTableProps {
    items: ProcurementRequestItemDetail[]; // Array of items with status 'Delayed'
}

export const DelayedItemsTable: React.FC<DelayedItemsTableProps> = ({ items = [] }) => {
    // Group items by category
    const groupedByCategory = React.useMemo(() => {
        return items.reduce((acc, item) => {
            const category = item.category || 'Uncategorized'; // Handle missing category
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(item);
            return acc;
        }, {} as { [category: string]: ProcurementRequestItemDetail[] });
    }, [items]);

    if (items.length === 0) {
        return (
            <div className="p-4 text-center text-sm text-muted-foreground border rounded-md">
                No Delayed Items found for this PR.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {Object.entries(groupedByCategory).map(([category, categoryItems]) => (
                 <div key={category} className="border rounded-md overflow-hidden">
                     <Table>
                         <TableHeader>
                             <TableRow className="bg-amber-100 hover:bg-amber-100">
                                 <TableHead className="w-[60%] text-amber-800 font-semibold">{category}</TableHead>
                                 <TableHead className="w-[20%] text-center text-amber-800">UOM</TableHead>
                                 <TableHead className="w-[20%] text-center text-amber-800">Quantity</TableHead>
                             </TableRow>
                         </TableHeader>
                         <TableBody>
                             {categoryItems.map((item, index) => (
                                 <TableRow key={`${item.name}-${index}`}>
                                     <TableCell>{item.item_name}</TableCell>
                                     <TableCell className='text-center'>{item.unit}</TableCell>
                                     <TableCell className='text-center'>{item.quantity}</TableCell>
                                 </TableRow>
                             ))}
                         </TableBody>
                     </Table>
                 </div>
            ))}
        </div>
    );
};