import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from 'frappe-react-sdk';
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectEstimates } from '@/types/NirmaanStack/ProjectEstimates';
import { po_item_data_item } from '../project';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
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
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { memoize } from 'lodash';
import { parseNumber } from '@/utils/parseNumber';
import { useOrderTotals } from '@/hooks/useOrderTotals';
import { Button } from '@/components/ui/button';

interface ProjectMaterialUsageTabProps {
    projectId: string;
    projectPayments?: ProjectPayments[];
}

type POStatus = "Fully Paid" | "Partially Paid" | "Unpaid";
type OverallItemPOStatus = POStatus | "N/A";

// Combined structure for display in the inner table
export interface MaterialUsageDisplayItem {
//   itemId?: string;          // From PO or Estimate
  categoryName: string;
  itemName?: string;        // From PO or Estimate
  unit?: string;            // From PO (or UOM from Estimate)
  orderedQuantity: number;
  deliveredQuantity: number;
  estimatedQuantity?: number;
  // Optional: Add PO numbers if you want to list them per item
  poNumbers?: {po: string, status: POStatus}[];
  uniqueKey: string;
}

export interface CategorizedMaterialUsage {
  categoryName: string;
  items: MaterialUsageDisplayItem[];
}


// Helper to parse numbers safely
const safeParseFloat = (value: string | number | undefined | null, defaultValue = 0): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? defaultValue : parsed;
    }
    return defaultValue;
};

// Helper function to determine overall PO status for an item
const determineOverallItemPOStatus = (
    poNumbersWithStatus: { po: string; status: POStatus; }[] | undefined
): OverallItemPOStatus => {
    if (!poNumbersWithStatus || poNumbersWithStatus.length === 0) {
        return "N/A"; // Or "Not Applicable" if no POs for this item
    }

    const totalPOs = poNumbersWithStatus.length;
    let fullyPaidCount = 0;
    let partiallyPaidCount = 0;
    let notPaidCount = 0;

    for (const po of poNumbersWithStatus) {
        if (po.status === "Fully Paid") {
            fullyPaidCount++;
        } else if (po.status === "Partially Paid") {
            partiallyPaidCount++;
        } else {
            notPaidCount++;
        }
    }

    if (fullyPaidCount === totalPOs) {
        return "Fully Paid";
    }
    if (notPaidCount === totalPOs) {
        return "Unpaid";
    }
    // If it reaches here, it means it's a mix (some paid, some not, or some partially)
    // or all are partially paid.
    if (fullyPaidCount > 0 || partiallyPaidCount > 0) {
        return "Partially Paid";
    }
    
    return "Unpaid"; // Fallback, should be covered by above
};

