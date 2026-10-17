import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import formatToIndianRupee from "@/utils/FormatPrice";
import type { TransferStockRow } from "@/utils/itmTransfer";

interface TransferRequestPreviewDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fromLabel: string;
  toLabel: string;
  /** The ticked rows, each with its quantity. */
  items: (TransferStockRow & { qty: number })[];
  onConfirm: () => void;
  isSubmitting: boolean;
}

/** One side of the route, as a small labelled box. */
const RouteBox = ({ side, name }: { side: string; name: string }) => (
  <div className="min-w-0 flex-1 rounded-md border bg-muted/40 px-3 py-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{side}</p>
    <p className="truncate text-sm font-semibold">{name || "—"}</p>
  </div>
);

/**
 * Last check before `create_itms`, laid out like a transfer statement: the route, one line
 * per item (quantity × estimated rate = value) and the estimated total. One memo.
 */
export function TransferRequestPreviewDialog({
  open,
  onOpenChange,
  fromLabel,
  toLabel,
  items,
  onConfirm,
  isSubmitting,
}: TransferRequestPreviewDialogProps) {
  const total = items.reduce((sum, it) => sum + it.qty * (it.estimated_rate || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        disableCloseIcon={false}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">Review Transfer</DialogTitle>
          <DialogDescription>
            One transfer memo will be created in <span className="font-semibold">Approved</span>{" "}
            status, ready to dispatch.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <RouteBox side="From" name={fromLabel} />
          <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
          <RouteBox side="To" name={toLabel} />
        </div>

        <div className="flex-1 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Est. Rate</th>
                <th className="px-3 py-2 text-right">Est. Value</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium leading-tight">{it.item_name}</div>
                    {it.make && <div className="text-xs text-muted-foreground">{it.make}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {it.qty.toLocaleString("en-IN")} <span className="text-xs text-muted-foreground">{it.unit || "Units"}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatToIndianRupee(it.estimated_rate)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {formatToIndianRupee(it.qty * (it.estimated_rate || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40">
              <tr>
                <td className="px-3 py-2.5 font-medium" colSpan={3}>
                  {items.length} item{items.length === 1 ? "" : "s"} · Estimated total
                </td>
                <td className="px-3 py-2.5 text-right text-base font-bold tabular-nums text-primary">
                  {formatToIndianRupee(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <DialogFooter className="sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button onClick={onConfirm} disabled={isSubmitting || items.length === 0} className="gap-2">
            {isSubmitting ? "Creating..." : "Create Transfer Memo"}
            {!isSubmitting && <ArrowRight className="h-4 w-4" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
