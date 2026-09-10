import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import React, { useMemo } from "react";

export const AmountPaidHoverCard: React.FC<{ paymentInfo: ProjectPayments }> = React.memo(({
  paymentInfo,
}) => {
  const amountPaid = useMemo(() => parseNumber(paymentInfo.amount) - parseNumber(paymentInfo.tds), [paymentInfo]);
  const tdsAmount = useMemo(() => parseNumber(paymentInfo.tds), [paymentInfo]);
  const TotalAmount = useMemo(() => parseNumber(paymentInfo.amount), [paymentInfo]);

  // A Service Request payment has nothing to distribute. Its tax is held in `Payment TDS
  // Deduction`, not in the legacy `tds` column, and its `amount` is ALREADY the net figure — so
  // this card would label the net as "Total Amount" and then subtract a TDS of zero from it.
  if ((paymentInfo.document_type || "").trim() === "Service Requests") {
    return (
      <p className="text-xs text-gray-600 font-semibold">
        {formatToRoundedIndianRupee(TotalAmount)}
      </p>
    );
  }

  return (
      <HoverCard>
        <HoverCardTrigger>
          <p className="text-xs text-gray-600 font-semibold underline">
            {formatToRoundedIndianRupee(amountPaid)}
          </p>
        </HoverCardTrigger>
        <HoverCardContent className="w-80">
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Amount Distribution</h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-gray-600">Total Amount:</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-right">
                  {formatToRoundedIndianRupee(TotalAmount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600">TDS Deducted:</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-right text-red-600">
                  - {formatToRoundedIndianRupee(tdsAmount)}
                </p>
              </div>
              <div className="border-t border-gray-200 col-span-2"></div>
              <div>
                <p className="text-xs font-semibold">Amount Paid:</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-right text-green-600">
                  {formatToRoundedIndianRupee(amountPaid)}
                </p>
              </div>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
  );
});