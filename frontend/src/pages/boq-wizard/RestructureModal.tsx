/**
 * RestructureModal -- Slice 1b-beta. The HEAVY path of the BoQ review-screen
 * restructure surface: reclassify ONE row AND place its children, committed as ONE
 * atomic `save_review_restructure` call (Slice 1b-alpha backend, feat f7761415).
 *
 * Trigger chain (in ReviewTree's row-detail panel):
 *   pill DropdownMenu -> pick a target class -> ReviewTree checks for children:
 *     childless -> light AlertDialog (handled in ReviewTree, NOT here);
 *     has children -> THIS staged modal.
 *
 * Row-own-position (Slice 1b-beta2): a separate "This row's position" control lets the
 * user ALSO place the reclassified ROW itself -- (1) "Keep current position" (DEFAULT,
 * pre-selected; sends NO row_new_parent -> backwards-compat) or (2) "Move under a new
 * parent" which reveals the SAME SheetSearchView picker + hitRowIndex resolution +
 * no-match guard the child pickers use (a picked row_index, or "Top level" -> -1).
 * Save is gated until a chosen "move" is resolved. A backend cycle throw caused by the
 * row's own move (e.g. moving it under its own child) surfaces inline like any other.
 *
 * Staged, gated, atomic:
 *   - The user actively chooses one of FIVE child-placement options (no silent default).
 *   - Save is DISABLED until the chosen option's required selections are complete.
 *   - On Save the modal assembles a fully-resolved child_moves map (Path A -- the
 *     FRONTEND computes the resolved {child_row_index: new_parent_index} map; the
 *     backend validates + writes it). A value of -1 means top-level/root.
 *   - ONE save_review_restructure call. Success -> onRestructured(edited_at) (parent
 *     closes + refreshes). Cancel / close / Escape writes nothing.
 *   - A backend frappe.throw (e.g. a batch cycle) surfaces inline; the modal stays open.
 *
 * Parent picker (options 3 + 4): mounts the CERTIFIED SheetSearchView (Slice 1a,
 * byte-for-byte untouched) as the find-and-pick surface, consuming its
 * onCurrentHitChange callback. A SheetPreviewRow carries only the Excel row_number --
 * NOT row_index -- so the current hit is resolved to a review-row row_index by matching
 * source_row_number against the rows list. If a hit resolves to no review row (a
 * header/banner/blank band row), "Set as parent" is DISABLED with a short reason
 * (the no-match guard). sheet_name is VERBATIM everywhere (#152).
 */
import { useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SheetSearchView } from "./SheetSearchView";
import type { ReviewRow, SheetPreviewRow } from "./boqTypes";

// Mirror of ReviewTree's CLS_LABELS (the assignable subset + the two parser-only
// detections, which can still be a FROM state shown in the summary line).
const CLS_LABELS: Record<string, string> = {
  preamble: "Preamble",
  line_item: "Item",
  note: "Note",
  spacer: "Spacer",
  subtotal_marker: "Subtotal",
  header_repeat: "Header",
};

// Classes that can hold children -- gate for option 2 ("keep under this row").
// Notes and spacers are not parents (mirrors the backend's assignable/parent rules).
const PARENT_CAPABLE = new Set(["line_item", "preamble"]);

// Local response shape of save_review_restructure (Slice 1b-alpha backend). Defined
// here rather than in boqTypes.ts -- that file is out of scope for this slice.
interface SaveReviewRestructureResponse {
  ok: boolean;
  row_index: number;
  new_classification: string;
  children_moved: number;
  edited_at: string;
  // Slice 1b-beta2: true when row_new_parent was applied (the row itself moved).
  row_moved?: boolean;
}

type PlacementOption = 1 | 2 | 3 | 4 | 5;

interface RestructureModalProps {
  open: boolean;
  onClose: () => void;
  boqName: string;
  /** VERBATIM sheet name (#152) -- never trimmed. */
  sheetName: string;
  /** The row being reclassified. */
  row: ReviewRow;
  /** The chosen target classification (one of the 4 assignable). */
  newClassification: string;
  /** All review rows for the sheet -- child list + row_number->row_index resolution. */
  rows: ReviewRow[];
  /** Success callback with the returned edited_at (parent closes + refreshes the tree). */
  onRestructured: (editedAt: string) => void;
}

