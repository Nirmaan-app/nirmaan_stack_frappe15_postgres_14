import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import formatToIndianRupee from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { usePOAdjustment } from "./data/usePOAdjustmentQueries";

interface POAdjustmentHistoryProps {
  poId: string;
}

const ENTRY_TYPE_COLORS: Record<string, string> = {
  "Revision Impact": "bg-orange-100 text-orange-800",
  "Auto Absorb": "bg-blue-100 text-blue-800",
  "Term Addition": "bg-green-100 text-green-800",
  "Term Rebalance": "bg-purple-100 text-purple-800",
  "Against PO": "bg-indigo-100 text-indigo-800",
  Adhoc: "bg-yellow-100 text-yellow-800",
  "Vendor Refund": "bg-red-100 text-red-800",
};

export function POAdjustmentHistory({ poId }: POAdjustmentHistoryProps) {
  const { adjustment, isLoading } = usePOAdjustment(poId);

  if (isLoading || !adjustment || adjustment.adjustment_items.length === 0) {
    return null;
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="adjustment-history">
        <AccordionTrigger className="text-sm font-medium">
          <div className="flex items-center gap-2">
            Payment Adjustments
            <Badge
              variant={
                adjustment.status === "Pending" ? "destructive" : "secondary"
              }
            >
              {adjustment.status}
            </Badge>
            {adjustment.remaining_impact !== 0 && (
              <span className="text-xs text-muted-foreground">
                ({formatToIndianRupee(Math.abs(adjustment.remaining_impact))}{" "}
                remaining)
              </span>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-2">
            {adjustment.adjustment_items.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between rounded-md border p-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        ENTRY_TYPE_COLORS[item.entry_type] ?? "bg-gray-100"
                      }
                    >
                      {item.entry_type}
                    </Badge>
                    {item.revision_id && (
                      <span className="text-xs text-muted-foreground">
                        {item.revision_id}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                  {item.target_po && (
                    <p className="text-xs">Target: {item.target_po}</p>
                  )}
                  {item.timestamp && (
                    <p className="text-xs text-muted-foreground">
                      {formatDate(item.timestamp)}
                    </p>
                  )}
                </div>
                <span
                  className={`text-sm font-medium ${item.amount < 0 ? "text-red-600" : "text-green-600"}`}
                >
                  {item.amount < 0 ? "-" : "+"}
                  {formatToIndianRupee(Math.abs(item.amount))}
                </span>
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
