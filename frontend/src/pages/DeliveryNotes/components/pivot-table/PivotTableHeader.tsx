import { useMemo } from "react";
import { TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Printer } from "lucide-react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { formatDate } from "@/utils/FormatDate";
import { cn } from "@/lib/utils";
import { DNColumn, PivotData } from "./types";

const USERS_LIST_PARAMS = { fields: ["name", "full_name"] as ("name" | "full_name")[], limit: 0 };

interface PivotTableHeaderProps {
  pivotData: PivotData;
  showEdit: boolean;
  onDownloadDN: (deliveryDate?: string) => Promise<void>;
  isProjectManager?: boolean;
  // Edit DN props
  editingDnName?: string | null;
  canEditDn?: (col: DNColumn) => boolean;
  onEditDn?: (col: DNColumn) => void;
}

export function PivotTableHeader({
  pivotData,
  showEdit,
  onDownloadDN,
  isProjectManager = false,
  editingDnName,
  canEditDn,
  onEditDn,
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
        <TableHead className="sticky left-0 z-30 bg-muted/50 min-w-[180px] text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Item
        </TableHead>
        <TableHead
          className={`sticky left-[180px] z-30 bg-muted/50 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground w-[60px] ${isProjectManager ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]" : ""}`}
        >
          Unit
        </TableHead>
        {!isProjectManager && (
          <TableHead className="sticky left-[240px] z-30 bg-muted/50 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground w-[80px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
            Ordered
          </TableHead>
        )}

        {/* Dynamic DN columns */}
        {pivotData.dnColumns.map((col) => {
          const isEditing = editingDnName === col.dnName;
          const showEditBtn = canEditDn?.(col) && !editingDnName;
          const userName = col.updatedBy
            ? userNameMap.get(col.updatedBy)
            : undefined;

          return (
            <TableHead
              key={col.dnName}
              className={cn(
                "text-center text-xs font-medium text-muted-foreground min-w-[100px]",
                isEditing && "bg-primary/5"
              )}
            >
              <div className="flex flex-col items-center gap-0.5 py-0.5">
                <span className="uppercase tracking-wider font-semibold text-foreground/80">
                  DN-{col.noteNo}
                </span>
                <span className="text-[10px] font-normal border-b border-primary/30 pb-0.5">
                  {formatDate(col.deliveryDate)}
                </span>
                {userName && (
                  <span
                    className="text-[10px] text-muted-foreground truncate max-w-[100px]"
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
                        onClick={() => onDownloadDN(col.deliveryDate)}
                      >
                        <Printer className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Download DN-{col.noteNo}</TooltipContent>
                  </Tooltip>
                  {showEditBtn && (
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
                      <TooltipContent>Edit DN-{col.noteNo}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </TableHead>
          );
        })}

        {/* Edit column (inline new entry) — only show when creating, not editing existing */}
        {showEdit && !editingDnName && (
          <TableHead className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground bg-primary/5 min-w-[80px]">
            New Entry
          </TableHead>
        )}

        {/* Total received column */}
        <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground min-w-[90px]">
          Total Received
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}
