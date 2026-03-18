import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ArrowLeftRight } from "lucide-react";
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          onClick={onClick}
          className={`h-8 px-2.5 shrink-0 gap-1.5 ${
            isNegative
              ? "border-destructive text-destructive hover:bg-destructive/10"
              : "border-orange-500 text-orange-600 hover:bg-orange-50"
          }`}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          <span className="hidden sm:inline text-xs">Adjust Payments</span>
          <Badge
            variant="outline"
            className={`ml-0.5 text-[10px] px-1.5 py-0 h-5 font-medium ${
              isNegative
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-orange-300 bg-orange-50 text-orange-700"
            }`}
          >
            {formatToIndianRupee(Math.abs(adjustment.remaining_impact))}
          </Badge>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="sm:hidden">Adjust Payments</TooltipContent>
    </Tooltip>
  );
}
