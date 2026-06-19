/**
 * SheetReviewPage -- read-only review screen for a parsed BoQ sheet (Slice B1).
 *
 * Shell structure mirrors SheetSpokePage:
 *   - useParams for boqId + sheetName (React Router v6 auto-decodes).
 *   - useFrappeGetDoc for the BOQs header (boq_name, version).
 *   - useFrappeGetCall for get_review_rows (all parsed rows for this sheet).
 *   - Full-page spinner while BOQs doc loads; inline loading/error for rows.
 *   - Back nav to /upload-boq/hub/:boqId (entity-id convention, never navigate(-1)).
 *
 * B1 scope (read-only spine):
 *   - Renders ReviewTree (nesting tree from effective_parent_index chain walk).
 *   - No flag overlays, no row-detail panel (B2).
 *   - No editing affordances, no mark-as-done wiring (C/D).
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappePostCall,
} from "frappe-react-sdk";
import { ArrowLeft, Check, Download, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getFrappeError } from "@/utils/frappeErrors";
import type {
  AiPassDonePayload,
  BOQsDoc,
  GetReviewRowsResponse,
  MarkParsedCheckDoneResponse,
  StructuralBreak,
  UnmarkParsedCheckDoneResponse,
} from "./boqTypes";
import { ReviewTree } from "./ReviewTree";
import { buildAndDownloadReviewCsv } from "./exportReviewCsv";

// Slice D1: human-readable labels for structural-break types shown in the mark
// warn-and-confirm escalation dialog.
const BREAK_TYPE_LABELS: Record<string, string> = {
  orphan: "Orphan line item",
  line_item_as_parent: "Line item used as a parent",
  cycle: "Parent cycle",
};

// AI-3a: readable messages for run_ai_pass's {ok:false, error} pre-flight rejections.
const AI_REJECT_MSGS: Record<string, string> = {
  not_parsed: "This sheet has no parsed rows yet. Parse it before running the AI pass.",
  ai_disabled: "The AI pass is disabled. Enable it in BOQ Upload Review AI Settings.",
  no_api_key: "No Anthropic API key is configured. Set one in BOQ Upload Review AI Settings.",
};
// AI-3a: readable messages for a terminal AI-pass FAILURE (boq:ai_pass_done error_code).
const AI_FAIL_MSGS: Record<string, string> = {
  ai_failed: "The AI pass failed — the model could not be reached or returned an unusable response. Try again.",
  internal: "The AI pass hit an unexpected error. Try again.",
};

// AI-3a: get_ai_pass_status response -- the cached terminal payload OR the idle shape.
type AiStatusResponse =
  | AiPassDonePayload
  | { status: "idle_or_unknown"; ai_in_progress: 0 | 1 };

// C-v2: format the save-anchor timestamp. edited_at is the server-local naive
// string from frappe.utils.now() ("YYYY-MM-DD HH:MM:SS.ffffff"); parse as local.
function fmtSavedTime(iso: string): string {
  try {
    const d = new Date(iso.replace(" ", "T"));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

const SheetReviewPage = () => {
  const { boqId, sheetName } = useParams<{ boqId: string; sheetName: string }>();
  const navigate = useNavigate();

  // BOQs doc: header info (boq_name, version). Same pattern as SheetSpokePage.
  // Third arg null disables until boqId is present (useFrappeGetDoc swrKey gotcha).
  const { data: boq, isLoading, mutate: boqMutate } = useFrappeGetDoc<BOQsDoc>(
    "BOQs",
    boqId ?? "",
    boqId ? undefined : null,
  );

  // Review rows: all parsed BoQ Review Rows for (boqId, sheetName).
  // useFrappeGetCall -- GET-capable endpoint, SWR-managed, no accumulation needed.
  // Loading: data === undefined (key enabled). Error: data === null.
  const { data: reviewData, mutate } = useFrappeGetCall<{ message: GetReviewRowsResponse }>(
    "nirmaan_stack.api.boq.wizard.review_screen.get_review_rows",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    // Disable until both params are present (routing guarantees them, but be defensive).
    boqId && sheetName ? undefined : null,
  );

  // C-v2: sheet-level save-status anchor. Set from each resolved save's returned
  // edited_at for an instant update (does not wait for the get_review_rows refetch).
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // C-v2: after a value edit saves, advance the anchor + refresh the grid so the
  // row flips to "Edited" (green tint) and its edit history gains an entry.
  const handleSaved = (editedAt: string) => {
    setLastSavedAt(editedAt);
    void mutate();
  };

  // RR v6 auto-decodes path params -- sheetName is the verbatim DB-stored string.
  const decodedSheetName = sheetName ?? "";
  const displaySheetName = decodedSheetName.trim() || decodedSheetName;

  // Back nav: semantic entity-id route -- never navigate(-1) (survives hard refresh).
  const handleBack = () => navigate(`/upload-boq/hub/${boqId ?? ""}`);

  // ── Slice D1: Finalized marking + read-only freeze (renamed A1) ─────────────
  // Sheet status rides the BOQs doc payload (boq.sheet_drafts is a one-level child
  // table -> serializes). sheetName is VERBATIM (no trim -- #152 trailing-space guard).
  const sheetDraft = boq?.sheet_drafts?.find(
    (d) => d.sheet_name === (sheetName ?? ""),
  );
  const sheetStatus = sheetDraft?.wizard_status;
  const isChecked = sheetStatus === "Finalized";
  // #164: the sheet is under active parse/re-parse -> the screen is transiently
  // read-only (the worker is rebuilding these rows). Same draft lookup, new flag.
  const isParsing = sheetDraft?.parse_in_progress === 1;

  // ── AI-3a: AI-pass trigger + poll-safe completion ───────────────────────────
  // aiInProgress rides the BOQs doc (sheet_drafts child) -- mirror of isParsing. An AI
  // pass does NOT make the screen read-only (it only writes ai_* suggestion fields,
  // never human/parser data), so it does NOT feed ReviewTree's readOnly.
  const aiInProgress = sheetDraft?.ai_in_progress === 1;
  const { socket } = useContext(FrappeContext) as FrappeConfig;

  // Trigger + status-poll endpoints.
  const { call: runAiCall, loading: aiRunLoading } = useFrappePostCall<{
    message: { ok: boolean; error?: string; cached?: boolean; enqueued?: boolean; count?: number };
  }>("nirmaan_stack.api.boq.wizard.ai_assist.run_ai_pass");
  const { call: aiStatusCall } = useFrappePostCall<{ message: AiStatusResponse }>(
    "nirmaan_stack.api.boq.wizard.ai_assist.get_ai_pass_status",
  );

  // Pre-flight message (the {ok:false} rejections + thrown errors). Result/error banner
  // for a completed pass. count=null => "complete" with no number (cached-miss edge).
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ count: number | null; cached: boolean } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Poll interval id held in a ref so cleanup is reliable (a leaked interval hammering
  // the endpoint is its own bug). stopAiPoll is idempotent.
  const aiPollRef = useRef<number | null>(null);
  const stopAiPoll = useCallback(() => {
    if (aiPollRef.current !== null) {
      clearInterval(aiPollRef.current);
      aiPollRef.current = null;
    }
  }, []);

  // Resolve a terminal AI outcome (from EITHER the socket fast-path or the poll). Stops
  // the poll, sets the result/error banner, and refreshes both the rows (get_review_rows,
  // so badges appear) and the BOQs doc (so ai_in_progress clears). Idempotent: a
  // socket+poll double-resolve just repeats harmless setState + mutate.
  const resolveAiOutcome = useCallback(
    (payload: AiPassDonePayload) => {
      stopAiPoll();
      if (payload.status === "success") {
        setAiResult({ count: payload.count ?? null, cached: false });
        setAiError(null);
      } else {
        setAiError(AI_FAIL_MSGS[payload.error_code ?? ""] ?? AI_FAIL_MSGS.internal);
        setAiResult(null);
      }
      void mutate();
      void boqMutate();
    },
    // mutate / boqMutate / stopAiPoll are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // LAYER 1 -- socket fast path. Mirror BoqHubPage's boq:parse_run_done listener:
  // guard this (boq, sheet), resolve, plus a reconnect re-fetch self-heal.
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: AiPassDonePayload) => {
      if (payload.boq_name !== boqId || payload.sheet_name !== (sheetName ?? "")) return;
      resolveAiOutcome(payload);
    };
    const onReconnect = () => { void boqMutate(); };
    socket.on("boq:ai_pass_done", handler);
    socket.on("connect", onReconnect);
    return () => {
      socket.off("boq:ai_pass_done", handler);
      socket.off("connect", onReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, boqId, sheetName, resolveAiOutcome]);

  // LAYER 2 + 3 -- poll-until-terminal (the GUARANTEE) + on-mount recovery. Whenever
  // aiInProgress is true (we just enqueued, OR the sheet loaded mid-pass after navigating
  // away), poll get_ai_pass_status every 3s. This resolves the screen within ~3s even if
  // the socket event is missed entirely (the historical parse/upload missed-socket hang).
  // When the pass ends, ai_in_progress clears -> aiInProgress flips false -> cleanup stops
  // the interval. Terminal cached payload (success/error) resolves immediately via
  // resolveAiOutcome; an idle+flag-0 edge (finished, no cached payload) refreshes + stops.
  useEffect(() => {
    if (!aiInProgress) { stopAiPoll(); return; }
    if (aiPollRef.current !== null) return; // already polling -- no double-registration
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const res = await aiStatusCall({ boq_name: boqId ?? "", sheet_name: sheetName ?? "" });
          const m = res.message;
          if (m.status === "success" || m.status === "error") {
            resolveAiOutcome(m);
          } else if (m.status === "idle_or_unknown" && m.ai_in_progress === 0) {
            // Finished with no cached terminal payload -- refresh + stop; show generic done.
            stopAiPoll();
            void mutate();
            void boqMutate();
            setAiResult((prev) => prev ?? { count: null, cached: false });
          }
        } catch {
          // transient (network/CSRF blip) -- keep polling; the next tick retries.
        }
      })();
    }, 3000);
    aiPollRef.current = id;
    return () => stopAiPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiInProgress, boqId, sheetName, resolveAiOutcome]);

  // Trigger handler. Three documented run_ai_pass shapes (verified vs ai_assist.py):
  // {ok:false,error}; {ok:true,cached:true,count}; {ok:true,enqueued:true,job_id}.
  const handleRunAiPass = async () => {
    setAiMessage(null);
    setAiResult(null);
    setAiError(null);
    try {
      const res = await runAiCall({ boq_name: boqId ?? "", sheet_name: sheetName ?? "" });
      const m = res.message;
      if (!m.ok) {
        setAiMessage(AI_REJECT_MSGS[m.error ?? ""] ?? "Could not start the AI pass.");
        return;
      }
      if (m.cached) {
        // Applied synchronously -- NO socket will fire. Refresh rows so badges appear.
        void mutate();
        setAiResult({ count: m.count ?? 0, cached: true });
        return;
      }
      // Enqueued -> the server set ai_in_progress=1 + committed. Re-fetch the BOQs doc so
      // aiInProgress flips true and the poll (Layer 2) arms; the socket (Layer 1) may also
      // fire. Either resolves; the poll is the guarantee.
      void boqMutate();
    } catch (e: unknown) {
      setAiMessage(getFrappeError(e) || "Could not start the AI pass.");
    }
  };

  const { call: markCall, loading: markLoading } = useFrappePostCall<{
    message: MarkParsedCheckDoneResponse;
  }>("nirmaan_stack.api.boq.wizard.review_screen.mark_sheet_parsed_check_done");
  const { call: unmarkCall, loading: unmarkLoading } = useFrappePostCall<{
    message: UnmarkParsedCheckDoneResponse;
  }>("nirmaan_stack.api.boq.wizard.review_screen.unmark_sheet_parsed_check_done");

  // Mark dialog: markBreaks === null -> light confirm; non-null -> breaks escalation.
  const [markDialogOpen, setMarkDialogOpen] = useState(false);
  const [markBreaks, setMarkBreaks] = useState<StructuralBreak[] | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [unmarkDialogOpen, setUnmarkDialogOpen] = useState(false);
  const [unmarkError, setUnmarkError] = useState<string | null>(null);

  const openMarkDialog = () => {
    setMarkBreaks(null);
    setMarkError(null);
    setMarkDialogOpen(true);
  };
  const closeMarkDialog = () => {
    setMarkDialogOpen(false);
    setMarkBreaks(null);
    setMarkError(null);
  };

  // POST mark; confirm=false on the first pass (light confirm), confirm=true to
  // override structural breaks (escalation "Mark anyway"). ok:false+breaks -> escalate.
  const confirmMark = async (override: boolean) => {
    setMarkError(null);
    try {
      const res = await markCall({
        boq_name: boqId ?? "",
        sheet_name: sheetName ?? "", // VERBATIM #152
        confirm: override,
      });
      const msg = res.message;
      if (msg.ok) {
        closeMarkDialog();
        void boqMutate();
      } else {
        // Structural issues -> switch the same dialog to the escalation view.
        setMarkBreaks(msg.breaks ?? []);
      }
    } catch (e: unknown) {
      setMarkError(getFrappeError(e) || "Could not mark the sheet. Please try again.");
    }
  };

  const handleUnmark = async () => {
    setUnmarkError(null);
    try {
      await unmarkCall({
        boq_name: boqId ?? "",
        sheet_name: sheetName ?? "", // VERBATIM #152
      });
      setUnmarkDialogOpen(false);
      void boqMutate();
    } catch (e: unknown) {
      setUnmarkError(getFrappeError(e) || "Could not un-mark the sheet. Please try again.");
    }
  };

  // ── Full-page spinner while BOQs doc loads ──────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Not-found state ─────────────────────────────────────────────────────────
  if (!boq) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
        <p className="font-medium text-foreground">BoQ not found</p>
        <p className="text-sm text-muted-foreground">
          No record found for &ldquo;{boqId}&rdquo;.
        </p>
        <Button variant="outline" className="mt-4" onClick={handleBack}>
          Back to hub
        </Button>
      </div>
    );
  }

  // ── Missing sheet name in URL (routing guarantees it, but be defensive) ─────
  if (!sheetName) {
    return (
      <p className="p-6 text-sm text-destructive">Missing sheet identifier in URL.</p>
    );
  }

  // Row data derived from the review-rows fetch.
  const rows = reviewData?.message?.rows ?? [];
  const columnDescriptors = reviewData?.message?.column_descriptors ?? [];
  const flags = reviewData?.message?.flags ?? [];
  const reviewLoading = reviewData === undefined;
  const reviewError = reviewData === null;

  // OBS-2: per-category flag counts for the summary strip.
  const FLAG_LABELS: Record<string, string> = {
    zero_amount_line_item: "zero-amount",
    orphan: "orphan",
    parser: "needs-review",
    priced_preamble_no_children: "priced-preamble",
  };
  const FLAG_ORDER = ["zero_amount_line_item", "orphan", "parser", "priced_preamble_no_children"];
  const flagCounts: Record<string, number> = {};
  for (const f of flags) flagCounts[f.type] = (flagCounts[f.type] ?? 0) + 1;
  // C-flag-dismissal: per-category "cleared" count = flags of this type whose row was
  // dismissed ("Looks OK") AND whose flag STILL computes (it's in the live flags array,
  // which already auto-excludes resolved conditions). Derived frontend-side from the row
  // payload's flags_dismissed -- no new backend data.
  const dismissedRowIdx = new Set(
    rows.filter(r => !!r.flags_dismissed).map(r => r.row_index),
  );
  const clearedCounts: Record<string, number> = {};
  for (const f of flags) {
    if (dismissedRowIdx.has(f.row_index)) {
      clearedCounts[f.type] = (clearedCounts[f.type] ?? 0) + 1;
    }
  }
  const flagSummaryParts = FLAG_ORDER
    .filter(t => (flagCounts[t] ?? 0) > 0)
    .map(t => {
      const cleared = clearedCounts[t] ?? 0;
      const base = `${flagCounts[t]} ${FLAG_LABELS[t]}`;
      return cleared > 0 ? `${base} – ${cleared} cleared` : base;
    });

  // C-v2c: sheet-level remarks count -- number of rows carrying a non-empty remark.
  // Single count (remarks have no sub-types); strip omitted when zero (mirrors flags).
  const remarkCount = rows.filter(
    r => typeof r.remarks === "string" && r.remarks.trim() !== "",
  ).length;

  return (
    <div className="flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4">

      {/* ── Header strip (mirrors SheetSpokePage layout) ──────────────────── */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5 text-muted-foreground mt-0.5"
          onClick={handleBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">
            {boq.boq_name} &middot; V{boq.version ?? 1} &middot; Review &amp; edit
          </p>
          <h1 className="text-lg font-semibold text-foreground truncate leading-tight">
            {displaySheetName}
          </h1>
        </div>

        {/* Right cluster: the Mark-checked action (only on a "Parsed" sheet) + the
            C-v2 save-status anchor. The Mark button and the read-only banner below are
            mutually exclusive by construction (status-driven). */}
        <div className="ml-auto shrink-0 flex items-center gap-3 mt-0.5">
          {/* Slice D2: per-sheet CSV export. STATUS-INDEPENDENT (a frozen/checked
              sheet exports too) and VIEW-INDEPENDENT (filters/collapse/search do
              not affect it). Disabled while loading or when there are no rows. */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              buildAndDownloadReviewCsv({
                boqName: boqId ?? "",
                sheetName: sheetName ?? "", // VERBATIM -- trailing spaces intact (#152)
                rows,
                columnDescriptors,
              })
            }
            disabled={reviewLoading || rows.length === 0}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          {sheetStatus === "Parsed" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={openMarkDialog}
            >
              <ShieldCheck className="h-4 w-4" />
              Mark Finalized
            </Button>
          )}
          {/* AI-3a: Run AI pass. Enabled only with parsed rows + not while an AI pass or a
              parse is in flight. The pass writes ai_* suggestion fields only (read-only here;
              accept/reject is AI-3b). */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => { void handleRunAiPass(); }}
            disabled={reviewLoading || rows.length === 0 || aiInProgress || aiRunLoading || isParsing}
          >
            <Sparkles className="h-4 w-4" />
            Run AI pass
          </Button>
          {aiInProgress && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>AI pass running&hellip;</span>
            </div>
          )}
          {/* C-v2: sheet-level save-status anchor -- reports the last auto-saved edit.
              Every confirmed edit already saved (one call = one commit); this is a
              status indicator, not a batch-save trigger. Shown once a save has landed. */}
          {lastSavedAt && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              <span>
                All changes saved
                <span className="text-muted-foreground/70"> &middot; {fmtSavedTime(lastSavedAt)}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── #164: parsing banner -- takes precedence over the checked banner ──── */}
      {isParsing && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-sm">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-700 dark:text-amber-300" />
          <p className="text-amber-900 dark:text-amber-100 flex-1">
            This sheet is being parsed. The review screen is read-only until the parse finishes.
          </p>
          <Button size="sm" variant="ghost" onClick={handleBack}>
            Go to hub
          </Button>
        </div>
      )}

      {/* ── Slice D1: read-only banner (shown when checked AND not parsing) ────── */}
      {isChecked && !isParsing && (
        <div className="flex flex-col gap-2 px-3 py-2.5 rounded-md border border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-sm">
          <div className="flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-teal-700 dark:text-teal-300" />
            <p className="text-teal-900 dark:text-teal-100">
              This sheet is marked <span className="font-medium">&lsquo;Finalized&rsquo;</span> and is
              read-only. Un-mark it to make changes, or re-parse / edit config from the hub.
            </p>
          </div>
          <div className="flex items-center gap-2 pl-6">
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setUnmarkError(null); setUnmarkDialogOpen(true); }}
            >
              Un-mark
            </Button>
            <Button size="sm" variant="ghost" onClick={handleBack}>
              Go to hub
            </Button>
          </div>
        </div>
      )}

      {/* ── AI-3a: AI-pass feedback strips (pre-flight message / result / failure) ──
          aiMessage = a {ok:false} rejection or a thrown trigger error (muted).
          aiResult = a completed pass (indigo, accents the AI provenance).
          aiError = a terminal failure (destructive). All dismiss on the next run. */}
      {aiMessage && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground flex-wrap">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span>{aiMessage}</span>
        </div>
      )}
      {aiResult && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-xs text-indigo-900 dark:text-indigo-100 flex-wrap">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-300" />
          <span>
            {aiResult.count === null
              ? "AI pass complete."
              : `AI pass complete — ${aiResult.count} suggestion${aiResult.count === 1 ? "" : "s"}${aiResult.cached ? " (cached)" : ""}.`}
            {aiResult.count !== null && aiResult.count > 0 && " Review the AI Rec column."}
          </span>
        </div>
      )}
      {aiError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-destructive/40 bg-destructive/10 text-xs text-destructive flex-wrap">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span>{aiError}</span>
        </div>
      )}

      {/* ── Staleness banner (always-on, no status gate) ──────────────────────
          Per-area edits + restructure do NOT recompute the row scalar totals; those
          are finalized post-commit by the tendering module. This static note sets that
          expectation. Muted-strip pattern (matches the flag/remark strips below). */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
        <span>
          Totals shown are as originally parsed. Final calculations happen after the BoQ is committed.
        </span>
      </div>

      {/* ── OBS-2: Advisory flag summary strip -- shown only when flags exist ── */}
      {!reviewLoading && !reviewError && flagSummaryParts.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
          <span className="font-medium text-foreground">Flags:</span>
          <span>{flagSummaryParts.join(" · ")}</span>
        </div>
      )}

      {/* ── C-v2c: Remarks count strip -- mirrors the flags strip; shown only when
          at least one row carries a remark (single count, no sub-types). ── */}
      {!reviewLoading && !reviewError && remarkCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
          <span className="font-medium text-foreground">Remarks:</span>
          <span>{remarkCount}</span>
        </div>
      )}

      {/* ── Review rows tree ──────────────────────────────────────────────── */}
      {reviewLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {reviewError && (
        <p className="text-sm text-destructive">
          Failed to load review rows. Check that this sheet has been parsed and try again.
        </p>
      )}

      {!reviewLoading && !reviewError && (
        <ReviewTree
          rows={rows}
          columnDescriptors={columnDescriptors}
          flags={flags}
          boqName={boqId ?? ""}
          sheetName={sheetName}
          onSaved={handleSaved}
          onRemarkSaved={() => void mutate()}
          // Slice 1b-beta: a restructure IS a real edit -- reuse handleSaved (advances the
          // save anchor + mutates) via the SAME SWR revalidate path as value/text edits.
          onRestructured={handleSaved}
          // Slice D1: a checked sheet freezes ALL write affordances in the tree.
          // #164: a sheet under active parse is likewise read-only (transient).
          readOnly={isChecked || isParsing}
        />
      )}

      {/* ── Slice D1: Mark dialog -- light confirm, escalates to breaks warn ──── */}
      <AlertDialog open={markDialogOpen} onOpenChange={(o) => { if (!o) closeMarkDialog(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {markBreaks ? "Structural issues found" : "Mark this sheet as Finalized?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {markBreaks
                ? "These structural issues may corrupt downstream pricing. You can mark the sheet anyway, or cancel and fix them first."
                : "This marks the sheet's parsed data as review-complete. The sheet becomes read-only until un-marked."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {markBreaks && markBreaks.length > 0 && (
            <ul className="max-h-48 overflow-y-auto space-y-1 rounded-md border border-border bg-muted/30 p-2 text-xs">
              {markBreaks.map((b, i) => (
                <li key={i} className="text-foreground leading-snug">
                  <span className="font-medium">{BREAK_TYPE_LABELS[b.type] ?? b.type}</span>
                  <span className="text-muted-foreground"> &middot; Excel row {b.source_row_number}</span>
                  {": "}{b.reason}
                </li>
              ))}
            </ul>
          )}
          {markError && <p className="text-sm text-destructive">{markError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markLoading}>Cancel</AlertDialogCancel>
            {/* Plain Button (not AlertDialogAction) so the dialog stays open on a backend
                error or to switch to the escalation view. */}
            <Button
              disabled={markLoading}
              onClick={() => { void confirmMark(markBreaks !== null); }}
            >
              {markBreaks ? "Mark anyway" : "Mark as Finalized"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Slice D1: Un-mark dialog -- light confirm back to "Parsed" ────────── */}
      <AlertDialog open={unmarkDialogOpen} onOpenChange={(o) => { if (!o) { setUnmarkDialogOpen(false); setUnmarkError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Un-mark this sheet?</AlertDialogTitle>
            <AlertDialogDescription>
              It returns to &lsquo;Parsed&rsquo; and becomes editable again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {unmarkError && <p className="text-sm text-destructive">{unmarkError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unmarkLoading}>Cancel</AlertDialogCancel>
            <Button disabled={unmarkLoading} onClick={() => { void handleUnmark(); }}>
              Un-mark
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SheetReviewPage;
export { SheetReviewPage as Component };
