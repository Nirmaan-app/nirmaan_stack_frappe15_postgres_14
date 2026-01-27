// components/tabs/ProjectMaterialUsageTab.tsx (Full, Refactored File)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { VirtualizedMaterialTable } from './VirtualizedMaterialTable';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { useMaterialUsageData } from '../hooks/useMaterialUsageData';
import { toast } from '@/components/ui/use-toast';
import { exportToCsv } from '@/utils/exportToCsv';
import { Button } from '@/components/ui/button';
import { FileUp, SearchIcon } from 'lucide-react';
import { getUrlJsonParam, getUrlStringParam } from '@/hooks/useServerDataTable';
import { urlStateManager } from '@/utils/urlStateManager';
import { debounce } from 'lodash';
import { Input } from '@/components/ui/input';
import Fuse from 'fuse.js';

// =================================================================================
// 1. TYPE DEFINITIONS
// =================================================================================
// These types define the shape of our data and the options for filters and sorting.

export type POStatus = "Fully Paid" | "Partially Paid" | "Unpaid";
export type DeliveryStatus = "Fully Delivered" | "Partially Delivered" | "Pending Delivery" | "Not Ordered";
export type OverallItemPOStatus = POStatus | "N/A";

// Defines which columns can be sorted and hidden.
export type MaterialSortKey = 'deliveredQuantity' | 'orderedQuantity' | 'totalAmount';

// The main data structure for each row in the table.
// NOTE: Standardized property names like `categoryName` and `overallPOPaymentStatus`
// to match the row component and export logic.
export interface MaterialUsageDisplayItem {
  uniqueKey: string;
  itemName?: string;
  categoryName: string; 
  unit?: string;
  estimatedQuantity?: number;
  orderedQuantity: number;
  deliveredQuantity: number;
  totalAmount?: number;
  deliveryStatus: DeliveryStatus;
  overallPOPaymentStatus: OverallItemPOStatus;
  poNumbers?: { po: string, status: POStatus, amount: number, poCalculatedAmount?: string }[];
  billingCategory?: string;
  deliveryChallans?: { name: string; creation: string; attachment: string; attachment_ref?: string }[];
  dcCount?: number;
}

export interface ProjectMaterialUsageTabProps {
  projectId: string;
  projectPayments?: ProjectPayments[];
}

// =================================================================================
// 2. MAIN COMPONENT
// =================================================================================

