/**
 * BcsColumnsDialog -- the BCS two-column confirmation card (slice BCS-S2).
 *
 * BCS records what a row costs US against what we charge the CLIENT. To compute a Total Amount
 * and a % Profit it needs two numbers off the committed sheet -- the row's Total Quantity and
 * its Amount (Combined) -- and neither sits on a fixed column across BoQs. This card is where a
 * human says which columns hold them, once per sheet+version.
 *
 * MULTI-PICK IS LOAD-BEARING. Each side is potentially multi-select: a sheet split per area
 * needs EVERY area column picked, because they SUM (owner ruling). A scalar column is a lone
 * pick, and a scalar must NEVER be mixed with its own per-area parts -- that would count every
 * value twice. The server refuses the mix; this card surfaces the refusal in the validity line
 * rather than letting the user attempt it.
 *
 * THIS COMPONENT HOLDS NO RULES. Eligibility, labelling and validity all come from the pure
 * `bcsColumns.ts`, which mirrors `services/boq_bcs/sources.py` condition-for-condition and in the
 * same precedence. Keep it that way: a rule inlined here would be structurally untestable (this
 * repo has NO DOM test environment by deliberate choice) and would immediately be a second
 * source of truth. Modelled on ClassifySheetDialog -- same Dialog shell, same reset-on-open,
 * same inline-error footer.
 *
 * TURNING BCS OFF IS NOT DESTRUCTIVE, which is why the footer action needs no confirm step:
 * `set_bcs_enabled(0)` writes one flag. The two confirmations are PRESERVED (so re-enabling does
 * not force a re-pick) and no cost row is ever deleted -- `BoQ Row BCS Rate` is freeze-and-
 * supersede and nothing on this path removes one. Readiness simply goes false meanwhile. That
 * makes it the Lock/Unlock shape, not the Freeze shape.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";
import type { BcsSource, ColumnDescriptor } from "./boqTypes";
import {
  bcsColumnLabel,
  bcsSelectionSaveable,
  bcsSourceCols,
  buildBcsDescriptorIndex,
  eligibleBcsColumns,
  validateBcsPicks,
  type BcsSide,
} from "./bcsColumns";

interface BcsColumnsDialogProps {
  open: boolean;
  /** The sheet this confirmation belongs to (display text only -- trimmed by the caller). */
  sheetLabel: string;
  /** Every mapped column of the COMMITTED sheet -- the same set the server validates against. */
  descriptors: ColumnDescriptor[];
  /** The stored confirmations, so re-opening the card shows what is already chosen. */
  qtySource: BcsSource | null;
  amountSource: BcsSource | null;
  onClose: () => void;
  /** POST confirm_bcs_columns. Throws on a server refusal; the message is shown inline. */
  onSave: (qtyCols: string[], amountCols: string[]) => Promise<void>;
  /** POST set_bcs_enabled(0). Non-destructive -- see the module docblock. */
  onDisable: () => Promise<void>;
}

/** One side's chip list + validity line. Pure presentation over the pure rules. */
function SideSection({
  side,
  heading,
  hint,
  columns,
  picks,
  onToggle,
  validity,
  disabled,
}: {
  side: BcsSide;
  heading: string;
  hint: string;
  columns: ColumnDescriptor[];
  picks: string[];
  onToggle: (col: string) => void;
  validity: ReturnType<typeof validateBcsPicks>;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground">{heading}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      {columns.length === 0 ? (
        // An honest dead end: the sheet maps nothing this side can use. Saying so beats an
        // empty box the user will read as a loading state.
        <p className="text-xs text-destructive">
          This sheet has no {side === "qty" ? "quantity" : "combined Amount"} column mapped, so
          BCS cannot read {side === "qty" ? "a quantity" : "an amount"} from it.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {columns.map((d) => {
            const picked = picks.includes(d.col);
            return (
              <button
                key={d.col}
                type="button"
                disabled={disabled}
                aria-pressed={picked}
                onClick={() => onToggle(d.col)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50",
                  picked
                    ? "border-primary bg-primary/10 font-semibold text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="font-mono">{d.col}</span>
                <span className="mx-1 opacity-50">—</span>
                {bcsColumnLabel(d)}
              </button>
            );
          })}
        </div>
      )}

      {/* The plain-English validity line. It is the CARD's voice for the server's refusal set,
          so the user never gets as far as a thrown error for something knowable here. */}
      <p className={cn("text-xs", validity.ok ? "text-muted-foreground" : "text-destructive")}>
        {validity.ok ? validity.summary : validity.message}
      </p>
    </div>
  );
}

