import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronRight, ChevronDown, ChevronsUpDown, ListX } from 'lucide-react';

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from '@/components/ui/badge';
import formatToIndianRupee from "@/utils/FormatPrice";
import { POWiseDisplayItem } from './ProjectMaterialUsageTab';
import { DeliveryDocumentCountCell } from './DeliveryDocumentCountCell';
import { SimpleFacetedFilter } from './SimpleFacetedFilter';
import { determineDeliveryStatus } from '../config/materialUsageHelpers';
import { exportToCsv } from '@/utils/exportToCsv';
import { toast } from '@/components/ui/use-toast';

// =================================================================================
// 1. TYPES & HELPER COMPONENT
// =================================================================================

type POWiseSortKey = 'totalOrderedQty' | 'totalDeliveryNoteQty' | 'totalDCQty' | 'totalMIRQty' | 'dcCount' | 'mirCount';

interface POSortableHeaderProps {
  sortableKey: POWiseSortKey;
  children: React.ReactNode;
  className?: string;
  currentSortKey: POWiseSortKey | null;
  currentSortDirection: 'asc' | 'desc';
  onSetSort: (key: POWiseSortKey, direction: 'asc' | 'desc') => void;
  onClearSort: () => void;
}

const POSortableHeader: React.FC<POSortableHeaderProps> = ({
  sortableKey, children, className, currentSortKey, currentSortDirection, onSetSort, onClearSort
}) => {
  const isSorted = currentSortKey === sortableKey;
  const alignmentClass = className?.includes('text-center') ? 'justify-center' :
                         className?.includes('text-right') ? 'justify-end' : 'justify-start';
  return (
    <TableHead className={className}>
      <div className={`flex items-center gap-1 ${alignmentClass}`}>
        <span>{children}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
              {isSorted ? (
                currentSortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onSetSort(sortableKey, 'asc')}><ArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />Asc</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSetSort(sortableKey, 'desc')}><ArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />Desc</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClearSort} disabled={!isSorted}><ListX className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />Clear</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TableHead>
  );
};

// =================================================================================
// 2. MAIN COMPONENT
// =================================================================================

interface POWiseMaterialTableProps {
  items: POWiseDisplayItem[];
  searchTerm?: string;
  projectId: string;
}

export interface POWiseMaterialTableHandle {
  exportCsv: () => void;
  canExport: boolean;
}

