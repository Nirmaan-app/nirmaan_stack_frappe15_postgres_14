import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import React from "react";

export const AmountPaidHoverCard: React.FC<{ paymentInfo: ProjectPayments }> = React.memo(({
  paymentInfo,
}) => {
  const amountPaid = parseNumber(paymentInfo.amount) - parseNumber(paymentInfo.tds);
  const tdsAmount = parseNumber(paymentInfo.tds);
  const TotalAmount = parseNumber(paymentInfo.amount);

  return (
      <HoverCard>
        <HoverCardTrigger>
          <p className="text-xs text-gray-600 font-semibold underline">
            {formatToIndianRupee(amountPaid)}
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
                  {formatToIndianRupee(TotalAmount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600">TDS Deducted:</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-right text-red-600">
                  - {formatToIndianRupee(tdsAmount)}
                </p>
              </div>
              <div className="border-t border-gray-200 col-span-2"></div>
              <div>
                <p className="text-xs font-semibold">Amount Paid:</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-right text-green-600">
                  {formatToIndianRupee(amountPaid)}
                </p>
              </div>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
  );
});