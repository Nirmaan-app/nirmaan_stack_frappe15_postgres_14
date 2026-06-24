/**
 * GeminiAcceptBlock -- DUAL-AI (ADR-0003 sec 8A). The detail-panel accept/reject block for a
 * Gemini suggestion. A VISUAL CLONE of Nitesh's "AI suggestion" accept block in ReviewTree.tsx,
 * only reading gemini_* and calling the gemini endpoints (accept_gemini_suggestion /
 * reject_gemini_suggestion).
 *
 * Mounted by ReviewTree in the row-detail panel BENEATH the Claude block; Nitesh's block stays
 * byte-identical. This block owns its OWN useFrappePostCall hooks for the two gemini endpoints
 * and its own action-error state (kept separate from the Claude block's aiActionError).
 *
 * R3a (ADR-0006): this block owns ONLY the Pending accept/reject UI. There is NO "Revert Gemini
 * change" branch any more -- revert is the ONE unified "Revert to parser" affordance owned by
 * ReviewTree (shown on any has_override row, calling review_screen.revert_to_parser). And per the
 * block-then-revert rule, the Apply button is DISABLED whenever row.has_override is set (a standing
 * AI acceptance or a manual edit) -- an AI apply must never silently overwrite a standing decision.
 *
 * Parity rules (mirror Claude, swap ai_ -> gemini_):
 *   - Per-axis checkboxes (classification / parent), each with a confidence pill + suggested
 *     value; one gemini_explanation line; Apply + Reject. Checkboxes seed default-checked when
 *     the suggestion is a REAL change vs the row's effective value (mirrors ReviewTree's seed).
 *   - ACCEPT-FOUR guard: if gemini_suggested_classification is subtotal_marker / header_repeat,
 *     the classification accept checkbox is DISABLED with a tooltip (the backend also throws;
 *     this is the UI line of defence).
 *   - With-children accept (classification change OR parent change) routes to the SHARED
 *     RestructureModal via onOpenRestructure(...) with markGeminiAccepted=true -- ReviewTree owns
 *     the single modal mount (mirror of handleApplyAi's markAiAccepted route).
 */
import { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { useFrappePostCall } from "frappe-react-sdk";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GeminiConfBadge } from "./GeminiSuggestionColumn";
import type { ReviewRow } from "./boqTypes";

// Mirror of ReviewTree's CLS_LABELS (label the suggested class). Local copy -- boqTypes.ts
// owns no label map and this block must read the same human-friendly names as the tree.
const CLS_LABELS: Record<string, string> = {
  preamble: "Preamble",
  line_item: "Item",
  note: "Note",
  spacer: "Spacer",
  subtotal_marker: "Subtotal",
  header_repeat: "Header",
};

// ACCEPT-FOUR (ADR-0003 sec 5): the detection-only classes a Gemini classification accept may
// NOT promote into the human layer. Mirrors the backend _ACCEPTABLE_CLASSES complement.
const DETECTION_ONLY_CLASSES = new Set(["subtotal_marker", "header_repeat"]);
const DETECTION_ONLY_TOOLTIP =
  "Gemini classifies this as a detection-only class — informational, not assignable";

interface GeminiAcceptBlockProps {
  row: ReviewRow;
  boqName: string;
  /** VERBATIM sheet name (#152) -- never trimmed. */
  sheetName: string;
  /** True when this row has children (effective-parent set) -- routes accepts to the modal. */
  hasChildren: boolean;
  /** Resolve an internal row_index to its Excel-row display label ("row N" / "#idx"). */
  parentLabel: (idx: number) => string;
  /** Accepted for call-site compat (ReviewTree passes it) but UNUSED here since R3a: the block
   *  now renders ONLY the Pending accept/reject UI and is mounted only when !readOnly, and revert
   *  moved to ReviewTree's unified "Revert to parser". Kept on the interface to avoid churning the
   *  call site; not destructured (noUnusedLocals). */
  readOnly?: boolean;
  /**
   * Open the SHARED RestructureModal (owned by ReviewTree) with markGeminiAccepted=true. Mirrors
   * handleApplyAi's setRestructureModal route: a parent change pre-applies the parent
   * (presetRowParent + message); a classification-only change omits presetRowParent (the modal
   * keeps the row's own parent and only disposes children).
   */
  onOpenRestructure: (args: {
    row: ReviewRow;
    newClassification: string;
    presetRowParent?: number | null;
    presetParentMessage?: string;
  }) => void;
  /** mutate-only refresh after reject (no edited_at threaded). ReviewTree's onRemarkSaved --
   *  re-fetches rows so the row re-renders with the new gemini status. */
  onChanged: () => void;
  /** advance-the-anchor refresh after an accept that WROTE the human layer (carries edited_at).
   *  ReviewTree's onSaved -- mirrors the Claude accept's onSaved(edited_at) call. */
  onAccepted: (editedAt: string) => void;
}

