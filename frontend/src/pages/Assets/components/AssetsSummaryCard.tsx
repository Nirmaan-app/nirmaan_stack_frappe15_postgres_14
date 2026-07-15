import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Boxes, UserCheck, UserX, AlertTriangle } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { useCounts, CountSpec } from "@/hooks/useCounts";
import {
    ASSET_CATEGORY_DOCTYPE,
    ASSET_MASTER_DOCTYPE,
    ASSET_MANAGEMENT_DOCTYPE,
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
    // ONE batch round-trip for every axis that's active on this tab. Each spec's
    // exact filters (incl. the `is not set` operator) are preserved verbatim so the
    // backend `frappe.db.count` reproduces the old per-count results byte-for-byte.
    // `is not set` matches both NULL and ''; `in ["", null]` would be dropped by the
    // count layer and return 0.
    const specs: CountSpec[] = enabled
        ? [
            { key: "categories", doctype: ASSET_CATEGORY_DOCTYPE },
            { key: "total", doctype: ASSET_MASTER_DOCTYPE },
            { key: "assigned", doctype: ASSET_MASTER_DOCTYPE, filters: [["current_assignee", "!=", ""]] },
            { key: "unassigned", doctype: ASSET_MASTER_DOCTYPE, filters: [["current_assignee", "is", "not set"]] },
            { key: "pendingDecl", doctype: ASSET_MANAGEMENT_DOCTYPE, filters: [["asset_declaration_attachment", "is", "not set"]] },
        ]
        : [];

    // Content-hash swrKey (default): the key varies with the spec set, so toggling
    // `enabled` (tab switch) refetches instead of serving a stale cache.
    const { data, isLoading, error } = useCounts(specs);
    const msg = data?.message;

    const categoriesCount = msg?.categories as number | undefined;

    return {
        total: (msg?.total as number) ?? 0,
        assigned: (msg?.assigned as number) ?? 0,
        unassigned: (msg?.unassigned as number) ?? 0,
        pendingDecl: (msg?.pendingDecl as number) ?? 0,
        categories: categoriesCount ?? 0,
        isLoading: enabled && isLoading,
        hasError: !!error,
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

    // ONE batch round-trip for the scoped axes. Each count's exact filters are
    // preserved verbatim — the `asset_category in [...]` / `asset in [...]` scoping
    // plus the `is not set` operator (matches both NULL and ''; `in ["", null]` would
    // be silently dropped by the count layer, yielding 0 for NULL-only rows).
    //
    // The specs stay empty until the async-derived name lists arrive (hasCategories /
    // hasMasters), so the content-hash swrKey only issues the scoped fetch once its
    // `in [...]` inputs exist — never counting a different row set than before.
    const specs: CountSpec[] = [];
    if (enabled && hasCategories) {
        specs.push(
            { key: "total", doctype: ASSET_MASTER_DOCTYPE, filters: [["asset_category", "in", categoryNames]] },
            { key: "assigned", doctype: ASSET_MASTER_DOCTYPE, filters: [["asset_category", "in", categoryNames], ["current_assignee", "!=", ""]] },
            { key: "unassigned", doctype: ASSET_MASTER_DOCTYPE, filters: [["asset_category", "in", categoryNames], ["current_assignee", "is", "not set"]] },
        );
    }
    if (enabled && hasMasters) {
        specs.push(
            { key: "pendingDecl", doctype: ASSET_MANAGEMENT_DOCTYPE, filters: [["asset_declaration_attachment", "is", "not set"], ["asset", "in", masterNames]] },
        );
    }

    const { data, isLoading: countsLoading, error: countsError } = useCounts(specs);
    const msg = data?.message;

    const typeLabel = isProject ? 'Project' : 'IT';

    // If gates are closed (no categories / no masters), the counts are exactly 0
    // and the corresponding spec was never issued. Short-circuit cleanly.
    const total = hasCategories ? ((msg?.total as number) ?? 0) : 0;
    const assigned = hasCategories ? ((msg?.assigned as number) ?? 0) : 0;
    const unassigned = hasCategories ? ((msg?.unassigned as number) ?? 0) : 0;
    const pendingDecl = hasMasters ? ((msg?.pendingDecl as number) ?? 0) : 0;
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
            || ((hasCategories || hasMasters) && countsLoading)
        ),
        hasError: !!countsError,
        title: `${typeLabel} Assets Summary`,
        totalLabel: `Total ${typeLabel} Assets`,
        categoriesLabel: `${typeLabel} Asset Categories`,
        categoriesHint: categories === 1 ? `${typeLabel} Category` : `${typeLabel} Categories`,
    };
}
