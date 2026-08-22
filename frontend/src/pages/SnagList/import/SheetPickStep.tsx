/**
 * Snag import wizard -- STEP 2: pick the worksheets to import.
 *
 * An EMPTY sheet is disabled with its reason shown; a sheet with no detected header row is
 * tickable but warns, because the user can still map its columns by hand.
 */

import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { WorkbookSheet } from "../types";

export interface SheetPickStepProps {
  fileName: string;
  sheets: WorkbookSheet[];
  selection: Record<string, boolean>;
  onToggle: (sheetName: string, next: boolean) => void;
}

export function SheetPickStep({
  fileName,
  sheets,
  selection,
  onToggle,
}: SheetPickStepProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{fileName}</span> — choose the
        worksheets to import. Each one becomes its own batch.
      </p>

      <ul className="divide-y rounded-md border border-border">
        {sheets.map((sheet) => {
          const disabled = sheet.is_empty;
          const checked = !disabled && !!selection[sheet.name];
          const noHeader = !disabled && sheet.header_row === null;
          const inputId = `snag-sheet-${sheet.name}`;
          return (
            <li
              key={sheet.name}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5",
                disabled && "bg-muted/30",
              )}
            >
              <Checkbox
                id={inputId}
                className="mt-0.5"
                checked={checked}
                disabled={disabled}
                onCheckedChange={(v) => onToggle(sheet.name, v === true)}
              />
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={inputId}
                  className={cn(
                    "flex flex-wrap items-center gap-2 text-sm font-medium",
                    disabled ? "text-muted-foreground" : "cursor-pointer text-foreground",
                  )}
                >
                  <span className="truncate">{sheet.name}</span>
                  <Badge variant="secondary" className="font-normal">
                    {sheet.row_count} {sheet.row_count === 1 ? "row" : "rows"}
                  </Badge>
                  {disabled && (
                    <span className="text-xs font-normal text-muted-foreground">empty</span>
                  )}
                </label>

                {noHeader && (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                    <span>
                      No header row found — you&apos;ll need to map the columns by hand.
                    </span>
                  </p>
                )}
                {!disabled && !noHeader && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Header row {sheet.header_row}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
