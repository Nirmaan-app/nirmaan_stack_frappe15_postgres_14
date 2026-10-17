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
import { AlertTriangle, ArrowLeft, Check, Download, Loader2, Lock, Maximize2, Minimize2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getFrappeError } from "@/utils/frappeErrors";
import { useUserData } from "@/hooks/useUserData";
import { BoqPresence } from "./BoqPresence";
import { DownstreamBanner } from "./DownstreamBanner";
import type {
  AiPassDonePayload,
  BOQsDoc,
  GetCommittedStateResponse,
  GetReviewRowsResponse,
  GetStructuralBreaksResponse,
  LockInfo,
  MarkParsedCheckDoneResponse,
  UnmarkParsedCheckDoneResponse,
} from "./boqTypes";
import { ReviewTree } from "./ReviewTree";
import { countSelectedLineItemsNoQty } from "./templateSelection";
import { buildAndDownloadReviewCsv } from "./exportReviewCsv";
import { shouldExitFullscreenOnEsc } from "./PricingGrid";
import {
  CHECKING_ROWS_LABEL,
  finalizeBlockMessage,
  heavyBannerText,
  isCheckIncomplete,
  isCheckNotRun,
  isCheckRunning,
} from "./reviewCheckFlags";
import { CheckIncompleteBanner, CheckNotRunBanner, HeavySheetBanner } from "./ReviewCheckParts";
import { changedSinceCommit } from "./hubState";

// B1 (ADR-0011): the DRAFT single-editor lock sentinel version + reject marker. Real committed
// versions start at 1, so version 0 is the disjoint draft-tier identity (mirrors the backend
// draft_lock.DRAFT_LOCK_VERSION / _DRAFT_MARKER). getFrappeError preserves the message verbatim
// and ", "-joins multiple server messages, so detect the reject with `includes` (NOT startsWith).
const DRAFT_LOCK_VERSION = 0;
const DRAFT_MARKER = "BOQ_DRAFT_LOCKED";

