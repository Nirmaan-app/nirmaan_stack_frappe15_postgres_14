/**
 * BcsColumnsDialog -- the BCS two-column confirmation card (slice BCS-S2).
 *
 * BCS records what a row costs US against what we charge the CLIENT. To compute a Total Amount
 * and a % Margin it needs two numbers off the committed sheet -- the row's Total Quantity and
 * the Amount charged -- and neither sits on a fixed column across BoQs. This card is where a
 * human says which columns hold them, once per sheet+version.
 *
 * MULTI-PICK IS LOAD-BEARING. Each side is potentially multi-select: a sheet split per area
 * needs EVERY area column picked, because they SUM (owner ruling). A scalar column is a lone
 * pick, and a scalar must NEVER be mixed with its own per-area parts -- that would count every
 * value twice. The server refuses the mix; this card surfaces the refusal in the validity line
 * rather than letting the user attempt it.
 *
 * THE AMOUNT SIDE ACCEPTS THE SUPPLY / INSTALLATION HALVES (BCS-S2b on the server, mirrored here
 * at BCS-S2c, owner ruling 2026-08-02). Most real sheets have no single "Amount (Total)" column,
 * so the earlier card -- which offered only combined Amounts -- showed an EMPTY Amount list on
 * most of them and could not be used at all. A sheet carrying only ONE half is accepted too.
 *
 * WHICH MAKES THE VALIDITY LINE THE SAFETY, NOT DECORATION. "Adapt and disclose, never refuse":
 * because a one-sided sheet is now accepted, the line under each side STATES THE FORMULA IN
 * FORCE ("% Margin is measured against the Supply amount alone (column G). Installation is not
 * included."). A sheet measured against half its amount otherwise looks exactly like one
 * measured against all of it. Never demote that line to a hint, and never truncate it.
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
import { useEffect, useState } from "react";
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
import { getFrappeError } from "@/utils/frappeErrors";

interface BcsColumnsDialogProps {
  open: boolean;
  /** The sheet this switch belongs to (display text only -- trimmed by the caller). */
  sheetLabel: string;
  /** Is BCS currently on for this sheet+version? Drives which action the dialog offers. */
  enabled: boolean;
  onClose: () => void;
  /** POST set_bcs_enabled(1). */
  onEnable: () => Promise<void>;
  /** POST set_bcs_enabled(0). Non-destructive -- see the module docblock. */
  onDisable: () => Promise<void>;
}

export function BcsColumnsDialog({
  open,
  sheetLabel,
  enabled,
  onClose,
  onEnable,
  onDisable,
}: BcsColumnsDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const act = async () => {
    setBusy(true);
    setError(null);
    try {
      await (enabled ? onDisable() : onEnable());
      onClose();
    } catch (e) {
      setError(getFrappeError(e) || "Could not change the BCS setting. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>BCS — {sheetLabel}</DialogTitle>
          <DialogDescription>
            {enabled
              ? "BCS is ON for this sheet. The cost columns are shown and cost rates can be entered."
              : "BCS is OFF for this sheet. Turn it on to record what the work costs us alongside what we charge."}
          </DialogDescription>
        </DialogHeader>

        {/* Where the quantity and amount choices went (BCS-S12). This dialog used to carry two
            column pickers; both now live in the formula dialogs on the columns they feed, which
            name the sheet's real columns with their Excel letters. Saying it here means someone
            looking for the old pickers is not left hunting. */}
        <p className="text-[12px] text-muted-foreground">
          Which quantity and which amount this sheet measures against is set in the{" "}
          <span className="font-medium text-foreground">ƒ</span> on{" "}
          <span className="font-medium text-foreground">BCS Total Amount</span> and{" "}
          <span className="font-medium text-foreground">% Margin</span>.
        </p>

        {/* Turning BCS off is NON-DESTRUCTIVE, which is why there is no confirm step: it writes
            one flag. Every stored cost row and both formulas are preserved, so turning it back
            on restores the sheet exactly. */}
        {enabled && (
          <p className="text-[12px] text-muted-foreground">
            Turning it off hides the cost columns. Nothing is deleted — costs and formulas are
            kept, and come back if you turn it on again.
          </p>
        )}

        {error && <p className="text-[12px] text-destructive">{error}</p>}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={enabled ? "destructive" : "default"}
            onClick={act}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Working…
              </>
            ) : enabled ? (
              "Turn BCS off"
            ) : (
              "Turn BCS on"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
