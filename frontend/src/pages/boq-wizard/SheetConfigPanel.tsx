/**
 * SheetConfigPanel -- Section 1 (rows) + Section 2 (areas) config UI (Slice 3c).
 *
 * Persists to BoQ Sheet Draft.sheet_config via set_sheet_config using
 * READ-MODIFY-WRITE. The endpoint is whole-blob replace -- we always merge the
 * full existing blob with the updated Section-1/2 keys before POSTing. Keys
 * owned by later slices (column_role_map, column_headers, etc.) are preserved
 * verbatim across every save.
 *
 * Unconfirmed (sparkle) state: per-field local Set<string>. Seeded all-unconfirmed
 * when an existing config is first loaded (prefill != confirmed). Distinct from the
 * session-scoped Zustand confirmedFields used by BoqMasterPanel.
 *
 * Save trigger: explicit "Save config" button (not per-keystroke), because the
 * read-modify-write is a network round-trip and editing multiple fields then saving
 * once is cleaner than per-field auto-save.
 *
 * Fix notes (Slice 3c-fix):
 * - Persistence fix: setInitialized(true) is now INSIDE the parsedConfig !== null
 *   guard. Previously it fired even when parsedConfig was null (doc not yet loaded),
 *   prematurely locking out the seed step when the doc subsequently arrived.
 * - Sparkle-on-confirm: header-type Select uses onOpenChange on the Select component
 *   to reliably clear the sparkle when the dropdown opens, even when the user
 *   re-selects the same already-active value. The unreliable onClick on SelectTrigger
 *   has been removed in favour of this approach.
 * - Section 2 reshape: Single/Multi toggle (two Buttons, segmented-control style) +
 *   stacked editable text boxes replace the prior chip/Enter-to-add pattern. Toggle
 *   start state is derived from the prefilled area_dimensions: non-empty -> Multi
 *   with boxes pre-filled; empty -> Single. Confirm-as-is for Section 2 is
 *   accomplished by clicking the active toggle button (always fires touch regardless
 *   of whether the mode changes) or by focusing any area-name text box.
 */
