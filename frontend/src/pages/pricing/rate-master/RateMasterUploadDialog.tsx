// SLICE 6 -- the preview surface. UPLOAD -> PREVIEW -> CONFIRM -> APPLY, and never one step.
//
// ⚠️ THE DIALOG NEVER DECIDES ANYTHING. The server computes the whole plan (what changes, what is
// major, what is an error) and this renders it; a second client-side copy of the 10% rule or of the
// upsert semantics would be free to disagree with the write that actually happens, which is the one
// failure a preview must never have.
//
// ⚠️ THAT WAS AN ASPIRATION UNTIL F-21, NOT A FACT. The percentage's COLOUR was decided here by
// `Math.abs(f.pct) >= 10` -- a second definition of the threshold, reading the ROUNDED percentage
// while the server classified from the raw one. At the boundary they disagreed and a row rendered
// RED while sitting COLLAPSED: "big move" and "not worth showing", about the same row. The server
// now emits `major` PER FIELD and the colour reads it. Do not reintroduce a comparison here.
//
// EXPANDED BY DEFAULT: every new item and every rate move of >= 10% IN EITHER DIRECTION -- the two
// classes a count cannot convey. COLLAPSED behind a count: everything else, one click from open.
// Nothing is hidden; the collapsing is about attention, not access.

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FREEZE_BLOCKED_MESSAGE } from "./rateMasterFreeze";
import { cn } from "@/lib/utils";
import { downloadErrorMessage } from "./rateMasterDownload";
import {
  SPEC_CONFIRM_COPY, acceptedFingerprints, rowsWithSuggestion, specLine, specQuestion, type SpecDecision,
} from "./rateMasterSpec";
import {
  UPLOAD_COPY,
  TWIN_COPY,
  canApply,
  cellText,
  changeSummary,
  fileToBase64,
  formatPct,
  headlineCounts,
  planIsNoOp,
  splitChanges,
  showEncodingWarning,
  twinFingerprints,
  twinNumbers,
  undecidedTwinRows,
  uploadTargetLine,
  UPLOAD_ACCEPT,
  type TwinDecision,
  type UploadTargetLabels,
  type UploadChange,
  type UploadPlan,
  type UploadResult,
} from "./rateMasterUpload";

interface Props {
  /** Reads the file and returns the plan. MUST NOT write -- it is called on every file choice. */
  // RMF-1: the deployment freeze. The chooser is DISABLED (not hidden) and carries the owner's
  // approved message as its tooltip. Note the asymmetry this deliberately accepts: the PREVIEW
  // endpoint still works while frozen (owner ruling R3), but the only reason to open a file in
  // this dialog is to APPLY it, and the apply is refused -- so offering the flow would walk the
  // user to a wall. Previewing a frozen catalog's file remains possible via the endpoint.
  frozen?: boolean;
  onPreview: (contentBase64: string) => Promise<UploadPlan>;
  /**
   * Applies the previewed file. The digest is what refuses a plan the catalog has outgrown.
   * SLICE 1d: the user's per-row Accept / Reject answers and the accepted suggestions' fingerprints ride
   * along (both optional; the server re-derives each suggestion and refuses a stale accept).
   */
  onApply: (
    contentBase64: string,
    expectedDigest: string,
    decisions?: Record<number, SpecDecision>,
    acceptedFingerprints?: Record<number, string>,
    // SLICE 1f: the per-row Confirm / Decline answers to the duplicate warning + the confirmed targets'
    // fingerprints (both optional; the server re-derives the target and refuses a stale confirm).
    twinDecisions?: Record<number, TwinDecision>,
    twinFingerprints?: Record<number, string>,
  ) => Promise<UploadResult>;
  /** Fired after a successful apply so the caller can refetch the item list. */
  onApplied?: () => void;
  /** SLICE 1g: the page's own labels, for the "Uploading into" banner (the id is shown where no label fits). */
  targetLabels?: UploadTargetLabels;
}

