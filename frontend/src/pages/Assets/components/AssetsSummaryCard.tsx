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
    AssetCategoryType,
} from '../assets.constants';
import { useAssetCategoryNamesByType } from '../hooks/useAssetCategoryNamesByType';
import { useAssetMasterNamesByType } from '../hooks/useAssetMasterNamesByType';

type AssetSummaryMode = 'project' | 'it' | 'categories';

interface AssetsSummaryCardsProps {
    activeTab: AssetSummaryMode;
}

interface SummaryViewModel {
    total: number;
    assigned: number;
    unassigned: number;
    pendingDecl: number;
    categories: number;
    isLoading: boolean;
    hasError: boolean;
    title: string;
    totalLabel: string;
    categoriesLabel: string;
    categoriesHint: string;
}

export const AssetsSummaryCards: React.FC<AssetsSummaryCardsProps> = ({ activeTab }) => {
    const isCategoriesMode = activeTab === 'categories';
    const typeForScope: AssetCategoryType | undefined = isCategoriesMode
        ? undefined
        : activeTab === 'project'
            ? 'Project'
            : 'IT';

    const globalView = useGlobalSummary(isCategoriesMode);
    const scopedView = useScopedSummary(typeForScope);

    const view = isCategoriesMode ? globalView : scopedView;

    if (view.isLoading) {
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

    const { total, assigned, unassigned, pendingDecl, categories, hasError, title, totalLabel, categoriesLabel, categoriesHint } = view;

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
                                        {totalLabel}
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
                                    {categoriesHint}
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
                            {title}
                        </CardTitle>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                            <Boxes className="h-3.5 w-3.5" />
                            <span className="uppercase tracking-wider">
                                {categories} {categoriesHint}
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
                                    {totalLabel}
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
                                    {categoriesLabel}
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

// ---------------------------------------------------------------------------
// Data hooks per mode
// ---------------------------------------------------------------------------

/**
 * Global counts — drives the Categories tab. Only fetches when `enabled` is true
 * so the Project/IT tabs don't issue these queries unnecessarily.
 */
function useGlobalSummary(enabled: boolean): SummaryViewModel {
    const {
        data: categoriesCount,
        isLoading: categoriesLoading,
        error: categoriesError,
    } = useFrappeGetDocCount(
        ASSET_CATEGORY_DOCTYPE,
        undefined,
        false,
        enabled ? ASSET_CACHE_KEYS.CATEGORIES_COUNT : null,
    );

    const {
        data: totalAssetsCount,
        isLoading: assetsLoading,
        error: assetsError,
    } = useFrappeGetDocCount(
        ASSET_MASTER_DOCTYPE,
        undefined,
        false,
        enabled ? ASSET_CACHE_KEYS.TOTAL_ASSETS_COUNT : null,
    );

    const {
        data: assignedAssetsCount,
        isLoading: assignedLoading,
    } = useFrappeGetDocCount(
        ASSET_MASTER_DOCTYPE,
        [["current_assignee", "!=", ""]],
        false,
        enabled ? ASSET_CACHE_KEYS.ASSIGNED_ASSETS_COUNT : null,
    );

    const {
        data: unassignedAssetsCount,
        isLoading: unassignedLoading,
    } = useFrappeGetDocCount(
        ASSET_MASTER_DOCTYPE,
        // `is not set` matches both NULL and ''. `in ["", null]` would be
        // dropped by frappe.client.get_count and return 0.
        [["current_assignee", "is", "not set"]],
        false,
        enabled ? ASSET_CACHE_KEYS.UNASSIGNED_ASSETS_COUNT : null,
    );

    const {
        data: pendingDeclarationCount,
        isLoading: pendingLoading,
    } = useFrappeGetDocCount(
        ASSET_MANAGEMENT_DOCTYPE,
        [["asset_declaration_attachment", "is", "not set"]],
        false,
        enabled ? ASSET_CACHE_KEYS.PENDING_DECLARATION_COUNT : null,
    );

    return {
        total: totalAssetsCount ?? 0,
        assigned: assignedAssetsCount ?? 0,
        unassigned: unassignedAssetsCount ?? 0,
        pendingDecl: pendingDeclarationCount ?? 0,
        categories: categoriesCount ?? 0,
        isLoading: enabled && (categoriesLoading || assetsLoading || assignedLoading || unassignedLoading || pendingLoading),
        hasError: !!(categoriesError || assetsError),
        title: 'Assets Summary',
        totalLabel: 'Total Assets',
        categoriesLabel: 'Asset Categories',
        categoriesHint: categoriesCount === 1 ? 'Category' : 'Categories',
    };
}

/**
 * Per-type counts — drives the Project / IT tabs. Each count filters on
 * `asset_category in <names for type>`; pending-declaration additionally filters
 * by `asset in <master names for type>` since Asset Management has no direct
 * type field. Gated on a non-empty category list to dodge the empty-`in` gotcha.
 */
function useScopedSummary(type: AssetCategoryType | undefined): SummaryViewModel {
    const isProject = type === 'Project';
    const isIT = type === 'IT';
    const enabled = isProject || isIT;

    const { categoryNames, isLoading: categoryNamesLoading } = useAssetCategoryNamesByType(type);
    const { masterNames, isLoading: masterNamesLoading } = useAssetMasterNamesByType(type);

    const hasCategories = categoryNames.length > 0;
    const hasMasters = masterNames.length > 0;

    const cacheKey = (project: string, it: string) =>
        !enabled ? null : isProject ? project : it;

    const totalFilters = enabled && hasCategories ? [["asset_category", "in", categoryNames]] : undefined;
    const assignedFilters = enabled && hasCategories
        ? [["asset_category", "in", categoryNames], ["current_assignee", "!=", ""]]
        : undefined;
    // Use the Frappe `is not set` operator (matches both NULL and '') —
    // sending `in ["", null]` through frappe.client.get_count silently drops
    // the null value, yielding 0 when there are only NULL-valued rows.
    const unassignedFilters = enabled && hasCategories
        ? [["asset_category", "in", categoryNames], ["current_assignee", "is", "not set"]]
        : undefined;
    const pendingFilters = enabled && hasMasters
        ? [["asset_declaration_attachment", "is", "not set"], ["asset", "in", masterNames]]
        : undefined;

    const totalKey = enabled && hasCategories
        ? cacheKey(ASSET_CACHE_KEYS.PROJECT_TOTAL_ASSETS_COUNT, ASSET_CACHE_KEYS.IT_TOTAL_ASSETS_COUNT)
        : null;
    const assignedKey = enabled && hasCategories
        ? cacheKey(ASSET_CACHE_KEYS.PROJECT_ASSIGNED_ASSETS_COUNT, ASSET_CACHE_KEYS.IT_ASSIGNED_ASSETS_COUNT)
        : null;
    const unassignedKey = enabled && hasCategories
        ? cacheKey(ASSET_CACHE_KEYS.PROJECT_UNASSIGNED_ASSETS_COUNT, ASSET_CACHE_KEYS.IT_UNASSIGNED_ASSETS_COUNT)
        : null;
    const pendingKey = enabled && hasMasters
        ? cacheKey(ASSET_CACHE_KEYS.PROJECT_PENDING_DECLARATION_COUNT, ASSET_CACHE_KEYS.IT_PENDING_DECLARATION_COUNT)
        : null;

    const {
        data: totalCount,
        isLoading: totalLoading,
        error: totalError,
    } = useFrappeGetDocCount(ASSET_MASTER_DOCTYPE, totalFilters as any, false, totalKey);

    const {
        data: assignedCount,
        isLoading: assignedLoading,
    } = useFrappeGetDocCount(ASSET_MASTER_DOCTYPE, assignedFilters as any, false, assignedKey);

    const {
        data: unassignedCount,
        isLoading: unassignedLoading,
    } = useFrappeGetDocCount(ASSET_MASTER_DOCTYPE, unassignedFilters as any, false, unassignedKey);

    const {
        data: pendingCount,
        isLoading: pendingLoading,
    } = useFrappeGetDocCount(ASSET_MANAGEMENT_DOCTYPE, pendingFilters as any, false, pendingKey);

    const typeLabel = isProject ? 'Project' : 'IT';

    // If gates are closed (no categories / no masters), the counts are exactly 0
    // and the corresponding fetch was disabled. Short-circuit cleanly.
    const total = hasCategories ? (totalCount ?? 0) : 0;
    const assigned = hasCategories ? (assignedCount ?? 0) : 0;
    const unassigned = hasCategories ? (unassignedCount ?? 0) : 0;
    const pendingDecl = hasMasters ? (pendingCount ?? 0) : 0;
    const categories = categoryNames.length;

    return {
        total,
        assigned,
        unassigned,
        pendingDecl,
        categories,
        isLoading: enabled && (
            categoryNamesLoading
            || masterNamesLoading
            || (hasCategories && (totalLoading || assignedLoading || unassignedLoading))
            || (hasMasters && pendingLoading)
        ),
        hasError: !!totalError,
        title: `${typeLabel} Assets Summary`,
        totalLabel: `Total ${typeLabel} Assets`,
        categoriesLabel: `${typeLabel} Asset Categories`,
        categoriesHint: categories === 1 ? `${typeLabel} Category` : `${typeLabel} Categories`,
    };
}
