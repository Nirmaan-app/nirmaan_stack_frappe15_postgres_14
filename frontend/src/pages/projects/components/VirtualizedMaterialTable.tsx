import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";
import { MaterialUsageDisplayItem } from './ProjectMaterialUsageTab';
import { MaterialTableRow } from './MaterialTableRow';

interface VirtualizedMaterialTableProps {
  items: MaterialUsageDisplayItem[];
  estimatedRowHeight?: number;
}

export const VirtualizedMaterialTable: React.FC<VirtualizedMaterialTableProps> = ({
  items,
  estimatedRowHeight = 48, // Default row height
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
            <TableHead className="min-w-[150px]">Category</TableHead>
            <TableHead className="text-center min-w-[80px]">Unit</TableHead>
            <TableHead className="text-right min-w-[100px]">Est. Qty</TableHead>
            <TableHead className="text-right min-w-[100px]">Ordered Qty</TableHead>
            <TableHead className="text-right min-w-[120px]">Delivered Qty</TableHead>
            <TableHead className="text-center min-w-[120px]">Delivery Status</TableHead>
            <TableHead className="text-center min-w-[170px]">PO Number(s)</TableHead>
            <TableHead className="text-center min-w-[150px]">PO Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paddingTop > 0 && (
            <TableRow>
              <td colSpan={9} style={{ height: `${paddingTop}px`, padding: 0, border: 0 }} />
            </TableRow>
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