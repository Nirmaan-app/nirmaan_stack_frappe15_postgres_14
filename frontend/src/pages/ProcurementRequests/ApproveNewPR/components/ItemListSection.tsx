import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ItemListTable } from './ItemListTable'; // The actual table component
import { PRCategory, PRItem } from '../types';
import { CirclePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ItemListSectionProps {
    categories: PRCategory[];
    items: PRItem[];
    onEdit: (item: PRItem) => void;
    categoryMakesMap: Map<string, string[]>; // Map of category name to makes array
    toggleNewItemsCard: () => void
}

export const ItemListSection: React.FC<ItemListSectionProps> = ({ categories, items, onEdit, categoryMakesMap, toggleNewItemsCard }) => {
    // if (!categories || categories.length === 0) {
    //     return null; // Don't render the card if there are no categories with added items
    // }

    return (
        <Card>
            <CardHeader className='flex items-center justify-between flex-row'>
                <CardTitle className="text-base">Order List</CardTitle> {/* Adjusted size */}
                <Button
                    className="text-sm bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1"
                    onClick={toggleNewItemsCard}
                    variant={"secondary"}
                >
                    <CirclePlus className="w-4 h-4" /> Add Missing Products
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                {categories.length > 0 ? (
                    categories.map((cat) => {
                        const itemsForCategory = items.filter(item => item.category === cat.name && item.status === (cat?.status || "Pending"));
                        const makes = categoryMakesMap.get(cat.name) ?? [];
                        if (itemsForCategory.length === 0) return null; // Skip category if no items match
    
                        return (
                            <div key={`${cat.name}-${cat?.status || "Pending"}`}>
                                {/* <div className="flex items-center justify-between border-b p-2 mb-2 bg-red-200">
                                     <h3 className="text-sm font-semibold text-red-800">
                                         {cat.name}
                                     </h3>
                                     {makes.length > 0 && (
                                         <div className="text-xs font-medium text-muted-foreground italic">
                                             Makes: {makes.join(', ')}
                                         </div>
                                     )}
                                </div> */}
                                <ItemListTable
                                    category={cat.name}
                                    items={itemsForCategory}
                                    onEdit={onEdit}
                                />
                            </div>
                        );
                    })
                ) : (
                    <p className='text-center text-xs'>No Products to display, please click on "Undo" button to recover the
                    deleted Products or add at least a Product to enable the "Approve" or
                    "Reject" button</p>
                )}
            </CardContent>
        </Card>
    );
};