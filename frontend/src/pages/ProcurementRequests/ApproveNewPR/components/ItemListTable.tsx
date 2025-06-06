import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Pencil, MessageCircleMore } from 'lucide-react';
import { PRItemUIData as PRItem } from '../types';

interface ItemListTableProps {
    category: string;
    items: PRItem[];
    onEdit: (item: PRItem) => void;
    makes: string[]
}

export const ItemListTable: React.FC<ItemListTableProps> = ({ items, onEdit, category, makes }) => {
    return (
        <Table className="table-fixed"> {/* Use table-fixed for better column control */}
            <TableHeader>
                <TableRow className="bg-red-200">
                    <TableHead className="w-[55%] text-xs h-8 text-red-700 font-semibold">{category}
                        {makes.length > 0 && (
                            <div className="text-xs font-medium text-muted-foreground italic">
                                MakeList: {makes.join(', ')}
                            </div>
                        )}
                    </TableHead>
                    <TableHead className="w-[15%] text-xs text-center h-8">Unit</TableHead>
                    <TableHead className="w-[15%] text-xs text-center h-8">Quantity</TableHead>
                    <TableHead className="w-[15%] text-xs text-center h-8">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {items.map((item) => (
                    <TableRow key={item.item_id} className="hover:bg-gray-50">
                        <TableCell className="text-sm py-2 align-top"> {/* Adjust padding */}
                            {item.item_name}
                            {/* Conditionally display Make with specific styling */}
                            {item.make && (
                                <span className="ml-1 text-red-700 font-light text-xs">({item.make})</span>
                            )}
                            {item.comment && (
                                <div className="flex items-start gap-1 mt-1 border border-gray-200 rounded p-1 text-xs text-muted-foreground max-w-md">
                                    <MessageCircleMore className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                    <span>{item.comment}</span>
                                </div>
                            )}
                            {/* <p className="text-xs"><strong>make: {" "}</strong>{item?.make || "--"}</p> */}
                        </TableCell>
                        <TableCell className="text-sm text-center py-2 align-top">{item.unit}</TableCell>
                        <TableCell className="text-sm text-center py-2 align-top">{item.quantity}</TableCell>
                        <TableCell className="text-sm text-center py-2 align-top">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(item)}>
                                <Pencil className="w-4 h-4" />
                            </Button>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};