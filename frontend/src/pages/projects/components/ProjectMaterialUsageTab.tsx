// components/tabs/ProjectMaterialUsageTab.tsx (Full, Refactored File)

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrappeGetCall } from 'frappe-react-sdk';
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { VirtualizedMaterialTable } from './VirtualizedMaterialTable';
import { POWiseMaterialTable, POWiseMaterialTableHandle } from './POWiseMaterialTable';
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
export type MaterialSortKey = 'deliveredQuantity' | 'orderedQuantity' | 'totalAmount' | 'dcQuantity' | 'mirQuantity' | 'remainingQuantity';

// Shared type for DC/MIR document references in the Material Usage table
export interface DeliveryDocumentInfo {
  name: string;           // PO Delivery Document name
  referenceNumber: string;
  dcDate?: string;
  isSignedByClient: boolean;
  attachmentUrl?: string;
  itemCount: number;
  poNumber: string;
  isStub: boolean;        // true when document has no items mapped yet
}

// Data structure for PO-Wise view rows
export interface POWiseDisplayItem {
  poNumber: string;
  vendorName: string;
  category: string;
  totalOrderedQty: number;
  totalDeliveryNoteQty: number;
  totalDCQty: number;
  totalMIRQty: number;
  totalAmount: number;
  deliveryStatus: DeliveryStatus;
  paymentStatus: POStatus;
  dcs: DeliveryDocumentInfo[];
  mirs: DeliveryDocumentInfo[];
  items: MaterialUsageDisplayItem[];
}