/** The row's own text, from the fields the plan carries, for the question. */
function rowText(change: UploadChange, column: string): string {
  const f = change.fields.find((x) => x.column === column);
  return f ? f.new : "";
}

function ChangeRow({
  change, decision, onDecide, twinDecision, onTwinDecide,
}: {
  change: UploadChange;
  decision?: SpecDecision;
  onDecide?: (row: number, d: SpecDecision) => void;
  twinDecision?: TwinDecision;
  onTwinDecide?: (row: number, d: TwinDecision) => void;
}) {
  const suggestion = change.spec?.suggestion ?? null;
  const twin = change.twin ?? null;
  return (
    <div className="rounded border px-2 py-1.5">
      <div className="flex flex-wrap items-baseline gap-2">
        {change.kind === "add" ? (
          <Badge variant="default" className="h-4 px-1 text-[10px] leading-none">new</Badge>
        ) : null}
        <span className="text-xs font-medium">{change.label}</span>
        <span className="text-[11px] text-muted-foreground">row {change.row}</span>
        {change.item_uid ? (
          <span className="font-mono text-[10px] text-muted-foreground">{change.item_uid}</span>
        ) : null}
      </div>
      <div className="mt-1 space-y-0.5">
        {change.fields.map((f) => (
          <div key={f.column} className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
            <span className="min-w-[9rem] text-muted-foreground">{f.column}</span>
            <span className="line-through opacity-70">{cellText(f.old)}</span>
            <span aria-hidden>&rarr;</span>
            <span className="font-medium">{cellText(f.new)}</span>
            {f.pct !== null ? (
              <span
                className={cn(
                  "font-medium",
                  f.major ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {formatPct(f.pct)}
              </span>
            ) : null}
          </div>
        ))}
        {change.spec ? (
          // SLICE 1c (U2): for a new / changed row of a spec-driven category -- what the reader
          // understood, or exactly why it could not. Server-computed; rendered verbatim.
          <div
            className={cn(
              "mt-1 text-[11px]",
              change.spec.status === "not_understood" ? "font-medium text-destructive" : "text-muted-foreground",
            )}
            data-testid="upload-spec-line"
          >
            {specLine(change.spec)}
          </div>
        ) : null}
        {change.spec && change.spec.status === "not_understood" && !suggestion && change.spec.no_suggestion_reason ? (
          // SLICE 1d: the exact read refused AND the suggester found no reasonable match -- say why.
          <div className="mt-0.5 text-[11px] text-muted-foreground" data-testid="upload-no-suggestion">
            {SPEC_CONFIRM_COPY.noMatch} {change.spec.no_suggestion_reason}
          </div>
        ) : null}
        {suggestion ? (
          // SLICE 1d (owner T-b 3): the QUESTION, per row, with Accept / Reject. Nothing is stored until the
          // apply, and the apply stores the suggestion ONLY for an accepted row.
          <div
            className="mt-1 rounded border border-amber-500/40 bg-amber-50 p-1.5 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="upload-suggestion"
          >
            <div>{specQuestion(change.spec?.text?.item_name ?? rowText(change, "item_name"), change.spec?.text?.item_detail ?? rowText(change, "item_detail"), suggestion)}</div>
            {suggestion.notes.length ? (
              <div className="mt-0.5 text-[10px] opacity-80">{Array.from(new Set(suggestion.notes)).join("; ")}</div>
            ) : null}
            <div className="mt-1 flex items-center gap-1.5">
              <Button
                size="sm" variant={decision === "accept" ? "default" : "outline"} className="h-6 px-2 text-[11px]"
                onClick={() => onDecide?.(change.row, "accept")} aria-label={`Accept suggestion row ${change.row}`}
              >
                {SPEC_CONFIRM_COPY.accept}
              </Button>
              <Button
                size="sm" variant={decision === "reject" ? "destructive" : "outline"} className="h-6 px-2 text-[11px]"
                onClick={() => onDecide?.(change.row, "reject")} aria-label={`Reject suggestion row ${change.row}`}
              >
                {SPEC_CONFIRM_COPY.reject}
              </Button>
              {decision ? <span className="text-[10px]">{SPEC_CONFIRM_COPY.decided(decision)}</span> : null}
            </div>
          </div>
        ) : null}
        {twin ? (
          // SLICE 1f (owner Y-a / Y-c / Y-d): this row MEANS THE SAME as an existing item -- the warning with
          // BOTH wordings and BOTH sets of numbers, Confirm / Decline per row, no bulk button. Confirm updates
          // the EXISTING item's rates (its wording stays); Decline skips the row and changes nothing.
          <div
            className="mt-1 rounded border border-orange-500/50 bg-orange-50 p-1.5 text-[11px] text-orange-950 dark:bg-orange-950/30 dark:text-orange-200"
            data-testid="upload-twin"
          >
            <div className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <div>{TWIN_COPY.warning(twin.existing_wording, twin.item_uid, twin.row_wording)}</div>
                {twin.case === "edit" && twin.edited_item_uid ? (
                  <div className="mt-0.5">{TWIN_COPY.editNote(twin.edited_item_uid)}</div>
                ) : null}
                <div className="mt-0.5 font-mono text-[10px]">
                  {TWIN_COPY.existingNumbers}: {twinNumbers(twin.existing_rates) || cellText("")}
                </div>
                <div className="font-mono text-[10px]">
                  {TWIN_COPY.rowNumbers}: {twinNumbers(twin.row_rates) || cellText("")}
                </div>
              </div>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <Button
                size="sm" variant={twinDecision === "confirm" ? "default" : "outline"} className="h-6 px-2 text-[11px]"
                onClick={() => onTwinDecide?.(change.row, "confirm")} aria-label={`Confirm duplicate row ${change.row}`}
              >
                {TWIN_COPY.confirm}
              </Button>
              <Button
                size="sm" variant={twinDecision === "decline" ? "destructive" : "outline"} className="h-6 px-2 text-[11px]"
                onClick={() => onTwinDecide?.(change.row, "decline")} aria-label={`Decline duplicate row ${change.row}`}
              >
                {TWIN_COPY.decline}
              </Button>
              {twinDecision ? <span className="text-[10px]">{TWIN_COPY.decided(twinDecision)}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RateMasterUploadDialog({ frozen, onPreview, onApply, onApplied, targetLabels }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "preview" | "apply">(null);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<UploadPlan | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [showCollapsed, setShowCollapsed] = useState(false);
  // SLICE 1d: the user's per-row answers to the suggestion question, by plan row. Cleared with the plan.
  const [decisions, setDecisions] = useState<Record<number, SpecDecision>>({});
  // SLICE 1f: the per-row Confirm / Decline answers to the duplicate warning. Cleared with the plan.
  const [twinDecisions, setTwinDecisions] = useState<Record<number, TwinDecision>>({});
  // The file's bytes are held so APPLY sends exactly what was PREVIEWED -- re-reading the file on
  // confirm would let a file changed on disk in between be applied against the wrong preview.
  const b64Ref = useRef<string>("");

  const reset = useCallback(() => {
    setPlan(null);
    setResult(null);
    setErr(null);
    setShowCollapsed(false);
    setDecisions({});
    setTwinDecisions({});
    b64Ref.current = "";
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);
  const decide = useCallback((row: number, d: SpecDecision) => {
    setDecisions((p) => ({ ...p, [row]: d }));
  }, []);
  const twinDecide = useCallback((row: number, d: TwinDecision) => {
    setTwinDecisions((p) => ({ ...p, [row]: d }));
  }, []);

  const onChoose = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setBusy("preview");
      setErr(null);
      setResult(null);
      setPlan(null);
      setShowCollapsed(false);
      setDecisions({});
      setTwinDecisions({});
      setFileName(file.name);
      try {
        const b64 = await fileToBase64(file);
        b64Ref.current = b64;
        setPlan(await onPreview(b64));
        setOpen(true);
      } catch (e) {
        setErr(downloadErrorMessage(e));
      } finally {
        setBusy(null);
        // Allow re-choosing the SAME file after a fix -- a file input fires nothing on an
        // unchanged value, so a user who edits and re-picks would get silence.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onPreview],
  );

  const doApply = useCallback(async () => {
    if (!plan) return;
    setBusy("apply");
    setErr(null);
    try {
      // SLICE 1d: only rows with a decision travel; an undecided row stays "won't price" as before.
      const fps = acceptedFingerprints(plan, decisions);
      // SLICE 1f: the duplicate answers ride only when any exist; a confirmed row's target fingerprint too.
      const tfps = twinFingerprints(plan, twinDecisions);
      setResult(await onApply(b64Ref.current, plan.digest,
        Object.keys(decisions).length ? decisions : undefined,
        Object.keys(fps).length ? fps : undefined,
        Object.keys(twinDecisions).length ? twinDecisions : undefined,
        Object.keys(tfps).length ? tfps : undefined));
      setPlan(null);
      onApplied?.();
    } catch (e) {
      setErr(downloadErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [onApply, onApplied, plan, decisions, twinDecisions]);

  const { expanded, collapsed } = splitChanges(plan?.changes ?? []);
  const suggestable = rowsWithSuggestion(plan);
  const undecidedTwins = undecidedTwinRows(plan, twinDecisions);
  const acceptAllShown = useCallback(() => {
    setDecisions((p) => {
      const next = { ...p };
      for (const row of suggestable) next[row] = "accept";
      return next;
    });
  }, [suggestable]);

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{UPLOAD_COPY.group}</div>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => void onChoose(e.target.files?.[0])}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null || !!frozen}
        title={frozen ? FREEZE_BLOCKED_MESSAGE : undefined}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-1 h-3.5 w-3.5" />
        {busy === "preview" ? UPLOAD_COPY.previewing : UPLOAD_COPY.choose}
      </Button>
      <p className="text-[11px] text-muted-foreground">{UPLOAD_COPY.hint}</p>
      <p className="text-[11px] text-muted-foreground">{UPLOAD_COPY.absentHint}</p>
      {err && !open && <p className="text-xs text-destructive">{err}</p>}
      {result && !open && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Applied {result.applied} row(s): {result.items_replaced} replaced, {result.items_added}{" "}
          added. Snapshot v{result.snapshot_version} saved.
        </p>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{UPLOAD_COPY.title}</DialogTitle>
          </DialogHeader>

          {plan && (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{fileName}</span>
                <Badge variant="outline">
                  {plan.mode === "all" ? "all categories" : "one category"}
                </Badge>
                <span className="text-muted-foreground">{plan.row_count} rows read</span>
              </div>

              {targetLabels && uploadTargetLine(plan, targetLabels) ? (
                // SLICE 1g (owner Z-c / Z-d): where this upload goes, as the server decided it from the file.
                <p className="text-xs font-medium" data-testid="upload-target">{uploadTargetLine(plan, targetLabels)}</p>
              ) : null}

              {showEncodingWarning(plan) && (
                <div className="flex gap-2 rounded border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{UPLOAD_COPY.encodingWarn(plan.encoding)}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {headlineCounts(plan.counts).map((c) => (
                  <Badge
                    key={c.key}
                    variant={c.tone === "error" && c.value > 0 ? "destructive" : "secondary"}
                  >
                    {c.value} {c.label}
                  </Badge>
                ))}
              </div>

              {plan.errors.length > 0 && (
                <div className="space-y-1 rounded border border-destructive/40 bg-destructive/5 p-2">
                  <div className="text-xs font-medium text-destructive">
                    {UPLOAD_COPY.errorsTitle(plan.errors.length)}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{UPLOAD_COPY.errorsHint}</p>
                  <ul className="space-y-0.5">
                    {plan.errors.slice(0, 50).map((e, i) => (
                      <li key={`${e.row}-${e.column}-${i}`} className="text-[11px]">
                        {e.row > 0 ? <span className="text-muted-foreground">Row {e.row}: </span> : null}
                        {e.message}
                      </li>
                    ))}
                  </ul>
                  {plan.errors.length > 50 && (
                    <p className="text-[11px] text-muted-foreground">
                      ...and {plan.errors.length - 50} more.
                    </p>
                  )}
                </div>
              )}

              {planIsNoOp(plan) && (
                <p className="text-xs text-muted-foreground">{UPLOAD_COPY.noOp}</p>
              )}

              {suggestable.length > 0 && (
                // SLICE 1d (owner T-b 3): "Accept all shown" accepts every row that HAS a suggestion.
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7" onClick={acceptAllShown} data-testid="accept-all-shown">
                    {SPEC_CONFIRM_COPY.acceptAll} ({suggestable.length})
                  </Button>
                  <span className="text-[11px] text-muted-foreground">{SPEC_CONFIRM_COPY.acceptAllHint}</span>
                </div>
              )}

              {expanded.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Shown in full ({expanded.length})</div>
                  <p className="text-[11px] text-muted-foreground">{UPLOAD_COPY.expandedHint}</p>
                  <div className="space-y-1">
                    {expanded.map((c) => (
                      <ChangeRow key={`${c.row}-${c.item_uid ?? "new"}`} change={c} decision={decisions[c.row]} onDecide={decide} twinDecision={twinDecisions[c.row]} onTwinDecide={twinDecide} />
                    ))}
                  </div>
                </div>
              )}

              {collapsed.length > 0 && (
                <div className="space-y-1">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs font-medium"
                    onClick={() => setShowCollapsed((v) => !v)}
                  >
                    {showCollapsed ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {UPLOAD_COPY.collapsedLabel(collapsed.length)}
                  </button>
                  {showCollapsed ? (
                    <div className="space-y-1">
                      {collapsed.map((c) => (
                        <ChangeRow key={`${c.row}-${c.item_uid ?? "new"}`} change={c} decision={decisions[c.row]} onDecide={decide} twinDecision={twinDecisions[c.row]} onTwinDecide={twinDecide} />
                      ))}
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {collapsed.slice(0, 8).map((c) => (
                        <li key={`${c.row}-${c.item_uid ?? "new"}`} className="text-[11px] text-muted-foreground">
                          row {c.row} &mdash; {c.label} ({changeSummary(c)})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {undecidedTwins.length > 0 && (
                <p className="text-[11px] font-medium text-orange-800 dark:text-orange-300" data-testid="upload-twin-undecided">
                  {TWIN_COPY.undecided(undecidedTwins.length)}
                </p>
              )}

              {canApply(plan, twinDecisions) && (
                <p className="text-[11px] text-muted-foreground">{UPLOAD_COPY.snapshotNote}</p>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-1 text-sm">
              <p>
                Applied {result.applied} row(s): {result.items_replaced} replaced,{" "}
                {result.items_added} added.
              </p>
              <p className="text-xs text-muted-foreground">
                Snapshot v{result.snapshot_version} was saved before the write, and the superseded
                rows are retained.
              </p>
            </div>
          )}

          {err && <p className="text-xs text-destructive">{err}</p>}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {result ? "Close" : UPLOAD_COPY.cancel}
            </Button>
            {!result && (
              <Button size="sm" disabled={!canApply(plan, twinDecisions) || busy !== null} onClick={() => void doApply()}>
                {busy === "apply" ? UPLOAD_COPY.applying : UPLOAD_COPY.apply}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
