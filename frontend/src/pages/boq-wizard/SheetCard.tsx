import { useState, type ReactNode } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";
import type { BoQSheetDraft, CommittedSheetState } from "./boqTypes";
import {
  computeSheetStages,
  type StageAccent,
  type StageDescriptor,
  type StageMarker,
  type StageState,
} from "./sheetCardStages";

// "date HH:MM" from a Frappe datetime string -- the wizard's slice(0,16) pattern
// (mirrors ReviewTree's formatEditAt). No date library, no TZ reparse.
function fmtCommittedAt(at: string | null | undefined): string {
  return typeof at === "string" ? at.slice(0, 16) : "";
}

// ── Accent -> Tailwind class registry ─────────────────────────────────────────
// ONE place for every zone-node / marker colour. Mirrors the old STATUS_PILL
// semantics one-to-one (blue/emerald/amber/sky/green/teal/red/slate/indigo) with
// full dark variants. sheetCardStages.ts stays React-free and hands back an accent
// token; this map turns it into classes so Tailwind's purge sees every literal.
const ACCENT: Record<
  StageAccent,
  { node: string; dot: string; tick: string; band: string; ring: string; badge: string }
> = {
  pending: {
    node: "bg-blue-500 border-blue-500 dark:bg-blue-600 dark:border-blue-600",
    dot: "bg-blue-500 dark:bg-blue-400",
    tick: "text-blue-600 dark:text-blue-400",
    band: "bg-blue-50/60 dark:bg-blue-950/20",
    ring: "ring-blue-500/20",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  config: {
    node: "bg-emerald-600 border-emerald-600 dark:bg-emerald-700 dark:border-emerald-700",
    dot: "bg-emerald-600 dark:bg-emerald-500",
    tick: "text-emerald-600 dark:text-emerald-500",
    band: "bg-emerald-50/60 dark:bg-emerald-950/20",
    ring: "ring-emerald-600/20",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  skip: {
    node: "bg-amber-500 border-amber-500 dark:bg-amber-600 dark:border-amber-600",
    dot: "bg-amber-500 dark:bg-amber-400",
    tick: "text-amber-600 dark:text-amber-400",
    band: "bg-amber-50/60 dark:bg-amber-950/20",
    ring: "ring-amber-500/20",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  gspec: {
    node: "bg-sky-500 border-sky-500 dark:bg-sky-600 dark:border-sky-600",
    dot: "bg-sky-500 dark:bg-sky-400",
    tick: "text-sky-600 dark:text-sky-400",
    band: "bg-sky-50/60 dark:bg-sky-950/20",
    ring: "ring-sky-500/20",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  },
  parsed: {
    node: "bg-green-600 border-green-600 dark:bg-green-700 dark:border-green-700",
    dot: "bg-green-600 dark:bg-green-500",
    tick: "text-green-600 dark:text-green-500",
    band: "bg-green-50/60 dark:bg-green-950/20",
    ring: "ring-green-600/20",
    badge: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
  final: {
    node: "bg-teal-600 border-teal-600 dark:bg-teal-700 dark:border-teal-700",
    dot: "bg-teal-600 dark:bg-teal-500",
    tick: "text-teal-600 dark:text-teal-500",
    band: "bg-teal-50/60 dark:bg-teal-950/20",
    ring: "ring-teal-600/20",
    badge: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  },
  failed: {
    node: "bg-red-600 border-red-600 dark:bg-red-700 dark:border-red-700",
    dot: "bg-red-600 dark:bg-red-500",
    tick: "text-red-600 dark:text-red-500",
    band: "bg-red-50/60 dark:bg-red-950/20",
    ring: "ring-red-600/20",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  hidden: {
    node: "bg-slate-500 border-slate-500 dark:bg-slate-600 dark:border-slate-600",
    dot: "bg-slate-500 dark:bg-slate-400",
    tick: "text-slate-600 dark:text-slate-400",
    band: "bg-slate-50/60 dark:bg-slate-900/30",
    ring: "ring-slate-500/20",
    badge: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  committed: {
    node: "bg-indigo-600 border-indigo-600 dark:bg-indigo-700 dark:border-indigo-700",
    dot: "bg-indigo-600 dark:bg-indigo-400",
    tick: "text-indigo-600 dark:text-indigo-400",
    band: "bg-indigo-50/50 dark:bg-indigo-950/20",
    ring: "ring-indigo-600/20",
    badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  },
};

const ZONE_LABELS: Record<1 | 2 | 3, string> = {
  1: "① Configure",
  2: "② Review",
  3: "③ Commit & Tender",
};


interface SheetCardProps {
  draft: BoQSheetDraft;
  /** Effective status -- may be "General specs" even when wizard_status differs. M2.16. */
  effectiveStatus: string;
  isLikelySkip: boolean;
  /** BOQs docname -- passed VERBATIM to endpoint calls (never trimmed). */
  boqName: string;
  /** Called after any successful write to trigger parent SWR re-fetch. */
  onSaved: () => void;
  /**
   * Called when the user clicks Review (Pending/Parse-failed) or Edit (Config Done/Parsed/Finalized).
   * Receives the VERBATIM sheet_name (no trimming). Parent (BoqHubPage) owns
   * navigate so SheetCard stays router-free.
   */
  onOpenSpoke?: (sheetName: string) => void;
  /**
   * Called when the user clicks Review on a Finalized card.
   * Navigates to the review screen (distinct from the config spoke).
   * Receives the VERBATIM sheet_name. Hub owns navigate; SheetCard stays router-free.
   */
  onOpenReview?: (sheetName: string) => void;
  /**
   * Work-header docnames for this sheet from get_boq_work_packages (Slice 3f-readback).
   * Replaces draft.work_packages read; undefined while the map is loading.
   */
  workHeaders?: string[];
  /**
   * Called when the user clicks the per-card "Re-parse" control (Force Re-parse slice).
   * Rendered ONLY on re-parse-eligible cards (has_prior_parse === 1 AND effective status
   * in Parsed / Finalized / Config Done). Opens the shared ParseRunDialog pre-filtered
   * to this one sheet. Receives the VERBATIM sheet_name; hub owns the dialog + navigate.
   */
  onReparse?: (sheetName: string) => void;
  /**
   * Called when the user clicks the per-card "Export CSV" control (Slice D2b),
   * rendered ONLY on a "Finalized" card. The HUB owns the fetch + the CSV
   * writer; this card awaits the returned promise to drive its own busy state and
   * surfaces any rejection via its inline cardError. Receives the VERBATIM
   * sheet_name (#152). Mirrors the onOpenReview / onReparse callback convention.
   */
  onExportCsv?: (sheetName: string) => Promise<void>;
  /**
   * This sheet's CURRENT committed-state (Phase 5 Slice 4b), from get_committed_state
   * keyed on sheet_name VERBATIM (#152). When present, stage ③ lights up with a
   * "◆ Committed v{n} · {date HH:MM}" badge (committed-ness is a SEPARATE marker from
   * the pipeline status -- NOT a wizard_status). Applies to finalized AND general-specs
   * alike. undefined => never committed (stage ③ stays "not committed").
   */
  committedState?: CommittedSheetState;
  /**
   * Amendment A1: per-sheet downstream orphanable state. When orphanable_count > 0 the card shows a
   * chip -- "{live_holder} pricing now" (rose) when another user holds a fresh pricing lock, else
   * "will orphan {n}" (amber). A re-parse / re-commit / un-finalize here would orphan that pricing.
   * undefined => uncommitted / unpriced (no chip).
   */
  downstreamState?: { orphanable_count: number; live_holder: string | null };
  /**
   * F2 "needs attention": this sheet's LIVE stale-config reason from get_stale_sheets
   * (Slice 1b), keyed by sheet_name VERBATIM (#152). undefined => not stale. The parse-
   * and commit-failure signals are read off `draft` (they ride the BOQs payload), so this
   * is the only extra signal that needs passing in.
   */
  staleReason?: string;
  /**
   * ADR-0013 A1: this BoQ was cloned from the master template (BOQsDoc.origin === "template").
   * A template BoQ has NO source workbook, so the Configure + Parse affordances are suppressed:
   * the stepper starts at ② Review (stage ① renders as a passive Config-Done summary) and
   * renderActions hides every Configure / Edit-Config / Re-parse control (Review + Export CSV stay).
   * Default false/undefined => upload origin (byte-identical to the pre-existing behaviour).
   */
  isTemplateOrigin?: boolean;
}

export function SheetCard({
  draft,
  effectiveStatus,
  isLikelySkip,
  boqName,
  onSaved,
  onOpenSpoke,
  onOpenReview,
  workHeaders,
  onReparse,
  onExportCsv,
  committedState,
  staleReason,
  downstreamState,
  isTemplateOrigin,
}: SheetCardProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);
  // F2: the "needs attention" detail block is collapsed by default; the chip toggles it.
  const [attnOpen, setAttnOpen] = useState(false);
  // Per-card CSV export busy state (Slice D2b) -- disables the button while the
  // hub fetches this sheet's rows; failure shows via the shared cardError line.
  const [exporting, setExporting] = useState(false);

  const { call: callStatus, loading: statusLoading } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_status"
  );
  const { call: callLabel, loading: labelLoading } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_label"
  );

  // Combined per-card saving state: spinner shows + ALL buttons on THIS card
  // are disabled while in flight. Other cards stay fully interactive.
  const isSaving = statusLoading || labelLoading;

  // ── 3-zone stage descriptors (pure mapping; ADR-0010 F4) ─────────────────
  // The rail structure + per-zone markers/states come from computeSheetStages;
  // this component only interpolates dynamic text (dates/reasons) + renders.
  const stages = computeSheetStages({
    effectiveStatus,
    hasPriorParse: draft.has_prior_parse === 1,
    committed: committedState,
    isTemplateOrigin,
  });

  // #164: this sheet is under active parse/re-parse -- disable its actions + show a
  // "Parsing..." indicator. Reads the per-sheet flag that rides the BOQs doc payload.
  const isParsing = draft.parse_in_progress === 1;

  // ── F2 "needs attention" signals ─────────────────────────────────────────
  // Three per-sheet signals: STALE CONFIG (live, via staleReason -- no timestamp),
  // PARSE FAILURE + COMMIT FAILURE (stamps on `draft`, with timestamps). DE-DUP: a live
  // stale reason that is byte-identical to a stored "Config stale" parse-failure reason
  // (the shared-helper guarantee) collapses to ONE "Stale config" line carrying the parse
  // timestamp. Other parse categories (Parser/Insert error) and commit failures are always
  // their own line. The chip shows iff there is >= 1 distinct line; healthy cards show none.
  const staleText = staleReason?.trim() || null;
  const parseText = draft.parse_failure_reason?.trim() || null;
  const commitText = draft.commit_failure_reason?.trim() || null;
  // The de-dup keys on raw `===` (the backend guarantees byte-identity for the stale case).
  const staleIsDupOfParse =
    !!staleText &&
    draft.parse_failure_category === "Config stale" &&
    draft.parse_failure_reason === staleReason;

  type AttnLine = {
    key: string;
    label: string;
    reason: string;
    at?: string | null; // timestamp (parse/commit only; stale has none)
    tone: "warning" | "destructive";
  };
  const attnLines: AttnLine[] = [];
  // Stale config gets its OWN line only when it is NOT merged into the parse line.
  if (staleText && !staleIsDupOfParse) {
    attnLines.push({ key: "stale", label: "Stale config", reason: staleText, tone: "warning" });
  }
  // Parse failure: when it IS the stale dup, render the merged "Stale config" line (with the
  // parse timestamp); otherwise a distinct "Parse failed (<category>)" line.
  if (parseText) {
    attnLines.push({
      key: "parse",
      label: staleIsDupOfParse
        ? "Stale config"
        : `Parse failed${draft.parse_failure_category ? ` (${draft.parse_failure_category})` : ""}`,
      reason: parseText,
      at: draft.parse_failure_at,
      tone: staleIsDupOfParse ? "warning" : "destructive",
    });
  }
  // Commit failure is always its own line (a different stage).
  if (commitText) {
    attnLines.push({
      key: "commit",
      label: "Commit failed",
      reason: commitText,
      at: draft.commit_failure_at,
      tone: "destructive",
    });
  }
  // Chip is RED when ANY failure STAMP is present (parse or commit), AMBER when only stale.
  const hasFailureStamp = !!parseText || !!commitText;
  const attnCount = attnLines.length;

  // ── Re-parse eligibility (Force Re-parse slice) ──────────────────────────
  // A sheet is re-parse-eligible iff it has a prior parse AND its effective status
  // is one the backend force_reparse path admits (Parsed / Finalized / Config Done).
  // Parse failed is DELIBERATELY excluded -- the backend does NOT widen force_reparse to it
  // (parse_run.assemble_mapping_config Rule 4); offering it would be a no-op control.
  // Never-parsed sheets (has_prior_parse !== 1) never show a Re-parse control.
  const canReparse =
    draft.has_prior_parse === 1 &&
    (effectiveStatus === "Parsed" ||
      effectiveStatus === "Finalized" ||
      effectiveStatus === "Config Done");

  // One muted summary line -- priority: sheet_label > workHeaders > keyword hint.
  // workHeaders comes from get_boq_work_packages (Slice 3f-readback), not draft.work_packages
  // (which is always empty -- Frappe get_doc does not hydrate grandchild rows).
  // Trim is display-only; draft.sheet_name stays exact for any data use.
  const summaryLine: string | null =
    (draft.sheet_label?.trim() || null) ??
    (workHeaders?.length
      ? workHeaders.join(", ")
      : null) ??
    (isLikelySkip ? "Likely non-data sheet -- consider skipping" : null);

  // True when the summary line IS the keyword hint (no label, no assigned work headers).
  // Used to apply stronger visual treatment -- presentation only, no data change.
  const isKeywordHint = isLikelySkip && !draft.sheet_label?.trim() && !(workHeaders?.length);

  // ── Status-change handler ────────────────────────────────────────────────
  const handleStatusChange = async (status: string) => {
    setCardError(null);
    try {
      // EXACT: sheet_name passed verbatim -- backend matches without whitespace trimming.
      await callStatus({ boq_name: boqName, sheet_name: draft.sheet_name, status });
      onSaved();
    } catch (_e) {
      setCardError("Status update failed. Please try again.");
    }
  };

  // ── Label editor handlers ────────────────────────────────────────────────
  const openLabelEdit = () => {
    setLabelInput(draft.sheet_label ?? "");
    setEditingLabel(true);
    setCardError(null);
  };

  const handleSaveLabel = async () => {
    setCardError(null);
    try {
      // EXACT: sheet_name passed verbatim. label="" clears the field.
      await callLabel({ boq_name: boqName, sheet_name: draft.sheet_name, label: labelInput });
      setEditingLabel(false);
      onSaved();
    } catch (_e) {
      setCardError("Label save failed. Please try again.");
    }
  };

  // ── Per-card CSV export (Slice D2b) ──────────────────────────────────────
  // Hub owns the fetch + writer; the card just drives busy + error locally.
  const handleExportCsv = async () => {
    if (!onExportCsv) return;
    setCardError(null);
    setExporting(true);
    try {
      await onExportCsv(draft.sheet_name); // VERBATIM #152
    } catch (e) {
      setCardError(getFrappeError(e) || "Could not export this sheet. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // ── Dynamic marker sub-text (dates/reasons the pure helper deliberately omits) ──
  const zone1DynamicSub =
    effectiveStatus === "Config Done" && draft.has_prior_parse === 1 && draft.last_parsed_at
      ? `last parsed ${formatDate(draft.last_parsed_at)}`
      : undefined;
  let zone2DynamicSub: string | undefined;
  if (effectiveStatus === "Parsed" && draft.last_parsed_at) zone2DynamicSub = `Parsed ${formatDate(draft.last_parsed_at)}`;
  else if (effectiveStatus === "Finalized" && draft.last_parsed_at) zone2DynamicSub = `Parsed ${formatDate(draft.last_parsed_at)}`;
  else if (effectiveStatus === "Parse failed" && draft.parse_failure_at) zone2DynamicSub = fmtCommittedAt(draft.parse_failure_at);

  // The zones actually rendered: ① always; ② unless N/A (aside skip/hidden/general-specs);
  // ③ unless hidden (uncommitted aside / general-specs). Aside cards collapse to one zone.
  const renderZones: Array<{ n: 1 | 2 | 3; d: StageDescriptor; dyn?: string }> = [
    { n: 1, d: stages.stage1, dyn: zone1DynamicSub },
  ];
  if (stages.stage2.state !== "na") renderZones.push({ n: 2, d: stages.stage2, dyn: zone2DynamicSub });
  if (stages.stage3.state !== "hidden") renderZones.push({ n: 3, d: stages.stage3 });

  // ── Zone-node visual (filled/outlined circle + glyph) per state ──────────
  const nodeVisual = (state: StageState, accent: StageAccent | undefined, zoneNum: number) => {
    switch (state) {
      case "active":
        return { cls: cn(ACCENT[accent ?? "pending"].node, "text-white ring-2 ring-offset-1 ring-offset-background", ACCENT[accent ?? "pending"].ring), content: zoneNum as ReactNode };
      case "active-done":
        return { cls: cn(ACCENT[accent ?? "config"].node, "text-white ring-2 ring-offset-1 ring-offset-background", ACCENT[accent ?? "config"].ring), content: "✓" };
      case "done":
        return { cls: cn(ACCENT.config.node, "text-white"), content: "✓" };
      case "committed":
        return { cls: cn(ACCENT.committed.node, "text-white"), content: "◆" };
      default: // unreached
        return { cls: "border-border bg-background text-muted-foreground/60", content: zoneNum as ReactNode };
    }
  };

  // A completed zone (done / active-done) turns its downward rail connector emerald.
  const barIsDone = (state: StageState) => state === "done" || state === "active-done";

  // ── Marker renderer (static content from helper + optional dynamic sub) ──
  const renderMarker = (marker: StageMarker, dynamicSub?: string) => {
    const acc = marker.accent ? ACCENT[marker.accent] : null;
    if (marker.kind === "muted") {
      return <span className="text-xs italic text-muted-foreground/70">{marker.label}</span>;
    }
    if (marker.kind === "badge") {
      return (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", acc?.badge)}>{marker.label}</span>
          {marker.sub && <span>{marker.sub}</span>}
        </span>
      );
    }
    // dot / tick -- one sub at most (static OR dynamic), joined defensively.
    const sub = [marker.sub, dynamicSub].filter(Boolean).join(" · ");
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
        {marker.kind === "dot" ? (
          <span className={cn("h-2 w-2 shrink-0 rounded-full", acc?.dot)} />
        ) : (
          <span className={cn("text-xs font-bold leading-none", acc?.tick)}>✓</span>
        )}
        <span>{marker.label}</span>
        {sub && <span className="font-normal text-muted-foreground"> &middot; {sub}</span>}
      </span>
    );
  };

  // ── Action row for the button-bearing zone (relocated verbatim per status) ──
  // ADR-0013 A1: a TEMPLATE-origin BoQ has no source workbook, so every Configure /
  // Edit-Config / Skip / Set-Pending / Include / Re-parse control is suppressed
  // (`showConfig`). Review + Export CSV survive -- they are review/export affordances,
  // not workbook-config. On upload origin `showConfig` is true -> byte-identical behaviour.
  const showConfig = !isTemplateOrigin;
  const renderActions = () => {
    switch (effectiveStatus) {
      case "Pending":
        return showConfig ? (
          <>
            {/* Review Config: navigates to the per-sheet spoke (Module 3 Slice 3b-ii). */}
            <Button size="sm" variant="ghost" disabled={isSaving}
              onClick={() => onOpenSpoke?.(draft.sheet_name)}>
              Review Config
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving}
              onClick={() => void handleStatusChange("Skip")}>
              Skip Sheet
            </Button>
          </>
        ) : null;
      case "Config Done":
        return showConfig ? (
          <>
            {/* Edit Config: navigates to the per-sheet spoke (Module 3 Slice 3b-ii). */}
            <Button size="sm" variant="ghost" disabled={isSaving || isParsing}
              onClick={() => onOpenSpoke?.(draft.sheet_name)}>
              Edit Config
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving || isParsing}
              onClick={() => void handleStatusChange("Pending")}>
              Set Pending
            </Button>
            {/* Re-parse Sheet: only on a dirty Config Done card (has_prior_parse === 1). */}
            {canReparse && (
              <Button size="sm" variant="outline" disabled={isSaving || isParsing}
                onClick={() => onReparse?.(draft.sheet_name)}>
                Re-parse Sheet
              </Button>
            )}
          </>
        ) : null;
      case "Skip":
        return showConfig ? (
          <>
            <Button size="sm" variant="ghost" disabled={isSaving}
              onClick={openLabelEdit} className="h-6 px-2 text-xs">
              Edit label
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving}
              onClick={() => void handleStatusChange("Pending")} className="h-6 px-2 text-xs">
              Include
            </Button>
          </>
        ) : null;
      case "Hidden":
        return showConfig ? (
          <Button size="sm" variant="outline" disabled={isSaving}
            onClick={() => void handleStatusChange("Pending")} className="h-6 px-2 text-xs">
            Include
          </Button>
        ) : null;
      case "Parse failed":
        return showConfig ? (
          <>
            {/* Review Config: navigates to the per-sheet spoke (Module 3 Slice 3b-ii).
                #164: Parse-failed is force-re-parse eligible (v5.46), so it can be
                superset-marked mid-parse -- disable + indicate while parsing. */}
            <Button size="sm" variant="ghost" disabled={isSaving || isParsing}
              onClick={() => onOpenSpoke?.(draft.sheet_name)}>
              Review Config
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving || isParsing}
              onClick={() => void handleStatusChange("Skip")}>
              Skip Sheet
            </Button>
          </>
        ) : null;
      case "Parsed":
        return (
          <>
            {/* Review: navigates to the review SCREEN (same as the hub's bottom
                "Review parsed sheets" list), NOT the config spoke. */}
            <Button size="sm" variant="ghost" disabled={isSaving || isParsing}
              onClick={() => onOpenReview?.(draft.sheet_name)}>
              Review
            </Button>
            {/* Edit Config: navigates to the per-sheet spoke (Module 3 Slice 3b-ii).
                Template origin -> suppressed (no source workbook to re-configure). */}
            {showConfig && (
              <Button size="sm" variant="ghost" disabled={isSaving || isParsing}
                onClick={() => onOpenSpoke?.(draft.sheet_name)}>
                Edit Config
              </Button>
            )}
            {/* Re-parse Sheet: discards this Parsed sheet's rows + any review-screen edits. */}
            {showConfig && canReparse && (
              <Button size="sm" variant="outline" disabled={isSaving || isParsing}
                onClick={() => onReparse?.(draft.sheet_name)}>
                Re-parse Sheet
              </Button>
            )}
          </>
        );
      case "Finalized":
        return (
          <>
            {/* Review navigates to the review screen (not the config spoke). */}
            <Button size="sm" variant="ghost" disabled={isSaving || isParsing}
              onClick={() => onOpenReview?.(draft.sheet_name)}>
              Review
            </Button>
            {/* A1: Edit Config -> the spoke, where a Finalized sheet shows the
                un-mark-and-edit affordance (makes the freeze reversible in-UI).
                Template origin -> suppressed (no source workbook to re-configure). */}
            {showConfig && (
              <Button size="sm" variant="ghost" disabled={isSaving || isParsing}
                onClick={() => onOpenSpoke?.(draft.sheet_name)}>
                Edit Config
              </Button>
            )}
            {/* Re-parse Sheet: discards a hand-reviewed+checked sheet's rows + all review work.
                Reordered BEFORE Export CSV (WI-B). */}
            {showConfig && canReparse && (
              <Button size="sm" variant="outline" disabled={isSaving || isParsing}
                onClick={() => onReparse?.(draft.sheet_name)}>
                Re-parse Sheet
              </Button>
            )}
            {/* Export CSV (Slice D2b): single-sheet .csv via the hub-owned fetch. */}
            {onExportCsv && (
              <Button size="sm" variant="outline" disabled={isSaving || exporting || isParsing}
                onClick={() => void handleExportCsv()}>
                {exporting ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1 h-3.5 w-3.5" />
                )}
                Export CSV
              </Button>
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className={cn(
      "overflow-hidden rounded-lg border border-border",
      stages.aside ? "bg-muted/30" : "bg-background",
    )}>

      {/* ── Header: name + summary + transient/attention cluster ─────────── */}
      <div className="flex items-start gap-2.5 px-4 pt-3 pb-2.5">
        <div className="flex-1 min-w-0">
          {/* Display-trimmed name. draft.sheet_name is used verbatim for keys/calls. */}
          <p className="text-sm font-medium text-foreground truncate leading-5">
            {draft.sheet_name.trim() || draft.sheet_name}
          </p>
          {summaryLine && (
            <div className="mt-0.5 flex items-center gap-1 leading-4">
              {isKeywordHint && (
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" />
              )}
              <p className={cn(
                "text-xs leading-4 truncate",
                isKeywordHint
                  ? "text-amber-600 font-medium dark:text-amber-400"
                  : "text-muted-foreground",
              )}>
                {summaryLine}
              </p>
            </div>
          )}
        </div>
        {/* Header-right: transient (saving / parsing) + attention signals ONLY.
            The status, committed, priced-since-export and orphan markers now live
            in their owning zone -- the header stays uncluttered. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {/* #164: transient parsing indicator (matches the hub footer's Parsing... pattern). */}
          {isParsing && (
            <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">
              <Loader2 className="h-3 w-3 animate-spin" />
              Parsing&hellip;
            </span>
          )}
          {/* Dirty indicator: Config Done sheet whose config changed since last parse.
              Template origin -> suppressed (no Parse button to act on it). */}
          {showConfig && effectiveStatus === "Config Done" && draft.has_prior_parse === 1 && (
            <span className="rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              needs re-parse
            </span>
          )}
          {/* F2: "needs attention" chip -- RED when a failure stamp is present, AMBER when
              only stale-config. Click toggles the inline detail block below. */}
          {attnCount > 0 && (
            <button
              type="button"
              onClick={() => setAttnOpen((prev) => !prev)}
              aria-expanded={attnOpen}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                hasFailureStamp
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              {attnCount} {attnCount === 1 ? "issue" : "issues"}
            </button>
          )}
        </div>
      </div>

      {/* F2: "needs attention" detail block -- collapsed by default, toggled by the chip.
          One line per distinct signal (after de-dup): label, optional timestamp, reason. */}
      {attnOpen && attnCount > 0 && (
        <div className="mx-4 mb-1 space-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
          {attnLines.map((l) => (
            <div key={l.key} className="text-xs">
              <span className={cn(
                "font-medium",
                l.tone === "destructive"
                  ? "text-destructive"
                  : "text-amber-700 dark:text-amber-400"
              )}>
                {l.label}
              </span>
              {l.at && (
                <span className="text-muted-foreground"> &middot; {fmtCommittedAt(l.at)}</span>
              )}
              <p className="mt-0.5 break-words text-muted-foreground">{l.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── The persistent 3-zone stepper ────────────────────────────────── */}
      <TooltipProvider>
        <div className="border-t border-border/60">
          {renderZones.map(({ n, d, dyn }, idx) => {
            const isLast = idx === renderZones.length - 1;
            const node = nodeVisual(d.state, d.marker.accent, n);
            const bandClass =
              d.state === "active" || d.state === "active-done"
                ? ACCENT[d.marker.accent ?? "pending"].band
                : d.state === "committed"
                ? ACCENT.committed.band
                : undefined;
            const isButtonZone = stages.buttonZone === n;
            return (
              <div key={n} className="grid grid-cols-[28px_1fr]">
                {/* rail: node + downward connector (hidden on the last zone) */}
                <div className="flex flex-col items-center pt-3">
                  <div className={cn(
                    "z-10 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border text-[10px] font-bold leading-none",
                    node.cls,
                  )}>
                    {node.content}
                  </div>
                  {!isLast && (
                    <div className={cn(
                      "my-0.5 w-0.5 flex-1 min-h-[10px] rounded",
                      barIsDone(d.state) ? "bg-emerald-500/60 dark:bg-emerald-600/50" : "bg-border",
                    )} />
                  )}
                </div>

                {/* body: label + marker (+ dynamic bits) + actions / commit block */}
                <div className={cn("py-2.5 pr-4 pl-1", bandClass)}>
                  <div className={cn(
                    "flex gap-2.5",
                    d.state === "committed" ? "items-start" : "items-center",
                  )}>
                    <span className="w-[74px] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                      {ZONE_LABELS[n]}
                    </span>

                    {/* Stage ③ committed = read-only block: badge ALONE on the marker
                        line, warnings/hint stacked below (never on the badge line). */}
                    {n === 3 && d.state === "committed" && committedState ? (
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold",
                            ACCENT.committed.badge,
                          )}>
                            &#9670; Committed v{committedState.commit_version}
                            <span className="font-normal opacity-70">
                              &middot; {fmtCommittedAt(committedState.committed_at)}
                            </span>
                          </span>
                        </div>
                        <div className="flex flex-col items-start gap-1.5">
                          {/* Staleness chip (Slice 5b): priced since last export -- own line. */}
                          {committedState.pricing_changed_since_export && (
                            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              priced since last export
                            </span>
                          )}
                          {/* Amendment A1: directional orphan chip + note (warn-only). */}
                          {downstreamState && downstreamState.orphanable_count > 0 && (
                            downstreamState.live_holder ? (
                              <>
                                <span
                                  className="rounded-full px-2 py-0.5 text-xs font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                                  title={`${downstreamState.live_holder} is pricing this sheet now -- re-parsing / re-committing / un-finalizing it will orphan their work.`}
                                >
                                  {downstreamState.live_holder} pricing now
                                </span>
                                <span className="text-xs text-amber-700 dark:text-amber-400">
                                  Re-parsing / re-committing here would orphan their priced cells.
                                </span>
                              </>
                            ) : (
                              <span
                                className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                title="Re-parsing, re-committing or un-finalizing this sheet will orphan its priced cells."
                              >
                                will orphan {downstreamState.orphanable_count}
                              </span>
                            )
                          )}
                          <span className="text-[10.5px] italic text-muted-foreground/60">
                            Ready for tendering &mdash; click Tendering below.
                          </span>
                        </div>
                      </div>
                    ) : n === 3 && effectiveStatus === "Finalized" && !committedState ? (
                      /* Next-step CTA (WI-B): a Finalized-but-uncommitted sheet points at the
                         footer's Commit, replacing the muted "-- not committed" marker. All
                         other uncommitted states keep the muted dash. */
                      <div className="min-w-0">
                        <span className="text-xs text-muted-foreground">
                          Ready to commit &mdash; click <span className="font-medium">Commit</span> below.
                        </span>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        {renderMarker(d.marker, dyn)}
                      </div>
                    )}
                  </div>

                  {/* Parse-failed inline reason -- surfaces IN zone ② (its stage). */}
                  {n === 2 && effectiveStatus === "Parse failed" && attnLines.find((l) => l.key === "parse") && (
                    <p className="mt-1.5 flex items-start gap-1 pl-[84px] text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="break-words">{attnLines.find((l) => l.key === "parse")?.reason}</span>
                    </p>
                  )}

                  {/* Action row -- ONLY in the button-bearing zone. */}
                  {isButtonZone && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-[84px]">
                      {renderActions()}
                    </div>
                  )}

                  {/* Next-step CTA (WI-B): Config Done points at the footer's Parse workbook.
                      Shown for all Config Done (incl. dirty / needs-re-parse). Template
                      origin -> suppressed (no Parse button; the stepper starts at Review). */}
                  {showConfig && n === 1 && effectiveStatus === "Config Done" && (
                    <p className="mt-1.5 pl-[84px] text-xs text-muted-foreground">
                      Ready to parse &mdash; click <span className="font-medium">Parse workbook</span> below.
                    </p>
                  )}

                  {/* General-specs note: selector-governed, no buttons. Template origin ->
                      suppressed (the general-specs selector is hidden; disposition is fixed
                      by the template), leaving just the "General specs" badge. */}
                  {showConfig && n === 1 && stages.aside === "general_specs" && (
                    <p className="mt-1.5 pl-[84px] text-xs text-muted-foreground">
                      This sheet is the general specifications sheet. Change it via the selector above.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </TooltipProvider>

      {/* ── Inline label editor (Skip cards) ─────────────────────────────── */}
      {editingLabel && (
        <div className="flex items-center gap-2 px-4 py-2.5">
          <input
            className="flex-1 h-7 rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            value={labelInput}
            placeholder="Sheet label (optional -- leave empty to clear)"
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSaveLabel();
              if (e.key === "Escape") setEditingLabel(false);
            }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <Button size="sm" disabled={isSaving} onClick={() => void handleSaveLabel()}
            className="h-7 px-2 text-xs">
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingLabel(false)}
            className="h-7 px-2 text-xs">
            Cancel
          </Button>
        </div>
      )}

      {/* ── Inline error (wizard convention: text-destructive, never a toast) ── */}
      {cardError && (
        <p className="px-4 pb-2.5 text-xs text-destructive">{cardError}</p>
      )}
    </div>
  );
}
