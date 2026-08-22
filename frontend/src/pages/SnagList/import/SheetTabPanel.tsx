/**
 * Snag import wizard -- STEP 3, the contents of ONE tab.
 *
 * A tab is a complete, independent unit: batch name + header row + column mapping + parsed
 * preview. It holds NO state of its own beyond the collapsibles inside `PreviewPanel` --
 * everything that must survive a tab switch lives in the dialog's `Record<sheetName, TabState>`,
 * because Radix `TabsContent` unmounts the inactive panels.
 *
 * The COLUMN LIST rendered here is `state.columns`, NEVER `sheet.columns`. The two are equal
 * only until the header row is overridden: from then on the authoritative list is the one
 * `get_sheet_columns` recomputed for the header row actually used, and `sheet.columns` is
 * stale. (R3.1: it used to come from `parse_preview`, which cannot run until a Description is
 * mapped -- which is why overriding the header row on a sheet with empty selects did nothing.)
 */

import { AlertTriangle, Loader2, Wand2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SnagColumnMapping, WorkbookSheet } from "../types";
import { ColumnMappingFields } from "./ColumnMappingFields";
import { PreviewPanel } from "./PreviewPanel";
import {
  headerRowInputValue,
  isMappingValid,
  parseHeaderRowInput,
  type TabState,
} from "./importState";

export interface SheetTabPanelProps {
  sheet: WorkbookSheet;
  state: TabState;
  onBatchNameChange: (sheetName: string, value: string) => void;
  onHeaderRowChange: (sheetName: string, headerRow: number | null) => void;
  onMappingChange: (sheetName: string, mapping: SnagColumnMapping) => void;
  onToggleRow: (sheetName: string, sourceRow: number) => void;
  onSetRows: (sheetName: string, rows: number[], ticked: boolean) => void;
}

export function SheetTabPanel({
  sheet,
  state,
  onBatchNameChange,
  onHeaderRowChange,
  onMappingChange,
  onToggleRow,
  onSetRows,
}: SheetTabPanelProps) {
  const batchInputId = `snag-batch-${sheet.name}`;
  const headerInputId = `snag-header-row-${sheet.name}`;
  const mappingOk = isMappingValid(state.mapping, state.columns);
  // What the preview ACTUALLY used, once one has landed -- the input can be ahead of it for
  // the debounce window, and after a blank override the server falls back to its own guess.
  const effectiveHeaderRow = state.preview ? state.preview.header_row : state.headerRow;

  return (
    <div className="space-y-4">
      {/* a) batch name ------------------------------------------------------- */}
      <div className="space-y-1.5">
        <Label htmlFor={batchInputId} className="text-xs">
          Batch name
        </Label>
        <Input
          id={batchInputId}
          value={state.batchName}
          maxLength={140}
          placeholder="Name this batch"
          onChange={(e) => onBatchNameChange(sheet.name, e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Shown on every snag imported from this sheet. Editable now and later.
        </p>
      </div>

      {/* b) header row + column mapping --------------------------------------- */}
      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={headerInputId} className="text-xs">
              Header row
            </Label>
            <Input
              id={headerInputId}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className="h-9 w-28"
              value={headerRowInputValue(state.headerRow)}
              placeholder="Auto"
              onChange={(e) =>
                onHeaderRowChange(sheet.name, parseHeaderRowInput(e.target.value))
              }
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            {sheet.header_row === null && state.headerRow === null ? (
              <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" />
                No header row detected — type the Excel row number, or map the columns by hand
              </span>
            ) : (
              <p className="text-xs text-muted-foreground">
                {effectiveHeaderRow === null
                  ? "No header row — columns are listed by letter."
                  : `Reading column names from Excel row ${effectiveHeaderRow}.`}{" "}
                Rows at or above it are not imported.
                {sheet.header_row !== null &&
                  state.headerRow !== sheet.header_row &&
                  ` Auto-detected ${sheet.header_row}.`}
              </p>
            )}
            {state.columnsLoading && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                Reading column names…
              </p>
            )}
            {state.columnsError && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {state.columnsError} The columns below are still the ones from the previous
                  header row.
                </span>
              </p>
            )}
            {state.mappingReguessed && (
              <p className="flex items-start gap-1.5 text-xs text-blue-700 dark:text-blue-400">
                <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  The header row changed, so the column mapping was re-guessed from the new
                  header. Check it before importing.
                </span>
              </p>
            )}
            {/* The counterpart note. A silent KEEP reads as "nothing happened" exactly as a
                silent reset read as a bug -- and it is the difference between the mapping you
                chose and one the machine chose, so it has to be said out loud. */}
            {state.mappingKeptNoGuess && (
              <p className="flex items-start gap-1.5 text-xs text-blue-700 dark:text-blue-400">
                <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  The header row changed, but nothing in it looked like a column name — your
                  existing mapping was kept. Check it against the new column list.
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">Column mapping</h4>
          <ColumnMappingFields
            sheetName={sheet.name}
            columns={state.columns}
            mapping={state.mapping}
            onChange={(next) => onMappingChange(sheet.name, next)}
          />
        </div>
      </div>

      {/* c) preview ---------------------------------------------------------- */}
      <PreviewPanel
        preview={state.preview}
        loading={state.previewLoading}
        error={state.previewError}
        mappingValid={mappingOk}
        ticked={state.ticked}
        onToggleRow={(row) => onToggleRow(sheet.name, row)}
        onSetRows={(rows, ticked) => onSetRows(sheet.name, rows, ticked)}
      />
    </div>
  );
}