export function GeminiAcceptBlock({
  row,
  boqName,
  sheetName,
  hasChildren,
  parentLabel,
  onOpenRestructure,
  onChanged,
  onAccepted,
}: GeminiAcceptBlockProps) {
  // Per-axis accept checkboxes (mirror aiAcceptCls / aiAcceptParent).
  const [acceptCls, setAcceptCls] = useState(false);
  const [acceptParent, setAcceptParent] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { call: acceptCall, loading: isAccepting } = useFrappePostCall<{
    message: { ok: boolean; edited_at: string | null };
  }>("nirmaan_stack.api.boq.wizard.gemini_assist.accept_gemini_suggestion");
  const { call: rejectCall, loading: isRejecting } = useFrappePostCall<{
    message: { ok: boolean };
  }>("nirmaan_stack.api.boq.wizard.gemini_assist.reject_gemini_suggestion");

  // Pending-suggestion shape (block-local; the per-axis "is change" gating compares vs the
  // row's EFFECTIVE value -- mirrors Nitesh's accept block exactly, not the column's vs-parser).
  const pending = row.gemini_suggestion_status === "Pending";
  const hasClass = pending && row.gemini_suggested_classification != null;
  const hasParent =
    pending &&
    ((row.gemini_suggested_parent != null && row.gemini_suggested_parent !== -1) ||
      row.gemini_suggested_is_root === 1);
  const clsIsChange =
    hasClass && row.gemini_suggested_classification !== row.effective_classification;
  const parentIsChange =
    hasParent &&
    (row.gemini_suggested_is_root === 1
      ? row.effective_parent_index !== null
      : row.gemini_suggested_parent !== row.effective_parent_index);
  // ACCEPT-FOUR: a detection-only suggested class disables the classification accept.
  const clsDetectionOnly =
    hasClass &&
    row.gemini_suggested_classification != null &&
    DETECTION_ONLY_CLASSES.has(row.gemini_suggested_classification);
  const clsAcceptable = clsIsChange && !clsDetectionOnly;

  // Seed the checkboxes default-checked when the suggestion is a REAL, acceptable change vs the
  // effective value (mirror ReviewTree's seeding effect). A detection-only class is never
  // auto-checked (the accept is disabled). Re-seeds on row identity / suggestion change.
  useEffect(() => {
    setAcceptCls(clsAcceptable);
    setAcceptParent(parentIsChange);
    setActionError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.row_index, row.gemini_suggestion_status, row.gemini_suggested_classification, row.gemini_suggested_parent, row.gemini_suggested_is_root]);

  // A parent / classification accept on a with-children row routes through the modal.
  const parentOpensModal = parentIsChange && hasChildren;

  // Suggested-parent display label (root / row N / #idx).
  const suggestedParentLabel =
    row.gemini_suggested_is_root === 1
      ? "Top level (root)"
      : (() => {
          const p = row.gemini_suggested_parent;
          if (p === null || p === undefined || p < 0) return "—";
          return parentLabel(p);
        })();

  // Apply the checked Gemini suggestion(s). With-children class/parent accept -> shared modal
  // (markGeminiAccepted). Otherwise the accept_gemini_suggestion endpoint path.
  const handleApply = async () => {
    setActionError(null);
    const clsAccept = acceptCls && clsAcceptable;
    const isRoot = row.gemini_suggested_is_root === 1;
    const parentAccept = acceptParent && parentIsChange;

    // ANY accepted change on a row WITH children opens the child-disposition RestructureModal
    // (mirror handleApplyAi's hasChildrenSet route). A classification-ONLY accept omits
    // presetRowParent (the modal keeps the row's own parent, child-disposition only).
    if (hasChildren && (clsAccept || parentAccept)) {
      const presetRowParent = parentAccept
        ? (isRoot ? -1 : (row.gemini_suggested_parent ?? -1))
        : undefined;
      const parentLbl = isRoot
        ? "Top level (root)"
        : (presetRowParent !== undefined ? parentLabel(presetRowParent) : "");
      onOpenRestructure({
        row,
        newClassification: clsAccept
          ? (row.gemini_suggested_classification as string)
          : (row.effective_classification as string),
        ...(presetRowParent !== undefined
          ? {
              presetRowParent,
              presetParentMessage: `Parent set to ${parentLbl} per Gemini suggestion — choose what happens to this row's children below.`,
            }
          : {}),
      });
      return;
    }
    try {
      const res = await acceptCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152
        row_index: row.row_index,
        accept_classification: acceptCls,
        accept_parent: acceptParent,
      });
      onAccepted(res.message.edited_at ?? "");
    } catch (e: unknown) {
      setActionError(getFrappeError(e) || "Could not apply the Gemini suggestion.");
    }
  };

  const handleReject = async () => {
    setActionError(null);
    try {
      await rejectCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152
        row_index: row.row_index,
      });
      onChanged();
    } catch (e: unknown) {
      setActionError(getFrappeError(e) || "Could not reject the Gemini suggestion.");
    }
  };

  // ── Pending: the accept/reject block (mirror of ReviewTree's "AI suggestion" block) ──
  // R3a (ADR-0006): the former Accepted "Revert Gemini change" branch is GONE -- revert is now
  // the ONE unified "Revert to parser" affordance owned by ReviewTree (shown on any has_override
  // row). This block renders ONLY the Pending accept/reject UI.
  // Render nothing when there is no pending suggestion to act on.
  if (!(hasClass || hasParent)) return null;

  const canApply =
    (acceptCls && hasClass && clsAcceptable) || (acceptParent && hasParent && parentIsChange);
  // R3a (ADR-0006): an AI apply must never silently overwrite a standing decision (the other
  // provider's accepted suggestion OR a manual edit). Disable Apply while the row carries any
  // override; the user must first "Revert to parser" (the unified affordance in ReviewTree).
  const blockedByOverride = !!row.has_override;

  return (
    <div className="mb-2 rounded-md border border-violet-200 dark:border-violet-900 bg-violet-50/40 dark:bg-violet-950/20 p-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300 mb-1.5 flex items-center gap-1">
        <Sparkles className="h-3 w-3" /> Gemini suggestion
      </p>
      {hasClass && (
        <label
          className={cn(
            "flex items-center gap-2 text-xs mb-1",
            clsAcceptable ? "cursor-pointer" : "cursor-not-allowed",
          )}
          title={clsDetectionOnly ? DETECTION_ONLY_TOOLTIP : undefined}
        >
          <Checkbox
            checked={acceptCls}
            disabled={!clsAcceptable}
            onCheckedChange={(c) => setAcceptCls(!!c)}
          />
          <GeminiConfBadge
            conf={row.gemini_classification_confidence ?? null}
            title="Gemini classification confidence"
          />
          <span>
            Classification &rarr;{" "}
            <span className="font-medium">
              {CLS_LABELS[row.gemini_suggested_classification ?? ""] ??
                row.gemini_suggested_classification}
            </span>
            {clsDetectionOnly ? (
              <span className="text-muted-foreground italic"> (detection-only — not assignable)</span>
            ) : !clsIsChange ? (
              <span className="text-muted-foreground italic"> (no change)</span>
            ) : null}
          </span>
        </label>
      )}
      {hasParent && (
        <label
          className={cn(
            "flex items-center gap-2 text-xs mb-1",
            parentIsChange ? "cursor-pointer" : "cursor-not-allowed",
          )}
          title={parentOpensModal
            ? "This row has children — applying opens the restructure step to choose where the children go."
            : undefined}
        >
          <Checkbox
            checked={acceptParent}
            disabled={!parentIsChange}
            onCheckedChange={(c) => setAcceptParent(!!c)}
          />
          <GeminiConfBadge
            conf={row.gemini_parent_confidence ?? null}
            title="Gemini parent confidence"
          />
          <span>
            Parent &rarr; <span className="font-medium">{suggestedParentLabel}</span>
            {!parentIsChange && <span className="text-muted-foreground italic"> (no change)</span>}
            {parentOpensModal && (
              <span className="text-muted-foreground italic"> (opens restructure)</span>
            )}
          </span>
        </label>
      )}
      {row.gemini_explanation && (
        <p className="text-[11px] text-muted-foreground mb-1.5 leading-snug">
          {row.gemini_explanation}
        </p>
      )}
      {actionError && <p className="text-xs text-destructive mb-1">{actionError}</p>}
      {blockedByOverride && (
        <p className="text-[11px] text-muted-foreground italic mb-1.5 leading-snug">
          Revert this row to parser before applying an AI suggestion.
        </p>
      )}
      <div className="flex items-center gap-2">
        <span title={blockedByOverride
          ? "Revert this row to parser before applying an AI suggestion."
          : undefined}>
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!canApply || blockedByOverride || isAccepting || isRejecting}
            onClick={() => { void handleApply(); }}
          >
            {isAccepting ? "Applying…" : "Apply selected changes"}
          </Button>
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={isAccepting || isRejecting}
          onClick={() => { void handleReject(); }}
        >
          {isRejecting ? "Rejecting…" : "Reject"}
        </Button>
      </div>
    </div>
  );
}

export default GeminiAcceptBlock;