export function RestructureModal({
  open,
  onClose,
  boqName,
  sheetName,
  row,
  newClassification,
  rows,
  onRestructured,
}: RestructureModalProps) {
  const { call, loading } = useFrappePostCall<{ message: SaveReviewRestructureResponse }>(
    "nirmaan_stack.api.boq.wizard.review_screen.save_review_restructure",
  );

  // No option is pre-selected -- the user MUST actively choose (no silent default).
  const [option, setOption] = useState<PlacementOption | null>(null);
  // option 3: the single resolved parent row_index for the whole block (-1 = top-level).
  const [blockParentIdx, setBlockParentIdx] = useState<number | null>(null);
  // option 4: per-child resolved target (child row_index -> new_parent_index; -1 = top-level).
  const [perChild, setPerChild] = useState<Record<number, number>>({});
  // option 4: which child's picker is currently open (null = none).
  const [activeChildPicker, setActiveChildPicker] = useState<number | null>(null);
  // The current search hit held from SheetSearchView's onCurrentHitChange.
  const [currentHit, setCurrentHit] = useState<SheetPreviewRow | null>(null);
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  // This row's OWN position (Slice 1b-beta2). "keep" (DEFAULT) = leave the row's
  // parent untouched -> send NO row_new_parent (backwards-compat shape). "move" =
  // reparent the row itself; rowParentIdx is the resolved target (-1 = top-level,
  // >=0 = a picked row_index, null = not yet resolved -> Save stays disabled).
  const [rowPosition, setRowPosition] = useState<"keep" | "move">("keep");
  const [rowParentIdx, setRowParentIdx] = useState<number | null>(null);

  const children = useMemo(
    () => rows.filter((r) => r.effective_parent_index === row.row_index),
    [rows, row.row_index],
  );

  const byIdx = useMemo(
    () => new Map<number, ReviewRow>(rows.map((r) => [r.row_index, r])),
    [rows],
  );

  // Resolve the current hit's Excel row_number -> a review-row row_index. A hit on a
  // header/banner/blank row matches no review row -> null (drives the no-match guard).
  const hitRowIndex = useMemo(() => {
    if (!currentHit) return null;
    const match = rows.find((r) => r.source_row_number === currentHit.row_number);
    return match ? match.row_index : null;
  }, [currentHit, rows]);

  const parentCapable = PARENT_CAPABLE.has(newClassification);

  // Label a target row_index for display ("row N" / "top-level").
  const targetLabel = (idx: number): string => {
    if (idx < 0) return "top-level";
    const r = byIdx.get(idx);
    return r ? `row ${r.source_row_number}` : `#${idx}`;
  };

  // This row's CURRENT parent -- used by option 1 ("move up") + its label.
  const oldParentIdx =
    row.effective_parent_index === null || row.effective_parent_index < 0
      ? -1
      : row.effective_parent_index;
  const oldParentLabel = oldParentIdx < 0 ? "top-level" : targetLabel(oldParentIdx);

  // Switching option resets all option-specific sub-state (avoids stale picks).
  const selectOption = (n: PlacementOption) => {
    setOption(n);
    setBlockParentIdx(null);
    setPerChild({});
    setActiveChildPicker(null);
    setCurrentHit(null);
    setSaveError(null);
  };

  // Switching the row's-own-position choice (Slice 1b-beta2). Resets the resolved
  // row-parent + the shared transient hit. rowParentIdx survives child-option changes
  // (the two choices are independent) -- only an explicit toggle here clears it.
  const selectRowPosition = (pos: "keep" | "move") => {
    setRowPosition(pos);
    setRowParentIdx(null);
    setCurrentHit(null);
    setSaveError(null);
  };

  const canSave = (() => {
    if (option === null) return false;
    // Row-own-position gate (1b-beta2): "move" selected but nothing resolved -> blocked
    // (same no-silent-incomplete principle as the child options).
    if (rowPosition === "move" && rowParentIdx === null) return false;
    if (option === 3) return blockParentIdx !== null;
    if (option === 4) return children.every((c) => perChild[c.row_index] !== undefined);
    return true; // options 1, 2, 5 -- complete as soon as selected
  })();

  // Assemble the fully-resolved {child_row_index: new_parent_index} map (Path A).
  const buildChildMoves = (): Record<number, number> => {
    const moves: Record<number, number> = {};
    if (option === 1) {
      for (const c of children) moves[c.row_index] = oldParentIdx;
    } else if (option === 2) {
      return {}; // keep under this row -- nothing reparents
    } else if (option === 3) {
      for (const c of children) moves[c.row_index] = blockParentIdx as number;
    } else if (option === 4) {
      for (const c of children) moves[c.row_index] = perChild[c.row_index];
    } else if (option === 5) {
      for (const c of children) moves[c.row_index] = -1;
    }
    return moves;
  };

  const handleSave = async () => {
    setSaveError(null);
    const child_moves = buildChildMoves();
    try {
      const res = await call({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152 trailing-space guard
        row_index: row.row_index,
        new_classification: newClassification,
        child_moves,
        reason: reason.trim() || undefined, // blank -> omitted; backend normalizes to None
        // Slice 1b-beta2: the row's OWN move -- sent ONLY when "move" is active AND
        // resolved. "keep" omits the param entirely (backwards-compat shape S4).
        ...(rowPosition === "move" && rowParentIdx !== null
          ? { row_new_parent: rowParentIdx }
          : {}),
      });
      onRestructured(res.message.edited_at);
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : "Restructure failed. Please try again.";
      setSaveError(msg);
    }
  };

  const fromLabel =
    CLS_LABELS[row.effective_classification ?? ""] ?? row.effective_classification ?? "—";
  const toLabel = CLS_LABELS[newClassification] ?? newClassification;

  const OPTIONS: { n: PlacementOption; label: string; disabled?: boolean; reason?: string }[] = [
    { n: 1, label: `Move all children up to this row's current parent (${oldParentLabel})` },
    {
      n: 2,
      label: "Keep all children under this row",
      disabled: !parentCapable,
      reason: parentCapable ? undefined : "notes and spacers can't have children",
    },
    { n: 3, label: "Move all children to one new parent" },
    { n: 4, label: "Decide each child individually" },
    { n: 5, label: "Make all children top-level" },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reclassify row and place its children</DialogTitle>
          <DialogDescription>
            Row {row.source_row_number}: {fromLabel} &rarr; {toLabel}. Choose where this
            row&rsquo;s {children.length} {children.length === 1 ? "child" : "children"} should
            go.
          </DialogDescription>
        </DialogHeader>

        {/* The row being reclassified */}
        <div className="text-xs text-foreground">
          <span className="font-medium">{row.description || "(no description)"}</span>
        </div>

        {/* This row's OWN position (Slice 1b-beta2) -- keep (default) or move under a
            new parent. Reuses the SAME SheetSearchView picker + hitRowIndex resolution
            + no-match guard as the child pickers (no duplication). */}
        <div className="rounded-md border border-border p-2 space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            This row&rsquo;s position
          </p>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="radio"
              name="row-position"
              className="mt-0.5"
              checked={rowPosition === "keep"}
              onChange={() => selectRowPosition("keep")}
            />
            <span>Keep current position (under {oldParentLabel})</span>
          </label>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="radio"
              name="row-position"
              className="mt-0.5"
              checked={rowPosition === "move"}
              onChange={() => selectRowPosition("move")}
            />
            <span>Move this row under a new parent</span>
          </label>

          {rowPosition === "move" && (
            <div className="rounded-md border border-border p-2 space-y-2">
              {rowParentIdx !== null ? (
                <p className="text-xs">
                  New position for this row:{" "}
                  <span className="font-medium">{targetLabel(rowParentIdx)}</span>{" "}
                  <button
                    type="button"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                    onClick={() => { setRowParentIdx(null); setCurrentHit(null); }}
                  >
                    change
                  </button>
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Search the sheet, land on the row you want as this row&rsquo;s new
                    parent, then Set as parent &mdash; or send this row to the top level.
                  </p>
                  <SheetSearchView
                    boqName={boqName}
                    sheetName={sheetName}
                    onCurrentHitChange={setCurrentHit}
                    onRowClick={setCurrentHit}
                    selectedRowNumber={currentHit?.row_number ?? null}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={hitRowIndex === null}
                      onClick={() => setRowParentIdx(hitRowIndex)}
                    >
                      Set as parent
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRowParentIdx(-1)}
                    >
                      Top level
                    </Button>
                    {currentHit !== null && hitRowIndex === null && (
                      <span className="text-xs text-muted-foreground">
                        This row isn&rsquo;t a selectable parent
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* The children that need placing */}
        <div className="rounded-md border border-border p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
            Children ({children.length})
          </p>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {children.map((c) => (
              <li key={c.row_index} className="text-xs text-muted-foreground whitespace-normal break-words">
                row {c.source_row_number}: {c.description || "(no description)"}
              </li>
            ))}
          </ul>
        </div>

        {/* The five placement options -- no option pre-selected */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Where should the children go?
          </p>
          {OPTIONS.map((opt) => (
            <label
              key={opt.n}
              className={cn(
                "flex items-start gap-2 text-xs cursor-pointer",
                opt.disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              <input
                type="radio"
                name="placement-option"
                className="mt-0.5"
                checked={option === opt.n}
                disabled={opt.disabled}
                onChange={() => selectOption(opt.n)}
              />
              <span>
                {opt.label}
                {opt.disabled && opt.reason && (
                  <span className="ml-1 text-muted-foreground italic">({opt.reason})</span>
                )}
              </span>
            </label>
          ))}
        </div>

        {/* Option 3: one new parent for the whole block (parent picker) */}
        {option === 3 && (
          <div className="rounded-md border border-border p-2 space-y-2">
            {blockParentIdx !== null ? (
              <p className="text-xs">
                New parent for all children:{" "}
                <span className="font-medium">{targetLabel(blockParentIdx)}</span>{" "}
                <button
                  type="button"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={() => { setBlockParentIdx(null); setCurrentHit(null); }}
                >
                  change
                </button>
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Search the sheet, land on the row you want as the new parent, then Set as
                  parent.
                </p>
                <SheetSearchView
                  boqName={boqName}
                  sheetName={sheetName}
                  onCurrentHitChange={setCurrentHit}
                  onRowClick={setCurrentHit}
                  selectedRowNumber={currentHit?.row_number ?? null}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={hitRowIndex === null}
                    onClick={() => setBlockParentIdx(hitRowIndex)}
                  >
                    Set as parent
                  </Button>
                  {currentHit !== null && hitRowIndex === null && (
                    <span className="text-xs text-muted-foreground">
                      This row isn&rsquo;t a selectable parent
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Option 4: per-child placement (each child its own target) */}
        {option === 4 && (
          <div className="rounded-md border border-border p-2 space-y-2">
            <ul className="space-y-1">
              {children.map((c) => {
                const t = perChild[c.row_index];
                return (
                  <li key={c.row_index} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 whitespace-normal break-words">
                      row {c.source_row_number}: {c.description || "(no description)"}
                    </span>
                    <span className="shrink-0 text-muted-foreground w-24 text-right">
                      {t === undefined ? "— not set —" : t === -1 ? "→ top-level" : `→ ${targetLabel(t)}`}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 shrink-0"
                      onClick={() => { setActiveChildPicker(c.row_index); setCurrentHit(null); }}
                    >
                      Pick parent
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 shrink-0"
                      onClick={() => setPerChild((prev) => ({ ...prev, [c.row_index]: -1 }))}
                    >
                      Top-level
                    </Button>
                  </li>
                );
              })}
            </ul>
            {activeChildPicker !== null && (
              <div className="rounded-md border border-border p-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Pick a parent for row {byIdx.get(activeChildPicker)?.source_row_number}:
                </p>
                <SheetSearchView
                  boqName={boqName}
                  sheetName={sheetName}
                  onCurrentHitChange={setCurrentHit}
                  onRowClick={setCurrentHit}
                  selectedRowNumber={currentHit?.row_number ?? null}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={hitRowIndex === null}
                    onClick={() => {
                      setPerChild((prev) => ({ ...prev, [activeChildPicker]: hitRowIndex as number }));
                      setActiveChildPicker(null);
                      setCurrentHit(null);
                    }}
                  >
                    Set as parent
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setActiveChildPicker(null); setCurrentHit(null); }}
                  >
                    Cancel pick
                  </Button>
                  {currentHit !== null && hitRowIndex === null && (
                    <span className="text-xs text-muted-foreground">
                      This row isn&rsquo;t a selectable parent
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Optional free-text reason (stored on each edit_log entry the backend writes) */}
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="h-8 text-xs"
        />

        {saveError && <p className="text-xs text-destructive">{saveError}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => { void handleSave(); }} disabled={!canSave || loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RestructureModal;