import { useState, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import type { ColumnRoleEntry, SheetPreviewRow } from "./boqTypes";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface SheetConfigPanelProps {
  /** BOQs docname -- passed verbatim to endpoint. */
  boqName: string;
  /** Verbatim DB-stored sheet name (already decoded by React Router). */
  sheetName: string;
  /** Existing sheet_config from the BoQ Sheet Draft row. May be null (no config yet). */
  draftConfig: Record<string, unknown> | string | null | undefined;
  /**
   * Lifted column-role map state (Slice 3d-i). Owned by SheetSpokePage so both
   * this panel (Save writes it) and SheetDataGrid (3d-iii reads it) share the same
   * live state. handleSave serializes it back to Record<string,string> for the blob.
   */
  columnRoleMap: Record<string, ColumnRoleEntry>;
  setColumnRoleMap: Dispatch<SetStateAction<Record<string, ColumnRoleEntry>>>;
  /**
   * Preview rows from SheetSpokePage (Slice 3d-i). Passed for the future Section 3
   * column-role list (Slice 3d-ii). Unused in this slice -- accepted for forward compat.
   */
  rows: SheetPreviewRow[];
  /** Called after a successful save to re-fetch the parent BOQs doc. */
  onSaveSuccess: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize the draftConfig prop to a plain object or null. */
function parseConfig(
  raw: Record<string, unknown> | string | null | undefined
): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
  return raw;
}

/** Parse a comma-separated string of integers into number[]. Drops non-numeric tokens. */
function parseIntList(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SheetConfigPanel({
  boqName,
  sheetName,
  draftConfig,
  columnRoleMap,
  // setColumnRoleMap and rows are accepted for Slice 3d-ii (Section 3 UI) but
  // not yet consumed in this slice. Included in the interface for type safety.
  onSaveSuccess,
}: SheetConfigPanelProps) {
  // Normalize to a plain object once per draftConfig change
  const parsedConfig = useMemo(() => parseConfig(draftConfig), [draftConfig]);

  // Whether values were pre-filled from an existing config.
  // Used to gate sparkle display (sparkle only when pre-filled and unconfirmed).
  const hasPrefill =
    parsedConfig !== null && Object.keys(parsedConfig).length > 0;

  // ── Section 1 local state ─────────────────────────────────────────────────
  const [hrc, setHrc] = useState<1 | 2>(1);
  const [headerRow, setHeaderRow] = useState<string>(""); // controlled as string; parsed on save
  const [topHeaderInput, setTopHeaderInput] = useState<string>(""); // comma-sep row numbers; shown only when hrc=2
  const [skipRowsInput, setSkipRowsInput] = useState<string>(""); // comma-sep row numbers

  // ── Section 2 local state ─────────────────────────────────────────────────
  // isMulti: false = single-area sheet (area_dimensions: []), true = multi-area.
  // areaBoxes: one editable text box per area name, shown only in multi mode.
  // Always holds at least one element so Single->Multi flip shows a ready input.
  const [isMulti, setIsMulti] = useState<boolean>(false);
  const [areaBoxes, setAreaBoxes] = useState<string[]>([""]);

  // ── Confirm state (per-field, local to this panel) ────────────────────────
  // seeded empty (all unconfirmed) when config is first loaded from server.
  const [confirmedFields, setConfirmedFields] = useState<Set<string>>(
    () => new Set()
  );

  // ── Save state ────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Initialization ────────────────────────────────────────────────────────
  // Runs once when parsedConfig first becomes non-null (boq doc loaded).
  // setInitialized(true) is INSIDE the non-null guard -- if parsedConfig is
  // null (doc not yet fetched), we do NOT mark initialized so the effect will
  // re-run and seed state once real data arrives.
  // Guarded so a later mutate() re-fetch does NOT reset the user's in-progress
  // edits. The component is keyed by sheetName in the parent so it remounts
  // fresh on sheet navigation.
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    if (parsedConfig !== null) {
      const cfg = parsedConfig;
      setHrc(cfg.header_row_count === 2 ? 2 : 1);
      setHeaderRow(
        typeof cfg.header_row === "number" ? String(cfg.header_row) : ""
      );
      if (Array.isArray(cfg.top_header_rows_override)) {
        setTopHeaderInput(
          (cfg.top_header_rows_override as number[]).join(", ")
        );
      }
      if (Array.isArray(cfg.skip_top_rows_after_header)) {
        setSkipRowsInput(
          (cfg.skip_top_rows_after_header as number[]).join(", ")
        );
      }
      const detectedAreas = Array.isArray(cfg.area_dimensions)
        ? (cfg.area_dimensions as string[])
        : [];
      setIsMulti(detectedAreas.length > 0);
      setAreaBoxes(detectedAreas.length > 0 ? [...detectedAreas] : [""]);
      setConfirmedFields(new Set()); // all fields unconfirmed on first load
      setInitialized(true); // only fires when real config data is present
    }
    // When parsedConfig is null (doc still loading), leave initialized=false
    // so the effect re-runs when parsedConfig becomes non-null.
  }, [parsedConfig, initialized]);

  const { call: callSetConfig } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_config"
  );

  // ── Confirm helpers ───────────────────────────────────────────────────────

  const touch = (key: string) => {
    setConfirmedFields((prev) => new Set([...prev, key]));
  };

  /**
   * Returns true when the field should display the sparkle + opacity-50 treatment:
   * an existing config was loaded (hasPrefill), the user has NOT yet touched this
   * field (not confirmed), and the field has a meaningful value.
   */
  const isUnconfirmed = (key: string, hasValue: boolean) =>
    hasPrefill && !confirmedFields.has(key) && hasValue;

  // ── Derived values ────────────────────────────────────────────────────────

  const headerRowNum = parseInt(headerRow, 10);
  // Data-start row is always DERIVED (no backing field in SheetConfig).
  const dataStartRow = !isNaN(headerRowNum) ? headerRowNum + hrc : null;

  // ── Save (read-modify-write) ──────────────────────────────────────────────

  const handleSave = async () => {
    if (isSaving) return; // single-flight guard
    setIsSaving(true);
    setSaveError(null);
    try {
      // Start from the full existing blob so we preserve every key we don't own
      // (column_role_map, column_headers, sheet_name, skip, treat_as, etc.).
      const existing = parsedConfig ?? {};

      const topRows =
        hrc === 2 ? parseIntList(topHeaderInput) : ([] as number[]);

      const updated: Record<string, unknown> = {
        ...existing,
        // Section 1 keys only
        header_row_count: hrc,
        header_row: !isNaN(headerRowNum) ? headerRowNum : null,
        top_header_rows_override:
          topRows.length > 0 ? topRows : null,
        skip_top_rows_after_header: parseIntList(skipRowsInput),
        // Section 2: write non-empty box values for multi-area, empty array for single.
        area_dimensions: isMulti
          ? areaBoxes.filter((s) => s.trim() !== "")
          : [],
        // column_role_map: explicitly written from the lifted state (Slice 3d-i) so
        // it is never silently dropped by the ...existing spread. Serialized back to
        // Record<string,string> for the backend blob (area is wizard-only, not stored).
        column_role_map: Object.fromEntries(
          Object.entries(columnRoleMap).map(([col, entry]) => [col, entry.role])
        ),
      };

      await callSetConfig({
        boq_name: boqName,
        sheet_name: sheetName,
        sheet_config: JSON.stringify(updated),
      });

      // All Section-1/2 fields are now confirmed (user reviewed and saved them).
      setConfirmedFields(
        new Set([
          "header_row_count",
          "header_row",
          "top_header_rows_override",
          "skip_top_rows_after_header",
          "area_dimensions",
        ])
      );

      onSaveSuccess();
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : "Save failed. Please try again.";
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-5">

      {/* ── Section 1: Rows ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground leading-none">
          Section 1 — Rows
        </h3>

        {/* Header type (1 or 2 row) */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Header type
            {isUnconfirmed("header_row_count", true) && (
              <span
                className="ml-0.5 text-sm"
                aria-label="Pre-filled -- open dropdown to confirm"
              >
                ✨
              </span>
            )}
          </Label>
          {/*
            onOpenChange clears sparkle when the dropdown opens -- fires
            reliably even when the user re-selects the already-active value.
            onValueChange fires on an actual value change and updates hrc.
          */}
          <Select
            value={String(hrc)}
            onOpenChange={(open) => {
              if (open) touch("header_row_count");
            }}
            onValueChange={(v) => {
              touch("header_row_count");
              setHrc(v === "2" ? 2 : 1);
            }}
          >
            <SelectTrigger
              className={cn(
                "w-52",
                isUnconfirmed("header_row_count", true) && "opacity-50"
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Single (1 row)</SelectItem>
              <SelectItem value="2">Double (2 rows)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Header row number */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Header row
            {hrc === 2 && (
              <span className="text-xs font-normal text-muted-foreground ml-1">
                (bottom header row)
              </span>
            )}
            {isUnconfirmed("header_row", headerRow !== "") && (
              <span
                className="ml-0.5 text-sm"
                aria-label="Pre-filled -- click to confirm"
              >
                ✨
              </span>
            )}
          </Label>
          <Input
            type="number"
            min={1}
            value={headerRow}
            placeholder="e.g. 7"
            className={cn(
              "w-32",
              isUnconfirmed("header_row", headerRow !== "") && "opacity-50"
            )}
            onFocus={() => touch("header_row")}
            onClick={() => touch("header_row")}
            onChange={(e) => {
              touch("header_row");
              setHeaderRow(e.target.value);
            }}
          />
        </div>

        {/* Top header row(s) -- SITUATIONAL: only when hrc=2 */}
        {hrc === 2 && (
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              Top header row(s)
              <span className="text-xs font-normal text-muted-foreground ml-1">
                (if non-contiguous)
              </span>
              {isUnconfirmed(
                "top_header_rows_override",
                topHeaderInput !== ""
              ) && (
                <span
                  className="ml-0.5 text-sm"
                  aria-label="Pre-filled -- click to confirm"
                >
                  ✨
                </span>
              )}
            </Label>
            <Input
              value={topHeaderInput}
              placeholder="e.g. 2 (leave blank if rows are adjacent)"
              className={cn(
                "w-64",
                isUnconfirmed(
                  "top_header_rows_override",
                  topHeaderInput !== ""
                ) && "opacity-50"
              )}
              onFocus={() => touch("top_header_rows_override")}
              onClick={() => touch("top_header_rows_override")}
              onChange={(e) => {
                touch("top_header_rows_override");
                setTopHeaderInput(e.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated row numbers. Leave blank when both header rows are
              adjacent (e.g. rows 6 and 7).
            </p>
          </div>
        )}

        {/* Data start row -- READ-ONLY derived (no backing field in SheetConfig) */}
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs">
            Data start row
          </Label>
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground w-32">
            {dataStartRow !== null ? dataStartRow : "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            Derived: header row + header row count. Read-only.
          </p>
        </div>

        {/* Skip rows after header */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Skip rows after header
            <span className="text-xs font-normal text-muted-foreground ml-1">
              (situational)
            </span>
            {isUnconfirmed(
              "skip_top_rows_after_header",
              skipRowsInput !== ""
            ) && (
              <span
                className="ml-0.5 text-sm"
                aria-label="Pre-filled -- click to confirm"
              >
                ✨
              </span>
            )}
          </Label>
          <Input
            value={skipRowsInput}
            placeholder="e.g. 8, 9 (usually blank)"
            className={cn(
              "w-64",
              isUnconfirmed(
                "skip_top_rows_after_header",
                skipRowsInput !== ""
              ) && "opacity-50"
            )}
            onFocus={() => touch("skip_top_rows_after_header")}
            onClick={() => touch("skip_top_rows_after_header")}
            onChange={(e) => {
              touch("skip_top_rows_after_header");
              setSkipRowsInput(e.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated absolute row numbers to exclude. Non-numeric entries
            are ignored.
          </p>
        </div>
      </div>

      {/* ── Section 2: Areas ────────────────────────────────────────────── */}
      <div className="space-y-4 pt-3 border-t border-border">
        <h3 className="text-sm font-semibold text-foreground leading-none flex items-center gap-1">
          Section 2 — Areas
          {/* Sparkle shows when multi-area was auto-detected and not yet confirmed */}
          {isUnconfirmed("area_dimensions", isMulti) && (
            <span
              className="text-sm"
              aria-label="Pre-filled -- interact to confirm"
            >
              ✨
            </span>
          )}
        </h3>

        {/*
          Single/Multi toggle -- segmented-control style using two Buttons.
          Clicking either button always calls touch("area_dimensions"), so
          re-clicking the already-active button is a valid confirm-as-is gesture.
          The opacity-50 unconfirmed treatment is applied to the whole area below
          the heading (not per-element) to avoid compounding opacity on nested nodes.
        */}
        <div className={cn("space-y-3", isUnconfirmed("area_dimensions", isMulti) && "opacity-50")}>
          <div className="flex rounded-md border border-border overflow-hidden w-fit">
            <Button
              type="button"
              size="sm"
              variant={!isMulti ? "default" : "ghost"}
              className="rounded-none"
              onClick={() => {
                touch("area_dimensions");
                setIsMulti(false);
              }}
            >
              Single area
            </Button>
            <Button
              type="button"
              size="sm"
              variant={isMulti ? "default" : "ghost"}
              className="rounded-none border-l border-border"
              onClick={() => {
                touch("area_dimensions");
                if (!isMulti && areaBoxes.every((s) => s.trim() === "")) {
                  setAreaBoxes([""]);
                }
                setIsMulti(true);
              }}
            >
              Multi area
            </Button>
          </div>

          {/* Multi mode: stacked editable text boxes, one per area name */}
          {isMulti && (
            <div className="space-y-2">
              {areaBoxes.map((val, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={val}
                    placeholder={`Area name ${i + 1}`}
                    className="max-w-64"
                    onFocus={() => touch("area_dimensions")}
                    onChange={(e) => {
                      touch("area_dimensions");
                      setAreaBoxes((prev) =>
                        prev.map((v, idx) => (idx === i ? e.target.value : v))
                      );
                    }}
                  />
                  {/* Remove button only visible when there are 2+ boxes */}
                  {areaBoxes.length > 1 && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive focus:outline-none"
                      aria-label={`Remove area ${i + 1}`}
                      onClick={() => {
                        touch("area_dimensions");
                        setAreaBoxes((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        );
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  touch("area_dimensions");
                  setAreaBoxes((prev) => [...prev, ""]);
                }}
              >
                + Add area
              </Button>
            </div>
          )}

          {/* Single mode: informational hint */}
          {!isMulti && (
            <p className="text-xs text-muted-foreground">
              Single-area sheet. Switch to Multi area to name areas for
              column-role assignment.
            </p>
          )}
        </div>
      </div>

      {/* ── Save action ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-3 border-t border-border">
        <Button size="sm" disabled={isSaving} onClick={handleSave}>
          {isSaving && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          )}
          Save config
        </Button>
        {saveError && (
          <p className="text-xs text-destructive">{saveError}</p>
        )}
      </div>
    </div>
  );
}
