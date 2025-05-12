// src/features/procurement-requests/components/OrderListDisplay.tsx
import React, { useMemo } from 'react'; // Added useMemo
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Pencil, Trash2, Undo, MessageCircleMore } from "lucide-react";
import { CategorySelection, ProcurementRequestItem } from '../types';
import { ItemStatus } from '../constants';

interface OrderListDisplayProps {
    procList: ProcurementRequestItem[];
    selectedCategories: CategorySelection[]; // Still useful for makes and category display names
    onEditItem: (item: ProcurementRequestItem) => void;
    onDeleteItem: (itemId: string) => void; // Changed to itemId (uniqueId or name)
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

    // Get all unique category names from the procList.
    // These are the categories that definitely have items.
    const allUniqueCategoryNamesInProcList = useMemo(() => {
        const names = new Set<string>();
        procList.forEach(item => names.add(item.category));
        return Array.from(names).sort();
    }, [procList]);

    // Reusable function to render a table of items for a specific category
    const renderCategoryItemsTable = (
        categoryName: string,
        itemsToRender: ProcurementRequestItem[],
        isRequestedSection: boolean // To help with unique key generation if needed
    ) => {
        if (itemsToRender.length === 0) return null;

        // The categoryName here is the DocType name (key).
        // For display, selectedCategories might hold a more user-friendly label if available,
        // but for now, using categoryName (the ID) is consistent.
        const displayCategoryName = categoryName;

        return (
            <div key={`${categoryName}-${isRequestedSection ? 'requested' : 'pending'}`} className="mb-4">
                {/* Category Header */}
                <div className="flex items-center gap-2 ml-1 mb-1">
                    <div className="w-1 h-1 rounded-full bg-gray-600" />
                    <h3 className="text-xs font-semibold text-gray-700">
                        {displayCategoryName}
                    </h3>
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
                        {itemsToRender.map((item) => (
                            <TableRow key={item.uniqueId || item.name} className="hover:bg-gray-50">
                                <TableCell className="px-3 py-2 text-sm align-top">
                                    {item.item}
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
                                            onClick={() => onDeleteItem(item.uniqueId || item.name)} // Use uniqueId if available
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
    };

    const pendingItemsExistInProcList = procList.some(item => item.status !== ItemStatus.REQUEST);
    const requestedItemsExistInProcList = procList.some(item => item.status === ItemStatus.REQUEST);

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

            {/* Pending Items Section: Render if there are any non-requested items in the entire procList */}
            {procList.length > 0 && pendingItemsExistInProcList && (
                <div className="mb-4">
                    {/* Optional: Add a title for "Pending Items" if desired */}
                    {/* <h2 className="text-lg font-semibold mb-2 px-1">Items to Order</h2> */}
                    {allUniqueCategoryNamesInProcList.map(categoryName => {
                        const itemsForThisCategory = procList.filter(
                            item => item.category === categoryName && item.status !== ItemStatus.REQUEST
                        );
                        return renderCategoryItemsTable(categoryName, itemsForThisCategory, false);
                    })}
                </div>
            )}

            {/* Requested Items Section: Render if there are any requested items in the entire procList */}
            {procList.length > 0 && requestedItemsExistInProcList && (
                <div className="mb-4 bg-yellow-50 border border-yellow-200 p-2 rounded-md">
                    <h2 className="text-lg font-semibold mb-2 px-1">Requested Items</h2>
                    {allUniqueCategoryNamesInProcList.map(categoryName => {
                        const itemsForThisCategory = procList.filter(
                            item => item.category === categoryName && item.status === ItemStatus.REQUEST
                        );
                        return renderCategoryItemsTable(categoryName, itemsForThisCategory, true);
                    })}
                </div>
            )}
        </div>
    );
};