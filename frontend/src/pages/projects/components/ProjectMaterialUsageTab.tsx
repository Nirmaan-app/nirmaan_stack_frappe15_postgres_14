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

// Define URL keys for this specific tab's filters
const URL_SYNC_KEY_PREFIX = 'mus'; // Material Usage
const SEARCH_URL_KEY = `${URL_SYNC_KEY_PREFIX}_q`;
const CATEGORY_FILTER_URL_KEY = `${URL_SYNC_KEY_PREFIX}_cat`;
const DELIVERY_STATUS_FILTER_URL_KEY = `${URL_SYNC_KEY_PREFIX}_ds`;
const PO_STATUS_FILTER_URL_KEY = `${URL_SYNC_KEY_PREFIX}_ps`;

export type POStatus = "Fully Paid" | "Partially Paid" | "Unpaid";
export type DeliveryStatus = "Fully Delivered" | "Partially Delivered" | "Pending Delivery" | "Not Ordered";
export type OverallItemPOStatus = POStatus | "N/A";

// Combined structure for display in the inner table
export interface MaterialUsageDisplayItem {
  categoryName: string;
  itemName?: string;
  unit?: string;
  orderedQuantity: number;
  deliveredQuantity: number;
  estimatedQuantity?: number;
  poNumbers?: {po: string, status: POStatus}[];
  uniqueKey: string;

  deliveryStatus: DeliveryStatus
  overallPOPaymentStatus: OverallItemPOStatus
  totalAmount?: number;
}

export interface ProjectMaterialUsageTabProps {
  projectId: string;
  projectPayments?: ProjectPayments[];
}

