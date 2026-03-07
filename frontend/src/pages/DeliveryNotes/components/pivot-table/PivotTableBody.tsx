import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { CheckCircle2, ArrowDown, MessageCircleMore, AlertTriangle } from "lucide-react";
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
  viewMode?: "create" | "view-only" | "full";
  // Return entry props
  showReturn?: boolean;
  returnHook?: {
    returnQuantities: Record<string, string>;
    handleReturnQuantityChange: (itemKey: string, value: string, maxAllowed: number) => void;
  };
}

export function PivotTableBody({
  pivotData,
  showEdit,
  submitHook,
  isProjectManager = false,
  editingDnName,
  editedQuantities,
  onEditQuantityChange,
  viewMode = "full",
  showReturn = false,
  returnHook,
}: PivotTableBodyProps) {
  return (
    <TableBody>
      {pivotData.rows.map((row) => (
        <TableRow
          key={row.itemId}
          className={cn(
            viewMode !== "create" &&
              row.isOverDelivered
                ? "bg-amber-50 dark:bg-amber-950/30"
                : viewMode !== "create" && row.isFullyDelivered
                  ? "bg-green-50 dark:bg-green-950/30"
                  : undefined
          )}
        >
          {/* Sticky: Item Name */}
          <TableCell
            className={cn(
              "sticky left-0 z-20 py-1.5 px-1.5 sm:px-2 max-w-[140px] sm:max-w-[180px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]",
              viewMode !== "create" && row.isOverDelivered
                ? "bg-amber-50 dark:bg-amber-950/30"
                : viewMode !== "create" && row.isFullyDelivered
                  ? "bg-green-50 dark:bg-green-950/30"
                  : "bg-background"
            )}
          >
            <div className="text-sm line-clamp-2 break-words">
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

          {/* Unit */}
          <TableCell className="py-1.5 px-1.5 sm:px-2 text-center text-xs">
            {row.unit}
          </TableCell>

          {/* Ordered Qty */}
          {!isProjectManager && (
            <TableCell className="py-1.5 px-1.5 sm:px-2 text-right tabular-nums text-xs">
              {row.orderedQty}
            </TableCell>
          )}

          {/* Dynamic DN quantity columns — hidden in "create" mode */}
          {viewMode !== "create" && pivotData.dnColumns.map((col) => {
            const isEditingThisCol = editingDnName === col.dnName;
            const currentDnQty = row.dnQuantities[col.dnName] ?? 0;

            if (isEditingThisCol) {
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
                        Infinity
                      )
                    }
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
                className={cn(
                  "py-1.5 px-2 text-right tabular-nums text-xs",
                  col.isReturn && "bg-red-50/30 dark:bg-red-950/10"
                )}
              >
                {currentDnQty !== 0 ? (
                  <span className={cn(currentDnQty < 0 && "text-red-600 dark:text-red-400")}>
                    {currentDnQty}
                  </span>
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
                    Infinity
                  )
                }
                min={0}
                placeholder="0"
              />
            </TableCell>
          )}

          {/* Return entry column */}
          {showReturn && !editingDnName && (
            <TableCell className="py-1.5 px-2 text-center bg-red-50/30 dark:bg-red-950/10">
              <Input
                type="number"
                className="h-7 w-16 text-xs text-center mx-auto"
                value={returnHook?.returnQuantities[row.itemId] || ""}
                onChange={(e) =>
                  returnHook?.handleReturnQuantityChange(
                    row.itemId,
                    e.target.value,
                    row.totalReceived
                  )
                }
                disabled={row.totalReceived <= 0}
                max={row.totalReceived}
                min={0}
                placeholder="0"
              />
            </TableCell>
          )}

          {/* Total Received */}
          <TableCell className="py-1.5 px-2 text-right tabular-nums text-xs font-medium">
            {row.totalReceived}
            {viewMode !== "create" && (
              row.isOverDelivered ? (
                <AlertTriangle className="inline ml-1 h-3 w-3 text-amber-600" />
              ) : row.isFullyDelivered ? (
                <CheckCircle2 className="inline ml-1 h-3 w-3 text-green-600" />
              ) : row.totalReceived > 0 ? (
                <ArrowDown className="inline ml-1 h-3 w-3 text-primary" />
              ) : null
            )}
          </TableCell>
        </TableRow>
      ))}

      {pivotData.rows.length === 0 && (
        <TableRow>
          <TableCell
            colSpan={
              (isProjectManager ? 2 : 3) +
              (viewMode !== "create" ? pivotData.dnColumns.length : 0) +
              (showEdit && !editingDnName ? 1 : 0) +
              (showReturn && !editingDnName ? 1 : 0) +
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