export const ProjectMaterialUsageTab: React.FC<ProjectMaterialUsageTabProps> = ({ projectId, projectPayments }) => {
    // 1. Fetch PO Summary data (item-wise)


    const { data: po_item_data, isLoading: po_item_loading, error: po_item_error } = useFrappeGetCall<{
        message: {
          po_items: po_item_data_item[],
          custom_items: po_item_data_item[]
        }
      }>(
        "nirmaan_stack.api.procurement_orders.generate_po_summary",
        { project_id: projectId }
      );

    const {getTotalAmount} = useOrderTotals()
    
    const getAmountPaidForPO = useMemo(() => {
        if (!projectPayments) return () => 0;
        const paymentsMap = new Map<string, number>();
        projectPayments.forEach(p => {
            if (p.document_name && p.status === "Paid") {
                paymentsMap.set(p.document_name, (paymentsMap.get(p.document_name) || 0) + parseNumber(p.amount));
            }
        });
        return memoize((poName: string) => paymentsMap.get(poName) || 0);
    }, [projectPayments]);


    const getIndividualPOStatus = useCallback((poName: string): POStatus => {
        const amountPaid = getAmountPaidForPO(poName);
        const orderTotals = getTotalAmount(poName, 'Procurement Orders'); // Assuming 'Procurement Orders' is the correct doctype for your hook
        
        if (!orderTotals || orderTotals.totalWithTax === 0 && amountPaid === 0) {
            // If PO total is 0 (e.g. not found or truly zero value) and no payment, consider it Unpaid or N/A
            // For simplicity, let's call it Unpaid if it exists but is zero value.
            // If orderTotals is null, it means the PO wasn't found by your hook, perhaps also Unpaid or handle as error.
            return "Unpaid";
        }
        const totalAmount = orderTotals.totalWithTax;

        if (amountPaid <= 0) return "Unpaid"; // Changed from Not Paid to Unpaid for consistency
        if (amountPaid >= totalAmount) return "Fully Paid";
        return "Partially Paid";
    }, [getAmountPaidForPO, getTotalAmount]);


    // 2. Fetch Project Estimates
    const {
        data: projectEstimates,
        isLoading: estimatesLoading,
        error: estimatesError,
    } = useFrappeGetDocList<ProjectEstimates>('Project Estimates', {
        fields: ['name', 'project', 'work_package', 'category', 'item', 'item_name', 'uom', 'quantity_estimate'],
        filters: [['project', '=', projectId]],
        limit: 0, // Fetch all for the project
    }, `project_estimates_${projectId}`); // SWR key



    // Process data into a flat list, sorted by category then item name
    const flatMaterialUsageList = useMemo((): MaterialUsageDisplayItem[] => {
        if (!po_item_data?.message || !projectEstimates) {
            return [];
        }

        const allPoItems = [
            ...(po_item_data.message.po_items || []),
            ...(po_item_data.message.custom_items || [])
        ];

        const estimatesMap = new Map<string, ProjectEstimates>();
        projectEstimates.forEach(est => {
            if (est.item) { // est.item is the Item DocName (ID)
                estimatesMap.set(est.item, est);
            }
        });

        const usageByItemKey = new Map<string, MaterialUsageDisplayItem>(); // Key: category_itemId

        allPoItems.forEach((poItem, index) => {
            if (!poItem.item_id || !poItem.category) return;

            const itemKey = `${poItem.category}_${poItem.item_id}`;
            let currentItemUsage = usageByItemKey.get(itemKey);

            if (!currentItemUsage) {
                const estimate = estimatesMap.get(poItem.item_id);
                currentItemUsage = {
                    uniqueKey: itemKey + `_item_${index}`, // Ensure unique key for React list
                    categoryName: poItem.category, // Store category directly
                    itemName: poItem.item_name || estimate?.item_name,
                    unit: poItem.unit || estimate?.uom,
                    orderedQuantity: 0,
                    deliveredQuantity: 0,
                    estimatedQuantity: safeParseFloat(estimate?.quantity_estimate),
                    poNumbers: [],
                };
            }

            currentItemUsage.orderedQuantity += safeParseFloat(poItem.quantity);
            currentItemUsage.deliveredQuantity += safeParseFloat(poItem.received);
            if (poItem.po_number) {
                // Check if this PO number is already added for this item
                const existingPoEntry = currentItemUsage.poNumbers?.find(p => p.po === poItem.po_number);
                if (!existingPoEntry) {
                    currentItemUsage.poNumbers?.push({
                        po: poItem.po_number,
                        status: getIndividualPOStatus(poItem.po_number),
                    });
                }
                // If PO already exists, its status would have been set on its first encounter.
                // Re-calculating status for existing POs every time is redundant here
                // as getIndividualPOStatus is memoized based on its own dependencies.
            }
            usageByItemKey.set(itemKey, currentItemUsage);
        });

        // Convert map to array
        const flatList = Array.from(usageByItemKey.values());

        // Sort by categoryName, then by itemName
        flatList.sort((a, b) => {
            if (a.categoryName.localeCompare(b.categoryName) !== 0) {
                return a.categoryName.localeCompare(b.categoryName);
            }
            return (a.itemName || "").localeCompare(b.itemName || "");
        });

        return flatList;

    }, [po_item_data, projectEstimates]);

    // --- NEW: Create an array of all category names to be open by default ---
    // const defaultOpenCategories = useMemo(() => {
    //   return categorizedUsageData.map(categoryData => categoryData.categoryName);
    // }, [categorizedUsageData]);
  // --- END NEW ---

    // Loading and Error States
    if (po_item_loading || estimatesLoading) {
        return (
            <div className="space-y-4 p-4 md:p-6">
                <Skeleton className="h-8 w-1/2 mb-6" /> {/* For title */}
                <Skeleton className="h-12 w-full" /> {/* For table header */}
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full mt-2" />)} {/* For table rows */}
            </div>
        );
    }

    const error = po_item_error || estimatesError;

    if (error) {
        return (
            <AlertDestructive error={error} />
        );
    }

    if (flatMaterialUsageList.length === 0) {
        return <div className="p-4 text-center text-muted-foreground">No material usage data found for this project.</div>;
    }
    // let lastCategory = ""; // To track category changes for group headers

    return (
        <div className="flex-1 space-y-4">
            <div className="rounded-md border overflow-x-auto">
                <Table>
                    {/* Optional: TableCaption */}
                    {/* <TableCaption>A list of materials used in the project, grouped by category.</TableCaption> */}
                    <TableHeader>
                        <TableRow>
                            {/* No Item ID column */}
                            <TableHead className="min-w-[250px] sticky left-0 bg-background z-10">Item Name</TableHead> {/* Sticky Item Name */}
                            <TableHead className="min-w-[150px]">Category</TableHead>
                            <TableHead className="text-center min-w-[80px]">Unit</TableHead>
                            <TableHead className="text-right min-w-[100px]">Est. Qty</TableHead>
                            <TableHead className="text-right min-w-[100px]">Ordered Qty</TableHead>
                            <TableHead className="text-right min-w-[120px]">Delivered Qty</TableHead>
                            <TableHead className="text-center min-w-[120px]">Delivery Status</TableHead>
                            <TableHead className="text-center min-w-[170px]">PO Number(s)</TableHead>
                            <TableHead className="text-center min-w-[150px]">PO Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {flatMaterialUsageList.map((item, idx) => {
                            // const showCategoryHeader = item.categoryName !== lastCategory;
                            // if (showCategoryHeader) {
                            //     lastCategory = item.categoryName;
                            // }

                            const deliveryPercentage = item.orderedQuantity > 0
                                ? (item.deliveredQuantity / item.orderedQuantity) * 100
                                : item.deliveredQuantity > 0 ? 100 : 0;

                            const deliveryStatusVariant: "success" | "warning" | "destructive" | "default" =
                                item.deliveredQuantity >= item.orderedQuantity && item.orderedQuantity > 0 ? "success"
                                : deliveryPercentage > 0 ? "warning"
                                : item.orderedQuantity > 0 ? "destructive"
                                : "default";
                            
                            const deliveryStatusText =
                                deliveryStatusVariant === "success" ? "Fully Delivered"
                                : deliveryStatusVariant === "warning" ? "Partially Delivered"
                                : deliveryStatusVariant === "destructive" ? "Pending Delivery"
                                : "Not Ordered";

                            const overOrdered = item.orderedQuantity > (item.estimatedQuantity ?? Infinity);
                            const underOrdered = item.orderedQuantity < (item.estimatedQuantity ?? 0) && item.orderedQuantity > 0;

                            const overallPOPaymentStatus = determineOverallItemPOStatus(item.poNumbers);
                            let poStatusBadgeVariant: "success" | "warning" | "destructive" | "default" = "default";
                            if (overallPOPaymentStatus === "Fully Paid") poStatusBadgeVariant = "success";
                            else if (overallPOPaymentStatus === "Partially Paid") poStatusBadgeVariant = "warning";
                            else if (overallPOPaymentStatus === "Unpaid") poStatusBadgeVariant = "destructive";


                            return (
                                    <TableRow key={item.uniqueKey || `item-${idx}`}>
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
                                        {item.poNumbers && item.poNumbers.length > 0 ? (
                                            item.poNumbers.length === 1 ? (
                                                <Link to={`../po/${item.poNumbers[0].po.replaceAll("/", "&=")}`} relative="path" className="text-blue-600 hover:underline text-xs font-mono">
                                                    {item.poNumbers[0].po}
                                                </Link>
                                            ) : (
                                                <TooltipProvider delayDuration={100}>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="sm" className="h-auto p-1 text-xs text-blue-600 hover:bg-blue-50">
                                                                <FileText className="h-3.5 w-3.5 mr-1" />
                                                                {item.poNumbers.length} POs
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent className="max-w-xs md:max-w-sm bg-popover border shadow-lg rounded-md p-0">
                                                            <ul className="list-none p-2 space-y-1">
                                                                {item.poNumbers.map(poEntry => (
                                                                    <li key={poEntry.po} className="text-xs flex justify-between items-center">
                                                                        <Link to={`../po/${poEntry.po.replaceAll("/", "&=")}`} relative="path" className="text-blue-600 hover:underline">
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
                                            )
                                        ) : (
                                            <span className="text-xs text-muted-foreground">-</span>
                                        )}
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
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};


export default ProjectMaterialUsageTab;