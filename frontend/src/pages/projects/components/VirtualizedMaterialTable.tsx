// components/VirtualizedMaterialTable.tsx (Full, Refactored File)

import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff, ListX } from 'lucide-react';

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { DeliveryStatus, MaterialUsageDisplayItem, OverallItemPOStatus, MaterialSortKey } from './ProjectMaterialUsageTab';
import { MaterialTableRow } from './MaterialTableRow';
import { SimpleFacetedFilter } from './SimpleFacetedFilter';

// =================================================================================
// 1. HELPER COMPONENT: SortableHeader
// =================================================================================
// This is a self-contained component responsible for rendering a single table header
// that has sorting and hiding capabilities via a dropdown menu.

interface SortableHeaderProps {
  sortableKey: MaterialSortKey;
  children: React.ReactNode;
  className?: string;
  currentSortKey: MaterialSortKey | null;
  currentSortDirection: 'asc' | 'desc';
  onSetSort: (key: MaterialSortKey, direction: 'asc' | 'desc') => void;
  onClearSort: () => void;
  onToggleVisibility: (key: MaterialSortKey) => void;
}

const SortableHeader: React.FC<SortableHeaderProps> = ({
  sortableKey, children, className, currentSortKey, currentSortDirection, onSetSort, onClearSort, onToggleVisibility
}) => {
  // Check if this specific header is the one currently being sorted.
  const isSorted = currentSortKey === sortableKey;

  // Dynamically determine text alignment to correctly position the text and button.
  const alignmentClass = className?.includes('text-center') ? 'justify-center' :
                         className?.includes('text-right') ? 'justify-end' : 'justify-start';
  return (
    <TableHead className={className}>
      <div className={`flex items-center gap-2 ${alignmentClass}`}>
        {/* The column title is just plain text, not part of the button. */}
        <span>{children}</span>

        {/* The DropdownMenu is triggered ONLY by the icon button. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              {/* Display the correct icon based on the current sort state. */}
              {isSorted ? (
                currentSortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />
              ) : (
                <ChevronsUpDown className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Each menu item calls a handler function passed down from the parent component. */}
            <DropdownMenuItem onClick={() => onSetSort(sortableKey, 'asc')}><ArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />Asc</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSetSort(sortableKey, 'desc')}><ArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />Desc</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClearSort} disabled={!isSorted}><ListX className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />Clear</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleVisibility(sortableKey)}><EyeOff className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />Hide</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TableHead>
  );
};


// =================================================================================
// 2. MAIN COMPONENT: VirtualizedMaterialTable
// =================================================================================
// This is a "controlled component". It receives all its data and state from its parent.
// Its primary job is to efficiently render a potentially large list of items.

interface VirtualizedMaterialTableProps {
  // The data to display, which is already filtered and sorted by the parent.
  items: MaterialUsageDisplayItem[];
  estimatedRowHeight?: number;
  
  // Props for filter components
  categoryOptions: { label: string; value: string }[];
  categoryFilter: Set<string>;
  onSetCategoryFilter: (selected: Set<string>) => void;
  // ... other filter props ...
  deliveryStatusOptions: { label: string; value: DeliveryStatus }[];
  deliveryStatusFilter: Set<DeliveryStatus>;
  onSetDeliveryStatusFilter: (selected: Set<DeliveryStatus>) => void;
  poStatusOptions: { label: string; value: OverallItemPOStatus }[];
  poStatusFilter: Set<OverallItemPOStatus>;
  onSetPoStatusFilter: (selected: Set<OverallItemPOStatus>) => void;

  // Props to control sorting UI
  sortKey: MaterialSortKey | null;
  sortDirection: 'asc' | 'desc';
  onSetSort: (key: MaterialSortKey, direction: 'asc' | 'desc') => void;
  onClearSort: () => void;
  
  // Props to control column visibility
  hiddenColumns: Set<MaterialSortKey>;
  onToggleColumnVisibility: (key: MaterialSortKey) => void;
}

