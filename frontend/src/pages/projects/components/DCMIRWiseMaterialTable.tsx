import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronRight, ChevronDown, ChevronsUpDown, ListX, Paperclip } from 'lucide-react';

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from '@/components/ui/badge';
import { DCMIRWiseDisplayItem } from './ProjectMaterialUsageTab';
import { SimpleFacetedFilter } from './SimpleFacetedFilter';
import { exportToCsv } from '@/utils/exportToCsv';
import { toast } from '@/components/ui/use-toast';
import { formatDate } from '@/utils/FormatDate';
import SITEURL from "@/constants/siteURL";

// =================================================================================
// 1. TYPES & HELPER COMPONENT
// =================================================================================

type DCMIRSortKey = 'totalReceivedQuantity' | 'totalQuantity' | 'itemCount';

interface DCMIRSortableHeaderProps {
  sortableKey: DCMIRSortKey;
  children: React.ReactNode;
  className?: string;
  currentSortKey: DCMIRSortKey | null;
  currentSortDirection: 'asc' | 'desc';
  onSetSort: (key: DCMIRSortKey, direction: 'asc' | 'desc') => void;
  onClearSort: () => void;
}

const DCMIRSortableHeader: React.FC<DCMIRSortableHeaderProps> = ({
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

interface DCMIRWiseMaterialTableProps {
  type: 'dc' | 'mir';
  items: DCMIRWiseDisplayItem[];
  searchTerm?: string;
  projectId: string;
}

export interface DCMIRWiseMaterialTableHandle {
  exportCsv: () => void;
  canExport: boolean;
}

export const DCMIRWiseMaterialTable = React.forwardRef<DCMIRWiseMaterialTableHandle, DCMIRWiseMaterialTableProps>(({ type, items, searchTerm, projectId }, ref) => {
  const isDC = type === 'dc';
  const docLabel = isDC ? 'DC' : 'MIR';
  const colCount = isDC ? 12 : 13;

  const [expandedDocs, setExpandedDocs] = React.useState<Set<string>>(new Set());

  // --- Sort & Filter State (self-contained) ---
  const [sortKey, setSortKey] = React.useState<DCMIRSortKey | null>(null);
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');
  const [vendorFilter, setVendorFilter] = React.useState<Set<string>>(new Set());
  const [signedFilter, setSignedFilter] = React.useState<Set<string>>(new Set());
  const [billingCategoryFilter, setBillingCategoryFilter] = React.useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = React.useState<Set<string>>(new Set());

  // --- Filter Option Lists (derived from data) ---
  const vendorOptions = React.useMemo(() => {
    const unique = new Set(items.map(i => i.vendorName).filter(Boolean));
    return Array.from(unique).sort().map(v => ({ label: v, value: v }));
  }, [items]);

  const signedOptions = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];

  const billingCatOptions = React.useMemo(() => {
    const unique = new Set(items.map(i => i.billingCategory).filter(Boolean));
    return Array.from(unique).sort().map(v => ({ label: v, value: v }));
  }, [items]);

  const statusOptions = [{ label: "Complete", value: "Complete" }, { label: "Incomplete", value: "Incomplete" }];

  // --- Sort Handlers ---
  const handleSetSort = React.useCallback((key: DCMIRSortKey, direction: 'asc' | 'desc') => {
    setSortKey(key);
    setSortDirection(direction);
  }, []);
  const handleClearSort = React.useCallback(() => setSortKey(null), []);

  // Helper to bundle sort props for each header
  const sortProps = (key: DCMIRSortKey) => ({
    sortableKey: key,
    currentSortKey: sortKey,
    currentSortDirection: sortDirection,
    onSetSort: handleSetSort,
    onClearSort: handleClearSort,
  });

  // --- Data Pipeline: Search -> Filter -> Sort ---
  const processedItems = React.useMemo(() => {
    // 1. Search
    let result = items;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(doc =>
        doc.referenceNumber.toLowerCase().includes(lower) ||
        doc.poNumber.toLowerCase().includes(lower) ||
        doc.vendorName.toLowerCase().includes(lower)
      );
    }

    // 2. Vendor filter
    if (vendorFilter.size > 0) {
      result = result.filter(doc => vendorFilter.has(doc.vendorName));
    }

    // 3. Signed filter
    if (signedFilter.size > 0) {
      result = result.filter(doc => signedFilter.has(doc.isSignedByClient ? "Yes" : "No"));
    }

    // 4. Billing Category filter
    if (billingCategoryFilter.size > 0) {
      result = result.filter(doc => billingCategoryFilter.has(doc.billingCategory));
    }

    // 5. Status filter
    if (statusFilter.size > 0) {
      result = result.filter(doc => statusFilter.has(doc.isStub ? "Incomplete" : "Complete"));
    }

    // 6. Sort
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const diff = a[sortKey] - b[sortKey];
        return sortDirection === 'asc' ? diff : -diff;
      });
    }

    return result;
  }, [items, searchTerm, vendorFilter, signedFilter, billingCategoryFilter, statusFilter, sortKey, sortDirection]);

  const toggleExpand = React.useCallback((documentName: string) => {
    setExpandedDocs(prev => {
      const newSet = new Set(prev);
      newSet.has(documentName) ? newSet.delete(documentName) : newSet.add(documentName);
      return newSet;
    });
  }, []);

  // Calculate row count including expanded item rows
  const flatRows = React.useMemo(() => {
    const rows: any[] = [];
    for (const doc of processedItems) {
      rows.push({ type: 'doc' as const, data: doc });
      if (expandedDocs.has(doc.documentName)) {
        if (doc.items.length === 0) {
          rows.push({ type: 'stub-msg' as const, data: doc });
        } else {
          for (let i = 0; i < doc.items.length; i++) {
            rows.push({ type: 'item' as const, data: doc, itemIndex: i });
          }
        }
      }
    }
    return rows;
  }, [processedItems, expandedDocs]);

  // --- CSV Export Handler (flat: one row per item) ---
  const handleExportCsv = React.useCallback(() => {
    if (processedItems.length === 0) {
      toast({ title: "No Data", description: "No data to export based on current filters.", variant: "default" });
      return;
    }

    const docNoHeader = `${docLabel} Number`;
    const qtyHeader = `${docLabel} Qty`;
    const headers = [
      docNoHeader,
      ...(isDC ? [] : ['DC Ref']),
      'PO Number', 'Vendor', 'Date',
      'Item Name', 'Category', 'Unit', 'Billing Category',
      'DN Qty', qtyHeader, 'Make', 'Signed', 'Status'
    ];

    const rows: Record<string, string>[] = [];
    for (const doc of processedItems) {
      if (doc.items.length === 0) {
        rows.push({
          [docNoHeader]: doc.referenceNumber,
          ...(isDC ? {} : { 'DC Ref': doc.dcReference || '-' }),
          'PO Number': doc.poNumber,
          'Vendor': doc.vendorName,
          'Date': doc.dcDate ? formatDate(doc.dcDate) : '-',
          'Item Name': '-',
          'Category': '-',
          'Unit': '-',
          'Billing Category': 'N/A',
          'DN Qty': '-',
          [qtyHeader]: '-',
          'Make': '-',
          'Signed': doc.isSignedByClient ? 'Yes' : 'No',
          'Status': 'Incomplete',
        });
      } else {
        for (const item of doc.items) {
          rows.push({
            [docNoHeader]: doc.referenceNumber,
            ...(isDC ? {} : { 'DC Ref': doc.dcReference || '-' }),
            'PO Number': doc.poNumber,
            'Vendor': doc.vendorName,
            'Date': doc.dcDate ? formatDate(doc.dcDate) : '-',
            'Item Name': item.itemName,
            'Category': item.category || '-',
            'Unit': item.unit,
            'Billing Category': item.billingCategory || 'N/A',
            'DN Qty': item.receivedQuantity.toFixed(2),
            [qtyHeader]: item.quantity.toFixed(2),
            'Make': item.make || '-',
            'Signed': doc.isSignedByClient ? 'Yes' : 'No',
            'Status': doc.isStub ? 'Incomplete' : 'Complete',
          });
        }
      }
    }

    exportToCsv(
      `project_${projectId}_${type}_wise_usage.csv`,
      rows,
      headers.map(h => ({ header: h, accessorKey: h }))
    );
    toast({ title: "Export Successful", description: `${rows.length} items across ${processedItems.length} ${docLabel}s exported.`, variant: "success" });
  }, [processedItems, projectId, type, isDC, docLabel]);

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
            <TableHead className="min-w-[150px]">{docLabel} No.</TableHead>
            {!isDC && <TableHead className="min-w-[130px]">DC Ref</TableHead>}
            <TableHead className="min-w-[150px]">PO Number</TableHead>
            <TableHead className="min-w-[150px]">
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter title="Vendor" options={vendorOptions} selectedValues={vendorFilter} onSelectedValuesChange={setVendorFilter} />
                <span>Vendor</span>
              </div>
            </TableHead>
            <TableHead className="min-w-[110px]">Date</TableHead>
            <DCMIRSortableHeader {...sortProps('itemCount')} className="text-center min-w-[80px]">Items</DCMIRSortableHeader>
            <TableHead className="min-w-[130px]">
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter title="Billing Category" options={billingCatOptions} selectedValues={billingCategoryFilter} onSelectedValuesChange={setBillingCategoryFilter} />
                <span>Billing Cat.</span>
              </div>
            </TableHead>
            <DCMIRSortableHeader {...sortProps('totalReceivedQuantity')} className="text-right min-w-[110px]">DN Qty</DCMIRSortableHeader>
            <DCMIRSortableHeader {...sortProps('totalQuantity')} className="text-right min-w-[100px]">{docLabel} Qty</DCMIRSortableHeader>
            <TableHead className="min-w-[80px]">
              <div className="flex items-center gap-1 justify-center">
                <SimpleFacetedFilter title="Signed" options={signedOptions} selectedValues={signedFilter} onSelectedValuesChange={setSignedFilter} />
                <span>Signed</span>
              </div>
            </TableHead>
            <TableHead className="min-w-[90px]">Attachment</TableHead>
            <TableHead className="min-w-[100px]">
              <div className="flex items-center gap-1 justify-center">
                <SimpleFacetedFilter title="Status" options={statusOptions} selectedValues={statusFilter} onSelectedValuesChange={setStatusFilter} />
                <span>Status</span>
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flatRows.length === 0 && (
            <TableRow><TableCell colSpan={colCount} className="h-24 text-center">No {docLabel}s found.</TableCell></TableRow>
          )}

          {flatRows.map((row: any) => {

            if (row.type === 'doc') {
              const doc: DCMIRWiseDisplayItem = row.data;
              const isExpanded = expandedDocs.has(doc.documentName);

              return (
                <TableRow
                  key={`doc-${doc.documentName}`}
                  className={`cursor-pointer hover:bg-muted/50 ${doc.isStub ? 'bg-amber-50/30' : ''}`}
                  onClick={() => toggleExpand(doc.documentName)}
                >
                  <TableCell className="py-2 px-2">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </TableCell>
                  <TableCell className="py-2 px-3 font-medium text-xs font-mono">{doc.referenceNumber}</TableCell>
                  {!isDC && <TableCell className="py-2 px-3 text-sm text-muted-foreground">{doc.dcReference || '-'}</TableCell>}
                  <TableCell className="py-2 px-3 text-xs font-mono">{doc.poNumber}</TableCell>
                  <TableCell className="py-2 px-3 text-sm text-muted-foreground">{doc.vendorName || '-'}</TableCell>
                  <TableCell className="py-2 px-3 text-sm">{doc.dcDate ? formatDate(doc.dcDate) : '-'}</TableCell>
                  <TableCell className="text-center py-2 px-3 font-mono text-sm">{doc.itemCount}</TableCell>
                  <TableCell className="py-2 px-3 text-sm">
                    <Badge variant={doc.billingCategory === "Billable" ? "default" : "secondary"}
                      className={doc.billingCategory === "Billable" ? "bg-blue-100 text-blue-700 border-blue-300" : ""}
                    >
                      {doc.billingCategory}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right py-2 px-3 font-mono text-sm">{doc.totalReceivedQuantity.toFixed(2)}</TableCell>
                  <TableCell className="text-right py-2 px-3 font-mono text-sm">{doc.totalQuantity.toFixed(2)}</TableCell>
                  <TableCell className="text-center py-2 px-3">
                    <Badge variant={doc.isSignedByClient ? "default" : "outline"}
                      className={doc.isSignedByClient ? "bg-green-100 text-green-700 border-green-300" : ""}
                    >
                      {doc.isSignedByClient ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2 px-3 text-sm" onClick={(e) => e.stopPropagation()}>
                    {doc.attachmentUrl ? (
                      <a href={`${SITEURL}${doc.attachmentUrl}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-600 hover:underline text-xs">
                        <Paperclip className="h-3 w-3" /> View
                      </a>
                    ) : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-center py-2 px-3">
                    <Badge variant={doc.isStub ? "outline" : "default"}
                      className={doc.isStub ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-green-100 text-green-700 border-green-300"}
                    >
                      {doc.isStub ? "Incomplete" : "Complete"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            }

            if (row.type === 'stub-msg') {
              return (
                <TableRow key={`stub-${row.data.documentName}`} className="bg-amber-50/30">
                  <TableCell colSpan={colCount} className="text-center py-3 text-xs text-muted-foreground italic">
                    Incomplete document — no items recorded yet
                  </TableCell>
                </TableRow>
              );
            }

            // Expanded item row
            const doc: DCMIRWiseDisplayItem = row.data;
            const item = doc.items[row.itemIndex];

            return (
              <TableRow key={`item-${doc.documentName}-${row.itemIndex}`} className="bg-muted/30">
                <TableCell className="py-1.5 px-2"></TableCell>
                <TableCell className="py-1.5 px-3 text-xs pl-8" colSpan={isDC ? 3 : 4}>
                  <span className="text-muted-foreground">{item.category || 'N/A'} / </span>
                  <span className="font-medium">{item.itemName}</span>
                  <span className="text-muted-foreground ml-2">({item.unit})</span>
                  {item.make && <span className="text-muted-foreground ml-1">&middot; {item.make}</span>}
                </TableCell>
                <TableCell className="py-1.5 px-3 text-xs text-muted-foreground">-</TableCell>
                <TableCell className="text-center py-1.5 px-3 text-xs text-muted-foreground">-</TableCell>
                <TableCell className="py-1.5 px-3 text-xs text-muted-foreground">{item.billingCategory || "N/A"}</TableCell>
                <TableCell className="text-right py-1.5 px-3 font-mono text-xs">{item.receivedQuantity.toFixed(2)}</TableCell>
                <TableCell className="text-right py-1.5 px-3 font-mono text-xs">{item.quantity.toFixed(2)}</TableCell>
                <TableCell className="py-1.5 px-3"></TableCell>
                <TableCell className="py-1.5 px-3"></TableCell>
                <TableCell className="py-1.5 px-3"></TableCell>
              </TableRow>
            );
          })}

        </TableBody>
      </Table>
    </div>
  );
});

DCMIRWiseMaterialTable.displayName = 'DCMIRWiseMaterialTable';