// The main data structure for each row in the table.
// NOTE: Standardized property names like `categoryName` and `overallPOPaymentStatus`
// to match the row component and export logic.
export interface MaterialUsageDisplayItem {
  uniqueKey: string;
  itemId?: string;
  itemName?: string;
  categoryName: string;
  unit?: string;
  estimatedQuantity?: number;
  orderedQuantity: number;
  deliveredQuantity: number;
  dcQuantity: number;
  mirQuantity: number;
  totalAmount?: number;
  deliveryStatus: DeliveryStatus;
  overallPOPaymentStatus: OverallItemPOStatus;
  poNumbers?: { po: string, status: POStatus, amount: number, quote?: number, poCalculatedAmount?: string }[];
  vendorNames?: string[];  // Vendor names from all POs for this item
  billingCategory?: string;
  deliveryChallans?: DeliveryDocumentInfo[];
  dcCount?: number;
  mirCount?: number;
  mirs?: DeliveryDocumentInfo[];
  isOrphanDCItem?: boolean;  // true when item comes from DC/MIR but has no matching PO item
  remainingQuantity?: number | null;
  isHighValueItem?: boolean;
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
    poWiseItems,
    isLoading,
    error,
    categoryOptions,
    billingCategoryOptions,
    deliveryStatusOptions,
    poStatusOptions
  } = useMaterialUsageData(projectId, projectPayments);

  // --- Remaining Quantities Data ---
  const { data: remainingData } = useFrappeGetCall<{
    message: {
      report_date: string | null;
      submitted_by: string | null;
      submitted_by_full_name: string | null;
      items: Record<string, { remaining_quantity: number | null; dn_quantity: number | null }>;
    };
  }>(
    "nirmaan_stack.api.remaining_items_report.get_latest_remaining_quantities",
    { project: projectId },
    projectId ? `remaining_qty_${projectId}` : undefined
  );

  const remainingReportDate = remainingData?.message?.report_date ?? null;
  const remainingSubmittedBy = remainingData?.message?.submitted_by_full_name ?? null;

  // --- A2. TAB STATE & REFS ---
  const poTableRef = useRef<POWiseMaterialTableHandle>(null);
  const [activeTab, setActiveTab] = useState<string>(() => getUrlStringParam('mus_tab', 'Item Wise'));

  // --- B. STATE MANAGEMENT ---
  // Manages the state for all user interactions: search, filters, sorting, and hidden columns.
  
  // Search state
  const [searchTerm, setSearchTerm] = useState<string>(() => getUrlStringParam('mus_q', ""));
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>(searchTerm);

  // Filter states
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(() => new Set(getUrlJsonParam<string[]>('mus_cat', [])));
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<Set<DeliveryStatus>>(() => new Set(getUrlJsonParam<DeliveryStatus[]>('mus_ds', [])));
  const [poStatusFilter, setPoStatusFilter] = useState<Set<OverallItemPOStatus>>(() => new Set(getUrlJsonParam<OverallItemPOStatus[]>('mus_ps', [])));
  const [billingCategoryFilter, setBillingCategoryFilter] = useState<Set<string>>(() => new Set(getUrlJsonParam<string[]>('mus_bc', [])));

  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ key: MaterialSortKey | null; direction: 'asc' | 'desc'; }>({ key: null, direction: 'asc' });
  
  // Column visibility state
  const [hiddenColumns, setHiddenColumns] = useState<Set<MaterialSortKey>>(new Set());

  // --- C. URL SYNCHRONIZATION ---
  // These effects keep the browser URL in sync with the component's state,
  // allowing filters to be bookmarked and shared.

  // Updates the URL when the search term or tab changes.
  useEffect(() => { urlStateManager.updateParam('mus_q', searchTerm || null); }, [searchTerm]);
  useEffect(() => { urlStateManager.updateParam('mus_tab', activeTab !== 'Item Wise' ? activeTab : null); }, [activeTab]);
  
  // Updates the URL for all Set-based filters.
  const updateUrlParamJsonArray = useCallback((key: string, valueSet: Set<string>) => {
    const arrayValue = Array.from(valueSet);
    urlStateManager.updateParam(key, arrayValue.length > 0 ? JSON.stringify(arrayValue) : null);
  }, []);

  useEffect(() => { updateUrlParamJsonArray('mus_cat', categoryFilter); }, [categoryFilter, updateUrlParamJsonArray]);
  useEffect(() => { updateUrlParamJsonArray('mus_ds', deliveryStatusFilter); }, [deliveryStatusFilter, updateUrlParamJsonArray]);
  useEffect(() => { updateUrlParamJsonArray('mus_ps', poStatusFilter); }, [poStatusFilter, updateUrlParamJsonArray]);
  useEffect(() => { updateUrlParamJsonArray('mus_bc', billingCategoryFilter); }, [billingCategoryFilter, updateUrlParamJsonArray]);

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
    return new Fuse(allMaterialUsageItems, { keys: ['itemName', 'vendorNames'], threshold: 0.3 });
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
      const bcMatch = billingCategoryFilter.size === 0 || billingCategoryFilter.has(item.billingCategory || "");
      const delMatch = deliveryStatusFilter.size === 0 || deliveryStatusFilter.has(item.deliveryStatus);
      const poMatch = poStatusFilter.size === 0 || poStatusFilter.has(item.overallPOPaymentStatus);
      return catMatch && bcMatch && delMatch && poMatch;
    });

    return items;
  }, [
    allMaterialUsageItems,
    debouncedSearchTerm,
    fuseInstance,
    categoryFilter,
    billingCategoryFilter,
    deliveryStatusFilter,
    poStatusFilter,
  ]);

  // Merge remaining data into processedItems, then sort
  const processedItemsWithRemaining = useMemo((): MaterialUsageDisplayItem[] => {
    const remainingItems = remainingData?.message?.items;
    let items: MaterialUsageDisplayItem[];

    if (!remainingItems || Object.keys(remainingItems).length === 0) {
      items = processedItems;
    } else {
      const remainingMap = new Map(Object.entries(remainingItems));
      items = processedItems.map((item) => {
        const key = `${item.categoryName}_${item.itemId}`;
        const maxQuote = Math.max(...(item.poNumbers?.map((p) => p.quote ?? 0) ?? [0]));
        const isHighValue = maxQuote > 5000;
        const remaining = remainingMap.get(key);

        return {
          ...item,
          isHighValueItem: isHighValue,
          remainingQuantity: isHighValue && remaining ? remaining.remaining_quantity : undefined,
        };
      });
    }

    // Sort after merge so remainingQuantity is available as a sort key
    const { key, direction } = sortConfig;
    if (key) {
      items = [...items].sort((a, b) => {
        const valA = (a as Record<string, any>)[key] ?? 0;
        const valB = (b as Record<string, any>)[key] ?? 0;
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return items;
  }, [processedItems, remainingData?.message?.items, sortConfig]);

  // --- F. CSV EXPORT HANDLER ---
  // Uses the final `processedItemsWithRemaining` array to export what the user sees.
  const handleExportCsv = useCallback(() => {
    if (processedItemsWithRemaining.length === 0) {
      toast({ title: "No Data", description: "No data to export based on current filters.", variant: "default" });
      return;
    }

    const exportColumns = [
      { header: 'Item Name', accessor: (item: MaterialUsageDisplayItem) => item.itemName || "N/A" },
      { header: 'Category', accessor: (item: MaterialUsageDisplayItem) => item.categoryName },
      { header: 'Billing Category', accessor: (item: MaterialUsageDisplayItem) => item.billingCategory || "N/A" },
      { header: 'Unit', accessor: (item: MaterialUsageDisplayItem) => item.unit || "N/A" },
      { header: 'Est. Qty', accessor: (item: MaterialUsageDisplayItem) => item.estimatedQuantity?.toFixed(2) || "N/A" },
      { header: 'Ordered Qty', accessor: (item: MaterialUsageDisplayItem) => item.orderedQuantity.toFixed(2) },
      { header: 'Delivery Note Qty', accessor: (item: MaterialUsageDisplayItem) => item.deliveredQuantity.toFixed(2) },
      { header: 'Remaining Qty', accessor: (item: MaterialUsageDisplayItem) => item.remainingQuantity !== null && item.remainingQuantity !== undefined && item.remainingQuantity !== -1 ? item.remainingQuantity.toFixed(2) : "N/A" },
      { header: 'DC Qty', accessor: (item: MaterialUsageDisplayItem) => item.dcQuantity.toFixed(2) },
      { header: 'MIR Qty', accessor: (item: MaterialUsageDisplayItem) => item.mirQuantity.toFixed(2) },
      { header: 'Total Amount', accessor: (item: MaterialUsageDisplayItem) => item.totalAmount?.toFixed(2) || "0.00" },
      { header: 'Delivery Status', accessor: (item: MaterialUsageDisplayItem) => item.deliveryStatus },
      { header: 'PO Numbers', accessor: (item: MaterialUsageDisplayItem) => item.poNumbers?.map(p => p.po).join(', ') || "-" },
      { header: 'DC Count', accessor: (item: MaterialUsageDisplayItem) => (item.dcCount || 0).toString() },
      { header: 'MIR Count', accessor: (item: MaterialUsageDisplayItem) => (item.mirCount || 0).toString() },
      { header: 'Overall PO Status', accessor: (item: MaterialUsageDisplayItem) => item.overallPOPaymentStatus },
    ];

    const dataToExport = processedItemsWithRemaining.map(item =>
        exportColumns.reduce((acc, col) => {
            acc[col.header] = col.accessor(item);
            return acc;
        }, {} as Record<string, any>)
    );

    exportToCsv(`project_${projectId}_item_wise_usage.csv`, dataToExport, exportColumns.map(c => ({header: c.header, accessorKey: c.header})));
    toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success"});
  }, [processedItemsWithRemaining, projectId]);


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

  const tabs = [
    { label: "Item Wise", value: "Item Wise" },
    { label: "PO Wise", value: "PO Wise" },
  ];

  const searchPlaceholder = activeTab === "Item Wise"
    ? "Search item name, vendor..."
    : "Search PO, vendor, category...";

  // const handleExport = useCallback(() => {
  //   if (activeTab === "Item Wise") {
  //     handleExportCsv();
  //   } else {
  //     poTableRef.current?.exportCsv();
  //   }
  // }, [activeTab, handleExportCsv]);
  

  const handleExport = () => {
    if (activeTab === "Item Wise") {
      handleExportCsv();
    } else {
      poTableRef.current?.exportCsv();
    }
  };
  
  const isExportDisabled = activeTab === "Item Wise"
    ? processedItems.length === 0
    : (poWiseItems?.length ?? 0) === 0;

  return (
    <div className="flex-1 space-y-3">
      {/* Row 1: Tab switcher */}
      <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`relative px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200
                ${isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Row 2: Search + Export toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Button
          onClick={handleExport}
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          disabled={isExportDisabled}
        >
          <FileUp className="mr-2 h-4 w-4" />
          Export
        </Button>
      </div>

      {/* Table content based on active tab */}
      {activeTab === "Item Wise" ? (
        <VirtualizedMaterialTable
          items={processedItemsWithRemaining}
          remainingReportDate={remainingReportDate}
          remainingSubmittedBy={remainingSubmittedBy}
          estimatedRowHeight={48}
          categoryOptions={categoryOptions}
          categoryFilter={categoryFilter}
          onSetCategoryFilter={setCategoryFilter}
          billingCategoryOptions={billingCategoryOptions}
          billingCategoryFilter={billingCategoryFilter}
          onSetBillingCategoryFilter={setBillingCategoryFilter}
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
      ) : (
        <POWiseMaterialTable
          ref={poTableRef}
          items={poWiseItems || []}
          searchTerm={debouncedSearchTerm}
          projectId={projectId}
        />
      )}
    </div>
  );
};

export default ProjectMaterialUsageTab;
