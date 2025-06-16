import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DeliveryStatus, MaterialUsageDisplayItem, OverallItemPOStatus } from './ProjectMaterialUsageTab';
import { MaterialTableRow } from './MaterialTableRow';
import { SimpleFacetedFilter } from './SimpleFacetedFilter';

interface VirtualizedMaterialTableProps {
  items: MaterialUsageDisplayItem[];
  estimatedRowHeight?: number;
  // Filter props passed down from ProjectMaterialUsageTab
  categoryOptions: { label: string; value: string }[];
  categoryFilter: Set<string>;
  onSetCategoryFilter: (selected: Set<string>) => void;
  deliveryStatusOptions: { label: string; value: DeliveryStatus }[];
  deliveryStatusFilter: Set<DeliveryStatus>;
  onSetDeliveryStatusFilter: (selected: Set<DeliveryStatus>) => void;
  poStatusOptions: { label: string; value: OverallItemPOStatus }[];
  poStatusFilter: Set<OverallItemPOStatus>;
  onSetPoStatusFilter: (selected: Set<OverallItemPOStatus>) => void;
}

export const VirtualizedMaterialTable: React.FC<VirtualizedMaterialTableProps> = ({
  items,
  estimatedRowHeight = 48, // Default row height
  categoryOptions,
  categoryFilter,
  onSetCategoryFilter,
  deliveryStatusOptions,
  deliveryStatusFilter,
  onSetDeliveryStatusFilter,
  poStatusOptions,
  poStatusFilter,
  onSetPoStatusFilter,
}) => {

  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

  return (
    <div ref={parentRef} className="rounded-md border overflow-x-auto max-h-[70vh] overflow-y-auto">
      <Table>
        <TableHeader className='bg-red-50 sticky top-0 z-[40]'>
          <TableRow>
            <TableHead className="min-w-[250px] sticky left-0 z-[50] bg-red-50">Item Name</TableHead>
            <TableHead className="min-w-[150px] flex items-center gap-1">
              <SimpleFacetedFilter
                title="Category"
                options={categoryOptions}
                selectedValues={categoryFilter}
                onSelectedValuesChange={onSetCategoryFilter}
              />
              Category</TableHead>
            <TableHead className="text-center min-w-[80px]">Unit</TableHead>
            <TableHead className="text-right min-w-[100px]">Est. Qty</TableHead>
            <TableHead className="text-right min-w-[100px]">Ordered Qty</TableHead>
            <TableHead className="text-right min-w-[120px]">Delivered Qty</TableHead>
            {/* <TableHead
             className="text-right min-w-[120px]">Total Amount</TableHead> */}
                 {/* =============== ADD THIS NEW TABLE HEAD ================ */}
            <TableHead className="text-right min-w-[120px]">Total Amount</TableHead>
            {/* ====================================================== */}
            

            <TableHead className="text-center min-w-[150px] flex items-center gap-1">
              <SimpleFacetedFilter
                title="Delivery Status"
                options={deliveryStatusOptions}
                selectedValues={deliveryStatusFilter as Set<string>} // Cast for compatibility
                onSelectedValuesChange={(newSet) => onSetDeliveryStatusFilter(newSet as Set<DeliveryStatus>)}
              />
              Delivery Status</TableHead>
            <TableHead className="text-center min-w-[170px]">PO Number(s)</TableHead>
            <TableHead className="text-center min-w-[150px] flex items-center gap-1">
              <SimpleFacetedFilter
                title="PO Status"
                options={poStatusOptions}
                selectedValues={poStatusFilter as Set<string>} // Cast for compatibility
            onSelectedValuesChange={(newSet) => onSetPoStatusFilter(newSet as Set<OverallItemPOStatus>)}
              />
              PO Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paddingTop > 0 && (
            <TableRow>
              <td colSpan={9} style={{ height: `${paddingTop}px`, padding: 0, border: 0 }} />
            </TableRow>
          )}

          {/* {virtualRows.length === 0 && (
            <TableRow><TableCell colSpan={9} className="h-24 text-center">No results found.</TableCell></TableRow>
          )} */}
           {virtualRows.length === 0 && (
            // ============ UPDATE THE COLSPAN HERE ============
            <TableRow><TableCell colSpan={10} className="h-24 text-center">No results found.</TableCell></TableRow>
            // ===============================================
          )}

          {virtualRows.map(virtualRow => {
            const item = items[virtualRow.index];
            return (
              <MaterialTableRow 
                key={item.uniqueKey || `item-${virtualRow.index}`} 
                item={item} 
              />
            );
          })}
         

          {paddingBottom > 0 && (
            <TableRow>
              <td colSpan={9} style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }} />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};