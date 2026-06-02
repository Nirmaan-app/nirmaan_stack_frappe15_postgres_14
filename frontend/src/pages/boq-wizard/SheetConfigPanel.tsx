/**
 * SheetConfigPanel -- Section 1 (rows) + Section 2 (areas) + Section 3 (column roles).
 *
 * Section 3 (Slice 3d-ii): pure add-rows list for column-role mapping. Each row maps
 * one Excel column letter to a role (+ optional area for the 8 area-compatible roles).
 * Reads/writes the lifted columnRoleMap prop (owned by SheetSpokePage) -- no separate
 * local state for the persisted map. Transient "pending" rows (column not yet chosen)
 * are held in local pendingRows state and merge into columnRoleMap on column selection.
 *
 * column_role_map save shape (corrected from 3d-i): {role, area} objects, not strings.
 *   - Non-area-compatible roles always get area: null (never a value).
 *   - 4 *_by_area roles require area (flagged in UI); save proceeds with null if empty.
 *
 * Persists to BoQ Sheet Draft.sheet_config via set_sheet_config READ-MODIFY-WRITE.
 * Keys owned by later slices are preserved verbatim across every save.
 *
 * Sparkle/confirm:
 * - S1/S2: per-field key in confirmedFields Set (seeded empty on first load).
 * - S3: single key "column_role_map"; cleared on any S3 interaction; re-set after save.
 *   Cross-section reactivity re-removes "column_role_map" from confirmedFields when an
 *   area referenced by a mapped column is renamed/removed in Section 2 (area is cleared
 *   from that entry, user must re-assign).
 *
 * Fix notes (Slice 3c-fix):
 * - Persistence fix: setInitialized(true) is now INSIDE the parsedConfig !== null guard.
 * - Sparkle-on-confirm: header-type Select uses onOpenChange on the Select component.
 * - Section 2 reshape: Single/Multi toggle + stacked text boxes.
 */
import {
  useState, useEffect, useMemo, useRef,
  type Dispatch, type SetStateAction,
} from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import type { ColumnRoleEntry, SheetPreviewRow } from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Role vocabulary ───────────────────────────────────────────────────────────
// 21 roles from config.py (qty_by_area excluded -- deprecated).
// Values are the exact strings the parser expects; labels are friendly display names.

// Group structure is authoritative here; labels derive from the shared ROLE_LABELS
// constant in boqTypes.ts so SheetConfigPanel and SheetDataGrid badges stay in sync.
const ROLES_BY_GROUP: { group: string; roles: { value: string; label: string }[] }[] = [
  {
    group: "Structural",
    roles: [
      { value: "sl_no", label: ROLE_LABELS["sl_no"] },
      { value: "description", label: ROLE_LABELS["description"] },
      { value: "unit", label: ROLE_LABELS["unit"] },
    ],
  },
  {
    group: "Quantity",
    roles: [
      { value: "qty", label: ROLE_LABELS["qty"] },
      { value: "qty_total", label: ROLE_LABELS["qty_total"] },
    ],
  },
  {
    group: "Rate",
    roles: [
      { value: "rate_supply", label: ROLE_LABELS["rate_supply"] },
      { value: "rate_install", label: ROLE_LABELS["rate_install"] },
      { value: "rate_combined", label: ROLE_LABELS["rate_combined"] },
      { value: "rate_supply_by_area", label: ROLE_LABELS["rate_supply_by_area"] },
      { value: "rate_install_by_area", label: ROLE_LABELS["rate_install_by_area"] },
      { value: "rate_combined_by_area", label: ROLE_LABELS["rate_combined_by_area"] },
    ],
  },
  {
    group: "Amount",
    roles: [
      { value: "amount_supply", label: ROLE_LABELS["amount_supply"] },
      { value: "amount_install", label: ROLE_LABELS["amount_install"] },
      { value: "amount_total", label: ROLE_LABELS["amount_total"] },
      { value: "amount_combined", label: ROLE_LABELS["amount_combined"] },
      { value: "amount_by_area", label: ROLE_LABELS["amount_by_area"] },
    ],
  },
  {
    group: "Notes",
    roles: [
      { value: "make_model", label: ROLE_LABELS["make_model"] },
      { value: "row_notes", label: ROLE_LABELS["row_notes"] },
      { value: "append_to_notes", label: ROLE_LABELS["append_to_notes"] },
      { value: "reference_images", label: ROLE_LABELS["reference_images"] },
    ],
  },
  {
    group: "Ignore",
    roles: [{ value: "ignore", label: ROLE_LABELS["ignore"] }],
  },
];

