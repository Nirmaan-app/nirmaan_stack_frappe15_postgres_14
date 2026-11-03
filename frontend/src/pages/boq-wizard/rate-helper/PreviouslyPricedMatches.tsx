/**
 * DEV2-B5 S4 -- THE "PREVIOUSLY PRICED" CARD AND ITS POP-UP (owner R-H2AI 2026-11-02 15:21, mockup approved 15:23 "yes
 * this is fine"; COLOURS 16:13 "lets just color code them red, amber green"; DISPLAY ORDER 2026-11-03 11:06; G4 (a) /
 * G13 / G14 (a)).
 *
 *   the card   "Previously priced", the rate range (total rate, min - max of the shown matches, leaving out not-a-match
 *              and other-unit ones; one figure for one; "–" for none), up to 5 matches in display order -- a colour dot
 *              with its words as tooltip AND screen-reader text, the row's text, its total and unit, "other unit - not
 *              in range", a not-a-match one struck through -- and a one-line colour key. NO value to "Use", no badge.
 *   the pop-up project / BoQ / sheet; the matched row's payload as the judge read it, with its hierarchy (sheet ->
 *              section -> item group -> row, notes under each); supply / install / total and the date priced; the
 *              verdict in words with its note; prev / next wrapping round the shown matches; "Not a match" -> an
 *              optional reason + note -> saved, struck through, out of the range; "Undo"; "Open this row" only when
 *              the user may open that BoQ.
 * Every rule (range, unit, total, order, words) is a pure function in rateHelperRegistry.ts; this file renders them.
 *
 * DEV2-B6 MOVABLE POP-UP (owner 23:22: "the modal which opens on clicking any match is stuck at one place opn the
 * screen...can we make it move freely across the screen so that the user can also move it to see the backgroyund
 * row"): dragged by its top bar (pointer events: mouse and touch); NO dimming overlay, the page behind stays visible;
 * kept inside the window (clampDrag: the top bar never leaves the screen); the position is kept while stepping prev /
 * next - once dragged it is anchored by its TOP-LEFT corner, so a match with a taller text does not move its top bar
 * (C4 fix) - ; the next open is centred again (the dialog unmounts on close); the close button and Esc close it as before;
 * a click on the page behind does NOT close it; focus stays in the pop-up (Radix's modal focus trap).
 */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  MATCH_DOT_HEX,
  MATCH_DOT_TEXT,
  MATCH_KEY_TEXT,
  formatRs,
  isNotAMatch,
  isOtherUnit,
  matchRange,
  matchTotal,
  rangeText,
} from "./rateHelperRegistry";
import type { MatchColour, MatchDetail, PreviousMatch, PreviouslyPricedView } from "./rateHelperTypes";

/** The reasons the store accepts (api/boq/rate_match.FEEDBACK_REASONS; the doctype's Select). */
export const NOT_A_MATCH_REASONS = ["Different spec", "Different item", "Different unit", "Different scope", "Other"] as const;

/** PURE. The pricing route's link to a row (G14 (a)): the page reads `?row=`, clears its view filters, scrolls there. */
export function matchRowHref(m: Pick<PreviousMatch, "boq" | "sheet_name" | "excel_row">): string {
  return `/upload-boq/hub/${encodeURIComponent(m.boq)}/pricing/${encodeURIComponent(m.sheet_name)}?row=${m.excel_row}`;
}

/** A dragged pop-up's top-left corner, in px from the window's top-left. */
export interface DragPos {
  left: number;
  top: number;
}

/** PURE (DEV2-B6). The pop-up's wanted top-left corner, clamped so it stays inside the window: left / right edges
 *  inside it (when the pop-up is wider than the window, its edges stay outside it instead), and the top bar never
 *  leaves the screen (top >= 0 and top + barHeight <= the window's height). */
export function clampDrag(
  want: DragPos,
  box: { width: number; height: number },
  view: { width: number; height: number },
  barHeight: number,
): DragPos {
  const [minL, maxL] = box.width <= view.width ? [0, view.width - box.width] : [view.width - box.width, 0];
  const maxT = Math.max(0, view.height - Math.max(0, barHeight));
  return { left: Math.min(maxL, Math.max(minL, want.left)), top: Math.min(maxT, Math.max(0, want.top)) };
}

