// src/features/procurement-requests/components/OrderListDisplay.tsx
import React from 'react';
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"; // Adjust path
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"; // Adjust path
import { Pencil, Trash2, Undo, MessageCircleMore } from "lucide-react";
import { CategorySelection, ProcurementRequestItem } from '../types'; // Adjust path
import { ItemStatus } from '../constants';

interface OrderListDisplayProps {
    procList: ProcurementRequestItem[];
    selectedCategories: CategorySelection[];
    onEditItem: (item: ProcurementRequestItem) => void;
    onDeleteItem: (itemName: string) => void;
    canUndo: boolean;
    onUndoDelete: () => void;
}

export const OrderListDisplay: React.FC<OrderListDisplayProps> = ({
    procList,
    selectedCategories,
    onEditItem,
    onDeleteItem,
    canUndo,
    onUndoDelete
}) => {

    const pendingCategories = selectedCategories.filter(cat => cat.status !== ItemStatus.REQUEST);
    const requestedCategories = selectedCategories.filter(cat => cat.status === ItemStatus.REQUEST);

    const renderCategorySection = (categories: CategorySelection[], title?: string, sectionBg?: string) => {
        if (categories.length === 0) return null;

        return (
            <div className={`mb-4 ${sectionBg ? `${sectionBg} p-2 rounded-md` : ''}`}>
                {title && <h2 className="text-lg font-semibold mb-2 px-1">{title}</h2>}
                {categories.map((cat, index) => {
                    const itemsInCategory = procList.filter(item => item.category === cat.name && item.status === cat.status);
                    if (itemsInCategory.length === 0) return null; // Don't render empty category tables

                    return (
                        <div key={`${cat.name}-${cat.status}-${index}`} className="mb-4">
                            {/* Category Header */}
                            <div className="flex items-center gap-2 ml-1 mb-1">
                                <div className="w-1 h-1 rounded-full bg-gray-600" />
                                <h3 className="text-xs font-semibold text-gray-700">
                                    {cat.name}
                                </h3>
                                {/* Optional: Display status if needed */}
                                {/* {cat.status !== ItemStatus.PENDING && <Badge variant="outline" className='ml-2'>{cat.status}</Badge>} */}
                            </div>

                            {/* Items Table */}
                            <Table className="bg-white rounded-md shadow-sm border border-gray-200">
                                <TableHeader>
                                    <TableRow className="bg-gray-50 hover:bg-gray-100">
                                        <TableHead className="w-[55%] text-xs font-medium text-gray-600 px-3 py-2">Item</TableHead>
                                        <TableHead className="w-[15%] text-xs font-medium text-gray-600 px-3 py-2 text-center">Unit</TableHead>
                                        <TableHead className="w-[15%] text-xs font-medium text-gray-600 px-3 py-2 text-center">Qty</TableHead>
                                        <TableHead className="w-[15%] text-xs font-medium text-gray-600 px-3 py-2 text-center">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {itemsInCategory.map((item) => (
                                        <TableRow key={item.uniqueId || item.name} className="hover:bg-gray-50">
                                            <TableCell className="px-3 py-2 text-sm align-top">
                                                {/* Display Item Name */}
                                                {item.item}
                                                {/* Conditionally display Make with specific styling */}
                                                {item.make && (
                                                    <span className="ml-1 text-red-700 font-light text-xs">({item.make})</span>
                                                )}
                                                {item.comment && (
                                                    <HoverCard>
                                                        <HoverCardTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-5 w-5 ml-1 p-0 inline-flex items-center justify-center align-middle text-blue-500 hover:bg-blue-50">
                                                                <MessageCircleMore className="h-4 w-4" />
                                                            </Button>
                                                        </HoverCardTrigger>
                                                        <HoverCardContent className="text-xs w-auto max-w-[300px] p-2 bg-gray-800 text-white rounded shadow-lg">
                                                            {item.comment}
                                                        </HoverCardContent>
                                                    </HoverCard>
                                                )}
                                                {/* Remove the old make display paragraph */}
                                                {/* <p><strong>make: {" "}</strong>{item?.make || "--"}</p> */}
                                            </TableCell>
                                            <TableCell className="px-3 py-2 text-sm text-center align-middle">{item.unit}</TableCell>
                                            <TableCell className="px-3 py-2 text-sm text-center align-middle">{item.quantity}</TableCell>
                                            <TableCell className="px-3 py-2 text-sm text-center align-middle">
                                                <div className="flex items-center justify-center gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-blue-600 hover:bg-blue-50"
                                                        onClick={() => onEditItem(item)}
                                                        aria-label={`Edit item ${item.item}`}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-red-600 hover:bg-red-50"
                                                        onClick={() => onDeleteItem(item.name)}
                                                        aria-label={`Delete item ${item.item}`}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    );
                })}
            </div>
        );
    };


    // if (procList.length === 0) {
    //     return (
    //         <div className="h-[40vh] flex items-center justify-center text-gray-500 font-semibold">
    //             No items added yet.
    //         </div>
    //     );
    // }

    return (
        <div className='mt-4'>
            {/* Header and Undo Button */}
            <div className="flex justify-between items-center mb-3 px-1">
                <h2 className="text-lg font-semibold">Order Cart</h2>
                {canUndo && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onUndoDelete}
                        className="flex items-center gap-1.5 text-blue-600 border-blue-300 hover:bg-blue-50"
                    >
                        <Undo className="h-4 w-4" />
                        Undo Delete
                    </Button>
                )}
            </div>

            {procList.length === 0 && <div className="h-[40vh] flex items-center justify-center text-gray-500 font-semibold">No items added yet.</div>}

            {/* Render Sections */}
            {renderCategorySection(pendingCategories)}
            {renderCategorySection(requestedCategories, "Requested Items", "bg-yellow-50 border border-yellow-200")}

        </div>
    );
};