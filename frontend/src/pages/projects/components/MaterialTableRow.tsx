// components/MaterialTableRow.tsx (Full, Refactored File)

import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { TableRow, TableCell } from "@/components/ui/table";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { ItemITMEntry, MaterialUsageDisplayItem, POStatus, MaterialSortKey } from './ProjectMaterialUsageTab';
import { determineDeliveryStatus, determineOverallItemPOStatus } from '../config/materialUsageHelpers';
import formatToIndianRupee from "@/utils/FormatPrice";
import { DeliveryDocumentCountCell } from './DeliveryDocumentCountCell';


// =================================================================================
// 1. MAIN COMPONENT: MaterialTableRow
// =================================================================================
/**
 * Renders a single row in the material usage table.
 * This component is responsible for displaying all data for one material item
 * and applying conditional rendering for columns that can be hidden.
 * @param {MaterialUsageDisplayItem} item - The data object for the material item.
 * @param {Set<MaterialSortKey>} hiddenColumns - A set of keys for columns that should be hidden.
 */

interface MaterialTableRowProps {
  item: MaterialUsageDisplayItem;
  hiddenColumns: Set<MaterialSortKey>;
}

export const MaterialTableRow: React.FC<MaterialTableRowProps> = ({ item, hiddenColumns }) => {
  
  // --- Derived State Calculation ---
  // These values are calculated from the `item` prop to determine how to render certain elements.
  
  // Determines the text and color variant for the delivery status badge.
  // Ordered and delivered both include incoming ITMs, so ITM-only rows get a real status too.
  const {
    deliveryStatusVariant,
    deliveryStatusText
  } = determineDeliveryStatus(item.deliveredQuantity, item.orderedQuantity);

  // Determines the overall payment status from all POs and incoming ITMs (an ITM is paid once Delivered).
  const overallPOPaymentStatus = determineOverallItemPOStatus([...(item.poNumbers || []), ...(item.itmNumbers || [])]);

  // Selects the correct badge color based on the overall payment status.
  let poStatusBadgeVariant: "success" | "warning" | "destructive" | "default" = "default";
  if (overallPOPaymentStatus === "Fully Paid") poStatusBadgeVariant = "success";
  else if (overallPOPaymentStatus === "Partially Paid") poStatusBadgeVariant = "warning";
  else if (overallPOPaymentStatus === "Unpaid") poStatusBadgeVariant = "destructive";

  // --- Render Logic ---
  return (
    <TableRow>
      {/* Column: Item Name (Sticky) */}
      <TableCell className="font-medium py-2 px-3 sticky left-0 bg-background z-10">
        {item.itemName || "N/A"}
        {item.isTransferredInItem && (
          <span className="ml-1.5 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">
            ↓ Transferred In
          </span>
        )}
      </TableCell>
      
      {/* Column: Category */}
      <TableCell className="py-2 px-3 text-muted-foreground">
        {item.categoryName}
      </TableCell>
         {/* Column: Unit */}
      <TableCell className="text-center py-2 px-3">
        {item.billingCategory || "N/A"}
      </TableCell>
      {/* Column: Unit */}
      <TableCell className="text-center py-2 px-3">
        {item.unit || "N/A"}
      </TableCell>
      
      {/* Column: Ordered Quantity (Conditionally Hidden) */}
      {!hiddenColumns.has('orderedQuantity') && (
        <TableCell className="text-right font-mono py-2 px-3">
          {(item.itmOrderedQty ?? 0) > 0 ? (
            <QtyBreakdown
              total={item.orderedQuantity}
              poLabel="PO Ordered Quantity"
              poQty={item.poOrderedQty ?? 0}
              itmQty={item.itmOrderedQty ?? 0}
            />
          ) : (
            item.orderedQuantity.toFixed(2)
          )}
        </TableCell>
      )}

      {/* Column: Delivery Note Quantity (Conditionally Hidden) */}
      {!hiddenColumns.has('deliveredQuantity') && (
        <TableCell className="text-right font-mono py-2 px-3">
          {(item.itmDeliveredQty ?? 0) > 0 ? (
            <QtyBreakdown
              total={item.deliveredQuantity}
              poLabel="PO Delivered Quantity"
              poQty={item.poDeliveredQty ?? item.deliveredQuantity}
              itmQty={item.itmDeliveredQty ?? 0}
            />
          ) : (
            item.deliveredQuantity.toFixed(2)
          )}
        </TableCell>
      )}

      {/* Column: Remaining Quantity (Conditionally Hidden) */}
      {!hiddenColumns.has('remainingQuantity') && (
        <TableCell className="text-right font-mono py-2 px-3">
          {!item.isHighValueItem ? (
            // State 1: Ineligible — N/A
            <span className="text-muted-foreground/50 select-none block text-center text-xs font-sans">N/A</span>
          ) : item.remainingQuantity === null || item.remainingQuantity === undefined || item.remainingQuantity === -1 ? (
            // State 2: Eligible but not filled — amber "Pending" indicator
            <span className="inline-flex items-center justify-end gap-1 text-amber-600/80 dark:text-amber-400/80">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500/70 shrink-0" />
              <span className="text-xs font-medium font-sans">Pending</span>
            </span>
          ) : item.remainingQuantity === 0 ? (
            // State 3b: Zero remaining
            <span className="tabular-nums">0</span>
          ) : (
            // State 3a: Normal positive value
            <span className="tabular-nums">{item.remainingQuantity.toFixed(2)}</span>
          )}
        </TableCell>
      )}

      {/* Column: Transferred Out (Conditionally Hidden) */}
      {!hiddenColumns.has('transferredOut') && (
        <TableCell className="text-right font-mono py-2 px-3">
          {(item.transferredOut || 0).toFixed(2)}
        </TableCell>
      )}

      {/* Column: DC Quantity (Conditionally Hidden) */}
      {!hiddenColumns.has('dcQuantity') && (
        <TableCell className="text-right font-mono py-2 px-3">
          {item.dcQuantity.toFixed(2)}
        </TableCell>
      )}

      {/* Column: MIR Quantity (Conditionally Hidden) */}
      {!hiddenColumns.has('mirQuantity') && (
        <TableCell className="text-right font-mono py-2 px-3">
          {item.mirQuantity.toFixed(2)}
        </TableCell>
      )}

      {/* Column: PO Amount (Conditionally Hidden) */}
      {!hiddenColumns.has('totalAmount') && (
        <TableCell className="text-center py-2 px-3">
          {renderPOAmount(item.poNumbers)}
        </TableCell>
      )}

      {/* Column: Delivery Status Badge */}
      <TableCell className="text-center py-2 px-3">
        <Badge
          variant={
            deliveryStatusVariant === "success" ? "default" :
            deliveryStatusVariant === "destructive" ? "destructive" :
            deliveryStatusVariant === "warning" ? "outline" : "secondary"
          }
          className={
            deliveryStatusVariant === "success" ? 'bg-green-100 text-green-700 border-green-300' :
            deliveryStatusVariant === "warning" ? 'bg-yellow-100 text-yellow-700 border-yellow-300' : ""
          }
        >
          {deliveryStatusText}
        </Badge>
      </TableCell>
      
      {/* Column: PO / ITM Numbers (with Tooltip for multiple) */}
      <TableCell className="text-center py-2 px-3">
        {renderPONumbers(item.poNumbers, item.itmNumbers)}
      </TableCell>

      {/* Column: Delivery Challans */}
      <TableCell className="text-center py-2 px-3">
        <DeliveryDocumentCountCell type="dc" documents={item.deliveryChallans || []} count={item.dcCount || 0} />
      </TableCell>

      {/* Column: MIRs */}
      <TableCell className="text-center py-2 px-3">
        <DeliveryDocumentCountCell type="mir" documents={item.mirs || []} count={item.mirCount || 0} />
      </TableCell>

      {/* Column: Overall PO Status Badge */}
      <TableCell className="text-center py-2 px-3">
        <Badge
          variant={
            poStatusBadgeVariant === "success" ? "default" :
            poStatusBadgeVariant === "destructive" ? "destructive" :
            poStatusBadgeVariant === "warning" ? "outline" : "secondary"
          }
          className={
            poStatusBadgeVariant === "success" ? 'bg-green-100 text-green-700 border-green-300' :
            poStatusBadgeVariant === "warning" ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
            overallPOPaymentStatus === "N/A" ? 'opacity-70' : ""
          }
        >
          {overallPOPaymentStatus}
        </Badge>
      </TableCell>
    </TableRow>
  );
};