// 8 roles where area may be assigned (area dropdown shown when sheet is multi-area).
const AREA_COMPATIBLE_ROLES = new Set([
  "qty", "amount_supply", "amount_install", "amount_total",
  "amount_by_area", "rate_supply_by_area", "rate_install_by_area", "rate_combined_by_area",
]);

// 4 *_by_area roles where area is REQUIRED (empty area is flagged as error).
const AREA_REQUIRED_ROLES = new Set([
  "amount_by_area", "rate_supply_by_area", "rate_install_by_area", "rate_combined_by_area",
]);

// 12 roles of which at most ONE column may hold each (disabled in other rows' dropdowns).
const SINGLETON_ROLES = new Set([
  "sl_no", "description", "unit", "qty_total",
  "rate_supply", "rate_install", "rate_combined",
  "amount_total", "amount_combined", "make_model", "row_notes", "reference_images",
]);

// ── Types ────────────────────────────────────────────────────────────────────

interface SheetConfigPanelProps {
  boqName: string;
  sheetName: string;
  draftConfig: Record<string, unknown> | string | null | undefined;
  columnRoleMap: Record<string, ColumnRoleEntry>;
  setColumnRoleMap: Dispatch<SetStateAction<Record<string, ColumnRoleEntry>>>;
  rows: SheetPreviewRow[];
  onSaveSuccess: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function parseIntList(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

/** Sort column letters in Excel order: A, B, ..., Z, AA, AB, ... */
function sortColLetters(cols: string[]): string[] {
  return [...cols].sort((a, b) =>
    a.length !== b.length ? a.length - b.length : a.localeCompare(b)
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SheetConfigPanel({
  boqName,
  sheetName,
  draftConfig,
  columnRoleMap,
  setColumnRoleMap,
  rows,
  onSaveSuccess,
}: SheetConfigPanelProps) {
  const parsedConfig = useMemo(() => parseConfig(draftConfig), [draftConfig]);
  const hasPrefill =
    parsedConfig !== null && Object.keys(parsedConfig).length > 0;

  // ── Section 1 state ───────────────────────────────────────────────────────
  const [hrc, setHrc] = useState<1 | 2>(1);
  const [headerRow, setHeaderRow] = useState<string>("");
  const [topAdjacent, setTopAdjacent] = useState<boolean>(true);
  const [topHeaderRowNum, setTopHeaderRowNum] = useState<string>("");
  const [skipRowsInput, setSkipRowsInput] = useState<string>("");

  // ── Section 2 state ───────────────────────────────────────────────────────
  const [isMulti, setIsMulti] = useState<boolean>(false);
  const [areaBoxes, setAreaBoxes] = useState<string[]>([""]);

  // ── Section 3 state (local only) ─────────────────────────────────────────
  // pendingRows: rows added by "+ Add column mapping" with no column chosen yet.
  // Each element is a unique string ID. On column selection the row moves into
  // columnRoleMap (lifted state) and is removed from pendingRows.
  const [pendingRows, setPendingRows] = useState<string[]>([]);
  const pendingIdRef = useRef(0);

  // ── Confirm state ─────────────────────────────────────────────────────────
  const [confirmedFields, setConfirmedFields] = useState<Set<string>>(
    () => new Set()
  );

  // ── Save state ────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [unmappedWarnings, setUnmappedWarnings] = useState<Array<{ col: string; exampleRow: number }>>([]);

  // ── Initialization ────────────────────────────────────────────────────────
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    if (parsedConfig !== null) {
      const cfg = parsedConfig;
      setHrc(cfg.header_row_count === 2 ? 2 : 1);
      setHeaderRow(
        typeof cfg.header_row === "number" ? String(cfg.header_row) : ""
      );
      if (
        Array.isArray(cfg.top_header_rows_override) &&
        (cfg.top_header_rows_override as number[]).length > 0
      ) {
        setTopAdjacent(false);
        setTopHeaderRowNum(String((cfg.top_header_rows_override as number[])[0]));
      } else {
        setTopAdjacent(true);
        setTopHeaderRowNum("");
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
      setConfirmedFields(new Set());
      setInitialized(true);
    }
  }, [parsedConfig, initialized]);

  // ── Cross-section area reconciliation (Slice 3d-ii) ──────────────────────
  // When Section 2 areas change, clear any columnRoleMap area values that are
  // no longer valid. Re-sparkles "column_role_map" so user knows re-assignment
  // is needed. Runs on validAreas change only -- intentionally NOT on every
  // columnRoleMap change (functional update in setColumnRoleMap handles safety).
  const validAreas = useMemo(
    () => new Set(areaBoxes.filter((s) => s.trim() !== "")),
    [areaBoxes]
  );

  useEffect(() => {
    const toReset = Object.entries(columnRoleMap).filter(
      ([, e]) => e.area !== null && !validAreas.has(e.area)
    );
    if (toReset.length === 0) return;

    setColumnRoleMap((prev) => {
      const next = { ...prev };
      for (const [col] of toReset) {
        if (col in next) next[col] = { ...next[col], area: null };
      }
      return next;
    });

    setConfirmedFields((prev) => {
      const next = new Set(prev);
      next.delete("column_role_map");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validAreas]);

  const { call: callSetConfig } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_config"
  );

  // ── Confirm helpers ───────────────────────────────────────────────────────

  const touch = (key: string) => {
    setConfirmedFields((prev) => new Set([...prev, key]));
  };

  const isUnconfirmed = (key: string, hasValue: boolean) =>
    hasPrefill && !confirmedFields.has(key) && hasValue;

  // ── Derived values ────────────────────────────────────────────────────────

  const headerRowNum = parseInt(headerRow, 10);
  const dataStartRow = !isNaN(headerRowNum) ? headerRowNum + hrc : null;

  // All column letters present in loaded preview rows, Excel-sorted.
  const allColumns = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const col of Object.keys(row.cells)) seen.add(col);
    }
    return sortColLetters([...seen]);
  }, [rows]);

