import React, { useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import formatToIndianRupee from "@/utils/FormatPrice";
import { Loader2, Package, Calendar, Building2 } from "lucide-react";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { formatDate } from "@/utils/FormatDate";

interface POItemsHoverCardProps {
  poName: string;
  children: React.ReactNode;
}

/**
 * Hover card component to display PO items and details when hovering over a PO badge
 */
export const POItemsHoverCard: React.FC<POItemsHoverCardProps> = ({
  poName,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Fetch PO details when hover card opens
  const {
    data: poData,
    isLoading,
    error,
  } = useFrappeGetDoc<ProcurementOrder>(
    "Procurement Orders",
    poName,
    isOpen ? `PO-hover-${poName}` : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  // Extract PO ID (2nd part after /)
  const extractPOId = (fullName: string) => {
    const parts = fullName.split("/");
    return parts.length > 1 ? parts[1] : fullName;
  };

  // Get items from PO - could be in 'items' or 'procurement_list'
  const items = poData?.items || [];

  return (
    <HoverCard openDelay={300} closeDelay={100} open={isOpen} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        className="w-[420px] p-0"
        side="top"
        align="start"
        sideOffset={5}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-slate-50 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-600" />
              <span className="font-semibold text-sm text-slate-800">
                PO: {extractPOId(poName)}
              </span>
            </div>
            {poData?.status && (
              <Badge
                variant="outline"
                className={`text-xs ${
                  poData.status === "Dispatched"
                    ? "border-orange-300 text-orange-600 bg-orange-50"
                    : poData.status === "Partially Delivered" || poData.status === "Delivered"
                    ? "border-green-300 text-green-600 bg-green-50"
                    : "border-slate-300 text-slate-600"
                }`}
              >
                {poData.status}
              </Badge>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-3">
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
              <span className="ml-2 text-sm text-slate-500">Loading...</span>
            </div>
          )}

          {error && (
            <div className="text-red-500 py-4 text-center text-sm">
              Error loading PO details
            </div>
          )}

          {!isLoading && !error && poData && (
            <>
              {/* PO Info */}
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Building2 className="w-3.5 h-3.5" />
                  <span className="truncate">{poData.vendor_name}</span>
                </div>
                {poData.dispatch_date && (
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDate(poData.dispatch_date)}</span>
                  </div>
                )}
              </div>

              <Separator className="mb-3" />

              {/* Items Table */}
              {items.length > 0 ? (
                <div className="max-h-[200px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs py-2 h-8">Item</TableHead>
                        <TableHead className="text-xs py-2 h-8 w-[50px] text-center">Qty</TableHead>
                        <TableHead className="text-xs py-2 h-8 w-[80px] text-right">Rate</TableHead>
                        <TableHead className="text-xs py-2 h-8 w-[90px] text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.slice(0, 5).map((item: any, index: number) => (
                        <TableRow key={item.name || index} className="hover:bg-slate-50">
                          <TableCell className="text-xs py-1.5 font-medium">
                            <div className="truncate max-w-[150px]" title={item.item_name}>
                              {item.item_name}
                            </div>
                            {item.make && (
                              <span className="text-[10px] text-slate-400">
                                Make: {item.make}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs py-1.5 text-center">
                            {item.quantity} {item.unit}
                          </TableCell>
                          <TableCell className="text-xs py-1.5 text-right">
                            {formatToIndianRupee(item.quote)}
                          </TableCell>
                          <TableCell className="text-xs py-1.5 text-right font-medium">
                            {formatToIndianRupee(item.quantity * item.quote)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {items.length > 5 && (
                    <p className="text-xs text-slate-400 text-center py-2">
                      +{items.length - 5} more items...
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-sm text-slate-500 text-center py-4">
                  No items found
                </div>
              )}

              {/* Total */}
              {poData.total_amount && (
                <>
                  <Separator className="my-2" />
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs font-medium text-slate-600">Total Amount</span>
                    <span className="text-sm font-bold text-slate-800">
                      {formatToIndianRupee(poData.total_amount)}
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
