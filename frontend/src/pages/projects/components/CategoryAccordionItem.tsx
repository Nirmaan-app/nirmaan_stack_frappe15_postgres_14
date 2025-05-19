import React from 'react';
import {
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MaterialUsageDisplayItem } from './ProjectMaterialUsageTab';
import { Button } from '@/components/ui/button';

interface CategoryAccordionItemProps {
    categoryName: string;
    items: MaterialUsageDisplayItem[];
    projectId: string; // Example if needed for links
}

export const CategoryAccordionItem: React.FC<CategoryAccordionItemProps> = ({ categoryName, items, projectId }) => {
    if (items.length === 0) {
        return null; // Don't render an accordion for an empty category
    }

    return (
        <AccordionItem value={categoryName} className="border bg-card shadow-sm rounded-lg">
            <AccordionTrigger className="px-6 py-4 font-medium hover:no-underline">
                {categoryName}
                <Badge variant="secondary" className="ml-3">{items.length} item(s)</Badge>
            </AccordionTrigger>
            <AccordionContent className="px-2 pb-4 pt-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[150px]">Item ID</TableHead>
                                <TableHead>Item Name</TableHead>
                                <TableHead className="text-center">Unit</TableHead>
                                <TableHead className="text-right">Est. Qty</TableHead>
                                <TableHead className="text-right">Ordered Qty</TableHead>
                                <TableHead className="text-right">Delivered Qty</TableHead>
                                <TableHead className="text-center w-[100px]">Status</TableHead>
                                <TableHead className="text-center w-[120px]">PO Number(s)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((item, idx) => {
                                const deliveryPercentage = item.orderedQuantity > 0
                                    ? (item.deliveredQuantity / item.orderedQuantity) * 100
                                    : item.deliveredQuantity > 0 ? 100 : 0; // If ordered is 0 but delivered > 0, consider it 100% for that delivery

                                const statusVariant: "green" | "warning" | "destructive" | "default" =
                                    item.deliveredQuantity >= item.orderedQuantity && item.orderedQuantity > 0 ? "green"
                                    : deliveryPercentage > 0 ? "warning"
                                    : item.orderedQuantity > 0 ? "destructive"
                                    : "default";
                                
                                const statusText =
                                    statusVariant === "green" ? "Fully Delivered"
                                    : statusVariant === "warning" ? "Partially Delivered"
                                    : statusVariant === "destructive" ? "Pending Delivery"
                                    : "Not Ordered";

                                const overOrdered = item.orderedQuantity > (item.estimatedQuantity ?? Infinity);
                                const underOrdered = item.orderedQuantity < (item.estimatedQuantity ?? 0) && item.orderedQuantity > 0;


                                return (
                                    <TableRow key={item.itemId || `item-${idx}`}>
                                        <TableCell className="font-mono text-xs">
                                            {item.itemId ? (
                                                 <Link to={`/products/${item.itemId}`} className="text-blue-600 hover:underline">
                                                    {item.itemId}
                                                </Link>
                                            ) : "N/A"}
                                        </TableCell>
                                        <TableCell className="font-medium">{item.itemName || "N/A"}</TableCell>
                                        <TableCell className="text-center">{item.unit || "N/A"}</TableCell>
                                        <TableCell className="text-right font-mono">
                                            {item.estimatedQuantity !== undefined ? item.estimatedQuantity.toFixed(2) : "N/A"}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono ${overOrdered ? 'text-orange-600 font-semibold' : underOrdered ? 'text-blue-600' : ''}`}>
                                            {item.orderedQuantity.toFixed(2)}
                                            {overOrdered && (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild><Info className="h-3 w-3 ml-1 inline text-orange-500" /></TooltipTrigger>
                                                        <TooltipContent><p>Over ordered vs estimate</p></TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                            {underOrdered && (
                                                 <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild><Info className="h-3 w-3 ml-1 inline text-blue-500" /></TooltipTrigger>
                                                        <TooltipContent><p>Under ordered vs estimate</p></TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">{item.deliveredQuantity.toFixed(2)}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={statusVariant === "warning" ? "default" : statusVariant} 
                                                   className={statusVariant === "warning" ? `bg-yellow-500 text-yellow-foreground hover:bg-yellow-500/80`: ""}>
                                                {statusText}
                                            </Badge>
                                        </TableCell>
                                        {/* <TableCell className="text-center text-xs">
                                            {item.poNumbers && item.poNumbers.length > 0 ? (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger>
                                                            {item.poNumbers.length} PO(s)
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {item.poNumbers.join(', ')}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            ) : '-'}
                                        </TableCell> */}

                                      <TableCell className="text-center">
                                            {item.poNumbers && item.poNumbers.length > 0 ? (
                                                item.poNumbers.length === 1 ? (
                                                    <Link to={`po/${item.poNumbers[0].replaceAll("/", "&=")}`} className="text-blue-600 hover:underline text-xs font-mono">
                                                        {item.poNumbers[0]}
                                                    </Link>
                                                ) : (
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button variant="ghost" size="sm" className="h-auto p-1 text-xs">
                                                                    <FileText className="h-3 w-3 mr-1" />
                                                                    {item.poNumbers.length} POs
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent className="max-w-md bg-gray-300">
                                                                <ul className="list-disc pl-4">
                                                                    {item.poNumbers.map(po => (
                                                                        <li key={po}>
                                                                            <Link to={`po/${po.replaceAll("/", "&=")}`} className="text-blue-600 hover:underline">
                                                                                {po}
                                                                            </Link>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                )
                                            ) : (
                                                <span className="text-xs text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </AccordionContent>
        </AccordionItem>
    );
};