// =================================================================================
// 2. HELPER FUNCTIONS
// =================================================================================

interface QtyBreakdownProps {
  total: number;
  poLabel: string;
  poQty: number;
  itmQty: number;
}

/** A quantity whose hover splits it into its PO part and its Internal Transfer Memo part. */
const QtyBreakdown: React.FC<QtyBreakdownProps> = ({ total, poLabel, poQty, itmQty }) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default text-blue-600 underline decoration-dotted underline-offset-2">{total.toFixed(2)}</span>
      </TooltipTrigger>
      <TooltipContent className="bg-gray-900 text-white border-gray-700 shadow-lg rounded-md p-2.5">
        <div className="text-xs space-y-1.5">
          <div className="flex justify-between gap-6">
            <span className="text-gray-300">{poLabel}</span>
            <span className="font-semibold tabular-nums text-white">{poQty.toFixed(2)}</span>
          </div>
          <hr className="border-gray-700" />
          <div className="flex justify-between gap-6">
            <span className="text-gray-300">Internal Transfer Memo Qty</span>
            <span className="font-semibold tabular-nums text-white">{itmQty.toFixed(2)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

/** Paid-status badge shared by PO and ITM entries in the PO / ITM Number(s) popover. */
const PaidStatusBadge: React.FC<{ status: POStatus }> = ({ status }) => (
  <Badge
    variant={
      status === "Fully Paid" ? "default" :
      status === "Partially Paid" ? "outline" :
      "destructive"
    }
    className={`ml-2 text-xs shrink-0 ${
      status === "Fully Paid" ? 'bg-green-100 text-green-700' :
      status === "Partially Paid" ? 'bg-yellow-100 text-yellow-700' : ''
    }`}
  >
    {status}
  </Badge>
);

/** Label for the multi-document trigger: "2 POs", "1 ITM", "2 POs · 1 ITM". */
function poItmCountLabel(poCount: number, itmCount: number): string {
  const parts: string[] = [];
  if (poCount > 0) parts.push(`${poCount} PO${poCount > 1 ? 's' : ''}`);
  if (itmCount > 0) parts.push(`${itmCount} ITM${itmCount > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/**
 * Renders the total PO amount for an item.
 * - If 0 POs, shows a dash.
 * - If 1 PO, shows the amount directly with a tooltip for calculation details.
 * - If multiple POs, shows the summed amount with a tooltip listing individual amounts.
 */
function renderPOAmount(poNumbers?: { po: string, status: POStatus, amount: number; poCalculatedAmount: string }[]) {
  // Case 1: No POs exist.
  if (!poNumbers || poNumbers.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  // Case 2: Exactly one PO exists.
  if (poNumbers.length === 1) {
    const po = poNumbers[0];
    return (
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-auto p-1 text-xs text-grey-600 hover:bg-grey-50">{formatToIndianRupee(po.amount)}</Button></TooltipTrigger>
          <TooltipContent className="max-w-xs md:max-w-sm bg-popover border shadow-lg rounded-md p-0">
            <ul className="list-none p-2 space-y-1">
              <li className="text-xs flex justify-between items-center gap-4">
                <div className='flex flex-col items-start'>
                  <div className="text-blue-600 hover:underline">{formatToIndianRupee(po.amount)}</div>
                  <small className='font-mono text-[0.65rem] leading-tight text-muted-foreground'>{po.poCalculatedAmount}</small>
                </div>
              </li>
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Case 3: Multiple POs exist. Sum the amounts for the trigger button.
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto p-1 text-xs text-blue-600 hover:bg-blue-50">
            {formatToIndianRupee(poNumbers.map(po => po.amount).reduce((sum, current) => sum + current, 0))}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs md:max-w-sm bg-popover border shadow-lg rounded-md p-0">
          <ul className="list-none p-2 space-y-1">
            {poNumbers.map((poEntry, index) => (
              <li key={index} className="text-xs flex justify-between items-center gap-4">
                <div className='flex flex-col items-start'>
                  <div className="text-blue-600 hover:underline">{formatToIndianRupee(poEntry.amount)}</div>
                  <small className='font-mono text-[0.65rem] leading-tight text-muted-foreground'>{poEntry.poCalculatedAmount}</small>
                </div>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Renders the PO and ITM numbers for an item.
 * - If none, shows a dash.
 * - If exactly one PO or one ITM, shows a direct link to it.
 * - Otherwise, shows a count ("2 POs · 1 ITM") with a tooltip listing each PO (amount + paid status)
 *   and each ITM (source project + paid status: Fully Paid once Delivered, Unpaid before).
 */
function renderPONumbers(poNumbers?: { po: string, status: POStatus, amount: number }[], itmNumbers?: ItemITMEntry[]) {
  const pos = poNumbers || [];
  const itms = itmNumbers || [];

  // Case 1: No POs or ITMs exist.
  if (pos.length === 0 && itms.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  // Case 2: Exactly one document. Render a direct link.
  if (pos.length + itms.length === 1) {
    if (pos.length === 1) {
      // `replaceAll` makes the PO number URL-safe.
      return (
        <Link to={`po/${pos[0].po.replaceAll("/", "&=")}`} relative="path" className="text-blue-600 hover:underline text-xs font-mono">
          {pos[0].po}
        </Link>
      );
    }
    return (
      <Link to={`/internal-transfer-memos/${itms[0].itm}`} className="text-blue-600 hover:underline text-xs font-mono">
        {itms[0].itm}
      </Link>
    );
  }

  // Case 3: Multiple documents. Render a summary button with a detailed tooltip.
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto p-1 text-xs text-blue-600 hover:bg-blue-50">
            <FileText className="h-3.5 w-3.5 mr-1" />
            {poItmCountLabel(pos.length, itms.length)}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs md:max-w-sm bg-popover border shadow-lg rounded-md p-0">
          <ul className="list-none p-2 space-y-1">
            {pos.map(poEntry => (
              <li key={poEntry.po} className="text-xs flex justify-between items-center gap-4">
                <div className='flex flex-col items-start'>
                  <Link to={`po/${poEntry.po.replaceAll("/", "&=")}`} relative="path" className="text-blue-600 hover:underline">
                    {poEntry.po}
                  </Link>
                  <span className='font-mono text-muted-foreground'>{formatToIndianRupee(poEntry.amount)}</span>
                </div>
                <PaidStatusBadge status={poEntry.status} />
              </li>
            ))}
            {itms.map(itmEntry => (
              <li key={itmEntry.itm} className="text-xs flex justify-between items-center gap-4">
                <div className='flex flex-col items-start'>
                  <div className="flex items-center gap-1.5">
                    <Link to={`/internal-transfer-memos/${itmEntry.itm}`} className="text-blue-600 hover:underline">
                      {itmEntry.itm}
                    </Link>
                    <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">ITM</span>
                  </div>
                  <span className='text-muted-foreground'>
                    {itmEntry.sourceName ? `From ${itmEntry.sourceName} · ` : ''}{itmEntry.itmStatus}
                  </span>
                </div>
                <PaidStatusBadge status={itmEntry.status} />
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
