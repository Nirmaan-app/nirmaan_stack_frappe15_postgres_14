import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { Merge, Split } from "lucide-react";
import type { MergeIncompatibility } from "./types";

interface MergePOTableProps {
  basePO: ProcurementOrder;
  mergeablePOs: ProcurementOrder[];
  mergedItems: ProcurementOrder[];
  onMerge: (po: ProcurementOrder) => void;
  onUnmerge: (po: ProcurementOrder) => void;
  incompatiblePOMap?: Map<string, MergeIncompatibility[]>;
}

export function MergePOTable({
  basePO,
  mergeablePOs,
  mergedItems,
  onMerge,
  onUnmerge,
  incompatiblePOMap,
}: MergePOTableProps) {
  if (mergeablePOs.length === 0) {
    return <p className="text-sm text-muted-foreground">No mergeable POs available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[500px]">
        <TableHeader>
          <TableRow className="bg-red-100">
            <TableHead className="w-[15%]">ID(PO/PR)</TableHead>
            <TableHead>Items Count</TableHead>
            <TableHead>Items List</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Base PO row — always shown, not actionable */}
          <TableRow>
            <TableCell>
              {basePO.name?.slice(3, 6)}/
              {basePO.procurement_request?.slice(9)}
            </TableCell>
            <TableCell>{basePO.items?.length}</TableCell>
            <TableCell>
              <ItemsList items={basePO.items || []} />
            </TableCell>
            <TableCell>
              <Button
                className="flex items-center gap-1 bg-blue-500 text-white hover:text-white hover:bg-blue-400"
                variant="ghost"
                disabled
              >
                <Split className="w-4 h-4" />
                Split
              </Button>
            </TableCell>
          </TableRow>

          {/* Mergeable PO rows */}
          {mergeablePOs.map((po) => {
            const isMerged = mergedItems.some((m) => m.name === po.name);
            const issues = incompatiblePOMap?.get(po.name);
            const isIncompatible = !isMerged && !!issues?.length;

            return (
              <TableRow key={po.name}>
                <TableCell>
                  {po.name?.slice(3, 6)}/
                  {po.procurement_request?.slice(9)}
                </TableCell>
                <TableCell>{po.items?.length}</TableCell>
                <TableCell>
                  <ItemsList items={po.items || []} />
                </TableCell>
                <TableCell>
                  {isMerged ? (
                    <Button
                      className="flex items-center gap-1 bg-blue-500 text-white hover:text-white hover:bg-blue-400"
                      variant="ghost"
                      onClick={() => onUnmerge(po)}
                    >
                      <Split className="w-4 h-4" />
                      Split
                    </Button>
                  ) : isIncompatible ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            className="flex items-center gap-1"
                            disabled
                          >
                            <Merge className="w-4 h-4" />
                            Merge
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {issues!.map((i) => i.detail).join("; ")}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      className="flex items-center gap-1"
                      onClick={() => onMerge(po)}
                    >
                      <Merge className="w-4 h-4" />
                      Merge
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ItemsList({ items }: { items: { item_name: string; quantity: number; make?: string; name: string }[] }) {
  return (
    <ul className="list-disc">
      {items.map((item) => (
        <li key={item.name}>
          {item.item_name} <span>(Qty-{item.quantity})</span>
          <p className="text-primary text-sm">
            Make:{" "}
            <span className="text-xs text-gray-500 italic">
              {item.make || "--"}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}