  // The header row's cell values -- used to build column picker labels.
  const headerRowData = useMemo(() => {
    if (isNaN(headerRowNum)) return null;
    return rows.find((r) => r.row_number === headerRowNum) ?? null;
  }, [rows, headerRowNum]);

  /** Column picker label: "C — Description of Work" (or just "C" if no header text). */
  function getColumnLabel(col: string): string {
    const cell = headerRowData?.cells[col];
    if (cell === null || cell === undefined) return col;
    const text = String(cell).trim();
    return text ? `${col} — ${text}` : col;
  }

  // Non-empty area names from Section 2 (live -- kept in sync with areaBoxes).
  const activeAreas = useMemo(
    () => areaBoxes.filter((s) => s.trim() !== ""),
    [areaBoxes]
  );

  // Map of singleton role -> column that currently holds it (for disabling in others).
  const usedSingletons = useMemo(() => {
    const used = new Map<string, string>(); // role -> col
    for (const [col, entry] of Object.entries(columnRoleMap)) {
      if (entry.role && SINGLETON_ROLES.has(entry.role)) {
        used.set(entry.role, col);
      }
    }
    return used;
  }, [columnRoleMap]);

  // Map of "role|area" -> column holding that pair (for disabling in area dropdowns).
  // Parser enforces per-area uniqueness: two columns cannot share (role, area).
  // Non-area-compatible roles and null areas are excluded -- they carry no area constraint.
  const usedAreaPairs = useMemo(() => {
    const used = new Map<string, string>(); // "role|area" -> col
    for (const [col, entry] of Object.entries(columnRoleMap)) {
      if (entry.role && entry.area !== null && AREA_COMPATIBLE_ROLES.has(entry.role)) {
        used.set(`${entry.role}|${entry.area}`, col);
      }
    }
    return used;
  }, [columnRoleMap]);

  // Column letters in the map, sorted for stable display order.
  const sortedMappedCols = useMemo(
    () => sortColLetters(Object.keys(columnRoleMap)),
    [columnRoleMap]
  );

  // ── Section 3 handlers ───────────────────────────────────────────────────

