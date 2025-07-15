// file: /workspace/development/frappe-bench/apps/nirmaan_stack/frontend/src/pages/ProcurementRequests/ApproveVendorQuotes/components/VendorApprovalTable.tsx

import * as React from "react";
import { useCallback, useEffect, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  SelectionState,
  VendorGroupForTable,
  VendorItemDetailsToDisplay,
  DynamicPaymentTerms,
} from "../types";
import formatToIndianRupee, {
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { HistoricalQuotesHoverCard } from "../../VendorQuotesSelection/components/HistoricalQuotesHoverCard";
import { parseNumber } from "@/utils/parseNumber";
import { VendorPaymentTerm } from "../../VendorQuotesSelection/types/paymentTerms";

interface VendorApprovalTableProps {
  dataSource: VendorGroupForTable[];
  selection: SelectionState;
  onSelectionChange: (newSelection: SelectionState) => void;
  paymentTerms?: { [vendorId: string]: VendorPaymentTerm[] };
  onDynamicTermsChange: (dynamicTerms: DynamicPaymentTerms) => void;
}

export const VendorApprovalTable: React.FC<VendorApprovalTableProps> = ({
  dataSource = [],
  selection,
  onSelectionChange,
  paymentTerms,
  onDynamicTermsChange,
}) => {
  const [openAccordionItems, setOpenAccordionItems] = React.useState<string[]>(
    []
  );

  const vendorCalculations = useMemo(() => {
    const calcs = new Map<
      string,
      {
        selectedItemsTotalInclGst: number;
        displayPaymentTerms?: VendorPaymentTerm[];
      }
    >();

    dataSource.forEach((vendorItem) => {
      const { vendorId, items } = vendorItem;
      const originalTermsForThisVendor = paymentTerms?.[vendorId];
      const selectedItemNames = selection.get(vendorId) || new Set();

      const selectedItemsTotalInclGst = items
        .filter((item) => selectedItemNames.has(item.name!))
        .reduce((sum, item) => {
          const quote = parseNumber(item.quote);
          const quantity = parseNumber(item.quantity);
          const taxRate = parseNumber(item.tax) / 100;
          const itemTotalInclGst = quantity * quote * (1 + taxRate);
          return sum + itemTotalInclGst;
        }, 0);

      let displayPaymentTerms: VendorPaymentTerm[] | undefined;

      if (selectedItemsTotalInclGst > 0 && originalTermsForThisVendor) {
        displayPaymentTerms = originalTermsForThisVendor.map((term) => {
          const termPercentage = parseNumber(term.percentage);
          const newAmount = selectedItemsTotalInclGst * (termPercentage / 100);
          return { ...term, amount: newAmount };
        });
      } else {
        displayPaymentTerms = originalTermsForThisVendor;
      }
      calcs.set(vendorId, { selectedItemsTotalInclGst, displayPaymentTerms });
    });
    return calcs;
  }, [dataSource, selection, paymentTerms]);

  useEffect(() => {
    const allDynamicTerms: DynamicPaymentTerms = {};
    vendorCalculations.forEach((calcs, vendorId) => {
      if (calcs.selectedItemsTotalInclGst > 0 && calcs.displayPaymentTerms) {
        allDynamicTerms[vendorId] = calcs.displayPaymentTerms;
      }
    });
    onDynamicTermsChange(allDynamicTerms);
  }, [vendorCalculations, onDynamicTermsChange]);

  const handleVendorCheckChange = useCallback(
    (
      vendorId: string,
      allItemsForVendor: VendorItemDetailsToDisplay[],
      isChecked: boolean | "indeterminate"
    ) => {
      const newSelection = new Map(selection);
      if (isChecked === true) {
        const allItemIds = new Set(allItemsForVendor.map((item) => item.name!));
        newSelection.set(vendorId, allItemIds);
        setOpenAccordionItems((prev) =>
          Array.from(new Set([...prev, vendorId]))
        );
      } else {
        newSelection.delete(vendorId);
        setOpenAccordionItems((prev) => prev.filter((v) => v !== vendorId));
      }
      onSelectionChange(newSelection);
    },
    [selection, onSelectionChange]
  );

  const handleItemCheckChange = useCallback(
    (
      vendorId: string,
      itemName: string,
      isChecked: boolean | "indeterminate"
    ) => {
      const newSelection = new Map(selection);
      const vendorSet = new Set(newSelection.get(vendorId) ?? []);
      if (isChecked === true) {
        vendorSet.add(itemName);
      } else {
        vendorSet.delete(itemName);
      }
      if (vendorSet.size === 0) {
        newSelection.delete(vendorId);
      } else {
        newSelection.set(vendorId, vendorSet);
      }
      onSelectionChange(newSelection);
    },
    [selection, onSelectionChange]
  );

  const getVendorCheckboxState = useCallback(
    (
      vendorId: string,
      totalItemsCount: number
    ): { checked: boolean | "indeterminate"; isFullySelected: boolean } => {
      const selectedVendorSet = selection.get(vendorId);
      const selectedCount = selectedVendorSet?.size ?? 0;
      if (selectedCount === 0)
        return { checked: false, isFullySelected: false };
      if (selectedCount === totalItemsCount)
        return { checked: true, isFullySelected: true };
      return { checked: "indeterminate", isFullySelected: false };
    },
    [selection]
  );

  if (!dataSource || dataSource.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No vendor data to display.
      </div>
    );
  }

  // console.log('selection Items ',dataSource)
  return (
    <div className="space-y-3">
      <Accordion
        type="multiple"
        value={openAccordionItems}
        onValueChange={setOpenAccordionItems}
        className="w-full space-y-2"
      >
        {dataSource.map((vendorItem) => {
          const {
            vendorId,
            vendorName,
            items,
            key,
            potentialSavingLossForVendor,
          } = vendorItem;
          const vendorState = getVendorCheckboxState(vendorId, items.length);
          const calcs = vendorCalculations.get(vendorId);
          const selectedItemsTotalInclGst =
            calcs?.selectedItemsTotalInclGst ?? 0;
          const displayPaymentTerms = calcs?.displayPaymentTerms;


          console.log("displayPaymentTerms dydt", calcs);

          return (
            <AccordionItem
              value={vendorId}
              key={key}
              className="border rounded-md overflow-hidden bg-white shadow-sm"
            >
              <AccordionTrigger
                className={`!py-0 !px-0 hover:!no-underline focus-visible:!ring-1 focus-visible:!ring-ring focus-visible:!ring-offset-1 rounded-t-md ${
                  vendorState.isFullySelected ? "bg-primary/10" : ""
                }`}
              >
                <CardHeader className="flex flex-row items-center justify-between p-3 w-full cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={`vendor-${vendorId}`}
                      checked={vendorState.checked}
                      onCheckedChange={(checkedState) =>
                        handleVendorCheckChange(vendorId, items, checkedState)
                      }
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select all items for ${vendorName}`}
                      className="ml-1"
                    />
                    <CardTitle
                      className={cn("text-base font-medium", "text-primary")}
                    >
                      {vendorName}
                    </CardTitle>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-xs">
                    {potentialSavingLossForVendor !== undefined && (
                      <div className="flex gap-2 items-end">
                        <span className="text-gray-500">
                          Potential Saving/Loss:
                        </span>
                        <span
                          className={cn(
                            "font-semibold",
                            potentialSavingLossForVendor > 0
                              ? "text-green-600"
                              : potentialSavingLossForVendor < 0
                              ? "text-red-600"
                              : "text-gray-600"
                          )}
                        >
                          {formatToIndianRupee(
                            potentialSavingLossForVendor || "N/A"
                          )}{" "}
                          {potentialSavingLossForVendor > 0
                            ? "(S)"
                            : potentialSavingLossForVendor < 0
                            ? "(L)"
                            : ""}
                        </span>
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <span className="text-gray-500">Selected Value:</span>
                      <span className="font-semibold text-gray-700">
                        {formatToRoundedIndianRupee(selectedItemsTotalInclGst)}
                      </span>
                    </div>
                  </div>
                </CardHeader>
              </AccordionTrigger>
              <AccordionContent className="overflow-auto">
                <CardContent className="p-0 ">
                  <Table>
                    <TableHeader className="bg-primary/20">
                      <TableRow>
                        <TableHead className="w-10 px-2"></TableHead>
                        <TableHead className="w-[25%] text-primary">
                          Item Name
                        </TableHead>
                        <TableHead className="w-[8%] text-center">
                          UOM
                        </TableHead>
                        <TableHead className="w-[8%] text-center">
                          Qty
                        </TableHead>
                        <TableHead className="w-[8%] text-right">
                          Rate
                        </TableHead>
                        <TableHead className="w-[8%] text-right">
                          Target Rate
                        </TableHead>
                        <TableHead className="w-[8%] text-right">Tax</TableHead>
                        <TableHead className="w-[12%] text-right">
                          Amount
                        </TableHead>
                        <TableHead className="w-[12%] text-right">
                          Lowest Quoted
                        </TableHead>
                        <TableHead className="w-[12%] text-right">
                          Target Amount
                        </TableHead>
                        <TableHead className="w-[13%] text-right pr-4">
                          Savings/Loss
                        </TableHead>
                        <TableHead className="w-[13%] text-right pr-4">
                          Total Amount(Incl. GST)
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => {
                        const isItemSelected =
                          selection.get(vendorId)?.has(item.name!) ?? false;
                        const itemSavingLoss = item.savingLoss || 0;
                        const quote = parseNumber(item.quote);
                        const quantity = parseNumber(item.quantity);
                        const taxRate = parseNumber(item.tax) / 100;
                        const itemTotalInclGst =
                          quantity * quote * (1 + taxRate);
                        return (
                          <TableRow key={item.name}>
                            <TableCell className="px-4">
                              <Checkbox
                                id={`item-${vendorId}-${item.name}`}
                                checked={isItemSelected}
                                onCheckedChange={(checkedState) =>
                                  handleItemCheckChange(
                                    vendorId,
                                    item.name!,
                                    checkedState
                                  )
                                }
                                aria-label={`Select item ${item.item_name}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium text-gray-900">
                              {item.item_name}
                              {item.make && (
                                <span className="ml-1 text-red-700 font-light text-xs">
                                  ({item.make})
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {item.unit}
                            </TableCell>
                            <TableCell className="text-center">
                              {item.quantity}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatToIndianRupee(item.quote)}
                            </TableCell>
                            <TableCell className="text-right">
                              {parseNumber(item?.targetRate) > 0 ? (
                                <HistoricalQuotesHoverCard
                                  quotes={item.contributingHistoricalQuotes}
                                >
                                  <span>
                                    {formatToIndianRupee(
                                      parseNumber(item.targetRate) * 0.98
                                    )}
                                  </span>
                                </HistoricalQuotesHoverCard>
                              ) : (
                                <span>N/A</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.tax}%
                            </TableCell>
                            <TableCell className="text-right">
                              {formatToIndianRupee(item.amount)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatToIndianRupee(
                                item.lowestQuotedAmountForItem || "N/A"
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatToIndianRupee(
                                parseNumber(item?.targetAmount) * 0.98 || "N/A"
                              )}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right font-semibold pr-4",
                                itemSavingLoss > 0
                                  ? "text-green-600"
                                  : itemSavingLoss < 0
                                  ? "text-red-600"
                                  : "text-gray-600"
                              )}
                            >
                              {formatToIndianRupee(itemSavingLoss || "N/A")}
                              {itemSavingLoss > 0
                                ? " (S)"
                                : itemSavingLoss < 0
                                ? " (L)"
                                : ""}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatToIndianRupee(itemTotalInclGst)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {displayPaymentTerms && displayPaymentTerms.length > 0 && (
                    <div className="p-4 border-t bg-gray-50">
                      <h4 className="text-sm font-semibold mb-2 text-gray-800">
                        <span className="text-primary pr-2">{displayPaymentTerms[0].type}:</span>
                        {selectedItemsTotalInclGst > 0
                          ? `Payment Terms (Based on Selected Value: ${formatToRoundedIndianRupee(
                              selectedItemsTotalInclGst
                            )})`
                          : "Original Payment Terms"} 
                      </h4>
                      <Table className="bg-white">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[60%]">Term</TableHead>
                            <TableHead className="w-[20%] text-center">
                              Percentage
                            </TableHead>
                            <TableHead className="w-[20%] text-right">
                              Amount
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {displayPaymentTerms.map((term, index) => (
                            <TableRow key={term.id || index}>
                              <TableCell>
                                {
                                  term.name ||
                                  "N/A"}
                              </TableCell>
                              <TableCell className="text-center">
                                {parseFloat(String(term.percentage)).toFixed(2)}
                                %
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatToIndianRupee(term.amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
};
