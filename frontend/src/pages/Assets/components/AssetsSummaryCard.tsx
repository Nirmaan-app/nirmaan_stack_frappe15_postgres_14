import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Boxes, Package, UserCheck } from "lucide-react";
import { useFrappeGetDocCount } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import {
    ASSET_CATEGORY_DOCTYPE,
    ASSET_MASTER_DOCTYPE
} from '../assets.constants';

interface SummaryCardProps {
    title: string;
    value: number | undefined;
    description: string;
    icon: React.ReactNode;
    isLoading: boolean;
    error?: unknown;
    accentColor?: string;
}

// Desktop/Tablet Card View
const SummaryCard: React.FC<SummaryCardProps> = ({
    title,
    value,
    description,
    icon,
    isLoading,
    error,
    accentColor = "text-muted-foreground"
}) => (
    <Card className="group relative overflow-hidden border border-gray-100 bg-white transition-all duration-300 hover:border-gray-200 hover:shadow-md">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-50/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium tracking-tight text-gray-600">
                {title}
            </CardTitle>
            <div className={`rounded-lg bg-gray-50 p-2 transition-colors duration-300 group-hover:bg-gray-100 ${accentColor}`}>
                {icon}
            </div>
        </CardHeader>
        <CardContent className="relative">
            <div className="text-3xl font-semibold tracking-tight text-gray-900">
                {isLoading ? (
                    <TailSpin visible={true} height="32" width="32" color="#D03B45" radius="1" />
                ) : error ? (
                    <span className="text-sm font-normal text-red-500">Error</span>
                ) : (
                    <span className="tabular-nums">{value ?? 0}</span>
                )}
            </div>
            <p className="mt-1 text-xs text-gray-400">{description}</p>
        </CardContent>
    </Card>
);

// Mobile Compact Stat Chip
interface StatChipProps {
    label: string;
    value: number | undefined;
    icon: React.ReactNode;
    isLoading: boolean;
    error?: unknown;
    bgColor: string;
    textColor: string;
}

const StatChip: React.FC<StatChipProps> = ({
    label,
    value,
    icon,
    isLoading,
    error,
    bgColor,
    textColor,
}) => (
    <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${bgColor}`}>
        <span className={textColor}>{icon}</span>
        <span className="text-xs font-medium text-gray-600 whitespace-nowrap">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${textColor}`}>
            {isLoading ? (
                <TailSpin visible={true} height="14" width="14" color="#D03B45" radius="1" />
            ) : error ? (
                '—'
            ) : (
                value ?? 0
            )}
        </span>
    </div>
);

export const AssetsSummaryCards: React.FC = () => {
    const {
        data: categoriesCount,
        isLoading: categoriesLoading,
        error: categoriesError
    } = useFrappeGetDocCount(
        ASSET_CATEGORY_DOCTYPE,
        undefined,
        false,
        false,
        `${ASSET_CATEGORY_DOCTYPE}_summary`
    );

    const {
        data: totalAssetsCount,
        isLoading: assetsLoading,
        error: assetsError
    } = useFrappeGetDocCount(
        ASSET_MASTER_DOCTYPE,
        undefined,
        false,
        false,
        `${ASSET_MASTER_DOCTYPE}_total_summary`
    );

    const {
        data: assignedAssetsCount,
        isLoading: assignedLoading,
        error: assignedError
    } = useFrappeGetDocCount(
        ASSET_MASTER_DOCTYPE,
        [["current_assignee", "!=", ""]],
        false,
        false,
        `${ASSET_MASTER_DOCTYPE}_assigned_summary`
    );

    return (
        <>
            {/* Mobile: Compact horizontal stat chips */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:hidden scrollbar-hide">
                <StatChip
                    label="Categories"
                    value={categoriesCount}
                    icon={<Boxes className="h-3.5 w-3.5" />}
                    isLoading={categoriesLoading}
                    error={categoriesError}
                    bgColor="bg-blue-50"
                    textColor="text-blue-600"
                />
                <StatChip
                    label="Total"
                    value={totalAssetsCount}
                    icon={<Package className="h-3.5 w-3.5" />}
                    isLoading={assetsLoading}
                    error={assetsError}
                    bgColor="bg-emerald-50"
                    textColor="text-emerald-600"
                />
                <StatChip
                    label="Assigned"
                    value={assignedAssetsCount}
                    icon={<UserCheck className="h-3.5 w-3.5" />}
                    isLoading={assignedLoading}
                    error={assignedError}
                    bgColor="bg-amber-50"
                    textColor="text-amber-600"
                />
            </div>

            {/* Tablet/Desktop: Full cards */}
            <div className="hidden sm:grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryCard
                    title="Asset Categories"
                    value={categoriesCount}
                    description="Defined asset types"
                    icon={<Boxes className="h-4 w-4" />}
                    isLoading={categoriesLoading}
                    error={categoriesError}
                    accentColor="text-blue-600"
                />
                <SummaryCard
                    title="Total Assets"
                    value={totalAssetsCount}
                    description="Assets in inventory"
                    icon={<Package className="h-4 w-4" />}
                    isLoading={assetsLoading}
                    error={assetsError}
                    accentColor="text-emerald-600"
                />
                <SummaryCard
                    title="Assigned Assets"
                    value={assignedAssetsCount}
                    description="Currently allocated"
                    icon={<UserCheck className="h-4 w-4" />}
                    isLoading={assignedLoading}
                    error={assignedError}
                    accentColor="text-amber-600"
                />
            </div>
        </>
    );
};
