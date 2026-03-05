import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { CheckCircle2, ArrowDown, MessageCircleMore } from "lucide-react";
import { cn } from "@/lib/utils";
import { PivotData } from "./types";

interface PivotTableBodyProps {
  pivotData: PivotData;
  showEdit: boolean;
  submitHook: {
    newlyDeliveredQuantities: Record<string, string>;
    handleNewlyDeliveredChange: (
      itemId: string,
      value: string,
      maxAllowed: number
    ) => void;
  };
  isProjectManager?: boolean;
  // Edit DN props
  editingDnName?: string | null;
  editedQuantities?: Record<string, string>;
  onEditQuantityChange?: (
    itemItemId: string,
    value: string,
    maxAllowed: number
  ) => void;
}

export function PivotTableBody({
  pivotData,
  showEdit,
  submitHook,
  isProjectManager = false,
  editingDnName,
  editedQuantities,
  onEditQuantityChange,
}: PivotTableBodyProps) {
  return (
    <TableBody>
      {pivotData.rows.map((row) => (
        <TableRow
          key={row.itemId}
          className={cn(
            row.isFullyDelivered && "bg-green-50/40 dark:bg-green-950/20"
          )}
        >
          {/* Sticky: Item Name */}
          <TableCell className="sticky left-0 z-20 bg-background py-1.5 px-2 max-w-[180px]">
            <div className="truncate text-sm">
              {row.itemName}
              {row.comment && (
                <HoverCard>
                  <HoverCardTrigger>
                    <MessageCircleMore className="text-blue-400 w-3.5 h-3.5 inline-block ml-1 cursor-pointer" />
                  </HoverCardTrigger>
                  <HoverCardContent>
                    <p className="text-sm">{row.comment}</p>
                    <p className="text-xs italic text-muted-foreground mt-1">
                      Comment by PL
                    </p>
                  </HoverCardContent>
                </HoverCard>
              )}
            </div>
          </TableCell>

          {/* Sticky: Unit */}
          <TableCell
            className={`sticky left-[180px] z-20 bg-background py-1.5 px-2 text-center text-xs ${isProjectManager ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]" : ""}`}
          >
            {row.unit}
          </TableCell>

          {/* Sticky: Ordered Qty */}
          {!isProjectManager && (
            <TableCell className="sticky left-[240px] z-20 bg-background py-1.5 px-2 text-right tabular-nums text-xs shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
              {row.orderedQty}
            </TableCell>
          )}

          {/* Dynamic DN quantity columns */}
          {pivotData.dnColumns.map((col) => {
            const isEditingThisCol = editingDnName === col.dnName;
            const currentDnQty = row.dnQuantities[col.dnName] ?? 0;

            if (isEditingThisCol) {
              // Editable input for the DN being edited
              const effectiveMax = row.remainingQty + currentDnQty;
              return (
                <TableCell
                  key={col.dnName}
                  className="py-1.5 px-2 text-center bg-primary/5"
                >
                  <Input
                    type="number"
                    className="h-7 w-16 text-xs text-center mx-auto"
                    value={editedQuantities?.[row.itemItemId] ?? ""}
                    onChange={(e) =>
                      onEditQuantityChange?.(
                        row.itemItemId,
                        e.target.value,
                        effectiveMax
                      )
                    }
                    max={effectiveMax}
                    min={0}
                    placeholder="0"
                  />
                </TableCell>
              );
            }

            // Read-only display for other DN columns
            return (
              <TableCell
                key={col.dnName}
                className="py-1.5 px-2 text-right tabular-nums text-xs"
              >
                {currentDnQty > 0 ? (
                  currentDnQty
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
            );
          })}

          {/* New entry column (only when creating, not editing existing) */}
          {showEdit && !editingDnName && (
            <TableCell className="py-1.5 px-2 text-center bg-primary/5">
              <Input
                type="number"
                className="h-7 w-16 text-xs text-center mx-auto"
                value={submitHook.newlyDeliveredQuantities[row.itemId] || ""}
                onChange={(e) =>
                  submitHook.handleNewlyDeliveredChange(
                    row.itemId,
                    e.target.value,
                    row.remainingQty
                  )
                }
                disabled={row.isFullyDelivered}
                max={row.remainingQty}
                min={0}
                placeholder="0"
              />
            </TableCell>
          )}

          {/* Total Received */}
          <TableCell className="py-1.5 px-2 text-right tabular-nums text-xs font-medium">
            {row.totalReceived}
            {row.isFullyDelivered ? (
              <CheckCircle2 className="inline ml-1 h-3 w-3 text-green-600" />
            ) : row.totalReceived > 0 ? (
              <ArrowDown className="inline ml-1 h-3 w-3 text-primary" />
            ) : null}
          </TableCell>
        </TableRow>
      ))}

      {pivotData.rows.length === 0 && (
        <TableRow>
          <TableCell
            colSpan={
              (isProjectManager ? 2 : 3) +
              pivotData.dnColumns.length +
              (showEdit && !editingDnName ? 1 : 0) +
              1
            }
            className="text-center py-8 text-muted-foreground text-sm"
          >
            No items found
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}
