import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";

interface TransferListTableProps {
  items: InternalTransferMemoItem[] | undefined;
  memoStatus: string;
  isAdmin: boolean;
}

/**
 * Simple items table for the ITM detail view.
 * No approval actions — all items are approved by definition.
 * Shows: Item Name | Unit | Transfer Qty | Delivered Qty
 */
export const TransferListTable: React.FC<TransferListTableProps> = ({
  items,
}) => {
  const rows = items ?? [];

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No items in this transfer.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-12">
              S.No.
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide font-semibold">
              Item Name
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-24">
              Unit
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-36 text-right">
              Quantity
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-36 text-right">
              Delivered Qty
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, idx) => (
            <TableRow key={row.name ?? `${row.item_id}-${idx}`}>
              <TableCell className="text-muted-foreground tabular-nums">
                {idx + 1}
              </TableCell>
              <TableCell className="font-medium">
                <div className="flex flex-col">
                  <span>{row.item_name ?? row.item_id}</span>
                  {row.make && (
                    <span className="text-xs text-muted-foreground">
                      Make: {row.make}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.unit ?? "--"}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {row.transfer_quantity}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {row.received_quantity ? row.received_quantity : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default TransferListTable;