/** PURE. prev / next wrap round the shown matches. */
export function stepIndex(i: number, n: number, dir: 1 | -1): number {
  return n <= 0 ? 0 : (((i + dir) % n) + n) % n;
}

export interface PayloadLevel {
  tag: string;
  text: string;
  notes: string[];
}

function noteStrings(notes: unknown): string[] {
  if (notes == null) return [];
  if (typeof notes === "string") return notes.trim() ? [notes.trim()] : [];
  if (Array.isArray(notes)) return notes.flatMap(noteStrings);
  if (typeof notes === "object") return Object.values(notes as Record<string, unknown>).flatMap(noteStrings);
  return [String(notes)];
}

/** PURE. The payload block (extraction._ai_item) as levels, root first: the sheet, its headings (the top one
 *  "Section", the nearest "Item group", any between "Sub-section"), then the row itself -- each with its notes. */
export function payloadLevels(payload: Record<string, unknown> | null | undefined, unit?: string | null): PayloadLevel[] {
  if (!payload) return [];
  const chain = (Array.isArray(payload.ancestor_chain) ? payload.ancestor_chain : []) as Record<string, unknown>[];
  const sheet = chain.find((a) => a.relation === "sheet");
  const heads = chain
    .filter((a) => a.relation !== "sheet")
    .sort((a, b) => Number(b.distance ?? 0) - Number(a.distance ?? 0));
  const out: PayloadLevel[] = [];
  if (sheet) out.push({ tag: "Sheet", text: String(sheet.description ?? ""), notes: noteStrings(sheet.notes) });
  heads.forEach((h, i) => {
    const tag = i === 0 ? "Section" : i === heads.length - 1 ? "Item group" : "Sub-section";
    out.push({ tag, text: String(h.description ?? ""), notes: noteStrings(h.notes) });
  });
  const u = (unit ?? "").trim();
  out.push({ tag: "This row", text: `${String(payload.description ?? "")}${u ? `  ·  ${u}` : ""}`, notes: noteStrings(payload.notes) });
  return out;
}

function Dot({ colour, size = 10 }: { colour: MatchColour; size?: number }) {
  const words = MATCH_DOT_TEXT[colour];
  return (
    <span
      role="img"
      aria-label={words}
      title={words}
      data-testid="match-dot"
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: MATCH_DOT_HEX[colour] }}
    />
  );
}

const fig = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? formatRs(v) : "—");
const day = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "—");