export const VirtualizedMaterialTable: React.FC<VirtualizedMaterialTableProps> = (props) => {
  const { items, estimatedRowHeight = 48, hiddenColumns } = props;
  const parentRef = React.useRef<HTMLDivElement>(null);

  // --- A. VIRTUALIZATION LOGIC ---
  // This hook from @tanstack/react-virtual is the key to performance.
  // It calculates which rows should be visible in the viewport.
  const rowVirtualizer = useVirtualizer({
    count: items.length, // Total number of items in the list.
    getScrollElement: () => parentRef.current, // The scrollable container element.
    estimateSize: () => estimatedRowHeight, // An estimate for performance; doesn't need to be exact.
    overscan: 10, // Renders 10 extra items above and below the viewport for smoother scrolling.
  });

  // `getVirtualItems()` returns a small array of only the rows that should be rendered.
  const virtualRows = rowVirtualizer.getVirtualItems();

  // This is the "magic" of virtualization. To make the scrollbar behave correctly,
  // we create empty spacer elements at the top and bottom of the rendered list.
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;
  
  // --- B. DYNAMIC LAYOUT CALCULATION ---
  // Calculate the number of visible columns to correctly set the `colSpan` for placeholder rows.
  const totalColumns = 15; // Total columns: Item Name, Category, Billing Cat, Unit, Est Qty, Ordered Qty, DN Qty, DC Qty, MIR Qty, PO Amount, Delivery Status, PO Numbers, DCs, MIRs, PO Status
  const visibleColumnCount = totalColumns - hiddenColumns.size;
    
  // Helper function to bundle all sorting-related props for the SortableHeader.
  const createSortableHeaderProps = (key: MaterialSortKey) => ({
      sortableKey: key,
      currentSortKey: props.sortKey,
      currentSortDirection: props.sortDirection,
      onSetSort: props.onSetSort,
      onClearSort: props.onClearSort,
      onToggleVisibility: props.onToggleColumnVisibility,
  });

  // --- C. RENDER LOGIC ---
  return (
    <div ref={parentRef} className="rounded-md border overflow-x-auto max-h-[70vh] overflow-y-auto">
      <Table>
        <TableHeader className='bg-background sticky top-0 z-[40]'>
          <TableRow>
            {/* Regular Headers */}
            <TableHead className="min-w-[250px] sticky left-0 z-[50] bg-background">Item Name</TableHead>
            <TableHead className="min-w-[170px]">
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter title="Category" options={props.categoryOptions} selectedValues={props.categoryFilter} onSelectedValuesChange={props.onSetCategoryFilter} />
                <span>Category</span>
              </div>
            </TableHead>
            <TableHead className="text-center min-w-[80px]">Billing category</TableHead>
            <TableHead className="text-center min-w-[80px]">Unit</TableHead>
            <TableHead className="text-right min-w-[120px]">Est. Qty</TableHead>

            {/* Sortable/Hideable Headers (Conditionally Rendered) */}
            {!hiddenColumns.has('orderedQuantity') && <SortableHeader {...createSortableHeaderProps('orderedQuantity')} className="text-right min-w-[140px]">Ordered Qty</SortableHeader>}
            {!hiddenColumns.has('deliveredQuantity') && <SortableHeader {...createSortableHeaderProps('deliveredQuantity')} className="text-right min-w-[160px]">Delivery Note Qty</SortableHeader>}
            {!hiddenColumns.has('dcQuantity') && <SortableHeader {...createSortableHeaderProps('dcQuantity')} className="text-right min-w-[120px]">DC Qty</SortableHeader>}
            {!hiddenColumns.has('mirQuantity') && <SortableHeader {...createSortableHeaderProps('mirQuantity')} className="text-right min-w-[120px]">MIR Qty</SortableHeader>}
            {!hiddenColumns.has('totalAmount') && <SortableHeader {...createSortableHeaderProps('totalAmount')} className="text-center min-w-[190px]">PO Amount(inc.GST)</SortableHeader>}
            
            {/* More Regular Headers with Filters */}
            <TableHead className="min-w-[180px]">
              <div className="flex items-center gap-1 justify-center">
                 <SimpleFacetedFilter title="Delivery Status" options={props.deliveryStatusOptions} selectedValues={props.deliveryStatusFilter as Set<string>} onSelectedValuesChange={(newSet) => props.onSetDeliveryStatusFilter(newSet as Set<DeliveryStatus>)} />
                <span>Delivery Status</span>
              </div>
            </TableHead>
            <TableHead className="text-center min-w-[170px]">PO Number(s)</TableHead>
            <TableHead className="text-center min-w-[80px]">DCs</TableHead>
            <TableHead className="text-center min-w-[80px]">MIRs</TableHead>
            <TableHead className="min-w-[180px]">
               <div className="flex items-center gap-1 justify-center">
                <SimpleFacetedFilter title="PO Status" options={props.poStatusOptions} selectedValues={props.poStatusFilter as Set<string>} onSelectedValuesChange={(newSet) => props.onSetPoStatusFilter(newSet as Set<OverallItemPOStatus>)} />
                <span>PO Status</span>
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Top padding row to simulate the position of un-rendered items */}
          {paddingTop > 0 && (<TableRow><td colSpan={visibleColumnCount} style={{ height: `${paddingTop}px` }} /></TableRow>)}
          
          {/* Message for when no items are found after filtering */}
          {virtualRows.length === 0 && (<TableRow><TableCell colSpan={visibleColumnCount} className="h-24 text-center">No results found.</TableCell></TableRow>)}
          
          {/* The main rendering loop: iterates over the small `virtualRows` array */}
          {virtualRows.map(virtualRow => {
            const item = items[virtualRow.index];
            return (<MaterialTableRow key={item.uniqueKey || `item-${virtualRow.index}`} item={item} hiddenColumns={hiddenColumns} />);
          })}

          {/* Bottom padding row */}
          {paddingBottom > 0 && (<TableRow><td colSpan={visibleColumnCount} style={{ height: `${paddingBottom}px` }} /></TableRow>)}
        </TableBody>
      </Table>
    </div>
  );
};