  const addRow = () => {
    touch("column_role_map");
    pendingIdRef.current += 1;
    setPendingRows((prev) => [...prev, String(pendingIdRef.current)]);
  };

  /** Pending row: column selected → moves to columnRoleMap with empty role. */
  const commitPendingRow = (pendingId: string, col: string) => {
    setPendingRows((prev) => prev.filter((id) => id !== pendingId));
    setColumnRoleMap((prev) => ({ ...prev, [col]: { role: "", area: null } }));
    touch("column_role_map");
  };

  /** Change the column letter of an existing mapped row (A → B). */
  const changeColumn = (oldCol: string, newCol: string) => {
    if (oldCol === newCol) return;
    setColumnRoleMap((prev) => {
      const entry = prev[oldCol];
      const next = { ...prev };
      delete next[oldCol];
      // Reset area when column changes -- the new column may serve a different area.
      next[newCol] = { role: entry?.role ?? "", area: null };
      return next;
    });
    touch("column_role_map");
  };

  /** Update the role for an existing mapped row. Clears area if new role is non-compatible. */
  const changeRole = (col: string, newRole: string) => {
    setColumnRoleMap((prev) => ({
      ...prev,
      [col]: {
        role: newRole,
        area: AREA_COMPATIBLE_ROLES.has(newRole) ? prev[col]?.area ?? null : null,
      },
    }));
    touch("column_role_map");
  };

  /** Update the area for an existing mapped row. "__none__" sentinel → null. */
  const changeArea = (col: string, v: string) => {
    setColumnRoleMap((prev) => ({
      ...prev,
      [col]: { ...prev[col], area: v === "__none__" ? null : v },
    }));
    touch("column_role_map");
  };