export const ProjectMaterialUsageTab: React.FC<ProjectMaterialUsageTabProps> = ({ 
  projectId, 
  projectPayments 
}) => {
  const { allMaterialUsageItems, isLoading, error, categoryOptions, deliveryStatusOptions, poStatusOptions } = useMaterialUsageData(projectId, projectPayments);

  // --- Initialize State from URL or Defaults ---
  const [searchTerm, setSearchTerm] = useState<string>(() =>
    getUrlStringParam(SEARCH_URL_KEY, "")
  );
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>(searchTerm);

  // --- State for Filters (LIFTED UP to this component) ---
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(() =>
    new Set(getUrlJsonParam<string[]>(CATEGORY_FILTER_URL_KEY, []))
  );
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<Set<DeliveryStatus>>(() =>
    new Set(getUrlJsonParam<DeliveryStatus[]>(DELIVERY_STATUS_FILTER_URL_KEY, []))
  );
  const [poStatusFilter, setPoStatusFilter] = useState<Set<OverallItemPOStatus>>(() =>
    new Set(getUrlJsonParam<OverallItemPOStatus[]>(PO_STATUS_FILTER_URL_KEY, []))
  );

  // --- URL Update Effects ---
  const updateUrlParamJsonArray = useCallback((key: string, valueSet: Set<string>) => {
    const arrayValue = Array.from(valueSet);
    if (arrayValue.length > 0) {
        urlStateManager.updateParam(key, JSON.stringify(arrayValue));
    } else {
        urlStateManager.updateParam(key, null); // Remove param if set is empty
    }
  }, []);

  useEffect(() => {
    urlStateManager.updateParam(SEARCH_URL_KEY, searchTerm || null);
  }, [searchTerm]);

  useEffect(() => {
    updateUrlParamJsonArray(CATEGORY_FILTER_URL_KEY, categoryFilter);
  }, [categoryFilter, updateUrlParamJsonArray]);

  useEffect(() => {
    updateUrlParamJsonArray(DELIVERY_STATUS_FILTER_URL_KEY, deliveryStatusFilter);
  }, [deliveryStatusFilter, updateUrlParamJsonArray]);

  useEffect(() => {
    updateUrlParamJsonArray(PO_STATUS_FILTER_URL_KEY, poStatusFilter);
  }, [poStatusFilter, updateUrlParamJsonArray]);


  // --- Debounce Search Term for Filtering ---
  const debouncedSetSearchForFilter = useCallback(
    debounce((term: string) => {
      setDebouncedSearchTerm(term);
    }, 300),
    []
  );

  useEffect(() => {
    debouncedSetSearchForFilter(searchTerm);
    return () => debouncedSetSearchForFilter.cancel();
  }, [searchTerm, debouncedSetSearchForFilter]);

  // --- Fuse.js Instance ---
  const fuseInstance = useMemo(() => {
    if (!allMaterialUsageItems || allMaterialUsageItems.length === 0) {
      return null;
    }
    return new Fuse(allMaterialUsageItems, {
      keys: ['itemName'], // Field to search on
      threshold: 0.3,    // Fuzzy search threshold (0.0 = exact match, 1.0 = match anything)
      includeScore: false, // We just need the items, not their search scores
      // For more advanced Fuse.js options: https://fusejs.io/api/options.html
    });
  }, [allMaterialUsageItems]); // Re-initialize Fuse if the base item list changes

  // --- Filtered Data (Calculated here) ---
  const filteredMaterialUsageItems = useMemo(() => {
    let itemsToFilter = allMaterialUsageItems || [];
    if (debouncedSearchTerm && fuseInstance) {
      itemsToFilter = fuseInstance.search(debouncedSearchTerm).map(result => result.item);
    } else if (debouncedSearchTerm) { // Basic fallback if Fuse isn't ready
      const lowerSearch = debouncedSearchTerm.toLowerCase();
      itemsToFilter = itemsToFilter.filter(item => item.itemName?.toLowerCase().includes(lowerSearch));
    }
    return itemsToFilter.filter(item => {
      const catMatch = categoryFilter.size === 0 || categoryFilter.has(item.categoryName);
      const delMatch = deliveryStatusFilter.size === 0 || deliveryStatusFilter.has(item.deliveryStatus);
      const poMatch = poStatusFilter.size === 0 || poStatusFilter.has(item.overallPOPaymentStatus);
      return catMatch && delMatch && poMatch;
    });
  }, [allMaterialUsageItems, debouncedSearchTerm, fuseInstance, categoryFilter, deliveryStatusFilter, poStatusFilter]);



  // --- CSV Export Handler ---
  const handleExportCsv = useCallback(() => {
    if (filteredMaterialUsageItems.length === 0) {
      toast({ title: "No Data", description: "No data to export based on current filters.", variant: "default" });
      return;
    }
    // Define columns for CSV (match table headers)
    const exportColumns = [
      { header: 'Item Name', accessor: (item: MaterialUsageDisplayItem) => item.itemName || "N/A" },
      { header: 'Category', accessor: (item: MaterialUsageDisplayItem) => item.categoryName },
      { header: 'Unit', accessor: (item: MaterialUsageDisplayItem) => item.unit || "N/A" },
      { header: 'Est. Qty', accessor: (item: MaterialUsageDisplayItem) => item.estimatedQuantity?.toFixed(2) || "N/A" },
      { header: 'Ordered Qty', accessor: (item: MaterialUsageDisplayItem) => item.orderedQuantity.toFixed(2) },
      { header: 'Delivered Qty', accessor: (item: MaterialUsageDisplayItem) => item.deliveredQuantity.toFixed(2) },
      { header: 'Delivery Status', accessor: (item: MaterialUsageDisplayItem) => item.deliveryStatus },
      { header: 'PO Numbers', accessor: (item: MaterialUsageDisplayItem) => item.poNumbers?.map(p => p.po).join(', ') || "-" },
      { header: 'Overall PO Status', accessor: (item: MaterialUsageDisplayItem) => item.overallPOPaymentStatus },
    ];
    // Transform data for export
    const dataToExport = filteredMaterialUsageItems.map(item =>
        exportColumns.reduce((acc, col) => {
            acc[col.header] = col.accessor(item);
            return acc;
        }, {} as Record<string, any>)
    );

    exportToCsv(`project_${projectId}_material_usage.csv`, dataToExport, exportColumns.map(c => ({header: c.header, accessorKey: c.header})));
    toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success"});
  }, [filteredMaterialUsageItems, projectId]);

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-12 w-full bg-red-50" />
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full mt-2" />)}
      </div>
    );
  }

  // Error state
  if (error) {
    return <AlertDestructive error={error} />;
  }

  // Data display with virtualization
  return (
    <div className="flex-1 space-y-4">
      <div className="flex justify-between items-center">
        <div className="relative w-full max-sm:w-auto sm:max-w-md">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
                type="search"
                placeholder="Search Item Name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-8 h-9 w-full"
            />
            {/* {searchTerm && (
                <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setSearchTerm("")} aria-label="Clear search">
                    <XIcon className="h-4 w-4 text-muted-foreground"/>
                </Button>
            )} */}
        </div>
          <Button onClick={handleExportCsv} variant="outline" size="sm" className="h-8"
          disabled={filteredMaterialUsageItems.length === 0}
          >
            <FileUp className="mr-2 h-4 w-4" /> Export CSV
          </Button>
      </div>

        <VirtualizedMaterialTable
          items={filteredMaterialUsageItems}
          estimatedRowHeight={48}
          // Pass filter states and setters TO the table for its header
          categoryOptions={categoryOptions}
          categoryFilter={categoryFilter}
          onSetCategoryFilter={setCategoryFilter}
          deliveryStatusOptions={deliveryStatusOptions}
          deliveryStatusFilter={deliveryStatusFilter}
          onSetDeliveryStatusFilter={setDeliveryStatusFilter}
          poStatusOptions={poStatusOptions}
          poStatusFilter={poStatusFilter}
          onSetPoStatusFilter={setPoStatusFilter}
        />
    </div>
  );
};

export default ProjectMaterialUsageTab;