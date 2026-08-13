// SLICE 6 -- the preview surface. UPLOAD -> PREVIEW -> CONFIRM -> APPLY, and never one step.
//
// ⚠️ THE DIALOG NEVER DECIDES ANYTHING. The server computes the whole plan (what changes, what is
// major, what is an error) and this renders it; a second client-side copy of the 10% rule or of the
// upsert semantics would be free to disagree with the write that actually happens, which is the one
// failure a preview must never have.
//
// EXPANDED BY DEFAULT: every new item and every rate move of >= 10% IN EITHER DIRECTION -- the two
// classes a count cannot convey. COLLAPSED behind a count: everything else, one click from open.
// Nothing is hidden; the collapsing is about attention, not access.

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { downloadErrorMessage } from "./rateMasterDownload";
import {
  UPLOAD_COPY,
  canApply,
  cellText,
  changeSummary,
  fileToBase64,
  formatPct,
  headlineCounts,
  planIsNoOp,
  splitChanges,
  type UploadChange,
  type UploadPlan,
  type UploadResult,
} from "./rateMasterUpload";

interface Props {
  /** Reads the file and returns the plan. MUST NOT write -- it is called on every file choice. */
  onPreview: (contentBase64: string) => Promise<UploadPlan>;
  /** Applies the previewed file. The digest is what refuses a plan the catalog has outgrown. */
  onApply: (contentBase64: string, expectedDigest: string) => Promise<UploadResult>;
  /** Fired after a successful apply so the caller can refetch the item list. */
  onApplied?: () => void;
}

function ChangeRow({ change }: { change: UploadChange }) {
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
                  Math.abs(f.pct) >= 10 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {formatPct(f.pct)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RateMasterUploadDialog({ onPreview, onApply, onApplied }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "preview" | "apply">(null);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<UploadPlan | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [showCollapsed, setShowCollapsed] = useState(false);
  // The file's bytes are held so APPLY sends exactly what was PREVIEWED -- re-reading the file on
  // confirm would let a file changed on disk in between be applied against the wrong preview.
  const b64Ref = useRef<string>("");

  const reset = useCallback(() => {
    setPlan(null);
    setResult(null);
    setErr(null);
    setShowCollapsed(false);
    b64Ref.current = "";
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const onChoose = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setBusy("preview");
      setErr(null);
      setResult(null);
      setPlan(null);
      setShowCollapsed(false);
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
      setResult(await onApply(b64Ref.current, plan.digest));
      setPlan(null);
      onApplied?.();
    } catch (e) {
      setErr(downloadErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [onApply, onApplied, plan]);

  const { expanded, collapsed } = splitChanges(plan?.changes ?? []);

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{UPLOAD_COPY.group}</div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => void onChoose(e.target.files?.[0])}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null}
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

              {plan.encoding !== "utf-8" && (
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

              {expanded.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Shown in full ({expanded.length})</div>
                  <p className="text-[11px] text-muted-foreground">{UPLOAD_COPY.expandedHint}</p>
                  <div className="space-y-1">
                    {expanded.map((c) => (
                      <ChangeRow key={`${c.row}-${c.item_uid ?? "new"}`} change={c} />
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
                        <ChangeRow key={`${c.row}-${c.item_uid ?? "new"}`} change={c} />
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

              {canApply(plan) && (
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
              <Button size="sm" disabled={!canApply(plan) || busy !== null} onClick={() => void doApply()}>
                {busy === "apply" ? UPLOAD_COPY.applying : UPLOAD_COPY.apply}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
