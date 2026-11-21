/**
 * VAV-2b1 (B5 / B6; owner 2026-11-20 18:42 "this is ok" = SCREEN 7, 18:44 "yes to all ... the usual revert icons") -- the shared-item
 * blocks of a VAV row and the "Review before using" block. ONE component, used by the Calculator now and by the BoQ row panel in VAV-2b2
 * (both through `RateHelperPanel`'s item list). Display and edits only: every figure comes from `sheetSharesView` (vavSheetShares.ts).
 */
import { AlertTriangle, Plus, RotateCcw, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { ShareEditOp, SharedItemView, SharesView } from "./vavSheetShares";

const fig = (n: number) => formatToRoundedIndianRupee(n).replace(/^₹/, "");

function Revert({ onClick, label, testId }: { onClick: () => void; label: string; testId: string }) {
  return (
    <button type="button" onClick={onClick} title="Undo my edit to this field -- restores the helper's value" aria-label={label} data-testid={testId}>
      <RotateCcw className="h-3 w-3 text-muted-foreground hover:text-foreground" />
    </button>
  );
}

function ShareBlock({ b, labels, onShares }: { b: SharedItemView; labels: SharesView["labels"]; onShares: (op: ShareEditOp) => void }) {
  return (
    <div className="space-y-1.5 rounded-md border-2 border-primary/60 bg-background px-2 py-1.5" data-testid={`share-block-${b.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold">
          {b.heading}{" "}
          <span
            className={cn("ml-1 rounded px-1 py-0.5 text-[10px] font-medium",
              b.origin === "helper" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200")}
            data-testid="share-tag"
          >
            {b.tag}
          </span>
        </div>
        <button type="button" onClick={() => onShares({ op: "remove", share: b.id })} aria-label={`Remove the ${b.label}`} data-testid="share-remove">
          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>
      <div className="space-y-1">
        {b.fields.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2" data-testid={`share-field-${f.id}`}>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {f.label}
              {f.sourceLabel && <span className="rounded bg-muted px-1 text-[10px]" data-testid="share-field-source">{f.sourceLabel}</span>}
              {f.edited && <Revert onClick={() => onShares({ op: "revert", share: b.id, field: f.id })} label={`Undo my edit to ${f.label}`} testId="share-field-revert" />}
            </span>
            <Input
              className="h-7 w-24 text-xs"
              inputMode="decimal"
              value={f.value}
              aria-label={f.label}
              onChange={(e) => onShares({ op: "set", share: b.id, field: f.id, value: e.target.value })}
            />
          </div>
        ))}
      </div>
      {b.replacesLine && <div className="text-xs text-muted-foreground" data-testid="share-replaces">{b.replacesLine}</div>}
      <div className="space-y-0.5 text-xs text-muted-foreground" data-testid="share-sum">
        {b.sumLines.map((l, i) => <div key={i}>{l}</div>)}
        {b.figures ? (
          <div className="font-medium text-foreground" data-testid="share-figures">
            Supply {fig(b.figures.supply_rate)} &middot; Install {fig(b.figures.install_rate)}{b.perLabel ?? labels.per_box}
          </div>
        ) : (
          <div className="text-red-700 dark:text-red-400" data-testid="share-reason">{b.reason}</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="share-amount">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {b.typedLabel ?? labels.typed}
          {b.amountTyped && <Revert onClick={() => onShares({ op: "revert_amount", share: b.id })} label="Undo the amount I typed" testId="share-amount-revert" />}
        </span>
        <Input className="h-7 w-24 text-xs" inputMode="decimal" placeholder={labels.typed_supply} aria-label={labels.typed_supply}
          value={b.amount.supply} onChange={(e) => onShares({ op: "amount", share: b.id, kind: "supply", value: e.target.value })} />
        <Input className="h-7 w-24 text-xs" inputMode="decimal" placeholder={labels.typed_install} aria-label={labels.typed_install}
          value={b.amount.install} onChange={(e) => onShares({ op: "amount", share: b.id, kind: "install", value: e.target.value })} />
      </div>
      {b.notes.map((n) => (
        <div key={n} className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="share-note">
          {n}
        </div>
      ))}
    </div>
  );
}

/** VAV-2b1 (B5). The row's shared-item blocks, then one add button per share not on the row. */
export function SharedItems({ shares, onShares }: { shares: SharesView; onShares: (op: ShareEditOp) => void }) {
  return (
    <div className="space-y-2" data-testid="share-blocks">
      {shares.blocks.map((b) => <ShareBlock key={b.id} b={b} labels={shares.labels} onShares={onShares} />)}
      {shares.adds.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="share-add-buttons">
          {shares.adds.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onShares({ op: "add", share: a.id })}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-primary/60 bg-background px-2.5 text-xs font-medium hover:bg-muted"
              data-testid={`share-add-${a.id}`}
            >
              <Plus className="h-3 w-3" /> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** VAV-2b2 (R10, owner 2026-11-21 10:45 "2 ok"): the "Possible double counting" block, in the "Review before using" style. */
export function DoubleCountBlock({ heading, lines }: { heading: string; lines: readonly string[] }) {
  return (
    <div className="flex gap-2 rounded-md border-2 border-amber-500 bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="alert" data-testid="item-double-count-block">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="text-xs">
        <div className="font-bold">{heading}</div>
        {lines.map((l) => <div key={l}>{l}</div>)}
      </div>
    </div>
  );
}

/** VAV-2b1 (B6; owner 18:06 "more prominent", screen 7): the combination warning as a bordered amber block with an icon and its heading. */
export function ReviewBlock({ heading, note }: { heading: string; note: string }) {
  return (
    <div className="flex gap-2 rounded-md border-2 border-amber-500 bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="alert" data-testid="item-review-block">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="text-xs">
        <div className="font-bold">{heading}</div>
        <div className="whitespace-pre-line" data-testid="item-combination-warning">{note}</div>
      </div>
    </div>
  );
}
