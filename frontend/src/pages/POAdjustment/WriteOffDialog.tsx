import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Eraser } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import formatToIndianRupee from "@/utils/FormatPrice";
import {
  normalizeWriteOffReason,
  useWriteOffAdjustment,
} from "./data/usePOAdjustmentMutations";
import { WRITE_OFF_REASON_MAX_LEN } from "./data/poAdjustment.constants";

interface WriteOffDialogProps {
  poId: string;
  /** Current signed balance. The control is hidden by the caller when this is 0. */
  remainingImpact: number;
  /** Re-read the adjustment after a successful write-off. */
  onWrittenOff: () => void;
}

/**
 * D5 — the honest exit, admin only.
 *
 * Against-PO, Adhoc expense and Vendor Refund all create a `Project Payments` row. When an
 * adjustment balance is a bookkeeping artefact rather than money, each of those books a
 * transfer, an expense or a refund that never happened. With no truthful option available,
 * people hand-edited `remaining_impact` in Desk instead — which is how PO/011/00097/26-27
 * came to sit at +144.00 while its own rows summed to −144.67.
 *
 * So this writes a single ledger entry with a name and a reason against it, and moves no
 * money at all. The caller gates visibility on `canWriteOffAdjustment`; the server re-gates
 * and is authoritative.
 */
export function WriteOffDialog({
  poId,
  remainingImpact,
  onWrittenOff,
}: WriteOffDialogProps) {
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const { writeOff, loading } = useWriteOffAdjustment();

  const outstanding = Math.abs(remainingImpact);
  // Blank means "all of it" — the common case is clearing the whole balance, and making
  // people retype a figure they can already see invites a typo.
  const amount = amountText.trim() === "" ? outstanding : Number(amountText);
  const amountValid =
    Number.isFinite(amount) && amount > 0 && amount <= outstanding + 0.01;
  const { value: cleanReason, isValid: reasonValid } =
    normalizeWriteOffReason(reason);

  const openDialog = () => {
    setAmountText("");
    setReason("");
    setOpen(true);
  };

  const submit = async () => {
    try {
      const res = await writeOff(poId, amount, cleanReason);
      toast({
        title: "Written off",
        description: `${formatToIndianRupee(
          Math.abs(res?.written_off ?? amount)
        )} written off. ${
          Math.abs(res?.remaining_impact ?? 0) < 0.01
            ? "Nothing outstanding."
            : `${formatToIndianRupee(
                Math.abs(res?.remaining_impact ?? 0)
              )} still outstanding.`
        }`,
      });
      setOpen(false);
      onWrittenOff();
    } catch (err: any) {
      toast({
        title: "Write-off failed",
        description: err?.message || "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={openDialog}
        className="h-7 gap-1.5 border-slate-300 text-slate-600 hover:bg-slate-50 text-[11px]"
      >
        <Eraser className="h-3 w-3" />
        Write off
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Write off this balance?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <p>
                  {poId} has{" "}
                  <span className="font-semibold">
                    {formatToIndianRupee(outstanding)}
                  </span>{" "}
                  outstanding on its adjustment ledger.
                </p>
                <p className="text-muted-foreground">
                  A write-off records that this balance is not money. It creates
                  no payment and does not change what has been paid. Use it when
                  the balance is a bookkeeping artefact — not to settle a real
                  debt or refund.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="write-off-amount" className="text-xs">
                Amount (blank = all of it)
              </Label>
              <Input
                id="write-off-amount"
                inputMode="decimal"
                placeholder={String(outstanding)}
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
              {!amountValid && (
                <p className="text-xs text-destructive">
                  Enter an amount between 0 and{" "}
                  {formatToIndianRupee(outstanding)}.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="write-off-reason" className="text-xs">
                Reason (required)
              </Label>
              <Textarea
                id="write-off-reason"
                rows={3}
                maxLength={WRITE_OFF_REASON_MAX_LEN}
                placeholder="Why is this balance not money?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground text-right">
                {cleanReason.length}/{WRITE_OFF_REASON_MAX_LEN}
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                submit();
              }}
              disabled={loading || !amountValid || !reasonValid}
            >
              {loading ? "Writing off…" : "Write off"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
