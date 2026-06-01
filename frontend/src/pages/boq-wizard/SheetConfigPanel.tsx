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
 */
import { useState, useEffect, useMemo } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
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
  const [areas, setAreas] = useState<string[]>([]);
  const [areaInput, setAreaInput] = useState<string>("");

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
  // Guarded by initialized flag so a later mutate() re-fetch does NOT reset
  // the user's in-progress edits. The component is keyed by sheetName in the
  // parent so it remounts fresh on sheet navigation.
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
      if (Array.isArray(cfg.area_dimensions)) {
        setAreas(cfg.area_dimensions as string[]);
      }
      setConfirmedFields(new Set()); // all fields unconfirmed on first load
    }
    // Both null (no existing config) and non-null paths mark initialized.
    setInitialized(true);
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
        // Section 2 keys only
        area_dimensions: areas,
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
                aria-label="Pre-filled -- click to confirm"
              >
                ✨
              </span>
            )}
          </Label>
          <Select
            value={String(hrc)}
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
              onClick={() => touch("header_row_count")}
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
        <h3 className="text-sm font-semibold text-foreground leading-none">
          Section 2 — Areas
        </h3>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Area names
            <span className="text-xs font-normal text-muted-foreground ml-1">
              (leave empty for single-area sheet)
            </span>
            {isUnconfirmed("area_dimensions", areas.length > 0) && (
              <span
                className="ml-0.5 text-sm"
                aria-label="Pre-filled -- click to confirm"
              >
                ✨
              </span>
            )}
          </Label>

          {/* Badge list of existing areas */}
          {areas.length > 0 && (
            <div
              className={cn(
                "flex flex-wrap gap-1.5",
                isUnconfirmed("area_dimensions", areas.length > 0) &&
                  "opacity-50"
              )}
            >
              {areas.map((area, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-sm font-medium border border-border"
                >
                  {area}
                  <button
                    type="button"
                    className="ml-0.5 text-muted-foreground hover:text-destructive focus:outline-none"
                    aria-label={`Remove area ${area}`}
                    onClick={() => {
                      touch("area_dimensions");
                      setAreas((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Add-area input */}
          <div className="flex gap-2 items-center">
            <Input
              value={areaInput}
              placeholder="Area name, e.g. PHASE-1 — press Enter to add"
              className="max-w-72"
              onChange={(e) => setAreaInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && areaInput.trim()) {
                  e.preventDefault();
                  touch("area_dimensions");
                  setAreas((prev) => [...prev, areaInput.trim()]);
                  setAreaInput("");
                }
              }}
            />
          </div>

          {areas.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Single-area sheet. Add area names above for multi-area column
              assignment.
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
