// components/MaterialTableRow.tsx (Full, Refactored File)

import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { TableRow, TableCell } from "@/components/ui/table";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Info, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { MaterialUsageDisplayItem, POStatus, MaterialSortKey } from './ProjectMaterialUsageTab';
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
  const {
    deliveryStatusVariant,
    deliveryStatusText
  } = determineDeliveryStatus(item.deliveredQuantity, item.orderedQuantity);

  // Checks if the ordered quantity is higher or lower than the estimate, for tooltip display.
  const overOrdered = item.orderedQuantity > (item.estimatedQuantity ?? Infinity);
  const underOrdered = item.orderedQuantity < (item.estimatedQuantity ?? 0) && item.orderedQuantity > 0;

  // Determines the overall payment status based on all associated purchase orders.
  const overallPOPaymentStatus = determineOverallItemPOStatus(item.poNumbers);

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
      
      {/* Column: Estimated Quantity (Always Visible) */}
      <TableCell className="text-right font-mono py-2 px-3">
        {item.estimatedQuantity !== undefined ? item.estimatedQuantity.toFixed(2) : "N/A"}
      </TableCell>

      {/* Column: Ordered Quantity (Conditionally Hidden) */}
      {!hiddenColumns.has('orderedQuantity') && (
        <TableCell className={`text-right font-mono py-2 px-3 ${overOrdered ? 'text-orange-600 font-semibold' : underOrdered ? 'text-blue-600' : ''}`}>
          {item.orderedQuantity.toFixed(2)}
          
          {/* Tooltip to show if quantity is over or under the estimate */}
          {(overOrdered || underOrdered) && (
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className={`h-3 w-3 ml-1 inline ${overOrdered ? 'text-orange-500' : 'text-blue-500'}`} />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{overOrdered ? 'Over ordered' : 'Under ordered'} vs estimate ({item.estimatedQuantity?.toFixed(2)})</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </TableCell>
      )}

      {/* Column: Delivery Note Quantity (Conditionally Hidden) */}
      {!hiddenColumns.has('deliveredQuantity') && (
        <TableCell className="text-right font-mono py-2 px-3">
          {item.deliveredQuantity.toFixed(2)}
        </TableCell>
      )}

      {/* Column: Remaining Quantity (Conditionally Hidden) */}
      {!hiddenColumns.has('remainingQuantity') && (
        <TableCell className="text-right font-mono py-2 px-3">
          {!item.isHighValueItem ? (
            // State 1: Ineligible — faded, centered dash
            <span className="text-muted-foreground/30 select-none block text-center">—</span>
          ) : item.remainingQuantity === null || item.remainingQuantity === undefined || item.remainingQuantity === -1 ? (
            // State 2: Eligible but not filled — amber "Pending" indicator
            <span className="inline-flex items-center justify-end gap-1 text-amber-600/80 dark:text-amber-400/80">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500/70 shrink-0" />
              <span className="text-xs font-medium font-sans">Pending</span>
            </span>
          ) : item.remainingQuantity === 0 ? (
            // State 3b: Zero remaining — red "consumed"
            <span className="text-red-600 dark:text-red-400 font-medium">
              0<span className="text-[10px] font-sans ml-1 font-normal">consumed</span>
            </span>
          ) : (
            // State 3a: Normal positive value
            <span className="tabular-nums">{item.remainingQuantity.toFixed(2)}</span>
          )}
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
      
      {/* Column: PO Numbers (with Tooltip for multiple) */}
      <TableCell className="text-center py-2 px-3">
        {renderPONumbers(item.poNumbers)}
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
 * Renders the PO numbers for an item.
 * - If 0 POs, shows a dash.
 * - If 1 PO, shows a direct link to the PO.
 * - If multiple POs, shows an aggregate count with a tooltip listing each PO, its amount, and status.
 */
function renderPONumbers(poNumbers?: { po: string, status: POStatus, amount: number }[]) {
  // Case 1: No POs exist.
  if (!poNumbers || poNumbers.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  // Case 2: Exactly one PO exists. Render a direct link.
  if (poNumbers.length === 1) {
    // `replaceAll` makes the PO number URL-safe.
    return (
      <Link to={`po/${poNumbers[0].po.replaceAll("/", "&=")}`} relative="path" className="text-blue-600 hover:underline text-xs font-mono">
        {poNumbers[0].po}
      </Link>
    );
  }

  // Case 3: Multiple POs exist. Render a summary button with a detailed tooltip.
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto p-1 text-xs text-blue-600 hover:bg-blue-50">
            <FileText className="h-3.5 w-3.5 mr-1" />
            {poNumbers.length} POs
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs md:max-w-sm bg-popover border shadow-lg rounded-md p-0">
          <ul className="list-none p-2 space-y-1">
            {poNumbers.map(poEntry => (
              <li key={poEntry.po} className="text-xs flex justify-between items-center gap-4">
                <div className='flex flex-col items-start'>
                  <Link to={`po/${poEntry.po.replaceAll("/", "&=")}`} relative="path" className="text-blue-600 hover:underline">
                    {poEntry.po}
                  </Link>
                  <span className='font-mono text-muted-foreground'>{formatToIndianRupee(poEntry.amount)}</span>
                </div>
                <Badge 
                  variant={
                    poEntry.status === "Fully Paid" ? "default" : 
                    poEntry.status === "Partially Paid" ? "outline" : 
                    "destructive"
                  }
                  className={`ml-2 text-xs shrink-0 ${
                    poEntry.status === "Fully Paid" ? 'bg-green-100 text-green-700' :
                    poEntry.status === "Partially Paid" ? 'bg-yellow-100 text-yellow-700' : ''
                  }`}
                >
                  {poEntry.status}
                </Badge>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}