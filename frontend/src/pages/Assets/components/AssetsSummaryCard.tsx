import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Package, Boxes, UserCheck, UserX, AlertTriangle, PackageX } from "lucide-react";
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
import { CategoryUnassigned, useCategoryAssetCounts } from '../hooks/useCategoryAssetCounts';
import { AssetListView, openAssetList } from '../utils/assetListLinks';

type AssetSummaryMode = 'project' | 'it' | 'categories';

const ASSET_TYPES: readonly AssetCategoryType[] = ['Project', 'IT'];
const TYPE_TAB_LABEL: Record<AssetCategoryType, string> = { Project: 'Project Assets', IT: 'IT Assets' };

interface AssetsSummaryCardsProps {
    activeTab: AssetSummaryMode;
}

interface SummaryViewModel {
    total: number;
    assigned: number;
    unassigned: number;
    /** Marked Lost/Damaged (owner, 2026-10-31): not counted in Unassigned. */
    lostDamaged: number;
    pendingDecl: number;
    categories: number;
    isLoading: boolean;
    hasError: boolean;
    title: string;
    totalLabel: string;
    /** "Total Unassigned Project Assets" -- the right-hand box's title. */
    unassignedLabel: string;
    categoriesHint: string;
    /** Every category with unassigned assets in this tab's scope, most first. */
    unassignedByCategory: CategoryUnassigned[];
}