export const POWiseMaterialTable = React.forwardRef<POWiseMaterialTableHandle, POWiseMaterialTableProps>(({ items, searchTerm, projectId }, ref) => {
  const [expandedPOs, setExpandedPOs] = React.useState<Set<string>>(new Set());

  // --- Sort & Filter State (self-contained) ---
  const [sortKey, setSortKey] = React.useState<POWiseSortKey | null>(null);
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');
  const [vendorFilter, setVendorFilter] = React.useState<Set<string>>(new Set());
  const [deliveryStatusFilter, setDeliveryStatusFilter] = React.useState<Set<string>>(new Set());
  const [paymentStatusFilter, setPaymentStatusFilter] = React.useState<Set<string>>(new Set());
  const [billingCategoryFilter, setBillingCategoryFilter] = React.useState<Set<string>>(new Set());

  // --- Filter Option Lists (derived from data) ---
  const vendorOptions = React.useMemo(() => {
    const unique = new Set(items.map(i => i.vendorName).filter(Boolean));
    return Array.from(unique).sort().map(v => ({ label: v, value: v }));
  }, [items]);

  const deliveryStatusOptions = React.useMemo(() => {
    const unique = new Set(items.map(i => i.deliveryStatus));
    return Array.from(unique).sort().map(v => ({ label: v, value: v }));
  }, [items]);

  const paymentStatusOptions = React.useMemo(() => {
    const unique = new Set(items.map(i => i.paymentStatus));
    return Array.from(unique).sort().map(v => ({ label: v, value: v }));
  }, [items]);

  const billingCatOptions = React.useMemo(() => {
    const unique = new Set(items.map(i => i.billingCategory).filter(Boolean));
    return Array.from(unique).sort().map(v => ({ label: v, value: v }));
  }, [items]);

  // --- Sort Handlers ---
  const handleSetSort = React.useCallback((key: POWiseSortKey, direction: 'asc' | 'desc') => {
    setSortKey(key);
    setSortDirection(direction);
  }, []);
  const handleClearSort = React.useCallback(() => setSortKey(null), []);

  // Helper to bundle sort props for each header
  const sortProps = (key: POWiseSortKey) => ({
    sortableKey: key,
    currentSortKey: sortKey,
    currentSortDirection: sortDirection,
    onSetSort: handleSetSort,
    onClearSort: handleClearSort,
  });

  // --- Data Pipeline: Search → Filter → Sort ---
  const processedItems = React.useMemo(() => {
    // 1. Search
    let result = items;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(item =>
        item.poNumber.toLowerCase().includes(lower) ||
        item.vendorName.toLowerCase().includes(lower) ||
        item.category.toLowerCase().includes(lower)
      );
    }

    // 2. Vendor filter
    if (vendorFilter.size > 0) {
      result = result.filter(item => vendorFilter.has(item.vendorName));
    }

    // 3. Delivery Status filter
    if (deliveryStatusFilter.size > 0) {
      result = result.filter(item => deliveryStatusFilter.has(item.deliveryStatus));
    }

    // 4. Payment Status filter
    if (paymentStatusFilter.size > 0) {
      result = result.filter(item => paymentStatusFilter.has(item.paymentStatus));
    }

    // 5. Billing Category filter
    if (billingCategoryFilter.size > 0) {
      result = result.filter(item => billingCategoryFilter.has(item.billingCategory));
    }

    // 6. Sort
    if (sortKey) {
      const getValue = (po: POWiseDisplayItem): number => {
        if (sortKey === 'dcCount') return po.dcs.length;
        if (sortKey === 'mirCount') return po.mirs.length;
        return po[sortKey];
      };
      result = [...result].sort((a, b) => {
        const diff = getValue(a) - getValue(b);
        return sortDirection === 'asc' ? diff : -diff;
      });
    }

    return result;
  }, [items, searchTerm, vendorFilter, deliveryStatusFilter, paymentStatusFilter, billingCategoryFilter, sortKey, sortDirection]);

  const toggleExpand = React.useCallback((poNumber: string) => {
    setExpandedPOs(prev => {
      const newSet = new Set(prev);
      newSet.has(poNumber) ? newSet.delete(poNumber) : newSet.add(poNumber);
      return newSet;
    });
  }, []);

  // Calculate row count including expanded item rows
  const flatRows = React.useMemo(() => {
    const rows: { type: 'po'; data: POWiseDisplayItem }[] | { type: 'item'; data: POWiseDisplayItem; itemIndex: number }[] = [];
    for (const poItem of processedItems) {
      rows.push({ type: 'po', data: poItem } as any);
      if (expandedPOs.has(poItem.poNumber)) {
        for (let i = 0; i < poItem.items.length; i++) {
          rows.push({ type: 'item', data: poItem, itemIndex: i } as any);
        }
      }
    }
    return rows;
  }, [processedItems, expandedPOs]);


  // --- CSV Export Handler (flat: one row per item) ---
  const handleExportCsv = React.useCallback(() => {
    if (processedItems.length === 0) {
      toast({ title: "No Data", description: "No data to export based on current filters.", variant: "default" });
      return;
    }

    const headers = [
      'PO Number', 'Vendor', 'Category', 'Item Name', 'Unit',
      'Billing Category',
      'Ordered Qty', 'Delivery Note Qty', 'DC Qty', 'MIR Qty',
      'Rate', 'Delivery Status', 'Payment Status'
    ];

    const rows: Record<string, string>[] = [];
    for (const po of processedItems) {
      for (const item of po.items) {
        const rate = item.poNumbers?.find(p => p.po === po.poNumber)?.quote || 0;
        rows.push({
          'PO Number': po.poNumber,
          'Vendor': po.vendorName,
          'Category': item.categoryName,
          'Item Name': item.itemName || 'N/A',
          'Unit': item.unit || '-',
          'Billing Category': item.billingCategory || 'N/A',
          'Ordered Qty': item.orderedQuantity.toFixed(2),
          'Delivery Note Qty': item.deliveredQuantity.toFixed(2),
          'DC Qty': item.dcQuantity.toFixed(2),
          'MIR Qty': item.mirQuantity.toFixed(2),
          'Rate': rate.toFixed(2),
          'Delivery Status': po.deliveryStatus,
          'Payment Status': po.paymentStatus,
        });
      }
    }

    exportToCsv(
      `project_${projectId}_po_wise_usage.csv`,
      rows,
      headers.map(h => ({ header: h, accessorKey: h }))
    );
    toast({ title: "Export Successful", description: `${rows.length} items across ${processedItems.length} POs exported.`, variant: "success" });
  }, [processedItems, projectId]);

  React.useImperativeHandle(ref, () => ({
    exportCsv: handleExportCsv,
    canExport: processedItems.length > 0,
  }), [handleExportCsv, processedItems.length]);

  return (
    <div className="rounded-md border overflow-x-auto max-h-[70vh] overflow-y-auto">
      <Table>
        <TableHeader className="bg-background sticky top-0 z-[40]">
          <TableRow>
            <TableHead className="w-[40px]"></TableHead>
            <TableHead className="min-w-[180px]">PO Number</TableHead>
            <TableHead className="min-w-[150px]">
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter title="Vendor" options={vendorOptions} selectedValues={vendorFilter} onSelectedValuesChange={setVendorFilter} />
                <span>Vendor</span>
              </div>
            </TableHead>
            <TableHead className="text-center min-w-[80px]">Items</TableHead>
            <TableHead className="min-w-[130px]">
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter title="Billing Category" options={billingCatOptions} selectedValues={billingCategoryFilter} onSelectedValuesChange={setBillingCategoryFilter} />
                <span>Billing Cat.</span>
              </div>
            </TableHead>
            <POSortableHeader {...sortProps('totalOrderedQty')} className="text-right min-w-[120px]">Ordered Qty</POSortableHeader>
            <POSortableHeader {...sortProps('totalDeliveryNoteQty')} className="text-right min-w-[120px]">DN Qty</POSortableHeader>
            <POSortableHeader {...sortProps('totalDCQty')} className="text-right min-w-[100px]">DC Qty</POSortableHeader>
            <POSortableHeader {...sortProps('totalMIRQty')} className="text-right min-w-[100px]">MIR Qty</POSortableHeader>
            <TableHead className="text-right min-w-[120px]">Rate</TableHead>
            <TableHead className="min-w-[150px]">
              <div className="flex items-center gap-1 justify-center">
                <SimpleFacetedFilter title="Delivery Status" options={deliveryStatusOptions} selectedValues={deliveryStatusFilter} onSelectedValuesChange={setDeliveryStatusFilter} />
                <span>Delivery Status</span>
              </div>
            </TableHead>
            <POSortableHeader {...sortProps('dcCount')} className="text-center min-w-[80px]">DCs</POSortableHeader>
            <POSortableHeader {...sortProps('mirCount')} className="text-center min-w-[80px]">MIRs</POSortableHeader>
            <TableHead className="min-w-[130px]">
              <div className="flex items-center gap-1 justify-center">
                <SimpleFacetedFilter title="Payment Status" options={paymentStatusOptions} selectedValues={paymentStatusFilter} onSelectedValuesChange={setPaymentStatusFilter} />
                <span>Payment Status</span>
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flatRows.length === 0 && (
            <TableRow><TableCell colSpan={14} className="h-24 text-center">No POs found.</TableCell></TableRow>
          )}

          {flatRows.map((row: any) => {

            if (row.type === 'po') {
              const po: POWiseDisplayItem = row.data;
              const isExpanded = expandedPOs.has(po.poNumber);
              const { deliveryStatusVariant } = determineDeliveryStatus(po.totalDeliveryNoteQty, po.totalOrderedQty);

              let paymentBadgeVariant: "success" | "warning" | "destructive" | "default" = "default";
              if (po.paymentStatus === "Fully Paid") paymentBadgeVariant = "success";
              else if (po.paymentStatus === "Partially Paid") paymentBadgeVariant = "warning";
              else if (po.paymentStatus === "Unpaid") paymentBadgeVariant = "destructive";

              return (
                <TableRow
                  key={`po-${po.poNumber}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleExpand(po.poNumber)}
                >
                  <TableCell className="py-2 px-2">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </TableCell>
                  <TableCell className="py-2 px-3 font-medium">
                    <Link
                      to={`po/${po.poNumber.replace(/\//g, "&=")}`}
                      relative="path"
                      className="text-blue-600 hover:underline text-xs font-mono"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {po.poNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="py-2 px-3 text-sm text-muted-foreground">{po.vendorName}</TableCell>
                  <TableCell className="text-center py-2 px-3 font-mono text-sm">{po.items.length}</TableCell>
                  <TableCell className="py-2 px-3 text-sm">
                    <Badge variant={po.billingCategory === "Billable" ? "default" : "secondary"}
                      className={po.billingCategory === "Billable" ? "bg-blue-100 text-blue-700 border-blue-300" : ""}
                    >
                      {po.billingCategory}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right py-2 px-3 font-mono text-sm">{po.totalOrderedQty.toFixed(2)}</TableCell>
                  <TableCell className="text-right py-2 px-3 font-mono text-sm">{po.totalDeliveryNoteQty.toFixed(2)}</TableCell>
                  <TableCell className="text-right py-2 px-3 font-mono text-sm">{po.totalDCQty.toFixed(2)}</TableCell>
                  <TableCell className="text-right py-2 px-3 font-mono text-sm">{po.totalMIRQty.toFixed(2)}</TableCell>
                  <TableCell className="text-right py-2 px-3 font-mono text-sm text-muted-foreground">-</TableCell>
                  <TableCell className="text-center py-2 px-3">
                    <Badge
                      variant={
                        deliveryStatusVariant === "success" ? "default" :
                        deliveryStatusVariant === "destructive" ? "destructive" :
                        deliveryStatusVariant === "warning" ? "outline" : "secondary"
                      }
                      className={
                        deliveryStatusVariant === "success" ? 'bg-green-100 text-green-700 border-green-300' :
                        deliveryStatusVariant === "warning" ? 'bg-yellow-100 text-yellow-700 border-yellow-300' : ""
                      }
                    >
                      {po.deliveryStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center py-2 px-3" onClick={(e) => e.stopPropagation()}>
                    <DeliveryDocumentCountCell type="dc" documents={po.dcs} count={po.dcs.length} />
                  </TableCell>
                  <TableCell className="text-center py-2 px-3" onClick={(e) => e.stopPropagation()}>
                    <DeliveryDocumentCountCell type="mir" documents={po.mirs} count={po.mirs.length} />
                  </TableCell>
                  <TableCell className="text-center py-2 px-3">
                    <Badge
                      variant={
                        paymentBadgeVariant === "success" ? "default" :
                        paymentBadgeVariant === "destructive" ? "destructive" :
                        paymentBadgeVariant === "warning" ? "outline" : "secondary"
                      }
                      className={
                        paymentBadgeVariant === "success" ? 'bg-green-100 text-green-700 border-green-300' :
                        paymentBadgeVariant === "warning" ? 'bg-yellow-100 text-yellow-700 border-yellow-300' : ""
                      }
                    >
                      {po.paymentStatus}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            }

            // Expanded item row
            const po: POWiseDisplayItem = row.data;
            const item = po.items[row.itemIndex];

            return (
              <TableRow key={`item-${po.poNumber}-${row.itemIndex}`} className={item.isOrphanDCItem ? 'bg-amber-50/50 border-l-2 border-l-amber-400' : 'bg-muted/30'}>
                <TableCell className="py-1.5 px-2"></TableCell>
                <TableCell className="py-1.5 px-3 text-xs pl-8" colSpan={2}>
                  <span className="text-muted-foreground">{item.categoryName} / </span>
                  <span className="font-medium">{item.itemName || "N/A"}</span>
                  <span className="text-muted-foreground ml-2">({item.unit || "-"})</span>
                  {item.isOrphanDCItem && (
                    <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-300">
                      Unmatched
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-center py-1.5 px-3 text-xs text-muted-foreground">-</TableCell>
                <TableCell className="py-1.5 px-3 text-xs text-muted-foreground">{item.billingCategory || "N/A"}</TableCell>
                <TableCell className="text-right py-1.5 px-3 font-mono text-xs">{item.orderedQuantity.toFixed(2)}</TableCell>
                <TableCell className="text-right py-1.5 px-3 font-mono text-xs">{item.deliveredQuantity.toFixed(2)}</TableCell>
                <TableCell className="text-right py-1.5 px-3 font-mono text-xs">{item.dcQuantity.toFixed(2)}</TableCell>
                <TableCell className="text-right py-1.5 px-3 font-mono text-xs">{item.mirQuantity.toFixed(2)}</TableCell>
                <TableCell className="text-right py-1.5 px-3 font-mono text-xs">
                  {formatToIndianRupee(item.poNumbers?.find(p => p.po === po.poNumber)?.quote || 0)}
                </TableCell>
                <TableCell className="py-1.5 px-3"></TableCell>
                <TableCell className="text-center py-1.5 px-3" onClick={(e) => e.stopPropagation()}>
                  <DeliveryDocumentCountCell type="dc" documents={item.deliveryChallans || []} count={item.dcCount || 0} />
                </TableCell>
                <TableCell className="text-center py-1.5 px-3" onClick={(e) => e.stopPropagation()}>
                  <DeliveryDocumentCountCell type="mir" documents={item.mirs || []} count={item.mirCount || 0} />
                </TableCell>
                <TableCell className="py-1.5 px-3"></TableCell>
              </TableRow>
            );
          })}

        </TableBody>
      </Table>
    </div>
  );
});
