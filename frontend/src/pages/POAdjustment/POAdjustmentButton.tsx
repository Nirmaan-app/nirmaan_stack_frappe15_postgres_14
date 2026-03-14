import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePOAdjustment } from "./data/usePOAdjustmentQueries";
import formatToIndianRupee from "@/utils/FormatPrice";

interface POAdjustmentButtonProps {
  poId: string;
  onClick: () => void;
}

/**
 * Renders an "Adjust Payments" button on the PO overview
 * when a Pending adjustment exists with remaining_impact != 0.
 */
export function POAdjustmentButton({ poId, onClick }: POAdjustmentButtonProps) {
  const { adjustment, isLoading } = usePOAdjustment(poId);

  if (isLoading || !adjustment) return null;
  if (adjustment.status !== "Pending" || adjustment.remaining_impact === 0)
    return null;

  const isNegative = adjustment.remaining_impact < 0;

  return (
    <Button
      variant={isNegative ? "destructive" : "default"}
      size="sm"
      onClick={onClick}
      className="gap-2"
    >
      Adjust Payments
      <Badge variant="outline" className="ml-1 bg-white/20 text-inherit">
        {formatToIndianRupee(Math.abs(adjustment.remaining_impact))}
      </Badge>
    </Button>
  );
}
