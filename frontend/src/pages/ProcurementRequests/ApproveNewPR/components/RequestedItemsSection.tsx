import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRCategory, PRItem } from '../types';
import { AlertTriangle } from 'lucide-react';
import { RequestedItemTable } from './RequestedItemTable';

interface RequestedItemsSectionProps {
    categories: PRCategory[]; // Categories that have requested items
    items: PRItem[]; // Only items with status 'Request'
    onAction: (item: PRItem) => void; // Handler to open the RequestItemDialog
    onDelete: (item: PRItem) => void; // Handler to directly reject/delete the request
}

export const RequestedItemsSection: React.FC<RequestedItemsSectionProps> = ({ categories, items, onAction, onDelete }) => {
    if (!categories || categories.length === 0 || !items || items.length === 0) {
        return null; // Don't render if no requested items
    }

    return (
        <Card className="bg-yellow-50 border-yellow-200">
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                    Action Required: Requested Products
                </CardTitle>
                <p className="text-xs text-yellow-700">
                    These products were requested by the site team. Please review, approve (potentially creating a new product master), match to an existing product, or reject them.
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {categories.map((cat) => {
                    // Filter items specifically for this category within the requested items list
                    const itemsForCategory = items.filter(item => item.category === cat.name && item.status === 'Request');
                    if (itemsForCategory.length === 0) return null; // Skip if no items for this cat

                    return (
                        <div key={`${cat.name}-Request`}>
                            {/* <h3 className="text-sm font-semibold text-gray-800 border-b pb-1 mb-2">
                                {cat.name}
                            </h3> */}
                            <RequestedItemTable
                                category={cat.name}
                                items={itemsForCategory}
                                onAction={onAction}
                                onDelete={onDelete}
                            />
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
};