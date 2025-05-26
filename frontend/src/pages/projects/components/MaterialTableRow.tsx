import * as React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { TableRow, TableCell } from "@/components/ui/table";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Info, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MaterialUsageDisplayItem } from './ProjectMaterialUsageTab';
import { determineDeliveryStatus, determineOverallItemPOStatus } from '../config/materialUsageHelpers';

interface MaterialTableRowProps {
  item: MaterialUsageDisplayItem;
}

export const MaterialTableRow: React.FC<MaterialTableRowProps> = ({ item }) => {
  // Determine delivery status
  const { 
    deliveryStatusVariant,
    deliveryStatusText 
  } = determineDeliveryStatus(item.deliveredQuantity, item.orderedQuantity);

  // Determine ordering status (over/under ordered)
  const overOrdered = item.orderedQuantity > (item.estimatedQuantity ?? Infinity);
  const underOrdered = item.orderedQuantity < (item.estimatedQuantity ?? 0) && item.orderedQuantity > 0;

  // Determine PO payment status
  const overallPOPaymentStatus = determineOverallItemPOStatus(item.poNumbers);
  let poStatusBadgeVariant: "success" | "warning" | "destructive" | "default" = "default";
  
  if (overallPOPaymentStatus === "Fully Paid") poStatusBadgeVariant = "success";
  else if (overallPOPaymentStatus === "Partially Paid") poStatusBadgeVariant = "warning";
  else if (overallPOPaymentStatus === "Unpaid") poStatusBadgeVariant = "destructive";

  return (
    <TableRow>
      <TableCell className="font-medium py-2 px-3 sticky left-0 bg-background z-10">
        {item.itemName || "N/A"}
      </TableCell>
      <TableCell className="py-2 px-3 text-muted-foreground">{item.categoryName}</TableCell>
      <TableCell className="text-center py-2 px-3">{item.unit || "N/A"}</TableCell>
      <TableCell className="text-right font-mono py-2 px-3">
        {item.estimatedQuantity !== undefined ? item.estimatedQuantity.toFixed(2) : "N/A"}
      </TableCell>
      <TableCell className={`text-right font-mono py-2 px-3 ${overOrdered ? 'text-orange-600 font-semibold' : underOrdered ? 'text-blue-600' : ''}`}>
        {item.orderedQuantity.toFixed(2)}
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
      <TableCell className="text-right font-mono py-2 px-3">{item.deliveredQuantity.toFixed(2)}</TableCell>
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
      <TableCell className="text-center py-2 px-3">
        {renderPONumbers(item.poNumbers)}
      </TableCell>
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

// Helper function for rendering PO numbers
function renderPONumbers(poNumbers?: { po: string, status: string }[]) {
  if (!poNumbers || poNumbers.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  if (poNumbers.length === 1) {
    return (
      <Link to={`po/${poNumbers[0].po.replaceAll("/", "&=")}`} relative="path" className="text-blue-600 hover:underline text-xs font-mono">
        {poNumbers[0].po}
      </Link>
    );
  }

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
              <li key={poEntry.po} className="text-xs flex justify-between items-center">
                <Link to={`po/${poEntry.po.replaceAll("/", "&=")}`} relative="path" className="text-blue-600 hover:underline">
                  {poEntry.po}
                </Link>
                <Badge variant={
                  poEntry.status === "Fully Paid" ? "default" :
                  poEntry.status === "Partially Paid" ? "outline" :
                  "destructive"
                }
                className={`ml-2 text-xs ${
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