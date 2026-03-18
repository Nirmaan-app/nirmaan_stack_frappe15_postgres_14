import { useMemo } from "react";
import { TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Printer, RotateCcw,PrinterCheck } from "lucide-react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { formatDate } from "@/utils/FormatDate";
import { cn } from "@/lib/utils";
import { DNColumn, PivotData } from "./types";

const USERS_LIST_PARAMS = { fields: ["name", "full_name"] as ("name" | "full_name")[], limit: 0 };

interface PivotTableHeaderProps {
  pivotData: PivotData;
  showEdit: boolean;
  onDownloadDN: (deliveryDate?: string, noteNo?: string | number) => Promise<void>;
  onOpenVendorDC?: (col: DNColumn) => void;
  isProjectManager?: boolean;
  // Edit DN props
  editingDnName?: string | null;
  canEditDn?: (col: DNColumn) => boolean;
  onEditDn?: (col: DNColumn) => void;
  viewMode?: "create" | "view-only" | "full";
  showReturn?: boolean;
  hideTotalReceived?: boolean;
}

export function PivotTableHeader({
  pivotData,
  showEdit,
  onDownloadDN,
  onOpenVendorDC,
  isProjectManager = false,
  editingDnName,
  canEditDn,
  onEditDn,
  viewMode = "full",
  showReturn = false,
  hideTotalReceived = false,
}: PivotTableHeaderProps) {
  const { data: usersList } = useFrappeGetDocList<NirmaanUsers>(
    "Nirmaan Users",
    USERS_LIST_PARAMS
  );

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    usersList?.forEach((u) => map.set(u.name, u.full_name));
    return map;
  }, [usersList]);

  return (
    <TableHeader>
      {/* Main column headers */}
      <TableRow className="bg-muted/50">
        <TableHead className="sticky left-0 z-30 bg-muted min-w-[140px] sm:min-w-[180px] text-xs font-medium uppercase tracking-wider text-muted-foreground shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
          Item
        </TableHead>
        <TableHead className="bg-muted/50 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground w-[50px] sm:w-[60px]">
          Unit
        </TableHead>
        {!isProjectManager && (
          <TableHead className="bg-muted/50 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground w-[70px] sm:w-[80px]">
            Ordered
          </TableHead>
        )}

        {/* Dynamic DN columns — hidden in "create" mode */}
        {viewMode !== "create" &&
          pivotData.dnColumns.map((col) => {
            const isEditing = editingDnName === col.dnName;
            const showEditBtn =
              viewMode === "full" && canEditDn?.(col) && !editingDnName;
            const userName = col.updatedBy
              ? userNameMap.get(col.updatedBy)
              : undefined;

            return (
              <TableHead
                key={col.dnName}
                className={cn(
                  "text-right text-xs font-medium text-muted-foreground min-w-[80px] sm:min-w-[100px]",
                  isEditing && "bg-primary/5",
                  col.isReturn && !isEditing && "bg-red-50/50 dark:bg-red-950/20"
                )}
              >
                <div className="flex flex-col items-end gap-0.5 py-0.5">
                  <span className={cn(
                    "uppercase tracking-wider font-semibold",
                    col.isReturn ? "text-red-700 dark:text-red-400" : "text-foreground/80"
                  )}>
                    {col.isReturn ? "RN" : "DN"}-{col.noteNo}
                  </span>
                  {col.isReturn && <RotateCcw className="h-3 w-3 inline ml-0.5" />}
                  <span className={cn(
                    "text-[10px] font-normal border-b pb-0.5",
                    col.isReturn ? "border-red-300/50" : "border-primary/30"
                  )}>
                    {formatDate(col.deliveryDate)}
                  </span>
                  {userName && (
                    <span
                      className="hidden sm:inline text-[10px] text-muted-foreground truncate max-w-[100px]"
                      title={userName}
                    >
                      by {userName.split(" ")[0]}
                    </span>
                  )}
                  <div className="flex items-center gap-0.5 mt-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => onDownloadDN(col.deliveryDate, col.noteNo)}
                        >
                          <Printer className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download {col.isReturn ? "RN" : "DN"}-{col.noteNo}</TooltipContent>
                    </Tooltip>
                    {showEditBtn && (
                      <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-foreground"
                            onClick={() => onEditDn?.(col)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit {col.isReturn ? "RN" : "DN"}-{col.noteNo}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-foreground"
                            onClick={() => onOpenVendorDC?.(col)}
                          >
                            <PrinterCheck className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Vendor Delivery Challan {col.isReturn ? "RN" : "DN"}-{col.noteNo}</TooltipContent>
                      </Tooltip>
                      </>
                    )}
                  </div>
                </div>
              </TableHead>
            );
          })}

        {/* Edit column (inline new entry) — only show when creating, not editing existing */}
        {showEdit && !editingDnName && (
          <TableHead className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground bg-primary/5 min-w-[70px] sm:min-w-[80px]">
            New Entry
          </TableHead>
        )}

        {/* Return entry column header */}
        {showReturn && !editingDnName && (
          <TableHead className="text-center text-xs font-medium uppercase tracking-wider text-red-700 dark:text-red-400 bg-red-50/30 dark:bg-red-950/10 min-w-[70px] sm:min-w-[80px]">
            Return
          </TableHead>
        )}

        {/* Total received column */}
        {!hideTotalReceived && (
          <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground min-w-[80px] sm:min-w-[90px]">
            <div className="flex flex-col items-end gap-1 px-1">
              <span>Total Received</span>
            </div>
          </TableHead>
        )}
      </TableRow>
    </TableHeader>
  );
}
