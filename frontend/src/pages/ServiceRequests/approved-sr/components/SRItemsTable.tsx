import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ServiceItemType } from '@/types/NirmaanStack/ServiceRequests';
import formatToIndianRupee from '@/utils/FormatPrice';
import { parseNumber } from '@/utils/parseNumber';

interface SRItemsTableProps {
    items?: ServiceItemType[]; // Expects already parsed list
    gstEnabled?: boolean; // To show GST column if applicable
}

export const SRItemsTable: React.FC<SRItemsTableProps> = ({ items, gstEnabled }) => {
    if (!items || items.length === 0) {
        return (
            <Card>
                <CardHeader><CardTitle className="text-lg text-muted-foreground">Service Items</CardTitle></CardHeader>
                <CardContent><p className="text-sm text-center py-4">No service items found for this request.</p></CardContent>
            </Card>
        );
    }

    return (
        <Card className="shadow-sm">
            <CardHeader><CardTitle className="text-lg text-muted-foreground">Service Order Details</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[5%]">#</TableHead>
                            <TableHead className="w-[30%]">Category</TableHead>
                            <TableHead className="w-[35%]">Description</TableHead>
                            <TableHead className="text-center w-[10%]">Qty</TableHead>
                            <TableHead className="text-center w-[10%]">UOM</TableHead>
                            <TableHead className="text-right w-[10%]">Rate</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item, index) => (
                            <TableRow key={item.id || `sr-item-${index}`}>
                                <TableCell>{index + 1}</TableCell>
                                <TableCell>{item.category}</TableCell>
                                <TableCell className="whitespace-pre-wrap">{item.description}</TableCell>
                                <TableCell className="text-center">{parseNumber(String(item.quantity))}</TableCell>
                                <TableCell className="text-center">{item.uom}</TableCell>
                                <TableCell className="text-right">{formatToIndianRupee(parseNumber(String(item.rate)))}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
};