export function PreviouslyPricedCard({ view }: { view: PreviouslyPricedView }) {
  const [open, setOpen] = useState<number | null>(null);
  const range = matchRange(view);
  const n = view.matches.length;
  return (
    <div className="rounded-md border" data-testid="previously-priced-card">
      <div className="border-b px-3 py-2">
        <div className="text-sm font-medium">Previously priced</div>
        <div className="text-[11px] text-muted-foreground">Rate range, total{view.rowUnit ? ` per ${view.rowUnit}` : ""}</div>
        <div className="text-base font-semibold tabular-nums" data-testid="match-range">{rangeText(range)}</div>
        <div className="text-[11px] text-muted-foreground">
          {range ? `From ${range.count} of ${n} match${n === 1 ? "" : "es"}` : "No matches left in the range"}
          {range && range.left > 0 ? ` (${range.left} left out)` : ""}
        </div>
      </div>
      <ul className="space-y-0.5 p-1">
        {view.matches.map((m, i) => {
          const flagged = isNotAMatch(m);
          const other = isOtherUnit(m, view.rowUnit);
          const total = matchTotal(m);
          return (
            <li key={`${m.key}-${i}`}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                aria-label={`Open match ${i + 1} details`}
                data-testid="match-row"
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Dot colour={m.colour} />
                  <span className={cn("truncate text-xs font-medium", flagged && "line-through")}>
                    {m.description || `Row ${m.excel_row}`}
                  </span>
                </span>
                <span className={cn("text-right text-xs font-semibold tabular-nums", flagged && "line-through")}>
                  {fig(total)}{m.unit ? ` / ${m.unit}` : ""}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">{m.boq} · {m.sheet_name}</span>
                <span className={cn("text-right text-[11px]", flagged || other ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                  {flagged ? "Not a match" : other ? "other unit - not in range" : day(m.priced_at)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-[11px] text-muted-foreground" data-testid="match-key">
        {(["green", "amber", "red"] as MatchColour[]).map((c) => (
          <span key={c} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: MATCH_DOT_HEX[c] }} />
            {MATCH_KEY_TEXT[c]}
          </span>
        ))}
        <span>Click a match for full details.</span>
      </div>
      {open !== null && <MatchDialog view={view} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function MatchDialog({ view, index, onIndex, onClose }: {
  view: PreviouslyPricedView;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const n = view.matches.length;
  const m = view.matches[Math.min(index, n - 1)];
  const [detail, setDetail] = useState<Record<string, MatchDetail | "error">>({});
  const [form, setForm] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = m ? detail[m.key] : undefined;
  // DEV2-B6: the drag. `pos` lives here, so it is kept while prev / next change `index`; a new open mounts afresh.
  // null = centred (as opened); once dragged, the top-left corner in px (C4: a top-left anchor, not the centre).
  const boxRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<DragPos | null>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const clampTo = (want: DragPos): DragPos => {
    const box = boxRef.current?.getBoundingClientRect();
    return clampDrag(want, { width: box?.width ?? 0, height: box?.height ?? 0 },
      { width: window.innerWidth, height: window.innerHeight }, barRef.current?.getBoundingClientRect().height ?? 0);
  };
  const onBarDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input")) return;   // the bar's buttons still click
    const at = boxRef.current?.getBoundingClientRect();
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos?.left ?? at?.left ?? 0, oy: pos?.top ?? at?.top ?? 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onBarMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (g) setPos(clampTo({ left: g.ox + e.clientX - g.sx, top: g.oy + e.clientY - g.sy }));
  };
  const onBarUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    if (e.currentTarget.hasPointerCapture?.(drag.current.id)) e.currentTarget.releasePointerCapture(drag.current.id);
    drag.current = null;
  };
  useEffect(() => {
    const keepInside = () => setPos((p) => (p ? clampTo(p) : p));
    window.addEventListener("resize", keepInside);
    return () => window.removeEventListener("resize", keepInside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setForm(false); setReason(null); setNote(""); setError(null);
    if (!m || detail[m.key]) return;
    let live = true;
    view.loadDetail(m).then(
      (x) => live && setDetail((p) => ({ ...p, [m.key]: x })),
      () => live && setDetail((p) => ({ ...p, [m.key]: "error" })),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.key]);

  if (!m) return null;
  const flagged = isNotAMatch(m);
  const det = d && d !== "error" ? d : null;
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await f(); setForm(false); setReason(null); setNote(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  };
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
      {/* DEV2-B6: no DialogOverlay - the page behind stays visible; a click there does not close the pop-up. */}
      <DialogPrimitive.Content
        ref={boxRef}
        data-testid="match-dialog"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : undefined}
        className={cn("fixed z-50 grid max-h-[85vh] w-full max-w-3xl gap-4 overflow-y-auto border bg-background p-6 shadow-lg sm:rounded-lg",
          pos ? "" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2")}
      >
        <div
          ref={barRef}
          data-testid="match-dialog-bar"
          title="Drag to move"
          className="-mx-6 -mt-6 cursor-move touch-none select-none px-6 pt-6"
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerCancel={onBarUp}
        >
        <DialogHeader>
          <div className="flex items-center gap-2 pr-6">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="Previous match"
              onClick={() => onIndex(stepIndex(index, n, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-sm font-normal text-muted-foreground">Match {index + 1} of {n}</DialogTitle>
              <DialogDescription asChild>
                <span className="flex items-center gap-2 text-sm text-foreground" data-testid="match-verdict">
                  <Dot colour={m.colour} size={12} />
                  <span>{MATCH_DOT_TEXT[m.colour]}{m.n1b ? ` - ${m.n1b}` : ""}</span>
                </span>
              </DialogDescription>
            </div>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="Next match"
              onClick={() => onIndex(stepIndex(index, n, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div><div className="text-xs text-muted-foreground">Project</div><div className="font-medium">{det?.project_name ?? det?.project ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">BoQ</div><div className="font-medium">{det?.boq_name ? `${det.boq_name} (${m.boq})` : m.boq}</div></div>
          <div><div className="text-xs text-muted-foreground">Sheet</div><div className="font-medium">{m.sheet_name}</div></div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Full row, as priced</div>
          <div className="space-y-2 rounded border px-3 py-2" data-testid="match-payload">
            {d === undefined && <div className="text-xs text-muted-foreground">Loading the row ...</div>}
            {d === "error" && <div className="text-xs text-red-700">The row could not be read.</div>}
            {det && !det.payload && <div className="text-xs text-muted-foreground">This row is no longer in its sheet.</div>}
            {det && payloadLevels(det.payload, m.unit).map((lv, k) => (
              <div key={k} style={{ paddingLeft: k * 14 }} data-testid="payload-level">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-[72px] text-[10px] uppercase tracking-wide text-muted-foreground">{lv.tag}</span>
                  <span className={cn("text-sm", lv.tag === "This row" && "font-semibold")}>{lv.text}</span>
                </div>
                {lv.notes.map((t, j) => (
                  <div key={j} className="pl-[80px] text-xs text-muted-foreground">Note: {t}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 rounded bg-muted/50 px-3 py-2 text-sm" data-testid="match-rates">
          <div><div className="text-xs text-muted-foreground">Supply</div><div className="tabular-nums">{fig(m.supply_rate)}</div></div>
          <div><div className="text-xs text-muted-foreground">Install</div><div className="tabular-nums">{fig(m.install_rate)}</div></div>
          <div><div className="text-xs text-muted-foreground">Total{m.unit ? ` / ${m.unit}` : ""}</div><div className="font-semibold tabular-nums">{fig(matchTotal(m))}</div></div>
          <div><div className="text-xs text-muted-foreground">Priced on</div><div>{day(m.priced_at)}</div></div>
        </div>
        {isOtherUnit(m, view.rowUnit) && (
          <div className="text-xs text-red-700 dark:text-red-400">Priced in another unit ({m.unit}) - left out of the rate range.</div>
        )}
        {error && <div className="text-xs text-red-700" role="alert">{error}</div>}
        {flagged ? (
          <div className="flex items-center justify-between gap-3 rounded border bg-muted/40 px-3 py-2 text-sm" data-testid="match-flagged">
            <span>Marked as not a match{m.flag?.reason ? ` (${m.flag.reason.toLowerCase()})` : ""}. Saved for improving matching; it is left out of the rate range.</span>
            {view.canMark && <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => view.onUndo(m))}>Undo</Button>}
          </div>
        ) : form ? (
          <div className="space-y-2 rounded border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/30" data-testid="match-flag-form">
            <div className="text-sm font-medium">Why is it not a match? (optional)</div>
            <div className="flex flex-wrap gap-2">
              {NOT_A_MATCH_REASONS.map((r) => (
                <Button key={r} type="button" size="sm" variant={reason === r ? "destructive" : "outline"} aria-pressed={reason === r}
                  onClick={() => setReason(reason === r ? null : r)}>{r}</Button>
              ))}
            </div>
            <label className="block text-xs text-muted-foreground">
              Note for the team (optional)
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
                className="mt-1 block w-full rounded border bg-background px-2 py-1 text-sm text-foreground" data-testid="match-flag-note" />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setForm(false)}>Cancel</Button>
              <Button type="button" variant="destructive" disabled={busy}
                onClick={() => run(() => view.onMark(m, reason, note.trim() || null))}>Mark as not a match</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Is this the wrong row to compare with?</span>
            <div className="flex gap-2">
              {det?.can_open && view.canOpenBoqs && (
                <Button type="button" variant="outline" asChild>
                  <a href={matchRowHref(m)} target="_blank" rel="noopener noreferrer" data-testid="match-open-row">
                    Open this row <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
              {view.canMark && (
                <Button type="button" variant="outline" className="border-red-700 text-red-700" onClick={() => setForm(true)}>Not a match</Button>
              )}
            </div>
          </div>
        )}
        {flagged && det?.can_open && view.canOpenBoqs && (
          <div className="flex justify-end">
            <Button type="button" variant="outline" asChild>
              <a href={matchRowHref(m)} target="_blank" rel="noopener noreferrer" data-testid="match-open-row">
                Open this row <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        )}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <Cross2Icon className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