// get_ai_pass_status response -- the cached terminal payload OR the idle shape.
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

  // R4 / S2: structural BREAKS for the warnings panel. Fetched alongside the advisory flags (which
  // ride get_review_rows above). breaks are the "must-fix" HARD-BLOCK group (preamble_parent_level,
  // line_item_parent_not_preamble, cycle); the panel inside ReviewTree groups them distinctly above
  // the softer advisories, and their presence disables the Finalize button (the server hard-blocks
  // any break). Read-only endpoint -- no write, no status change. Same disable-until-params guard.
  // S6 (U1, owner ruling Q-i): this sheet's committed state -- "not checked" shows only while the
  // sheet changed since its last commit. Same read the hub makes; no write.
  const { data: committedStateData } = useFrappeGetCall<{ message: GetCommittedStateResponse }>(
    "nirmaan_stack.api.boq.wizard.commit_gate.get_committed_state",
    { boq_name: boqId ?? "" },
    boqId ? undefined : null,
  );

  const { data: breaksData, mutate: breaksMutate } = useFrappeGetCall<{ message: GetStructuralBreaksResponse }>(
    "nirmaan_stack.api.boq.wizard.review_screen.get_structural_breaks",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );

  // C-v2: sheet-level save-status anchor. Set from each resolved save's returned
  // edited_at for an instant update (does not wait for the get_review_rows refetch).
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Full-screen / maximize mode (per-session), ported from SheetPricingPage's Slice 4c. When true
  // the page root becomes a fixed inset-0 full-viewport overlay so the dense review tree gets the
  // whole screen. Pure LAYOUT: only the root wrapper's className flips (ONE JSX tree, same children),
  // so expand/collapse NEVER remounts ReviewTree -- open detail panel / search / collapse / draft-lock
  // all survive. NOT a Dialog/portal (those remount), NOT the native Fullscreen API.
  const [expanded, setExpanded] = useState(false);

  // C-v2: after a value edit saves, advance the anchor + refresh the grid so the
  // row flips to "Edited" (green tint) and its edit history gains an entry.
  // R4: also re-fetch structural breaks -- a value/restructure edit can resolve or introduce
  // a break, so the warnings panel must stay in sync with the grid.
  const handleSaved = (editedAt: string) => {
    setLastSavedAt(editedAt);
    void mutate();
    void breaksMutate();
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

  // ── The automatic check of this sheet (S2 runs it after every parse) ─────────
  // aiInProgress rides the BOQs doc (sheet_drafts child) -- mirror of isParsing. The check does
  // NOT make the screen read-only (it writes only its own answer fields, never human or parsed
  // data), so it does NOT feed ReviewTree's readOnly. S4a: the reviewer never starts it and is
  // shown no result text -- only the "Checking rows…" chip while it runs, then the flags.
  const aiInProgress = sheetDraft?.ai_in_progress === 1;
  const { socket } = useContext(FrappeContext) as FrappeConfig;

  // ── B1: draft-tier single-editor lock -- realtime layer (ADR-0011) ────────────
  // Mirrors SheetPricingPage's A2 pricing lock, adapted to the DRAFT tier (committed_version = 0,
  // the draft_lock.* endpoints, the BOQ_DRAFT_LOCKED marker). Acquire on FIRST edit-intent
  // (ReviewTree's onEditIntent, funneled from every real edit), heartbeat ~30s while holding,
  // release on leave (sendBeacon + unmount), and listen for boq:lock_changed to flip read-only /
  // free the instant ANOTHER user acquires / releases. The server acquires the SAME draft lock
  // inside every write endpoint (durable enforcement); this is only the UX accelerator.
  const { user_id: currentUser } = useUserData();
  const { call: acquireDraftLock } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.draft_lock.acquire_draft_lock",
  );
  // Break-glass CLIENT override (dev/testing): skip ALL lock calls when set.
  const locksDisabledClient =
    typeof window !== "undefined" &&
    window.localStorage.getItem("nirmaan-boq-locks-disabled") === "true";
  // PURE read of the draft lock state (holder + editable). editable=false ONLY when held FRESH by
  // ANOTHER user. Re-fetched on mount, after a boq:lock_changed, and on reconnect. Disabled under
  // break-glass (skips the call). sheet_name VERBATIM (#152).
  const { data: draftLockData, mutate: draftLockMutate } = useFrappeGetCall<{
    message: { lock_info: LockInfo | null; editable: boolean };
  }>(
    "nirmaan_stack.api.boq.wizard.draft_lock.get_draft_lock_info",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName && !locksDisabledClient ? undefined : null,
  );
  // DRAFT_LOCK_VERSION (0) this client currently HOLDS (null = none). A ref so the heartbeat +
  // socket handler read the latest without re-registering.
  const heldVersionRef = useRef<number | null>(null);
  // A mid-edit takeover (another user acquired) flips this true -> read-only + banner until a
  // fresh editable get_draft_lock_info payload arrives.
  const [takenOver, setTakenOver] = useState(false);
  // Latest lock identity, read by the [socket]-scoped handler + the heartbeat/release effects
  // WITHOUT recreating them (the pricing lockCtxRef pattern). Updated each render.
  const lockCtxRef = useRef<{
    boqId?: string; sheetName?: string; currentUser: string; disabled: boolean;
  }>({ boqId, sheetName, currentUser, disabled: locksDisabledClient });
  lockCtxRef.current = { boqId, sheetName, currentUser, disabled: locksDisabledClient };

  // Clear the takeover flag whenever a FRESH get_draft_lock_info payload reports editable (a
  // Reload / released event re-read found it free / mine / stale). Keyed on the payload identity
  // so it fires on EVERY refetch (an [editable] dep would miss a true->true no-change).
  useEffect(() => {
    if (draftLockData?.message && (draftLockData.message.editable ?? true)) {
      setTakenOver(false);
    }
  }, [draftLockData]);

  // Esc-to-exit full-screen. Window keydown listener mounted ONLY while expanded.
  // shouldExitFullscreenOnEsc (reused from PricingGrid) guards the collision cases:
  // e.defaultPrevented (a Radix popover closing on its own Esc) and an <input>/<textarea> being typed.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldExitFullscreenOnEsc(e, document.activeElement)) setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  // Realtime lock updates: flip read-only / free the instant ANOTHER user acquires or releases
  // this sheet's DRAFT lock. Mirrors the boq:ai_pass_done listener above (screen-scoped on the
  // stable FrappeContext socket) + the pricing lock handler: read changing identity from
  // lockCtxRef, guard on (boq, sheet_name VERBATIM, committed_version === 0, suppress own), off()
  // on cleanup, + a reconnect self-heal (re-read authoritative lock_info).
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: {
      boq?: string; sheet_name?: string; committed_version?: number | string;
      action?: string; locked_by?: string | null;
    }) => {
      const ctx = lockCtxRef.current;
      if (ctx.disabled) return;
      if (!payload || payload.boq !== ctx.boqId) return;
      if (payload.sheet_name !== ctx.sheetName) return; // VERBATIM (#152)
      if (Number(payload.committed_version) !== DRAFT_LOCK_VERSION) return;
      if (payload.locked_by && payload.locked_by === ctx.currentUser) return; // suppress own
      if (payload.action === "acquired" || payload.action === "took_over") {
        const wasHolding = heldVersionRef.current !== null;
        heldVersionRef.current = null;
        if (wasHolding) setTakenOver(true); // we were the editor and got displaced
        else void draftLockMutate(); // we were only viewing -> re-read the holder banner
      } else if (payload.action === "released") {
        void draftLockMutate(); // freed -> re-read authoritative editable/lock_info
      }
    };
    const onReconnect = () => { void draftLockMutate(); };
    socket.on("boq:lock_changed", handler);
    socket.on("connect", onReconnect);
    return () => {
      socket.off("boq:lock_changed", handler);
      socket.off("connect", onReconnect);
    };
  }, [socket, draftLockMutate]);

  // Heartbeat: while we HOLD the draft lock, refresh it every ~30s so an active editor is never
  // taken over mid-session (the edit-driven TTL would otherwise lapse). A rejected refresh
  // (another user took over) flips us to read-only.
  useEffect(() => {
    const id = window.setInterval(() => {
      const ctx = lockCtxRef.current;
      if (ctx.disabled || heldVersionRef.current !== DRAFT_LOCK_VERSION) return;
      if (!ctx.boqId || !ctx.sheetName) return;
      void acquireDraftLock({ boq_name: ctx.boqId, sheet_name: ctx.sheetName }).catch((e) => {
        if (getFrappeError(e).includes(DRAFT_MARKER)) {
          heldVersionRef.current = null;
          setTakenOver(true);
        }
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [acquireDraftLock]);

  // Release-on-leave: free the draft lock the INSTANT the reviewer closes, so no colleague waits
  // out the TTL. beforeunload + unmount both fire navigator.sendBeacon (a normal POST would be
  // cancelled on unload). Guarded on actually holding the lock; idempotent + tolerant server-side.
  // (Draft release takes no committed_version.)
  useEffect(() => {
    const beacon = () => {
      const ctx = lockCtxRef.current;
      if (ctx.disabled || heldVersionRef.current === null) return;
      if (!ctx.boqId || !ctx.sheetName) return;
      try {
        const fd = new FormData();
        fd.append("boq_name", ctx.boqId);
        fd.append("sheet_name", ctx.sheetName);
        const csrf = (window as unknown as { frappe?: { csrf_token?: string } })?.frappe?.csrf_token;
        if (csrf) fd.append("csrf_token", csrf);
        navigator.sendBeacon(
          "/api/method/nirmaan_stack.api.boq.wizard.draft_lock.release_draft_lock", fd,
        );
      } catch {
        /* best-effort: the lock ages out via the TTL if this fails */
      }
    };
    window.addEventListener("beforeunload", beacon);
    return () => {
      window.removeEventListener("beforeunload", beacon);
      beacon(); // release on unmount (SPA navigate-away) too
      heldVersionRef.current = null;
    };
  }, []);

  // Status-poll endpoint (the missed-socket recovery; it also heals a dead run on every read).
  const { call: aiStatusCall } = useFrappePostCall<{ message: AiStatusResponse }>(
    "nirmaan_stack.api.boq.wizard.ai_assist.get_ai_pass_status",
  );

  // Poll interval id held in a ref so cleanup is reliable (a leaked interval hammering
  // the endpoint is its own bug). stopAiPoll is idempotent.
  const aiPollRef = useRef<number | null>(null);
  const stopAiPoll = useCallback(() => {
    if (aiPollRef.current !== null) {
      clearInterval(aiPollRef.current);
      aiPollRef.current = null;
    }
  }, []);

  // The check ended (from EITHER the socket fast-path or the poll), whatever its outcome.
  // Refresh the rows (so the flags, the counter and check_running resettle), the must-fix panel
  // and the BOQs doc (so ai_in_progress clears and the chip goes). The poll is NOT stopped here:
  // it stops itself once the refreshed data says the check is no longer running, so a refresh
  // that lands a moment early cannot strand the chip. Idempotent: a socket+poll double-resolve
  // just repeats harmless mutates. S4a: no text for success, failure or an unknown error code --
  // "the check didn't finish" is S4b's banner.
  const resolveAiOutcome = useCallback(
    () => {
      void mutate();
      void breaksMutate();
      void boqMutate();
    },
    // mutate / breaksMutate / boqMutate are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // LAYER 1 -- socket fast path. Mirror BoqHubPage's boq:parse_run_done listener:
  // guard this (boq, sheet), resolve, plus a reconnect re-fetch self-heal.
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: AiPassDonePayload) => {
      if (payload.boq_name !== boqId || payload.sheet_name !== (sheetName ?? "")) return;
      resolveAiOutcome();
    };
    // S4a (owner ruling Q-l): a parse of this BoQ finished while the page is open. The rows were
    // rebuilt and the automatic check was queued in the same breath, so re-read everything: the
    // "being parsed" banner goes, the chip appears, and the flags follow when the check ends.
    // Without this the page learned none of it until the window was refocused.
    const onParseDone = (payload: { boq_name?: string }) => {
      if (!payload || payload.boq_name !== boqId) return;
      void boqMutate();
      void mutate();
      void breaksMutate();
    };
    const onReconnect = () => { void boqMutate(); };
    socket.on("boq:ai_pass_done", handler);
    socket.on("boq:parse_run_done", onParseDone);
    socket.on("connect", onReconnect);
    return () => {
      socket.off("boq:ai_pass_done", handler);
      socket.off("boq:parse_run_done", onParseDone);
      socket.off("connect", onReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, boqId, sheetName, resolveAiOutcome]);

  // LAYER 2 + 3 -- poll-until-terminal (the GUARANTEE) + on-mount recovery. Whenever the check
  // is running (the sheet loaded mid-check, or a re-parse just queued one), poll
  // get_ai_pass_status every 3s. This resolves the screen within ~3s even if the socket event is
  // missed entirely. `checkRunning` reads BOTH the sheet's flag and the run log behind
  // check_summary, so the poll runs for as long as the finalize block would refuse.
  const checkRunning = isCheckRunning(aiInProgress, reviewData?.message?.check_summary);
  useEffect(() => {
    if (!checkRunning) { stopAiPoll(); return; }
    if (aiPollRef.current !== null) return; // already polling -- no double-registration
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const res = await aiStatusCall({ boq_name: boqId ?? "", sheet_name: sheetName ?? "" });
          const m = res.message;
          if (m.status === "success" || m.status === "error"
              || (m.status === "idle_or_unknown" && m.ai_in_progress === 0)) {
            resolveAiOutcome();
          }
        } catch {
          // transient (network/CSRF blip) -- keep polling; the next tick retries.
        }
      })();
    }, 3000);
    aiPollRef.current = id;
    return () => stopAiPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkRunning, boqId, sheetName, resolveAiOutcome]);

  // ── S5: revision "Looks OK" confirmations ────────────────────────────────
  // Rows that carried nothing from the original block finalize until a human confirms them. Both
  // calls mutate() afterwards so the row stamp, the panel's remaining count and the Finalize
  // button's disabled state all resettle from the SAME server read -- never from local optimism,
  // because the count they feed is the one the finalize gate itself refuses on.
  const { call: affirmRowCall } = useFrappePostCall<{ message: { ok: boolean } }>(
    "nirmaan_stack.api.boq.wizard.review_screen.affirm_revision_row",
  );
  const [affirmError, setAffirmError] = useState<string | null>(null);

  const handleAffirmRow = async (rowIndex: number, affirmed: boolean) => {
    setAffirmError(null);
    try {
      await affirmRowCall({
        boq_name: boqId ?? "",
        sheet_name: sheetName ?? "", // VERBATIM #152
        row_index: rowIndex,
        affirmed,
      });
      void mutate();
    } catch (e: unknown) {
      setAffirmError(getFrappeError(e) || "Could not save that confirmation.");
    }
  };

  const { call: markCall, loading: markLoading } = useFrappePostCall<{
    message: MarkParsedCheckDoneResponse;
  }>("nirmaan_stack.api.boq.wizard.review_screen.mark_sheet_parsed_check_done");
  const { call: unmarkCall, loading: unmarkLoading } = useFrappePostCall<{
    message: UnmarkParsedCheckDoneResponse;
  }>("nirmaan_stack.api.boq.wizard.review_screen.unmark_sheet_parsed_check_done");

  // S2: Mark dialog is now a plain confirm -- the Finalize button is disabled whenever
  // structural breaks exist (the must-fix panel shows what to fix), so there is NO
  // "Mark anyway" escalation/override.
  const [markDialogOpen, setMarkDialogOpen] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [unmarkDialogOpen, setUnmarkDialogOpen] = useState(false);
  const [unmarkError, setUnmarkError] = useState<string | null>(null);
  // C0 / ADR-0011: when un-finalize reports it would orphan downstream pricing, hold the
  // stripped message so the user can explicitly confirm (re-submit with confirm_orphan=true).
  const [orphanPrompt, setOrphanPrompt] = useState<{ message: string } | null>(null);

  const openMarkDialog = () => {
    setMarkError(null);
    setMarkDialogOpen(true);
  };
  const closeMarkDialog = () => {
    setMarkDialogOpen(false);
    setMarkError(null);
  };

  // POST mark. The server is now a FULLY HARD gate: it finalizes only when zero structural
  // breaks exist, otherwise it returns {ok:false, breaks}. The Finalize button is already
  // disabled whenever breaks exist, so ok:false here is only a defensive race (a break
  // appeared between the breaks fetch and this POST). There is NO override -- on ok:false we
  // surface an error and refresh the breaks panel so the button re-disables.
  const confirmMark = async () => {
    setMarkError(null);
    try {
      const res = await markCall({
        boq_name: boqId ?? "",
        sheet_name: sheetName ?? "", // VERBATIM #152
      });
      const msg = res.message;
      if (msg.ok) {
        closeMarkDialog();
        void boqMutate();
      } else if (msg.qty_gap) {
        // A2 (template origin): the server backstop found selected line items whose quantity is
        // missing or negative. Re-fetch rows so the inline qty cells + the client qtyGap gate re-sync.
        setMarkError(
          `Enter a valid quantity (present and not negative) for all ${msg.qty_gap} selected line item${msg.qty_gap === 1 ? "" : "s"} before finalizing.`,
        );
        void mutate();
      } else if (msg.unaffirmed_count) {
        // S5 (revision): rows that didn't carry are still unconfirmed. Like the qty_gap case this
        // is normally unreachable -- the button is already disabled -- so reaching it means the
        // count moved under us (a re-parse, or another editor). Re-fetch so the red rows, the
        // panel and the button all re-sync from the server's own count.
        setMarkError(
          `Confirm the ${msg.unaffirmed_count} row${msg.unaffirmed_count === 1 ? "" : "s"} that ` +
          "didn't carry from the original before finalizing.",
        );
        void mutate();
      } else {
        // Defensive: a structural break appeared after the panel last refreshed. Keep the
        // dialog open, explain, and re-fetch breaks so the must-fix panel + disabled gate update.
        setMarkError(
          "Structural issues were found on this sheet. Fix the must-fix items listed on the review screen, then try again.",
        );
        void breaksMutate();
      }
    } catch (e: unknown) {
      setMarkError(getFrappeError(e) || "Could not mark the sheet. Please try again.");
    }
  };

  const handleUnmark = async (confirmOrphan = false) => {
    setUnmarkError(null);
    setOrphanPrompt(null);
    try {
      await unmarkCall({
        boq_name: boqId ?? "",
        sheet_name: sheetName ?? "", // VERBATIM #152
        confirm_orphan: confirmOrphan, // C0 / ADR-0011: acknowledged orphaning of downstream pricing
      });
      setUnmarkDialogOpen(false);
      setOrphanPrompt(null);
      void boqMutate();
    } catch (e: unknown) {
      const msg = getFrappeError(e) || "";
      if (msg.includes("BOQ_DOWNSTREAM_ORPHAN")) {
        // C0 / ADR-0011: un-finalizing would orphan downstream priced cells. Surface an explicit
        // confirm (strip the marker prefix), then retry with confirm_orphan=true.
        setOrphanPrompt({ message: msg.replace(/^.*?BOQ_DOWNSTREAM_ORPHAN:\s*/, "") });
      } else {
        setUnmarkError(msg || "Could not un-mark the sheet. Please try again.");
      }
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
  // Per-sheet Work Packages -- chosen at config time, carried through by get_review_rows
  // (work_packages: string[]). Read defensively: default [] when the payload is missing/older,
  // and drop any empty/whitespace entries so the header badge only renders real assignments.
  const workPackages = (reviewData?.message?.work_packages ?? []).filter(
    (wp): wp is string => typeof wp === "string" && wp.trim() !== "",
  );
  // R4: structural breaks for the warnings panel (must-fix group). Defaults to [] until the
  // get_structural_breaks fetch resolves; the panel renders breaks above the advisory flags.
  const breaks = breaksData?.message?.breaks ?? [];
  // S4a (ADR-0034): the sheet's review-flag counts, from the function the finalize block uses.
  const checkSummary = reviewData?.message?.check_summary ?? null;
  const reviewLoading = reviewData === undefined;
  const reviewError = reviewData === null;

  // ── B1: draft-lock read-only gate + first-edit-intent acquire ────────────────
  // draftEditable=false ONLY when the draft is held FRESH by ANOTHER user (get_draft_lock_info).
  // draftLockedByAnother folds that with a mid-edit takeover; it ORs into the ReviewTree readOnly
  // ALONGSIDE the existing Finalized (isChecked) + parsing (isParsing) freezes -- ONE boolean,
  // reusing ReviewTree's existing readOnly mechanism (which HIDES all 11 write affordances). Never
  // read-only under break-glass.
  const draftEditable = draftLockData?.message?.editable ?? true;
  const draftLockInfo = draftLockData?.message?.lock_info ?? null;
  const draftLockedByAnother = !locksDisabledClient && (takenOver || draftEditable === false);
  const readOnly = isChecked || isParsing || draftLockedByAnother;

  // ── Create-from-Template (ADR-0013 T10/T11): template-origin gate ──────────────
  // Row selection + row create/delete are TEMPLATE-ORIGIN ONLY (the backend endpoints
  // hard-reject upload BoQs). Gated additionally on !readOnly so a finalized / parsing /
  // externally-locked sheet freezes them exactly like every other write affordance. On an
  // upload BoQ (or when boq.origin is absent) both stay false -> ReviewTree is unaffected.
  const isTemplateOrigin = boq.origin === "template";
  // A2: template-origin finalize gate -- count SELECTED line_item rows still missing a quantity
  // (STRICT, rate-only NOT exempt). Upload origin -> 0 (countSelectedLineItemsNoQty is not called).
  const qtyGap = isTemplateOrigin ? countSelectedLineItemsNoQty(rows) : 0;
  // S5: revision finalize gate -- rows stamped `Needs Review` that nobody has confirmed. Read from
  // the SERVER meta, not counted client-side: it is produced by the very function the finalize
  // endpoint refuses on, so the button and the server can never disagree (ADR-0010 F1). 0 off a
  // revision, and 0 on a sheet parsed before this feature shipped.
  const unaffirmedCount = reviewData?.message?.revision?.unaffirmed_count ?? 0;

  // Acquire the draft lock on FIRST edit-intent (ReviewTree threads this as onEditIntent, called
  // at the top of every real-edit funnel -- value/text edits, reclassify/restructure opens,
  // revert; NOT the annotation-only remark/dismiss paths). Idempotent (heldVersionRef).
  // A rejected acquire (someone else holds it fresh) flips us read-only via the takeover banner.
  // The write endpoints still enforce server-side.
  //
  // S4b (R33): it RETURNS the lock call's promise (already caught -- it never rejects), so an
  // action that fires its write in the same instant can wait for it (editIntent.afterEditIntent;
  // Revert does). Callers that ignore the return value behave exactly as before.
  const ensureLockAcquired = (): Promise<unknown> | void => {
    if (locksDisabledClient) return;
    if (readOnly) return; // finalized / parsing / already taken over / held by another
    if (!boqId || !sheetName) return;
    if (heldVersionRef.current === DRAFT_LOCK_VERSION) return; // already hold it
    heldVersionRef.current = DRAFT_LOCK_VERSION; // optimistic (prevents a double-fire)
    return acquireDraftLock({ boq_name: boqId, sheet_name: sheetName }).catch((e) => {
      heldVersionRef.current = null; // failed -> we do NOT hold it
      if (getFrappeError(e).includes(DRAFT_MARKER)) setTakenOver(true);
    });
  };

  // Lock-banner Reload: re-read the draft lock + rows + BOQs doc in place (refreshes editable/
  // lock_info + resets takenOver via the [draftLockData] effect above).
  const handleReloadLock = () => {
    void draftLockMutate();
    void mutate();
    void boqMutate();
  };

  // R4: the OBS-2 advisory-flag count strip + its "– N cleared" rollup moved INTO ReviewTree's
  // warnings panel header (ReviewTree owns revealAndScrollToRow + flags + rows.flags_dismissed,
  // so the clickable panel and its rollup live together there). The FLAG_LABELS / FLAG_ORDER /
  // cleared-count derivation that used to live here is now in ReviewTree.

  // C-v2c: sheet-level remarks count -- number of rows carrying a non-empty remark.
  // Single count (remarks have no sub-types); strip omitted when zero (mirrors flags).
  const remarkCount = rows.filter(
    r => typeof r.remarks === "string" && r.remarks.trim() !== "",
  ).length;

  // S4a (U12): why Mark Finalized is greyed out, or null. One pure function, in the SERVER's
  // order of checks; the count of flagged rows is the server's own (check_summary.to_check), so
  // the button and the refusal cannot disagree. The server still refuses as the last guard.
  const finalizeBlock = finalizeBlockMessage({
    breakCount: breaks.length,
    unaffirmedCount,
    qtyGap,
    checkRunning,
    summary: checkSummary,
  });

  // S4b (U1, U2): the two sheet banners. Both read the server's check_summary; neither blocks
  // anything. The heavy-sheet advice is about finalizing, so it shows on a Parsed sheet only.
  const heavyBanner = sheetStatus === "Parsed" ? heavyBannerText(checkSummary, checkRunning) : null;
  const checkIncomplete = !isParsing && isCheckIncomplete(checkSummary, checkRunning);
  // S6 (U1): the check never ran on this parse and the sheet changed since its last commit.
  const thisCommitted = (committedStateData?.message?.committed_state ?? []).find(
    (c) => c.sheet_name === sheetName,   // VERBATIM (#152)
  );
  const thisDraft = (boq?.sheet_drafts ?? []).find((d) => d.sheet_name === sheetName);
  const checkNotRun = !isParsing && isCheckNotRun(
    checkSummary, checkRunning,
    changedSinceCommit(thisDraft?.last_parsed_at, thisCommitted?.committed_at, !!thisCommitted),
  );
  // "Re-parse sheet" hands over to the hub, which owns the re-parse confirmation and the parse
  // run: the hub opens today's dialog for this sheet (owner ruling Q-h). VERBATIM name (#152).
  const handleReparseFromBanner = () =>
    navigate(`/upload-boq/hub/${boqId ?? ""}`, { state: { reparseSheet: sheetName ?? "" } });

  return (
    <div
      className={cn(
        expanded
          ? "fixed inset-0 z-50 flex flex-col space-y-4 overflow-auto bg-background p-4"
          : "flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4",
      )}
    >

      {/* ── Header: Row 1 = back + title + status badges; Row 2 = action buttons ── */}
      <div className="space-y-3">
        {/* Row 1: back button, title, and the STATUS BADGES beside the title (WP, "Also here", saved). */}
        {/* items-center vertically centres the badges against the two-line title block; flex-wrap
            lets the badge cluster drop to its own right-aligned line if the viewport is too narrow. */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground"
            onClick={handleBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground truncate">
              {boq.boq_name} &middot; V{boq.version ?? 1} &middot; Review &amp; edit
            </p>
            <h1 className="text-lg font-semibold text-foreground truncate leading-tight">
              {displaySheetName}
            </h1>
          </div>

          {/* Status badges -- RIGHT-ALIGNED on the title line (ml-auto). Per-sheet Work Packages,
              "who else is here" presence, and the auto-save status anchor. SHEET-LEVEL header
              elements only -- never threaded into the memoized ReviewTree rows. justify-end +
              flex-wrap keeps them tidily right-packed; each badge self-truncates so a long WP
              list / presence roster never crowds the title (which truncates via min-w-0 flex-1). */}
          <div className="ml-auto shrink-0 flex flex-wrap items-center justify-end gap-2">
            {workPackages.length > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground max-w-[16rem]"
                title={`Work packages: ${workPackages.join(", ")}`}
              >
                <span className="text-primary font-medium">WP</span>
                <span className="truncate">{workPackages.join(" · ")}</span>
              </span>
            )}
            {/* B2: BoQ-level "who else is here" presence (soft awareness; the draft lock owns correctness). */}
            <BoqPresence boqId={boqId} />
            {/* C-v2: sheet-level save-status anchor -- reports the last auto-saved edit (split-by-meaning:
                the persistent saved-status badge lives with the title badges). */}
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

        {/* Row 2: action buttons. Full screen FIRST, then Export, Finalize, and the transient
            "Checking rows…" chip while the automatic check runs. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Full-screen toggle -- FIRST. Ported from SheetPricingPage Slice 4c. Orthogonal to
              editability (works on a read-only / finalized sheet too). */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Exit full screen (Esc)" : "Expand the review screen to full screen"}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {expanded ? "Exit full screen" : "Full screen"}
          </Button>
          {/* Slice D2: per-sheet CSV export. STATUS-INDEPENDENT + VIEW-INDEPENDENT. */}
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
          {/* S2 hard gate: Finalize DISABLED whenever any structural break exists. S4a: also
              while the automatic check runs and while any flagged row is unchecked; the hover
              says which (finalizeBlock). */}
          {sheetStatus === "Parsed" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={openMarkDialog}
              disabled={reviewLoading || finalizeBlock !== null}
              title={finalizeBlock ?? undefined}
            >
              <ShieldCheck className="h-4 w-4" />
              Mark Finalized
            </Button>
          )}
          {/* S6 (F3 / U2): the reason the button is off, as visible text -- the disabled button's
              hover never shows (pointer events are off). Names the open rows (Excel rows). */}
          {sheetStatus === "Parsed" && !reviewLoading && finalizeBlock && (
            <span className="max-w-md text-xs text-amber-700 dark:text-amber-300">{finalizeBlock}</span>
          )}
          {/* S4a (U16): the automatic check of this sheet is running. No button starts it and
              no AI is named; the chip clears by itself when the check ends. */}
          {checkRunning && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{CHECKING_ROWS_LABEL}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Amendment A1: on-entry directional banner. This sheet is an UPSTREAM stage; if its
          current committed version is priced, re-parsing / re-committing / un-finalizing it will
          orphan that pricing. Warn-only awareness (renders nothing when unpriced). ──────────── */}
      <DownstreamBanner boqId={boqId} sheetName={sheetName} />

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

      {/* S4b (U2): the automatic check of this sheet did not finish. The button is withheld on a
          read-only sheet (Finalized / another editor); the sentence stays. */}
      {checkIncomplete && (
        <CheckIncompleteBanner onReparse={readOnly ? undefined : handleReparseFromBanner} />
      )}
      {/* S6 (U1): the automatic check never ran on this sheet (and it changed since its commit). */}
      {checkNotRun && <CheckNotRunBanner />}
      {/* S4b (U1): more than 40% of the rows are flagged -- advice only. */}
      {heavyBanner && <HeavySheetBanner text={heavyBanner} />}

      {/* S5: a failed confirmation. Inline, not a toast -- the wizard convention. */}
      {affirmError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-destructive/40 bg-destructive/10 text-xs text-destructive flex-wrap">
          <span>{affirmError}</span>
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

      {/* R4: the advisory-flag summary strip evolved into ReviewTree's clickable warnings panel
          (rendered at the top of the tree). The count + "– N cleared" rollup now live in that
          panel's header, alongside the per-row clickable entries + structural-break group. */}

      {/* ── C-v2c: Remarks count strip -- mirrors the flags strip; shown only when
          at least one row carries a remark (single count, no sub-types). ── */}
      {!reviewLoading && !reviewError && remarkCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
          <span className="font-medium text-foreground">Remarks:</span>
          <span>{remarkCount}</span>
        </div>
      )}

      {/* ── B1: draft-lock read-only banner (another user is editing) ─────────
          Shown when the draft is held FRESH by another user (or after a mid-edit takeover).
          Mirrors the pricing-lock banners: takenOver = generic "your change was not saved";
          held-by-another = names the holder. Reload re-reads the authoritative lock state. */}
      {draftLockedByAnother && (
        takenOver ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <p className="text-amber-900 dark:text-amber-100 flex-1">
              This sheet was taken over by another user. Your latest change was not saved. Reload to continue.
            </p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReloadLock}>
              <RefreshCw className="h-3.5 w-3.5" /> Reload
            </Button>
            <Button size="sm" variant="ghost" onClick={handleBack}>Go to hub</Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-sm">
            <Lock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <p className="text-amber-900 dark:text-amber-100 flex-1">
              This sheet is being edited by{" "}
              <span className="font-medium">{draftLockInfo?.locked_by_name ?? "another user"}</span>.
              It is read-only until they finish.
            </p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReloadLock}>
              <RefreshCw className="h-3.5 w-3.5" /> Reload
            </Button>
            <Button size="sm" variant="ghost" onClick={handleBack}>Go to hub</Button>
          </div>
        )
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
          breaks={breaks}
          onSaved={handleSaved}
          // R4: a remark / dismissal / Looks OK tick / revert routes through here; a revert can
          // change structural integrity -> re-fetch breaks too.
          onRemarkSaved={() => { void mutate(); void breaksMutate(); }}
          // Slice 1b-beta: a restructure IS a real edit -- reuse handleSaved (advances the
          // save anchor + mutates) via the SAME SWR revalidate path as value/text edits.
          onRestructured={handleSaved}
          // Slice D1: a checked sheet freezes ALL write affordances in the tree.
          // #164: a sheet under active parse is likewise read-only (transient).
          // B1: the draft is held FRESH by ANOTHER user -> read-only too (one boolean,
          // reusing the SAME readOnly mechanism -- no second per-row editable signal).
          readOnly={readOnly}
          // B1: acquire the draft lock on FIRST real edit-intent (funneled inside ReviewTree).
          onEditIntent={ensureLockAcquired}
          // S4a (ADR-0034): the review-flag counts for the counter strip. The per-row flags ride
          // each row (check_flags).
          checkSummary={checkSummary}
          // S4b (U12): while the check runs the counter strip is not drawn.
          checkRunning={checkRunning}
          // A2: template-origin review customizations (hide Status/Check/Rate*/Amount*, inline qty).
          // NOT gated on !readOnly (unlike selectable/canCreateRows) -- provenance columns stay
          // hidden even on a finalized/locked template sheet.
          templateOrigin={isTemplateOrigin}
          // Full-screen toggle above -- relaxes ReviewTree's internal scroll-height cap in full-screen.
          expanded={expanded}
          // Create-from-Template (ADR-0013 T10/T11): row selection + row create/delete, template
          // -origin only + frozen with the rest when readOnly. Both false on an upload BoQ ->
          // byte-identical to before. onSelectionChanged re-fetches rows (+ breaks) after the
          // server cascade flips is_excluded / the keyspace is renumbered.
          selectable={isTemplateOrigin && !readOnly}
          canCreateRows={isTemplateOrigin && !readOnly}
          onSelectionChanged={() => { void mutate(); void breaksMutate(); }}
          // S5b (#1103, ADR-0014 D7): the revised-BoQ delta meta -- null for upload/template so the
          // Status column + delta panel stay inert (byte-identical off a revision).
          revisionMeta={reviewData?.message?.revision ?? null}
          // S5: the revision confirmation writes. WITHHELD when readOnly (frozen sheet) -- the
          // wizard's presence-is-the-gate convention, so the column renders but its checkbox is
          // disabled rather than there being a second per-cell "editable" signal. Both refetch so
          // the row stamps, the blocking count and the Finalize button all resettle together.
          onAffirmRow={readOnly ? undefined : handleAffirmRow}
        />
      )}

      {/* ── Slice D1 (S2 hard gate): Mark dialog -- plain confirm, no override ──── */}
      <AlertDialog open={markDialogOpen} onOpenChange={(o) => { if (!o) closeMarkDialog(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this sheet as Finalized?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks the sheet&rsquo;s parsed data as review-complete. The sheet becomes read-only until un-marked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {markError && <p className="text-sm text-destructive">{markError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markLoading}>Cancel</AlertDialogCancel>
            {/* Plain Button (not AlertDialogAction) so the dialog stays open on a backend error. */}
            <Button
              disabled={markLoading}
              onClick={() => { void confirmMark(); }}
            >
              Mark as Finalized
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

      {/* ── C0 / ADR-0011: explicit confirm when un-finalizing would orphan downstream priced
          cells. The backend threw BOQ_DOWNSTREAM_ORPHAN; on confirm we retry with confirm_orphan=true. */}
      <AlertDialog
        open={!!orphanPrompt}
        onOpenChange={(o) => { if (!o && !unmarkLoading) setOrphanPrompt(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              This will orphan priced cells
            </AlertDialogTitle>
            <AlertDialogDescription>{orphanPrompt?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unmarkLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={unmarkLoading}
              onClick={() => { void handleUnmark(true); }}
            >
              Un-finalize anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SheetReviewPage;
export { SheetReviewPage as Component };