export const ProjectMaterialUsageTab: React.FC<ProjectMaterialUsageTabProps> = ({
  projectId,
  projectPayments
}) => {
  
  // --- A. DATA FETCHING ---
  // A custom hook that fetches and prepares all material usage items.
  const { 
    allMaterialUsageItems, 
    isLoading, 
    error, 
    categoryOptions, 
    deliveryStatusOptions, 
    poStatusOptions 
  } = useMaterialUsageData(projectId, projectPayments);

  // --- B. STATE MANAGEMENT ---
  // Manages the state for all user interactions: search, filters, sorting, and hidden columns.
  
  // Search state
  const [searchTerm, setSearchTerm] = useState<string>(() => getUrlStringParam('mus_q', ""));
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>(searchTerm);

  // Filter states
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(() => new Set(getUrlJsonParam<string[]>('mus_cat', [])));
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<Set<DeliveryStatus>>(() => new Set(getUrlJsonParam<DeliveryStatus[]>('mus_ds', [])));
  const [poStatusFilter, setPoStatusFilter] = useState<Set<OverallItemPOStatus>>(() => new Set(getUrlJsonParam<OverallItemPOStatus[]>('mus_ps', [])));
  
  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ key: MaterialSortKey | null; direction: 'asc' | 'desc'; }>({ key: null, direction: 'asc' });
  
  // Column visibility state
  const [hiddenColumns, setHiddenColumns] = useState<Set<MaterialSortKey>>(new Set());

  // --- C. URL SYNCHRONIZATION ---
  // These effects keep the browser URL in sync with the component's state,
  // allowing filters to be bookmarked and shared.

  // Updates the URL when the search term changes.
  useEffect(() => { urlStateManager.updateParam('mus_q', searchTerm || null); }, [searchTerm]);
  
  // Updates the URL for all Set-based filters.
  const updateUrlParamJsonArray = useCallback((key: string, valueSet: Set<string>) => {
    const arrayValue = Array.from(valueSet);
    urlStateManager.updateParam(key, arrayValue.length > 0 ? JSON.stringify(arrayValue) : null);
  }, []);

  useEffect(() => { updateUrlParamJsonArray('mus_cat', categoryFilter); }, [categoryFilter, updateUrlParamJsonArray]);
  useEffect(() => { updateUrlParamJsonArray('mus_ds', deliveryStatusFilter); }, [deliveryStatusFilter, updateUrlParamJsonArray]);
  useEffect(() => { updateUrlParamJsonArray('mus_ps', poStatusFilter); }, [poStatusFilter, updateUrlParamJsonArray]);

  // --- D. EVENT HANDLERS & HELPERS ---
  
  // Debounces the search input to avoid re-filtering on every keystroke.
  const debouncedSetSearchForFilter = useCallback(debounce((term: string) => setDebouncedSearchTerm(term), 300), []);
  useEffect(() => { debouncedSetSearchForFilter(searchTerm); return () => debouncedSetSearchForFilter.cancel(); }, [searchTerm, debouncedSetSearchForFilter]);

  // Handlers for sorting and column visibility, passed down to the table component.
  const handleSetSort = useCallback((key: MaterialSortKey, direction: 'asc' | 'desc') => { setSortConfig({ key, direction }); }, []);
  const handleClearSort = useCallback(() => { setSortConfig({ key: null, direction: 'asc' }); }, []);
  const handleToggleColumnVisibility = useCallback((key: MaterialSortKey) => {
    setHiddenColumns(prev => {
      const newSet = new Set(prev);
      newSet.has(key) ? newSet.delete(key) : newSet.add(key);
      return newSet;
    });
  }, []);

  // --- E. DATA PROCESSING PIPELINE ---
  // This is the single source of truth for the data displayed in the table and exported to CSV.
  // It applies search, filtering, and sorting in a specific order.

  // Initializes Fuse.js for fuzzy searching on the item names.
  const fuseInstance = useMemo(() => {
    if (!allMaterialUsageItems) return null;
    return new Fuse(allMaterialUsageItems, { keys: ['itemName'], threshold: 0.3 });
  }, [allMaterialUsageItems]);
  
  // The main `useMemo` hook to process data. This is the single source of truth.
  const processedItems = useMemo(() => {
    let items = allMaterialUsageItems || [];

    // 1. SEARCH: Apply fuzzy search if a search term exists.
    if (debouncedSearchTerm && fuseInstance) {
      items = fuseInstance.search(debouncedSearchTerm).map(result => result.item);
    }

    // 2. FILTER: Apply all active faceted filters.
    items = items.filter(item => {
      const catMatch = categoryFilter.size === 0 || categoryFilter.has(item.categoryName);
      const delMatch = deliveryStatusFilter.size === 0 || deliveryStatusFilter.has(item.deliveryStatus);
      const poMatch = poStatusFilter.size === 0 || poStatusFilter.has(item.overallPOPaymentStatus);
      return catMatch && delMatch && poMatch;
    });

    // 3. SORT: Apply sorting if a sort key is active.
    const { key, direction } = sortConfig;
    if (key) {
      // Create a mutable copy to avoid sorting the original array
      items = [...items].sort((a, b) => {
        const valA = a[key] ?? 0; // Default null/undefined to 0 for consistent sorting
        const valB = b[key] ?? 0;
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return items;
  }, [
    allMaterialUsageItems, 
    debouncedSearchTerm, 
    fuseInstance, 
    categoryFilter, 
    deliveryStatusFilter, 
    poStatusFilter, 
    sortConfig
  ]);

  // --- F. CSV EXPORT HANDLER ---
  // Uses the final `processedItems` array to export what the user sees.
  const handleExportCsv = useCallback(() => {
    if (processedItems.length === 0) {
      toast({ title: "No Data", description: "No data to export based on current filters.", variant: "default" });
      return;
    }

    const exportColumns = [
      { header: 'Item Name', accessor: (item: MaterialUsageDisplayItem) => item.itemName || "N/A" },
      { header: 'Category', accessor: (item: MaterialUsageDisplayItem) => item.categoryName },
      { header: 'Unit', accessor: (item: MaterialUsageDisplayItem) => item.unit || "N/A" },
      { header: 'Est. Qty', accessor: (item: MaterialUsageDisplayItem) => item.estimatedQuantity?.toFixed(2) || "N/A" },
      { header: 'Ordered Qty', accessor: (item: MaterialUsageDisplayItem) => item.orderedQuantity.toFixed(2) },
      { header: 'Delivered Qty', accessor: (item: MaterialUsageDisplayItem) => item.deliveredQuantity.toFixed(2) },
      { header: 'Total Amount', accessor: (item: MaterialUsageDisplayItem) => item.totalAmount?.toFixed(2) || "0.00" },
      { header: 'Delivery Status', accessor: (item: MaterialUsageDisplayItem) => item.deliveryStatus },
      { header: 'PO Numbers', accessor: (item: MaterialUsageDisplayItem) => item.poNumbers?.map(p => p.po).join(', ') || "-" },
      { header: 'DC Count', accessor: (item: MaterialUsageDisplayItem) => (item.dcCount || 0).toString() },
      { header: 'Overall PO Status', accessor: (item: MaterialUsageDisplayItem) => item.overallPOPaymentStatus },
    ];

    const dataToExport = processedItems.map(item =>
        exportColumns.reduce((acc, col) => {
            acc[col.header] = col.accessor(item);
            return acc;
        }, {} as Record<string, any>)
    );

    exportToCsv(`project_${projectId}_material_usage.csv`, dataToExport, exportColumns.map(c => ({header: c.header, accessorKey: c.header})));
    toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success"});
  }, [processedItems, projectId]);


 // === MODIFIED: Skeleton loader is now used during the loading state ===
  if (isLoading) {
    return (
      <div className="flex-1 space-y-4">
        {/* Skeleton for the search/export header */}
        <div className="flex justify-between items-center">
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-9 w-24" />
        </div>
        {/* Skeleton for the table */}
        <div className="rounded-md border">
          <Skeleton className="h-12 w-full" /> {/* Table Header */}
          <div className="p-4 space-y-2">
            {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </div>
      </div>
    );
  }
  if (error) { return <AlertDestructive error={error} />; }

  return (
    <div className="flex-1 space-y-4">
      {/* Header with Search and Export Button */}
      <div className="flex justify-between items-center">
        <div className="relative w-full max-w-md">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input type="search" placeholder="Search Item Name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-9" />
        </div>
        <Button onClick={handleExportCsv} variant="outline" size="sm" className="h-9" disabled={processedItems.length === 0}>
          <FileUp className="mr-2 h-4 w-4" /> Export
        </Button>
      </div>

      {/* The Virtualized Table Component */}
      <VirtualizedMaterialTable
        items={processedItems}
        estimatedRowHeight={48}
        // Pass all state and handlers down to the table component
        categoryOptions={categoryOptions}
        categoryFilter={categoryFilter}
        onSetCategoryFilter={setCategoryFilter}
        deliveryStatusOptions={deliveryStatusOptions}
        deliveryStatusFilter={deliveryStatusFilter}
        onSetDeliveryStatusFilter={setDeliveryStatusFilter}
        poStatusOptions={poStatusOptions}
        poStatusFilter={poStatusFilter}
        onSetPoStatusFilter={setPoStatusFilter}
        sortKey={sortConfig.key}
        sortDirection={sortConfig.direction}
        onSetSort={handleSetSort}
        onClearSort={handleClearSort}
        hiddenColumns={hiddenColumns}
        onToggleColumnVisibility={handleToggleColumnVisibility}
      />
    </div>
  );
};

export default ProjectMaterialUsageTab;