export function BcsColumnsDialog({
  open,
  sheetLabel,
  descriptors,
  qtySource,
  amountSource,
  onClose,
  onSave,
  onDisable,
}: BcsColumnsDialogProps) {
  const [qtyPicks, setQtyPicks] = useState<string[]>([]);
  const [amountPicks, setAmountPicks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from the stored confirmation whenever the card (re)opens, so re-opening shows what
  // is already chosen rather than a blank slate. Keyed on `open` only -- a mid-edit refetch must
  // not stomp the user's in-progress picks.
  useEffect(() => {
    if (!open) return;
    setQtyPicks(bcsSourceCols(qtySource));
    setAmountPicks(bcsSourceCols(amountSource));
    setError(null);
    setSaving(false);
    setDisabling(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const index = useMemo(() => buildBcsDescriptorIndex(descriptors), [descriptors]);
  const qtyColumns = useMemo(() => eligibleBcsColumns("qty", descriptors), [descriptors]);
  const amountColumns = useMemo(() => eligibleBcsColumns("amount", descriptors), [descriptors]);

  const qtyValidity = validateBcsPicks("qty", qtyPicks, index);
  const amountValidity = validateBcsPicks("amount", amountPicks, index);
  const busy = saving || disabling;
  const canSave = !busy && bcsSelectionSaveable(qtyValidity, amountValidity);

  const toggle = (side: BcsSide, col: string) => {
    const setPicks = side === "qty" ? setQtyPicks : setAmountPicks;
    setPicks((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(qtyPicks, amountPicks);
      onClose();
    } catch (e) {
      // The server is the authority: if it refuses something the card thought was fine, its
      // words are what the user sees -- never a generic message that hides the real reason.
      setError(getFrappeError(e) || "Could not save the BCS columns. Please try again.");
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    setDisabling(true);
    setError(null);
    try {
      await onDisable();
      onClose();
    } catch (e) {
      setError(getFrappeError(e) || "Could not turn BCS off. Please try again.");
      setDisabling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>BCS columns — {sheetLabel}</DialogTitle>
          <DialogDescription>
            BCS compares what each row costs us against what we charge the client. Tell it which
            columns on this sheet hold the row&apos;s total quantity and the amount charged. Where
            a sheet splits a number across areas, pick every area column — they are added up.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <SideSection
            side="qty"
            heading="Total Quantity"
            hint="The sheet's one Total Quantity column, or the per-area quantity columns that add up to it."
            columns={qtyColumns}
            picks={qtyPicks}
            onToggle={(col) => toggle("qty", col)}
            validity={qtyValidity}
            disabled={busy}
          />
          <SideSection
            side="amount"
            heading="Amount (Combined)"
            hint="What we charge the client — the combined Amount, not a rate and not the supply or install half."
            columns={amountColumns}
            picks={amountPicks}
            onToggle={(col) => toggle("amount", col)}
            validity={amountValidity}
            disabled={busy}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter className="sm:justify-between">
          {/* Turning BCS off keeps these columns and any cost rates already entered -- so it is a
              direct action, not a confirm-first one (see the module docblock). */}
          <Button variant="outline" onClick={handleDisable} disabled={busy} title="Hide the BCS cost section. Your columns and any cost rates are kept.">
            {disabling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Turn BCS off
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save columns
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
