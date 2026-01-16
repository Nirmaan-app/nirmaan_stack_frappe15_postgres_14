import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Boxes, UserCheck, UserX, AlertTriangle } from "lucide-react";
import { useFrappeGetDocCount } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import {
    ASSET_CATEGORY_DOCTYPE,
    ASSET_MASTER_DOCTYPE,
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_CACHE_KEYS,
} from '../assets.constants';

export const AssetsSummaryCards: React.FC = () => {
    // Fetch categories count
    const {
        data: categoriesCount,
        isLoading: categoriesLoading,
        error: categoriesError
    } = useFrappeGetDocCount(
        ASSET_CATEGORY_DOCTYPE,
        undefined,
        false,
        false,
        ASSET_CACHE_KEYS.CATEGORIES_COUNT
    );

    // Fetch total assets count
    const {
        data: totalAssetsCount,
        isLoading: assetsLoading,
        error: assetsError
    } = useFrappeGetDocCount(
        ASSET_MASTER_DOCTYPE,
        undefined,
        false,
        false,
        ASSET_CACHE_KEYS.TOTAL_ASSETS_COUNT
    );

    // Fetch assigned assets count
    const {
        data: assignedAssetsCount,
        isLoading: assignedLoading,
    } = useFrappeGetDocCount(
        ASSET_MASTER_DOCTYPE,
        [["current_assignee", "!=", ""]],
        false,
        false,
        ASSET_CACHE_KEYS.ASSIGNED_ASSETS_COUNT
    );

    // Fetch unassigned assets count
    const {
        data: unassignedAssetsCount,
        isLoading: unassignedLoading,
    } = useFrappeGetDocCount(
        ASSET_MASTER_DOCTYPE,
        [["current_assignee", "in", ["", null]]],
        false,
        false,
        ASSET_CACHE_KEYS.UNASSIGNED_ASSETS_COUNT
    );

    // Fetch pending declaration count (assigned but no declaration)
    const {
        data: pendingDeclarationCount,
        isLoading: pendingLoading,
    } = useFrappeGetDocCount(
        ASSET_MANAGEMENT_DOCTYPE,
        [["asset_declaration_attachment", "in", ["", null]]],
        false,
        false,
        ASSET_CACHE_KEYS.PENDING_DECLARATION_COUNT
    );

    const isLoading = categoriesLoading || assetsLoading || assignedLoading || unassignedLoading || pendingLoading;
    const hasError = categoriesError || assetsError;

    // Loading state
    if (isLoading) {
        return (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                <CardContent className="p-4 sm:p-6">
                    <div className="flex justify-center items-center h-10 sm:h-16">
                        <TailSpin height={24} width={24} color="#10b981" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    const total = totalAssetsCount ?? 0;
    const assigned = assignedAssetsCount ?? 0;
    const unassigned = unassignedAssetsCount ?? 0;
    const pendingDecl = pendingDeclarationCount ?? 0;
    const categories = categoriesCount ?? 0;

    return (
        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
            {/* ===== COMPACT MOBILE VIEW ===== */}
            <div className="sm:hidden">
                <CardContent className="p-3">
                    {hasError ? (
                        <div className="text-xs text-center text-red-500 py-2">
                            Failed to load summary
                        </div>
                    ) : (
                        <div className="flex items-center gap-3">
                            {/* Color accent + Icon */}
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                                <Package className="h-5 w-5 text-white" />
                            </div>
                            {/* Primary metric */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                        {total}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        Total Assets
                                    </span>
                                </div>
                                {/* Breakdown pills */}
                                <div className="flex flex-wrap gap-1 mt-1">
                                    <span className="px-1.5 py-0.5 text-[9px] font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded inline-flex items-center gap-0.5">
                                        <UserCheck className="h-2.5 w-2.5" />
                                        {assigned}
                                    </span>
                                    <span className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded inline-flex items-center gap-0.5">
                                        <UserX className="h-2.5 w-2.5" />
                                        {unassigned}
                                    </span>
                                    {pendingDecl > 0 && (
                                        <span className="px-1.5 py-0.5 text-[9px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded inline-flex items-center gap-0.5">
                                            <AlertTriangle className="h-2.5 w-2.5" />
                                            {pendingDecl}
                                        </span>
                                    )}
                                </div>
                            </div>
                            {/* Categories badge */}
                            <div className="flex-shrink-0 text-right">
                                <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md tabular-nums">
                                    {categories}
                                </span>
                                <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                    categories
                                </span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </div>

            {/* ===== EXPANDED DESKTOP VIEW ===== */}
            <div className="hidden sm:block">
                <CardHeader className="pb-2 pt-4 px-5">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                            Assets Summary
                        </CardTitle>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                            <Boxes className="h-3.5 w-3.5" />
                            <span className="uppercase tracking-wider">
                                {categories} {categories === 1 ? 'Category' : 'Categories'}
                            </span>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                    {hasError ? (
                        <div className="text-sm text-center text-red-500 py-6">
                            Failed to load summary data.
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            {/* Primary Metric - Total Assets with breakdown */}
                            <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/40 dark:to-teal-950/30 rounded-lg p-4 border border-emerald-100 dark:border-emerald-900/50">
                                <dt className="text-xs font-medium text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <Package className="h-3 w-3" />
                                    Total Assets
                                </dt>
                                <dd className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                    {total}
                                </dd>
                                {/* Breakdown badges */}
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-full">
                                        <UserCheck className="h-3 w-3" />
                                        {assigned} Assigned
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                                        <UserX className="h-3 w-3" />
                                        {unassigned} Unassigned
                                    </span>
                                    {pendingDecl > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-full">
                                            <AlertTriangle className="h-3 w-3" />
                                            {pendingDecl} Pending Decl
                                        </span>
                                    )}
                                </div>
                            </div>
                            {/* Secondary Metric - Categories */}
                            <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <Boxes className="h-3 w-3" />
                                    Asset Categories
                                </dt>
                                <dd className="text-2xl font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                    {categories}
                                </dd>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 block">
                                    Asset types defined
                                </span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </div>
        </Card>
    );
};
