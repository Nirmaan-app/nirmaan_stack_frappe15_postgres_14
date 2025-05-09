// src/features/procurement-requests/components/WorkPackageSelector.tsx
import React from 'react';
import { Card, CardHeader, CardTitle } from "@/components/ui/card"; // Adjust path
import { ProcurementPackages } from '@/types/NirmaanStack/ProcurementPackages';

// Default image URL (replace with your actual fallback)
const defaultImageUrl = "/placeholder-image.png";

interface WorkPackageSelectorProps {
    wpList?: ProcurementPackages[];
    onSelectWP: (wpName: string) => void;
    isLoading?: boolean; // Optional: Show loading state
}

export const WorkPackageSelector: React.FC<WorkPackageSelectorProps> = ({ wpList, onSelectWP, isLoading }) => {

    if (isLoading) {
        // Optional: Show a loading skeleton matching the grid layout
        return <div className="p-4">Loading Work Packages...</div>;
    }

    if (!wpList || wpList.length === 0) {
        return <div className="p-4 text-center text-gray-500">No Work Packages available for this project.</div>;
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {wpList.map((item) => (
                <Card
                    key={item.name} // Use DocType name as key
                    className="flex flex-col items-center shadow-sm text-center border border-gray-300 hover:border-primary hover:shadow-md transition-all cursor-pointer"
                    onClick={() => onSelectWP(item.work_package_name!)}
                >
                    <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2 w-full">
                        {/* Ensure CardTitle allows flex layout */}
                        <CardTitle className="flex flex-col items-center text-sm font-medium text-center w-full">
                            <img
                                className="h-32 md:h-36 w-full object-cover rounded-lg mb-2" // Adjust size/styling
                                src={item.work_package_image || defaultImageUrl}
                                alt={item.work_package_name}
                                loading="lazy" // Add lazy loading
                            />
                            {/* Ensure text wraps */}
                            <span className="break-words">{item.work_package_name}</span>
                        </CardTitle>
                    </CardHeader>
                </Card>
            ))}
        </div>
    );
};