  const removeRow = (col: string) => {
    setColumnRoleMap((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
    touch("column_role_map");
  };

  const removePendingRow = (pendingId: string) => {
    setPendingRows((prev) => prev.filter((id) => id !== pendingId));
    touch("column_role_map");
  };

  // ── Save (read-modify-write) ──────────────────────────────────────────────

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const existing = parsedConfig ?? {};
      let topRows: number[] = [];
      if (hrc === 2 && !topAdjacent && topHeaderRowNum !== "") {
        const n = parseInt(topHeaderRowNum, 10);
        if (!isNaN(n) && n > 0) topRows = [n];
      }

      const updated: Record<string, unknown> = {
        ...existing,
        header_row_count: hrc,
        header_row: !isNaN(headerRowNum) ? headerRowNum : null,
        top_header_rows_override: topRows.length > 0 ? topRows : null,
        skip_top_rows_after_header: parseIntList(skipRowsInput),
        area_dimensions: isMulti ? areaBoxes.filter((s) => s.trim() !== "") : [],
        // column_role_map: {role, area} objects per the parser contract (Slice 3d-ii).
        // Non-area-compatible roles always get area: null -- never write a non-null
        // area on a role that doesn't accept it (parser treats it as invalid).
        // Entries with empty role (uncommitted pending) are excluded.
        column_role_map: Object.fromEntries(
          Object.entries(columnRoleMap)
            .filter(([, entry]) => entry.role !== "")
            .map(([col, entry]) => [
              col,
              {
                role: entry.role,
                area: AREA_COMPATIBLE_ROLES.has(entry.role) ? entry.area : null,
              },
            ])
        ),
      };

      // Finding #5: scan loaded preview rows for columns with data but no role assigned.
      // Non-blocking -- computed and displayed; save proceeds regardless.
      const warned: Array<{ col: string; exampleRow: number }> = [];
      for (const col of allColumns) {
        const entry = columnRoleMap[col];
        const isMapped = entry && entry.role !== "";
        if (!isMapped) {
          const exRow = rows.find((r) => {
            const v = r.cells[col];
            return v !== null && v !== undefined && String(v).trim() !== "";
          });
          if (exRow) warned.push({ col, exampleRow: exRow.row_number });
        }
      }
      setUnmappedWarnings(warned);

      await callSetConfig({
        boq_name: boqName,
        sheet_name: sheetName,
        sheet_config: JSON.stringify(updated),
      });

      setConfirmedFields(
        new Set([
          "header_row_count",
          "header_row",
          "top_header_rows_override",
          "skip_top_rows_after_header",
          "area_dimensions",
          "column_role_map",
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

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Header type
            {isUnconfirmed("header_row_count", true) && (
              <span className="ml-0.5 text-sm" aria-label="Pre-filled -- open dropdown to confirm">
                ✨
              </span>
            )}
          </Label>
          <Select
            value={String(hrc)}
            onOpenChange={(open) => { if (open) touch("header_row_count"); }}
            onValueChange={(v) => {
              touch("header_row_count");
              setHrc(v === "2" ? 2 : 1);
            }}
          >
            <SelectTrigger className={cn("w-52", isUnconfirmed("header_row_count", true) && "opacity-50")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Single (1 row)</SelectItem>
              <SelectItem value="2">Double (2 rows)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Header row
            {hrc === 2 && (
              <span className="text-xs font-normal text-muted-foreground ml-1">(bottom header row)</span>
            )}
            {isUnconfirmed("header_row", headerRow !== "") && (
              <span className="ml-0.5 text-sm" aria-label="Pre-filled -- click to confirm">✨</span>
            )}
          </Label>
          <Input
            type="number"
            min={1}
            value={headerRow}
            placeholder="e.g. 7"
            className={cn("w-32", isUnconfirmed("header_row", headerRow !== "") && "opacity-50")}
            onFocus={() => touch("header_row")}
            onClick={() => touch("header_row")}
            onChange={(e) => { touch("header_row"); setHeaderRow(e.target.value); }}
          />
        </div>

        {hrc === 2 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              Top header row
              {isUnconfirmed("top_header_rows_override", !topAdjacent) && (
                <span className="ml-0.5 text-sm" aria-label="Pre-filled -- interact to confirm">✨</span>
              )}
            </Label>
            <p className="text-xs text-muted-foreground -mt-0.5">
              Is the top header row immediately above the bottom one?
            </p>
            <div
              className={cn(
                "flex rounded-md border border-border overflow-hidden w-fit",
                isUnconfirmed("top_header_rows_override", !topAdjacent) && "opacity-50"
              )}
            >
              <Button
                type="button"
                size="sm"
                variant={topAdjacent ? "default" : "ghost"}
                className="rounded-none"
                onClick={() => {
                  touch("top_header_rows_override");
                  setTopAdjacent(true);
                  setTopHeaderRowNum("");
                }}
              >
                Yes
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!topAdjacent ? "default" : "ghost"}
                className="rounded-none border-l border-border"
                onClick={() => {
                  touch("top_header_rows_override");
                  setTopAdjacent(false);
                }}
              >
                No — specify row
              </Button>
            </div>
            {topAdjacent && !isNaN(headerRowNum) && headerRowNum > 1 && (
              <p className="text-xs text-muted-foreground">
                Top header will be row {headerRowNum - 1} (immediately above row {headerRowNum}).
              </p>
            )}
            {!topAdjacent && (
              <div className="space-y-1.5 pt-0.5">
                <Label className="flex items-center gap-1 font-normal">
                  Which row is the top header?
                  {isUnconfirmed("top_header_rows_override", topHeaderRowNum !== "") && (
                    <span className="ml-0.5 text-sm" aria-label="Pre-filled -- click to confirm">✨</span>
                  )}
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={topHeaderRowNum}
                  placeholder="e.g. 5"
                  className={cn(
                    "w-32",
                    isUnconfirmed("top_header_rows_override", topHeaderRowNum !== "") && "opacity-50"
                  )}
                  onFocus={() => touch("top_header_rows_override")}
                  onClick={() => touch("top_header_rows_override")}
                  onChange={(e) => {
                    touch("top_header_rows_override");
                    setTopHeaderRowNum(e.target.value);
                  }}
                />
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Data starts at row{" "}
          <span className="font-medium text-foreground">
            {dataStartRow !== null ? dataStartRow : "—"}
          </span>
          {" "}(derived from header row + row count)
        </p>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Skip rows after header
            <span className="text-xs font-normal text-muted-foreground ml-1">(situational)</span>
            {isUnconfirmed("skip_top_rows_after_header", skipRowsInput !== "") && (
              <span className="ml-0.5 text-sm" aria-label="Pre-filled -- click to confirm">✨</span>
            )}
          </Label>
          <Input
            value={skipRowsInput}
            placeholder="e.g. 8, 9 (usually blank)"
            className={cn("w-64", isUnconfirmed("skip_top_rows_after_header", skipRowsInput !== "") && "opacity-50")}
            onFocus={() => touch("skip_top_rows_after_header")}
            onClick={() => touch("skip_top_rows_after_header")}
            onChange={(e) => { touch("skip_top_rows_after_header"); setSkipRowsInput(e.target.value); }}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated absolute row numbers to exclude. Non-numeric entries are ignored.
          </p>
        </div>
      </div>

      {/* ── Section 2: Areas ────────────────────────────────────────────── */}
      <div className="space-y-4 pt-3 border-t border-border">
        <h3 className="text-sm font-semibold text-foreground leading-none flex items-center gap-1">
          Section 2 — Areas
          {isUnconfirmed("area_dimensions", isMulti) && (
            <span className="text-sm" aria-label="Pre-filled -- interact to confirm">✨</span>
          )}
        </h3>

        <div className={cn("space-y-3", isUnconfirmed("area_dimensions", isMulti) && "opacity-50")}>
          <div className="flex rounded-md border border-border overflow-hidden w-fit">
            <Button
              type="button"
              size="sm"
              variant={!isMulti ? "default" : "ghost"}
              className="rounded-none"
              onClick={() => { touch("area_dimensions"); setIsMulti(false); }}
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
                if (!isMulti && areaBoxes.every((s) => s.trim() === "")) setAreaBoxes([""]);
                setIsMulti(true);
              }}
            >
              Multi area
            </Button>
          </div>

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
                      setAreaBoxes((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)));
                    }}
                  />
                  {areaBoxes.length > 1 && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive focus:outline-none"
                      aria-label={`Remove area ${i + 1}`}
                      onClick={() => { touch("area_dimensions"); setAreaBoxes((prev) => prev.filter((_, idx) => idx !== i)); }}
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
                onClick={() => { touch("area_dimensions"); setAreaBoxes((prev) => [...prev, ""]); }}
              >
                + Add area
              </Button>
            </div>
          )}

          {!isMulti && (
            <p className="text-xs text-muted-foreground">
              Single-area sheet. Switch to Multi area to name areas for column-role assignment.
            </p>
          )}
        </div>
      </div>

      {/* ── Section 3: Column Roles ──────────────────────────────────────── */}
      {/*
        Pure add-rows list. Each row maps one column letter to a role + optional area.
        Unmapped columns are implicitly "ignore" -- user only adds rows for columns that
        matter. pendingRows holds rows not yet assigned a column letter (transient, local).
        Singleton enforcement: disable already-used singleton options in other rows' dropdowns.
        Cross-section reactivity: area reconciliation effect above handles area clearing.
      */}
      <div className="space-y-4 pt-3 border-t border-border">
        <h3 className="text-sm font-semibold text-foreground leading-none flex items-center gap-1">
          Section 3 — Column Roles
          {isUnconfirmed("column_role_map", Object.keys(columnRoleMap).length > 0) && (
            <span className="text-sm" aria-label="Pre-filled -- interact to confirm">✨</span>
          )}
        </h3>

        {/* Finding #4 -- helper text for the three confusable role pairs. */}
        {/* Outside the opacity-50 wrapper so it stays readable when unconfirmed. */}
        <p className="text-xs text-muted-foreground">
          <strong>Amount (Total)</strong> vs <strong>Amount (Combined)</strong>: same resolved amount -- pick whichever matches your sheet&apos;s header wording.{" "}
          <strong>Row Notes</strong> replaces the notes field (one source); <strong>Append to Notes</strong> accumulates from multiple columns.{" "}
          <strong>Quantity</strong> and <strong>Total Quantity</strong> set distinct parser fields -- not interchangeable.
        </p>

        <div
          className={cn(
            "space-y-3",
            isUnconfirmed("column_role_map", Object.keys(columnRoleMap).length > 0) && "opacity-50"
          )}
        >
          {/* ── Mapped rows (from columnRoleMap, sorted by column letter) ── */}
          {sortedMappedCols.map((col) => {
            const entry = columnRoleMap[col];
            const areaRequired = AREA_REQUIRED_ROLES.has(entry.role);
            const showAreaDropdown =
              AREA_COMPATIBLE_ROLES.has(entry.role) && isMulti && activeAreas.length > 0;

            return (
              <div key={col} className="flex flex-wrap gap-2 items-start">
                {/* Column picker */}
                <Select
                  value={col}
                  onOpenChange={(open) => { if (open) touch("column_role_map"); }}
                  onValueChange={(newCol) => changeColumn(col, newCol)}
                >
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allColumns.length === 0 && (
                      <SelectItem value={col} disabled>{col} (loading...)</SelectItem>
                    )}
                    {allColumns.map((letter) => (
                      <SelectItem
                        key={letter}
                        value={letter}
                        disabled={letter !== col && letter in columnRoleMap}
                      >
                        {getColumnLabel(letter)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Role dropdown (always shown) */}
                <Select
                  value={entry.role || ""}
                  onOpenChange={(open) => { if (open) touch("column_role_map"); }}
                  onValueChange={(newRole) => changeRole(col, newRole)}
                >
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES_BY_GROUP.map(({ group, roles }) => (
                      <SelectGroup key={group}>
                        <SelectLabel>{group}</SelectLabel>
                        {roles.map((r) => (
                          <SelectItem
                            key={r.value}
                            value={r.value}
                            disabled={
                              SINGLETON_ROLES.has(r.value) &&
                              usedSingletons.has(r.value) &&
                              usedSingletons.get(r.value) !== col
                            }
                          >
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>

                {/* Area dropdown -- only when role is area-compatible, sheet is multi, areas exist */}
                {showAreaDropdown && (
                  <Select
                    value={entry.area || "__none__"}
                    onOpenChange={(open) => { if (open) touch("column_role_map"); }}
                    onValueChange={(v) => changeArea(col, v)}
                  >
                    <SelectTrigger
                      className={cn(
                        "w-40",
                        areaRequired && !entry.area && "border-destructive"
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        {areaRequired ? "— required —" : "Any area"}
                      </SelectItem>
                      {activeAreas.map((area) => {
                        const pairKey = `${entry.role}|${area}`;
                        const takenByCol = usedAreaPairs.get(pairKey);
                        const isPairTaken = takenByCol !== undefined && takenByCol !== col;
                        return (
                          <SelectItem key={area} value={area} disabled={isPairTaken}>
                            {area}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}

                {/* Required-area missing indicator */}
                {areaRequired && !entry.area && !showAreaDropdown && isMulti && (
                  <span className="text-xs text-destructive self-center">area required</span>
                )}

                {/* Remove */}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive focus:outline-none self-center mt-0.5"
                  aria-label={`Remove mapping for column ${col}`}
                  onClick={() => removeRow(col)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {/* ── Pending rows (column not yet chosen) ───────────────────── */}
          {pendingRows.map((id) => (
            <div key={id} className="flex gap-2 items-center">
              <Select
                value=""
                onValueChange={(newCol) => commitPendingRow(id, newCol)}
              >
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Pick column" />
                </SelectTrigger>
                <SelectContent>
                  {allColumns.length === 0 && (
                    <SelectItem value="__loading__" disabled>
                      Loading columns...
                    </SelectItem>
                  )}
                  {allColumns.map((letter) => (
                    <SelectItem
                      key={letter}
                      value={letter}
                      disabled={letter in columnRoleMap}
                    >
                      {getColumnLabel(letter)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive focus:outline-none"
                aria-label="Remove unmapped row"
                onClick={() => removePendingRow(id)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          {/* Add button */}
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            + Add column mapping
          </Button>

          {/* Hint when no preview data loaded yet */}
          {rows.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              Sheet preview loading — column letters will appear once data loads.
            </p>
          )}
        </div>
      </div>

      {/* ── Save action ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 pt-3 border-t border-border">
        {unmappedWarnings.length > 0 && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Columns with data in loaded rows but no role assigned (will be ignored by the parser):
            </p>
            <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-0.5 pl-5 list-disc">
              {unmappedWarnings.map(({ col, exampleRow }) => (
                <li key={col}>
                  Column {col} — has data (row {exampleRow})
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Assign roles above and save to include them.
            </p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={isSaving} onClick={handleSave}>
            {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save config
          </Button>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        </div>
      </div>
    </div>
  );
}