/** Hover text of a count that opens a list; `type` is unset on the Categories tab, which asks which. */
function listTitle(view: AssetListView, type?: AssetCategoryType): string {
    const what = type ? `${type} assets` : 'assets';
    const shown = {
        all: `Show all ${what}`,
        assigned: `Show assigned ${what}`,
        unassigned: `Show unassigned ${what}`,
        lost: `Show Lost/Damaged ${what}`,
        pending: `Show ${what} waiting for a declaration`,
    }[view];
    return type ? shown : `${shown} (choose Project or IT)`;
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1';

interface CountLinkProps {
    view: AssetListView;
    /** Project / IT tab: open that tab's list. */
    type?: AssetCategoryType;
    /** Categories tab: each type's count, for the "Open in" menu (a type with none is disabled). */
    byType: Record<AssetCategoryType, number>;
    className: string;
    children: React.ReactNode;
}

/**
 * A count on the card that opens its list. On the Project / IT tabs it opens that tab's list; the
 * Categories tab covers both kinds, so it asks which one first.
 */
const CountLink: React.FC<CountLinkProps> = ({ view, type, byType, className, children }) => {
    const buttonClass = `${className} ${FOCUS_RING} cursor-pointer transition-colors`;
    if (type) {
        return (
            <button type="button" title={listTitle(view, type)} onClick={() => openAssetList({ type, view })} className={buttonClass}>
                {children}
            </button>
        );
    }
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button type="button" title={listTitle(view)} className={buttonClass}>
                    {children}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[11rem]">
                <DropdownMenuLabel className="text-xs font-medium text-slate-500">Open in</DropdownMenuLabel>
                {ASSET_TYPES.map((t) => (
                    <DropdownMenuItem
                        key={t}
                        disabled={byType[t] === 0}
                        onSelect={() => openAssetList({ type: t, view })}
                        className="text-sm"
                    >
                        {TYPE_TAB_LABEL[t]}
                        <span className="ml-auto pl-4 font-semibold tabular-nums">{byType[t]}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

/** A category with unassigned assets; opens its type's Unassigned list filtered to it. */
const CategoryChip: React.FC<{ type: AssetCategoryType; chip: CategoryUnassigned }> = ({ type, chip: { category, count } }) => (
    <button
        type="button"
        title={`Show the ${count} unassigned ${category} assets`}
        onClick={() => openAssetList({ type, view: 'unassigned', category })}
        className={`inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300 hover:border-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors ${FOCUS_RING}`}
    >
        <span className="truncate">{category}</span>
        <span className="shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{count}</span>
    </button>
);

export const AssetsSummaryCards: React.FC<AssetsSummaryCardsProps> = ({ activeTab }) => {
    const isCategoriesMode = activeTab === 'categories';
    const scopeType: AssetCategoryType | undefined = isCategoriesMode ? undefined : activeTab === 'project' ? 'Project' : 'IT';

    const globalView = useGlobalSummary(isCategoriesMode);
    // The Categories tab needs both kinds too: its chips are grouped by kind, and its counts open
    // a menu with each kind's number -- the same numbers that kind's own tab shows.
    const projectView = useScopedSummary(isCategoriesMode || scopeType === 'Project' ? 'Project' : undefined);
    const itView = useScopedSummary(isCategoriesMode || scopeType === 'IT' ? 'IT' : undefined);
    const typeViews: Record<AssetCategoryType, SummaryViewModel> = { Project: projectView, IT: itView };

    const view = scopeType ? typeViews[scopeType] : globalView;
    const isLoading = isCategoriesMode
        ? globalView.isLoading || projectView.isLoading || itView.isLoading
        : view.isLoading;

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

    const { total, assigned, unassigned, lostDamaged, pendingDecl, categories, title, totalLabel, unassignedLabel, categoriesHint, unassignedByCategory } = view;
    const hasError = view.hasError || (isCategoriesMode && (projectView.hasError || itView.hasError));

    const byType = (pick: (v: SummaryViewModel) => number): Record<AssetCategoryType, number> => ({
        Project: pick(projectView),
        IT: pick(itView),
    });
    const totalByType = byType((v) => v.total);
    const assignedByType = byType((v) => v.assigned);
    const unassignedByType = byType((v) => v.unassigned);
    const lostDamagedByType = byType((v) => v.lostDamaged);
    const pendingByType = byType((v) => v.pendingDecl);

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
                                <CountLink view="all" type={scopeType} byType={totalByType} className="flex items-baseline gap-2 rounded">
                                    <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                        {total}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        {totalLabel}
                                    </span>
                                </CountLink>
                                {/* Breakdown pills */}
                                <div className="flex flex-wrap gap-1 mt-1">
                                    <CountLink view="assigned" type={scopeType} byType={assignedByType} className="px-1.5 py-0.5 text-[9px] font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded inline-flex items-center gap-0.5 active:bg-emerald-200">
                                        <UserCheck className="h-2.5 w-2.5" />
                                        {assigned}
                                    </CountLink>
                                    <CountLink view="unassigned" type={scopeType} byType={unassignedByType} className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded inline-flex items-center gap-0.5 active:bg-slate-200">
                                        <UserX className="h-2.5 w-2.5" />
                                        {unassigned}
                                    </CountLink>
                                    {lostDamaged > 0 && (
                                        <CountLink view="lost" type={scopeType} byType={lostDamagedByType} className="px-1.5 py-0.5 text-[9px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded inline-flex items-center gap-0.5 active:bg-red-200">
                                            <PackageX className="h-2.5 w-2.5" />
                                            {lostDamaged}
                                        </CountLink>
                                    )}
                                    {pendingDecl > 0 && (
                                        <CountLink view="pending" type={scopeType} byType={pendingByType} className="px-1.5 py-0.5 text-[9px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded inline-flex items-center gap-0.5 active:bg-amber-200">
                                            <AlertTriangle className="h-2.5 w-2.5" />
                                            {pendingDecl}
                                        </CountLink>
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
                            <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/40 dark:to-teal-950/30 rounded-lg p-3 border border-emerald-100 dark:border-emerald-900/50">
                                {/* Same shape as the unassigned box beside it: label left, count top-right */}
                                <CountLink view="all" type={scopeType} byType={totalByType} className="w-[calc(100%+0.5rem)] -mx-1 px-1 flex items-center justify-between gap-2 rounded hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40">
                                    <span className="text-xs font-medium text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wide flex items-center gap-1.5">
                                        <Package className="h-3 w-3" />
                                        {totalLabel}
                                    </span>
                                    <span className="text-lg font-bold leading-none text-emerald-700 dark:text-emerald-400 tabular-nums">
                                        {total}
                                    </span>
                                </CountLink>
                                {/* Breakdown badges */}
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    <CountLink view="assigned" type={scopeType} byType={assignedByType} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-full hover:bg-emerald-200 dark:hover:bg-emerald-800/60">
                                        <UserCheck className="h-3 w-3" />
                                        {assigned} Assigned
                                    </CountLink>
                                    <CountLink view="unassigned" type={scopeType} byType={unassignedByType} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600">
                                        <UserX className="h-3 w-3" />
                                        {unassigned} Unassigned
                                    </CountLink>
                                    {lostDamaged > 0 && (
                                        <CountLink view="lost" type={scopeType} byType={lostDamagedByType} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 rounded-full hover:bg-red-200 dark:hover:bg-red-800/60">
                                            <PackageX className="h-3 w-3" />
                                            {lostDamaged} Lost/Damaged
                                        </CountLink>
                                    )}
                                    {pendingDecl > 0 && (
                                        <CountLink view="pending" type={scopeType} byType={pendingByType} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-full hover:bg-amber-200 dark:hover:bg-amber-800/60">
                                            <AlertTriangle className="h-3 w-3" />
                                            {pendingDecl} Pending Decl
                                        </CountLink>
                                    )}
                                </div>
                            </div>
                            {/* Unassigned: the total top-right, then EVERY category with unassigned assets as wrapping chips */}
                            <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                                <CountLink view="unassigned" type={scopeType} byType={unassignedByType} className="w-[calc(100%+0.5rem)] -mx-1 px-1 flex items-center justify-between gap-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700/60">
                                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                                        <UserX className="h-3 w-3" />
                                        {unassignedLabel}
                                    </span>
                                    <span className="text-lg font-bold leading-none text-slate-700 dark:text-slate-300 tabular-nums">
                                        {unassigned}
                                    </span>
                                </CountLink>
                                {unassignedByCategory.length === 0 ? (
                                    <div className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Every asset is assigned.</div>
                                ) : scopeType ? (
                                    <div className="mt-2 flex flex-wrap items-center gap-1">
                                        {unassignedByCategory.map((chip) => (
                                            <CategoryChip key={chip.category} type={scopeType} chip={chip} />
                                        ))}
                                    </div>
                                ) : (
                                    // Categories tab: one row per kind; its label opens that kind's Unassigned list.
                                    <div className="mt-2 space-y-1">
                                        {ASSET_TYPES.filter((t) => typeViews[t].unassignedByCategory.length > 0).map((t) => (
                                            <div key={t} className="flex flex-wrap items-center gap-1">
                                                <button
                                                    type="button"
                                                    title={listTitle('unassigned', t)}
                                                    onClick={() => openAssetList({ type: t, view: 'unassigned' })}
                                                    className={`mr-0.5 rounded px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 cursor-pointer transition-colors ${FOCUS_RING}`}
                                                >
                                                    {t} · {typeViews[t].unassigned}
                                                </button>
                                                {typeViews[t].unassignedByCategory.map((chip) => (
                                                    <CategoryChip key={chip.category} type={t} chip={chip} />
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                )}
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
            { key: "unassigned", doctype: ASSET_MASTER_DOCTYPE, filters: [["current_assignee", "is", "not set"], ["lost_damaged", "=", 0]] },
            { key: "lostDamaged", doctype: ASSET_MASTER_DOCTYPE, filters: [["lost_damaged", "=", 1]] },
            { key: "pendingDecl", doctype: ASSET_MANAGEMENT_DOCTYPE, filters: [["asset_declaration_attachment", "is", "not set"]] },
        ]
        : [];

    // Content-hash swrKey (default): the key varies with the spec set, so toggling
    // `enabled` (tab switch) refetches instead of serving a stale cache.
    const { data, isLoading, error } = useCounts(specs);
    const msg = data?.message;
    const categoryCounts = useCategoryAssetCounts(enabled);

    const categoriesCount = msg?.categories as number | undefined;

    return {
        total: (msg?.total as number) ?? 0,
        assigned: (msg?.assigned as number) ?? 0,
        unassigned: (msg?.unassigned as number) ?? 0,
        lostDamaged: (msg?.lostDamaged as number) ?? 0,
        pendingDecl: (msg?.pendingDecl as number) ?? 0,
        categories: categoriesCount ?? 0,
        isLoading: enabled && (isLoading || categoryCounts.isLoading),
        hasError: !!error,
        title: 'Assets Summary',
        totalLabel: 'Total Assets',
        unassignedLabel: 'Total Unassigned Assets',
        categoriesHint: categoriesCount === 1 ? 'Category' : 'Categories',
        unassignedByCategory: categoryCounts.unassignedByCategory(),
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
            { key: "unassigned", doctype: ASSET_MASTER_DOCTYPE, filters: [["asset_category", "in", categoryNames], ["current_assignee", "is", "not set"], ["lost_damaged", "=", 0]] },
            { key: "lostDamaged", doctype: ASSET_MASTER_DOCTYPE, filters: [["asset_category", "in", categoryNames], ["lost_damaged", "=", 1]] },
        );
    }
    if (enabled && hasMasters) {
        specs.push(
            { key: "pendingDecl", doctype: ASSET_MANAGEMENT_DOCTYPE, filters: [["asset_declaration_attachment", "is", "not set"], ["asset", "in", masterNames]] },
        );
    }

    const { data, isLoading: countsLoading, error: countsError } = useCounts(specs);
    const msg = data?.message;
    const categoryCounts = useCategoryAssetCounts(enabled);

    const typeLabel = isProject ? 'Project' : 'IT';

    // If gates are closed (no categories / no masters), the counts are exactly 0
    // and the corresponding spec was never issued. Short-circuit cleanly.
    const total = hasCategories ? ((msg?.total as number) ?? 0) : 0;
    const assigned = hasCategories ? ((msg?.assigned as number) ?? 0) : 0;
    const unassigned = hasCategories ? ((msg?.unassigned as number) ?? 0) : 0;
    const lostDamaged = hasCategories ? ((msg?.lostDamaged as number) ?? 0) : 0;
    const pendingDecl = hasMasters ? ((msg?.pendingDecl as number) ?? 0) : 0;
    const categories = categoryNames.length;

    return {
        total,
        assigned,
        unassigned,
        lostDamaged,
        pendingDecl,
        categories,
        isLoading: enabled && (
            categoryNamesLoading
            || masterNamesLoading
            || categoryCounts.isLoading
            || ((hasCategories || hasMasters) && countsLoading)
        ),
        hasError: !!countsError,
        title: `${typeLabel} Assets Summary`,
        totalLabel: `Total ${typeLabel} Assets`,
        unassignedLabel: `Total Unassigned ${typeLabel} Assets`,
        categoriesHint: categories === 1 ? `${typeLabel} Category` : `${typeLabel} Categories`,
        unassignedByCategory: categoryCounts.unassignedByCategory(categoryNames),
    };
}
