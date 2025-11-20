import { ProcurementHeaderCard } from "@/components/helpers/ProcurementHeaderCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useItemEstimate } from "@/hooks/useItemEstimate";
import { useUserData } from "@/hooks/useUserData";
import { ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import formatToIndianRupee, {
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import TextArea from "antd/es/input/TextArea";
import {
  useFrappeCreateDoc,
  useFrappeDocumentEventListener,
  useFrappeUpdateDoc,
  useSWRConfig,
} from "frappe-react-sdk";
import memoize from "lodash/memoize";
import {
  ArrowBigUpDash,
  CheckCheck,
  Undo2,
  CirclePlus,
  Pencil,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useSentBackCategory } from "@/hooks/useSentBackCategory";
import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { PaymentTermsDialog } from "../ProcurementRequests/VendorQuotesSelection/components/PaymentTermsDialog";
import {
  PaymentTermsData,
  VendorPaymentTerm,
} from "../ProcurementRequests/VendorQuotesSelection/types/paymentTerms";
import { getItemListFromDocument } from "../ProcurementRequests/VendorQuotesSelection/types";
import { useTargetRatesForItems, getTargetRateKey } from "../ProcurementRequests/VendorQuotesSelection/hooks/useTargetRatesForItems";

// --- UI Imports ---
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface DisplayItem extends ProcurementRequestItemDetail {
  amount?: number; 
  vendor_name?: string;
  lowestQuotedAmount?: number; 
  targetRateValue?: number; 
  targetAmount?: number;
  savingLoss?: number;
}

interface VendorWiseApprovalItems {
  [vendor: string]: {
    items: DisplayItem[];
    total: number; 
    totalInclGst: number; 
    totalSavingLoss: number; // Added for Vendor Total Savings
  };
}

export const SBQuotesSelectionReview: React.FC = () => {
  const { sbId } = useParams<{ sbId: string }>();

  if (!sbId) return <div>No Sent Back ID Provided</div>;
  const navigate = useNavigate();
  const userData = useUserData();

  const { updateDoc: updateDoc, loading: update_loading } = useFrappeUpdateDoc();
  const { createDoc: createDoc, loading: create_loading } = useFrappeCreateDoc();
  const { mutate } = useSWRConfig();
  const { getItemEstimate } = useItemEstimate();

  const [comment, setComment] = useState<string>("");
  const [orderData, setOrderData] = useState<SentBackCategory | undefined>();
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);

  // Payment Terms State
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermsData>(() => {
    const storageKey = `SBpaymentTermsDraft_${sbId}`;
    try {
      const savedData = localStorage.getItem(storageKey);
      if (savedData) return JSON.parse(savedData);
    } catch (error) {
      console.error("Failed to parse payment terms", error);
    }
    return {};
  });

  useEffect(() => {
    if (Object.keys(paymentTerms).length > 0) {
      localStorage.setItem(`SBpaymentTermsDraft_${sbId}`, JSON.stringify(paymentTerms));
    }
  }, [paymentTerms, sbId]);

  useEffect(() => {
    const cleanup = () => {
      localStorage.removeItem(`SBpaymentTermsDraft_${sbId}`);
      console.log(`Cleaned up payment terms for SBPR: ${sbId}`);
    };
    return cleanup;
  }, [sbId]);

  const [editingVendor, setEditingVendor] = useState<{
    id: string;
    name: string;
    total: number;
  } | null>(null);

  const {
    data: sent_back,
    isLoading: sent_back_loading,
    mutate: sent_back_mutate,
  } = useSentBackCategory(sbId);

  useFrappeDocumentEventListener(
    "Sent Back Category",
    sbId,
    (event) => {
      console.log("Sent Back document updated:", event);
      sent_back_mutate();
    },
    true
  );

  const { data: vendor_list, isLoading: vendor_list_loading } = useVendorsList({
    vendorTypes: ["Material", "Material & Service"],
  });

  useEffect(() => {
    if (sent_back) {
      const newOrderData = JSON.parse(JSON.stringify(sent_back));
      if (!Array.isArray(newOrderData.order_list)) {
        newOrderData.order_list = [];
      }
      if (typeof newOrderData.rfq_data === 'string' && newOrderData.rfq_data) {
        try {
          newOrderData.rfq_data = JSON.parse(newOrderData.rfq_data);
        } catch (e) {
          newOrderData.rfq_data = { selectedVendors: [], details: {} };
        }
      }
      if (!newOrderData.rfq_data) {
        newOrderData.rfq_data = { selectedVendors: [], details: {} };
      }
      setOrderData(newOrderData);
    }
  }, [sent_back]);

  const getVendorName = useMemo(
    () => (vendorId: string | undefined) => {
      return (
        vendor_list?.find((vendor) => vendor?.name === vendorId)?.vendor_name ||
        ""
      );
    },
    [vendor_list]
  );

  const getLowest = useMemo(
    () =>
      memoize(
        (itemId: string): number => {
          if (!orderData?.rfq_data?.details?.[itemId]?.vendorQuotes) return Infinity;
          const allQuotesForItem = orderData.rfq_data.details[itemId].vendorQuotes;
          const numericQuotes = Object.values(allQuotesForItem)
            .map((vendorQuote: any) => parseNumber(vendorQuote.quote))
            .filter(q => q > 0);
          if (numericQuotes.length === 0) return Infinity;
          return Math.min(...numericQuotes);
        },
        (itemId: string) => `${itemId}-${JSON.stringify(orderData?.rfq_data)}`
      ),
    [orderData]
  );

  const savePaymentTerms = async (): Promise<boolean> => {
    const paymentTermsJsonString = JSON.stringify({ list: paymentTerms });
    try {
      await updateDoc("Sent Back Category", sbId, {
        payment_terms: paymentTermsJsonString,
      });
      toast({
        title: "SB Payment Terms Saved",
        description: "Payment terms have been successfully saved.",
        variant: "success",
      });
      localStorage.removeItem(`SBpaymentTermsDraft_${sbId}`);
      return true;
    } catch (error) {
      toast({
        title: "Error Saving Terms",
        description: "Could not save the SB payment terms.",
        variant: "destructive",
      });
      return false;
    }
  };

  const handleConfirmPaymentTerms = (
    vendorId: string,
    data: VendorPaymentTerm
  ) => {
    setPaymentTerms((prev) => ({
      ...prev,
      [vendorId]: data,
    }));
    setEditingVendor(null);
  };

  const handleSubmit = async () => {
    try {
      const termsSavedSuccessfully = await savePaymentTerms();
      if (!termsSavedSuccessfully) return;

      await updateDoc("Sent Back Category", sbId, {
        workflow_state: "Vendor Selected",
      });

      if (comment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Sent Back Category",
          reference_name: sbId,
          comment_by: userData?.user_id,
          content: comment,
          subject: "sb vendors selected",
        });
      }

      toast({
        title: "Success!",
        description: `Sent Back: ${sbId} sent for Approval!`,
        variant: "success",
      });

      await mutate(`${orderData?.type} Sent Back Category`);
      navigate(`/procurement-requests?tab=${orderData?.type}`);
      
    } catch (error) {
      toast({
        title: "Failed!",
        description: `Failed to send Sent Back: ${sbId} for Approval.`,
        variant: "destructive",
      });
    }
  };

  const itemIdsToFetch = useMemo(
    () => getItemListFromDocument(orderData).map(item => item.item_id).filter(Boolean),
    [orderData]
  );

  const { targetRatesDataMap } = useTargetRatesForItems(itemIdsToFetch, sbId);

  // --- CORE CALCULATION LOGIC ---
  const generateActionSummary = useCallback(() => {
    let allDelayedItems: DisplayItem[] = [];
    let vendorWiseApprovalItems: VendorWiseApprovalItems = {};

    let approvalOverallTotalExclGst: number = 0;
    let approvalOverallTotalInclGst: number = 0;
    let delayedItemsTotalExclGst: number = 0;
    let delayedItemsTotalInclGst: number = 0;

    orderData?.order_list.forEach((item: ProcurementRequestItemDetail) => {
      const vendor = item?.vendor;
      const quote = parseNumber(item.quote);
      const quantity = parseNumber(item.quantity);
      const taxRate = parseNumber(item.tax) / 100;

      const baseItemTotal = quantity * quote;
      const itemTotalInclGst = baseItemTotal * (1 + taxRate);

      if (!vendor || !quote) {
        allDelayedItems.push(item);
        delayedItemsTotalExclGst += baseItemTotal;
        delayedItemsTotalInclGst += itemTotalInclGst;
      } else {
        // 1. Target Rate Calculation
        const lookupKey = getTargetRateKey(item.item_id, item.unit);
        const targetRateDetail = targetRatesDataMap?.get(lookupKey);
        
        let pureTargetRate = -1;
        if (targetRateDetail?.rate && targetRateDetail.rate !== "-1") {
          const parsedRate = parseNumber(targetRateDetail.rate);
          if (!isNaN(parsedRate)) {
            pureTargetRate = parsedRate * 0.98;
          }
        }
        const targetAmount = (pureTargetRate > 0) ? pureTargetRate * quantity : 0;

        // 2. Lowest Quote Calculation
        const lowestRate = getLowest(item.item_id);
        const lowestQuotedAmount = (lowestRate !== Infinity) ? (lowestRate * quantity) : 0;

        // 3. Benchmark Calculation (Target > L1 Priority)
        let benchmarkAmount = 0;
        if (targetAmount > 0) {
            benchmarkAmount = targetAmount; 
        } else if (lowestQuotedAmount > 0) {
            benchmarkAmount = lowestQuotedAmount;
        }

        // 4. Saving/Loss Calculation
        let savingLoss = 0;
        if (item.category !== "Additional Charges" && benchmarkAmount > 0) {
            savingLoss = benchmarkAmount - baseItemTotal;
        }

        if (!vendorWiseApprovalItems[vendor]) {
          vendorWiseApprovalItems[vendor] = {
            items: [],
            total: 0,
            totalInclGst: 0,
            totalSavingLoss: 0,
          };
        }

        const displayItem: DisplayItem = {
          ...item,
          amount: itemTotalInclGst,
          targetRateValue: pureTargetRate > 0 ? pureTargetRate : undefined,
          lowestQuotedAmount: lowestQuotedAmount > 0 ? lowestQuotedAmount : undefined,
          targetAmount: targetAmount > 0 ? targetAmount : undefined,
          savingLoss: savingLoss
        };

        vendorWiseApprovalItems[vendor].items.push(displayItem);
        vendorWiseApprovalItems[vendor].total += baseItemTotal;
        vendorWiseApprovalItems[vendor].totalInclGst += itemTotalInclGst;
        vendorWiseApprovalItems[vendor].totalSavingLoss += savingLoss;

        approvalOverallTotalExclGst += baseItemTotal;
        approvalOverallTotalInclGst += itemTotalInclGst;
      }
    });

    return {
      allDelayedItems,
      vendorWiseApprovalItems,
      approvalOverallTotal: approvalOverallTotalExclGst,
      approvalOverallTotalInclGst,
      delayedItemsTotalInclGst,
    };
  }, [orderData, getLowest, getItemEstimate, targetRatesDataMap]);

  const {
    allDelayedItems,
    vendorWiseApprovalItems,
    approvalOverallTotal,
    approvalOverallTotalInclGst,
  } = useMemo(() => generateActionSummary(), [generateActionSummary]);

  useEffect(() => {
    if (Object.keys(vendorWiseApprovalItems).length > 0) {
      setOpenAccordionItems(Object.keys(vendorWiseApprovalItems));
    }
  }, [vendorWiseApprovalItems]);

  const allVendorsHaveTerms = useMemo(() => {
    const approvalVendorIds = Object.keys(vendorWiseApprovalItems);
    if (approvalVendorIds.length === 0) return true;
    return approvalVendorIds.every((id) => !!paymentTerms[id]);
  }, [vendorWiseApprovalItems, paymentTerms]);

  if (sent_back_loading || vendor_list_loading) return <LoadingFallback />;

  if (orderData?.workflow_state !== "Pending") {
    return (
      <div className="flex items-center justify-center h-[90vh]">
        <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
          <p className="text-gray-600 text-lg">
            PR: <span className="font-medium text-gray-900">{orderData?.name}</span> is not in Pending state.
          </p>
          <Button onClick={() => navigate("/procurement-requests")}>Go Back</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {orderData && (
        <div className="flex-1 space-y-4">
          <div className="space-y-2">
            <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">
              Comparison & Review
            </h2>
            <ProcurementHeaderCard orderData={orderData} sentBack />
          </div>

          <div className="flex flex-col gap-4">
            {/* --- APPROVAL ITEMS (ACCORDION TABLE LAYOUT) --- */}
            {Object.keys(vendorWiseApprovalItems).length > 0 && (
              <div className="space-y-3">
                <Accordion
                  type="multiple"
                  value={openAccordionItems}
                  onValueChange={setOpenAccordionItems}
                  className="w-full space-y-2"
                >
                  {Object.entries(vendorWiseApprovalItems).map(
                    ([vendor, { items, total, totalInclGst, totalSavingLoss }]) => {
                      const termsForVendor = paymentTerms[vendor];

                      return (
                        <AccordionItem
                          key={vendor}
                          value={vendor}
                          className="border rounded-md overflow-hidden bg-white shadow-sm"
                        >
                          <AccordionTrigger className="!py-0 !px-0 hover:!no-underline focus-visible:!ring-1 focus-visible:!ring-ring focus-visible:!ring-offset-1 rounded-t-md bg-green-50/50">
                            <CardHeader className="flex flex-row items-center justify-between p-3 w-full cursor-pointer hover:bg-green-50 transition-colors">
                              <div className="flex items-center gap-3">
                                <CardTitle className="text-base font-medium text-primary">
                                  {getVendorName(vendor)}
                                </CardTitle>
                              </div>
                              <div className="flex items-center gap-4">
                                <Button
                                  variant={termsForVendor ? "outline" : "default"}
                                  size="sm"
                                  className={cn(
                                    "h-8 text-xs",
                                    termsForVendor
                                      ? "text-primary border-primary hover:bg-primary hover:text-white"
                                      : "bg-primary text-white hover:bg-primary/90"
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingVendor({
                                      id: vendor,
                                      name: getVendorName(vendor),
                                      total: totalInclGst,
                                    });
                                  }}
                                >
                                  {termsForVendor ? (
                                    <>
                                      <Pencil className="mr-2 h-3 w-3" /> Edit Payment Terms
                                    </>
                                  ) : (
                                    <>
                                      <CirclePlus className="mr-2 h-3 w-3" /> Add Payment Terms
                                    </>
                                  )}
                                </Button>
                                <div className="text-xs text-gray-500">
                                   Value: <span className="font-semibold text-gray-900">{formatToRoundedIndianRupee(totalInclGst)}</span>
                                </div>
                              </div>
                            </CardHeader>
                          </AccordionTrigger>

                          <AccordionContent className="p-0">
                            <CardContent className="p-0">
                              {/* --- ITEM DETAILS TABLE --- */}
                              <Table>
                                <TableHeader className="bg-primary/10">
                                  <TableRow>
                                    <TableHead className="w-[20%] text-primary pl-4">Item Name</TableHead>
                                    <TableHead className="w-[5%] text-center">UOM</TableHead>
                                    <TableHead className="w-[5%] text-center">Qty</TableHead>
                                    <TableHead className="w-[8%] text-right">Rate</TableHead>
                                    <TableHead className="w-[8%] text-right">Target Rate</TableHead>
                                    <TableHead className="w-[5%] text-right">Tax</TableHead>
                                    <TableHead className="w-[10%] text-right">Amount</TableHead>
                                    <TableHead className="w-[10%] text-right">Lowest Quoted</TableHead>
                                    <TableHead className="w-[10%] text-right">Target Amount</TableHead>
                                    <TableHead className="w-[10%] text-right pr-4">Savings/Loss</TableHead>
                                    <TableHead className="w-[10%] text-right pr-4">Total (Incl. GST)</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {items.map((item) => {
                                    const quote = parseNumber(item.quote);
                                    const quantity = parseNumber(item.quantity);
                                    const taxRate = parseNumber(item.tax) / 100;
                                    const itemTotalInclGst = quantity * quote * (1 + taxRate);
                                    const savingLoss = item.savingLoss || 0;

                                    return (
                                      <TableRow key={item.item_id}>
                                        <TableCell className="font-medium text-gray-900 pl-4">
                                          {item.item_name}
                                          {item.make && (
                                            <span className="ml-1 text-gray-500 italic text-xs">
                                              ({item.make})
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-center">{item.unit}</TableCell>
                                        <TableCell className="text-center">{item.quantity}</TableCell>
                                        <TableCell className="text-right">{formatToIndianRupee(item.quote)}</TableCell>
                                        <TableCell className="text-right">
                                          {item.targetRateValue && item.targetRateValue > 0 
                                            ? formatToIndianRupee(item.targetRateValue) 
                                            : "N/A"}
                                        </TableCell>
                                        <TableCell className="text-right">{item.tax}%</TableCell>
                                        <TableCell className="text-right">{formatToIndianRupee(item.amount ? item.amount / (1+taxRate) : 0)}</TableCell>
                                        
                                        {/* Lowest Quoted */}
                                        <TableCell className="text-right text-gray-600">
                                            {item.lowestQuotedAmount ? formatToIndianRupee(item.lowestQuotedAmount) : "N/A"}
                                        </TableCell>
                                        {/* Target Amount */}
                                        <TableCell className="text-right text-gray-600">
                                            {item.targetAmount ? formatToIndianRupee(item.targetAmount) : "N/A"}
                                        </TableCell>
                                        {/* Savings/Loss */}
                                        <TableCell
                                          className={cn(
                                            "text-right font-bold pr-4",
                                            savingLoss > 0 ? "text-green-600" : savingLoss < 0 ? "text-red-600" : "text-gray-400"
                                          )}
                                        >
                                          {savingLoss !== 0 ? formatToIndianRupee(savingLoss) : "-"}
                                          {savingLoss > 0 ? " (S)" : savingLoss < 0 ? " (L)" : ""}
                                        </TableCell>

                                        <TableCell className="text-right pr-4 font-medium">{formatToIndianRupee(itemTotalInclGst)}</TableCell>
                                      </TableRow>
                                    );
                                  })}
                                  
                                  {/* VENDOR TOTAL ROW */}
                                  <TableRow className="bg-gray-100 font-semibold border-t-2 border-gray-200">
                                    <TableCell colSpan={6} className="text-right text-gray-700 pr-4">
                                      {getVendorName(vendor)} Total:
                                    </TableCell>
                                    <TableCell className="text-right text-gray-800">
                                      {formatToIndianRupee(total)}
                                    </TableCell>
                                    <TableCell colSpan={2}></TableCell>
                                    <TableCell 
                                        className={cn(
                                            "text-right pr-4 font-bold",
                                            totalSavingLoss > 0 ? "text-green-600" : totalSavingLoss < 0 ? "text-red-600" : "text-gray-600"
                                        )}
                                    >
                                      {formatToIndianRupee(totalSavingLoss)}
                                      {totalSavingLoss > 0 ? " (S)" : totalSavingLoss < 0 ? " (L)" : ""}
                                    </TableCell>
                                    <TableCell className="text-right pr-4 text-green-800 text-base">
                                      {formatToIndianRupee(totalInclGst)}
                                    </TableCell>
                                  </TableRow>

                                </TableBody>
                              </Table>

                              {/* --- PAYMENT TERMS TABLE --- */}
                              {termsForVendor && termsForVendor.terms && termsForVendor.terms.length > 0 && (
                                <div className="p-4 border-t bg-gray-50">
                                  <h4 className="text-sm font-semibold mb-2 text-gray-800">
                                    <span className="text-primary pr-2">{termsForVendor.type}:</span>
                                    Payment Terms Breakdown
                                  </h4>
                                  <Table className="bg-white border rounded-md">
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="w-[60%]">Milestone</TableHead>
                                        <TableHead className="w-[20%] text-center">Percentage</TableHead>
                                        <TableHead className="w-[20%] text-right">Amount</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {termsForVendor.terms.map((term, index) => {
                                         const termAmount = totalInclGst * (parseNumber(term.percentage) / 100);
                                         return (
                                          <TableRow key={index}>
                                            <TableCell>{term.name || "Payment"}</TableCell>
                                            <TableCell className="text-center">{parseFloat(String(term.percentage)).toFixed(2)}%</TableCell>
                                            <TableCell className="text-right font-medium">{formatToIndianRupee(termAmount)}</TableCell>
                                          </TableRow>
                                         );
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              )}
                              
                              {!termsForVendor && (
                                 <div className="p-4 border-t bg-red-50 text-center text-sm text-red-600">
                                    Please add payment terms for this vendor.
                                 </div>
                              )}
                            </CardContent>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    }
                  )}
                </Accordion>

                {/* --- GRAND TOTAL SUMMARY --- */}
                 <div className="mt-4 pt-4 pb-2 px-4 border bg-white rounded-md shadow-sm border-gray-200 text-right">
                   <div className="flex flex-col gap-1 items-end">
                    <p className="text-sm font-medium text-gray-600">
                      Total (Excl. Tax):{" "}
                      <span className="font-semibold text-gray-900 ml-2">
                        {formatToRoundedIndianRupee(approvalOverallTotal)}
                      </span>
                    </p>
                    <div className="h-px w-1/4 bg-gray-200 my-1"></div>
                    <p className="text-lg font-bold text-gray-800">
                      Grand Total (Incl. GST):{" "}
                      <span className="text-xl text-green-700 ml-2">
                        {formatToRoundedIndianRupee(approvalOverallTotalInclGst)}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* --- ACTION BUTTONS --- */}
          <div className="flex flex-col justify-end items-end mr-2 my-4">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  className="flex items-center gap-1"
                  disabled={!allVendorsHaveTerms || update_loading}
                >
                  <ArrowBigUpDash className="" />
                  Send for Approval
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>
                    Have you cross-checked your selections?
                  </DialogTitle>
                  <DialogDescription>
                    {Object.keys(vendorWiseApprovalItems).length !== 0 && (
                      <div className="flex flex-col gap-2 mt-2 text-start">
                        <h4 className="font-bold">
                          Any remarks for the Project Lead?
                        </h4>
                        <TextArea
                          className="border-green-400 focus:border-green-800 bg-green-200"
                          placeholder="type here..."
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                        />
                      </div>
                    )}
                  </DialogDescription>
                </DialogHeader>
                <DialogDescription className="flex items-center justify-center gap-2">
                  {create_loading || update_loading ? (
                    <TailSpin width={60} color={"red"} />
                  ) : (
                    <>
                      <DialogClose>
                        <Button
                          variant="secondary"
                          className="flex items-center gap-1"
                        >
                          <Undo2 className="h-4 w-4" />
                          Cancel
                        </Button>
                      </DialogClose>
                      <Button
                        variant="default"
                        onClick={handleSubmit}
                        className="flex items-center gap-1"
                      >
                        <CheckCheck className="h-4 w-4" />
                        Confirm
                      </Button>
                    </>
                  )}
                </DialogDescription>
              </DialogContent>
            </Dialog>
            {!allVendorsHaveTerms && (
              <p className="text-xs text-red-500 mt-2">
                Please add payment terms for all vendors before proceeding.
              </p>
            )}
          </div>

          {/* --- EDIT PAYMENT TERMS MODAL --- */}
          {editingVendor && (
            <PaymentTermsDialog
              isOpen={!!editingVendor}
              onClose={() => setEditingVendor(null)}
              vendorName={editingVendor.name}
              poAmount={editingVendor.total}
              initialData={paymentTerms[editingVendor.id]}
              onConfirm={(data) =>
                handleConfirmPaymentTerms(editingVendor.id, data)
              }
            />
          )}
        </div>
      )}
    </>
  );
};

export default SBQuotesSelectionReview;

// import { ProcurementHeaderCard } from "@/components/helpers/ProcurementHeaderCard";
// import { Button } from "@/components/ui/button";
// import {
//   Dialog,
//   DialogClose,
//   DialogContent,
//   DialogDescription,
//   DialogHeader,
//   DialogTitle,
//   DialogTrigger,
// } from "@/components/ui/dialog";
// import { toast } from "@/components/ui/use-toast";
// import { useItemEstimate } from "@/hooks/useItemEstimate";
// import { useUserData } from "@/hooks/useUserData";
// import { ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests";
// import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
// import formatToIndianRupee, {
//   formatToRoundedIndianRupee,
// } from "@/utils/FormatPrice";
// import getLowestQuoteFilled from "@/utils/getLowestQuoteFilled";
// import { parseNumber } from "@/utils/parseNumber";
// import TextArea from "antd/es/input/TextArea";
// import {
//   useFrappeCreateDoc,
//   useFrappeDocumentEventListener,
//   useFrappeUpdateDoc,
//   useSWRConfig,
// } from "frappe-react-sdk";
// import memoize from "lodash/memoize";
// import {
//   ArrowBigUpDash,
//   CheckCheck,
//   ListChecks,
//   Undo2,
//   CirclePlus,
//     Pencil,
  
// } from "lucide-react";
// import React, { useCallback, useEffect, useMemo, useState } from "react";
// import { TailSpin } from "react-loader-spinner";
// import { useNavigate, useParams } from "react-router-dom";
// import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
// import { useSentBackCategory } from "@/hooks/useSentBackCategory";
// import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
// import { PaymentTermsDialog } from "../ProcurementRequests/VendorQuotesSelection/components/PaymentTermsDialog";
// import {
//   PaymentTermsData,
//   VendorPaymentTerm,
// } from "../ProcurementRequests/VendorQuotesSelection/types/paymentTerms";
// import { PaymentTermsDetailsDisplay } from "../ProcurementRequests/VendorQuotesSelection/components/PaymentTermsDetailsDisplay";
// import { getItemListFromDocument } from "../ProcurementRequests/VendorQuotesSelection/types";
// import { useTargetRatesForItems } from "../ProcurementRequests/VendorQuotesSelection/hooks/useTargetRatesForItems";

// interface DisplayItem extends ProcurementRequestItemDetail {
//   amount?: number; // Calculated amount based on quote
//   vendor_name?: string; // Added by getVendorName
//   lowestQuotedAmount?: number; // From getLowest
//   threeMonthsLowestAmount?: number; // From getItemEstimate (if used)
//   potentialLoss?: number;
//   targetRateValue?:number;

// }
// // Interface for the vendor-wise summary object
// interface VendorWiseApprovalItems {
//   [vendor: string]: {
//     // vendor here is vendor_id (DocName)
//     items: DisplayItem[];
//     total: number; // Total EXCLUDING GST
//     totalInclGst: number; // Total INCLUDING GST
//   };
// }

// export const SBQuotesSelectionReview: React.FC = () => {
//   const { sbId } = useParams<{ sbId: string }>();

//   if (!sbId) return <div>No Sent Back ID Provided</div>;
//   const navigate = useNavigate();
//   const userData = useUserData();

//   const { updateDoc: updateDoc, loading: update_loading } =
//     useFrappeUpdateDoc();
//   const { createDoc: createDoc, loading: create_loading } =
//     useFrappeCreateDoc();

//   const { mutate } = useSWRConfig();

//   const { getItemEstimate } = useItemEstimate();
//   const [comment, setComment] = useState<string>("");

//   const [orderData, setOrderData] = useState<SentBackCategory | undefined>();

//   // This function will only run ONCE when the component first mounts.
//   const [paymentTerms, setPaymentTerms] = useState<PaymentTermsData>(() => {
//     // Create a unique key for this specific Procurement Request.
//     const storageKey = `SBpaymentTermsDraft_${sbId}`;
//     try {
//       const savedData = localStorage.getItem(storageKey);
//       // If we find saved data, parse it and use it as the initial state.
//       if (savedData) {
//         return JSON.parse(savedData);
//       }
//     } catch (error) {
//       console.error("Failed to parse payment terms from local storage", error);
//     }
//     // If no data is found, or if there's an error, start with an empty object.
//     return {};
//   });
//   // --- ADD THIS ENTIRE useEffect HOOK ---
//   // This hook will run every time the `paymentTerms` state changes.
//   useEffect(() => {
//     // Don't save anything if the paymentTerms object is empty.
//     if (Object.keys(paymentTerms).length > 0) {
//       const storageKey = `SBpaymentTermsDraft_${sbId}`;
//       localStorage.setItem(storageKey, JSON.stringify(paymentTerms));
//     }
//   }, [paymentTerms, sbId]); // The dependency array ensures this runs only when needed.
//   // --- ADDED: State to control which vendor's payment terms are being edited ---

// //cleanUP of Pyament Local Storage

//     useEffect(() => {
//       // This function will be called when the component is about to unmount.
//       const cleanup = () => {
//         // Create the specific key for this PR's payment terms draft.
//         const storageKey = `SBpaymentTermsDraft_${sbId}`;
        
//         // Remove the item from localStorage.
//         localStorage.removeItem(storageKey);
        
//         console.log(`Cleaned up payment terms for SBPR: ${sbId}`);
//       };
  
//       // React calls the returned function when the component unmounts.
//       return cleanup;
  
//     }, [sbId]);
     
//   const [editingVendor, setEditingVendor] = useState<{
//     id: string;
//     name: string;
//     total: number;
//   } | null>(null);

//   const {
//     data: sent_back,
//     isLoading: sent_back_loading,
//     mutate: sent_back_mutate,
//   } = useSentBackCategory(sbId);

//   useFrappeDocumentEventListener(
//     "Sent Back Category",
//     sbId,
//     (event) => {
//       console.log("Sent Back document updated (real-time):", event);
//       toast({
//         title: "Document Updated",
//         description: `Sent Back ${event.name} has been modified.`,
//       });
//       sent_back_mutate(); // Re-fetch this specific document
//     },
//     true // emitOpenCloseEventsOnMount (default)
//   );

//   const { data: vendor_list, isLoading: vendor_list_loading } = useVendorsList({
//     vendorTypes: ["Material", "Material & Service"],
//   });

// //   useEffect(() => {
// //     if (sent_back) {
// //       const items =
// //         sent_back.order_list && Array.isArray(sent_back.order_list)
// //           ? sent_back.order_list
// //           : [];
// //       setOrderData({ ...sent_back, order_list: items });
// //     }
// //   }, [sent_back]);

// useEffect(() => {
//   if (sent_back) {
//     // Start with a deep copy to avoid mutating server data
//     const newOrderData = JSON.parse(JSON.stringify(sent_back));

//     // 1. Normalize the item list to prevent errors
//     if (!Array.isArray(newOrderData.order_list)) {
//       newOrderData.order_list = [];
//     }

//     // 2. THIS IS THE CRITICAL FIX: Parse rfq_data if it's a string
//     if (typeof newOrderData.rfq_data === 'string' && newOrderData.rfq_data) {
//       try {
//         newOrderData.rfq_data = JSON.parse(newOrderData.rfq_data);
//       } catch (e) {
//         console.error("Failed to parse rfq_data JSON in VendorsSelectionSummary:", e);
//         newOrderData.rfq_data = { selectedVendors: [], details: {} };
//       }
//     }

//     // 3. Ensure rfq_data is a valid object if it was null, undefined, or an empty string
//     if (!newOrderData.rfq_data) {
//       newOrderData.rfq_data = { selectedVendors: [], details: {} };
//     }

//     // 4. Set the fully normalized document as our component's working state.
//     setOrderData(newOrderData);
//   }
// }, [sent_back]);


//   const getVendorName = useMemo(
//     () => (vendorId: string | undefined) => {
//       return (
//         vendor_list?.find((vendor) => vendor?.name === vendorId)?.vendor_name ||
//         ""
//       );
//     },
//     [vendor_list]
//   );


// const getLowest = useMemo(
//   () =>
//     memoize(
//       (itemId: string): number => {
//         // Guard clause: Ensure the path to the quotes exists in our data.
//         if (!orderData?.rfq_data?.details?.[itemId]?.vendorQuotes) {
//           // Return a very large number so Math.min will ignore it.
//           return Infinity;
//         }

//         // Get the object containing all vendor quotes for this specific item.
//         // e.g., { "V-001": { quote: "100" }, "V-002": { quote: "95" } }
//         const allQuotesForItem = orderData.rfq_data.details[itemId].vendorQuotes;

//         // 1. Get all quote values from the object.
//         // 2. Convert them from strings to numbers.
//         // 3. Filter out any non-positive values (e.g., 0, null, empty strings that become NaN).
//         const numericQuotes = Object.values(allQuotesForItem)
//           .map((vendorQuote: any) => parseNumber(vendorQuote.quote))
//           .filter(q => q > 0);

//         // If after filtering, there are no valid quotes, return Infinity.
//         if (numericQuotes.length === 0) {
//           return Infinity;
//         }
        
//         // Return the lowest number from the array of valid quotes.
//         return Math.min(...numericQuotes);
//       },
//       // THIS IS THE CORRECTED MEMOIZATION KEY:
//       // It depends on the itemID and the *entire* rfq_data object.
//       // If any quote changes anywhere, the cache will be correctly busted.
//       (itemId: string) => `${itemId}-${JSON.stringify(orderData?.rfq_data)}`
//     ),
//   [orderData] // The function is only recreated if `orderData` itself changes.
// );
 

//   // --- ADD THIS ENTIRE NEW FUNCTION ---
//   const savePaymentTerms = async (): Promise<boolean> => {
//     // This function will attempt to save the payment terms and return true on success or false on failure.

//     // 1. Prepare the data payload, just like before.

//     const paymentTermsJsonString = JSON.stringify({ list: paymentTerms });

//     // 2. Use a try/catch block to handle potential errors from the API call.
//     try {
//       console.log("Saving payment terms to :", sbId);
//       console.log("Data for SB Payments_terms", paymentTermsJsonString);

//       await updateDoc("Sent Back Category", sbId, {
//         payment_terms: paymentTermsJsonString,
//       });

//       // 4. Show a success message to the user.
//       toast({
//         title: "SB Payment Terms Saved",
//         description:
//           "Payment terms have been successfully saved to the Sent Back Category.",
//         variant: "success",
//       });

//       localStorage.removeItem(`SBpaymentTermsDraft_${sbId}`);

//       // 5. Return true to indicate success.
//       return true;
//     } catch (error) {
//       console.error("Failed to save payment terms:", error);
//       toast({
//         title: "Error Saving Terms",
//         description: "Could not save the SB payment terms. Please try again.",
//         variant: "destructive",
//       });

//       // 6. Return false to indicate failure.
//       return false;
//     }
//   };
//   const handleConfirmPaymentTerms = (
//     vendorId: string,
//     data: VendorPaymentTerm
//   ) => {
//     setPaymentTerms((prev) => ({
//       ...prev,
//       [vendorId]: data,
//     }));
//     setEditingVendor(null); // Close the dialog
//   };

//   const handleSubmit = async () => {
//     try {
//       // --- ADDED: Transform the paymentTerms state into an array for the API payload ---
//       const termsSavedSuccessfully = await savePaymentTerms();

//       // --- Step 2: Check if the save was successful. If not, stop here. ---
//       if (!termsSavedSuccessfully) {
//         // The error toast is already shown inside savePaymentTerms, so we just exit.
//         return;
//       }

//       await updateDoc("Sent Back Category", sbId, {
//         workflow_state: "Vendor Selected",
//       });

//       if (comment) {
//         await createDoc("Nirmaan Comments", {
//           comment_type: "Comment",
//           reference_doctype: "Sent Back Category",
//           reference_name: sbId,
//           comment_by: userData?.user_id,
//           content: comment,
//           subject: "sb vendors selected",
//         });
//       }

//       toast({
//         title: "Success!",
//         description: `Sent Back: ${sbId} sent for Approval!`,
//         variant: "success",
//       });

//       await mutate(`${orderData?.type} Sent Back Category`);

//       navigate(`/procurement-requests?tab=${orderData?.type}`);
      
//     } catch (error) {
//       toast({
//         title: "Failed!",
//         description: `Failed to send Sent Back: ${sbId} for Approval.`,
//         variant: "destructive",
//       });
//       console.log("submit_error", error);
//     }
//   };


  
//      const itemIdsToFetch = useMemo(
//       () => getItemListFromDocument(orderData).map(item => item.item_id).filter(Boolean),
//       [orderData]
//     );
  
//     // console.log("itemIdsToFetch", itemIdsToFetch)
//     const {targetRatesDataMap } = useTargetRatesForItems(itemIdsToFetch, sbId);
  

// //   const generateActionSummary = useCallback(() => {
// //     let allDelayedItems: DisplayItem[] = [];
// //     let vendorWiseApprovalItems: VendorWiseApprovalItems = {};

// //     let approvalOverallTotalExclGst: number = 0;
// //     let approvalOverallTotalInclGst: number = 0;
// //     let delayedItemsTotalExclGst: number = 0;
// //     let delayedItemsTotalInclGst: number = 0;

// //     orderData?.order_list.forEach((item: ProcurementRequestItemDetail) => {
// //       const vendor = item?.vendor;
// //       const quote = parseNumber(item.quote);
// //       const quantity = parseNumber(item.quantity);
// //       const taxRate = parseNumber(item.tax) / 100; // e.g., 18 -> 0.18

// //       const baseItemTotal = quantity * quote;
// //       const itemTotalInclGst = baseItemTotal * (1 + taxRate);

// //       if (!vendor || !quote) {
// //         allDelayedItems.push(item);
// //         delayedItemsTotalExclGst += baseItemTotal;
// //         delayedItemsTotalInclGst += itemTotalInclGst;
// //       } else {
// //         const targetRate = getItemEstimate(item?.item_id)?.averageRate;
// //         const lowestItemPrice = targetRate
// //           ? targetRate * 0.98
// //           : getLowest(item?.item_id);

// //         if (!vendorWiseApprovalItems[vendor]) {
// //           vendorWiseApprovalItems[vendor] = {
// //             items: [],
// //             total: 0,
// //             totalInclGst: 0,
// //           };
// //         }

// //         const displayItem: DisplayItem = { ...item, amount: itemTotalInclGst };

// //         if (lowestItemPrice && lowestItemPrice < quote) {
// //           displayItem.potentialLoss =
// //             baseItemTotal - quantity * lowestItemPrice;
// //         }

// //         vendorWiseApprovalItems[vendor].items.push(displayItem);
// //         vendorWiseApprovalItems[vendor].total += baseItemTotal;
// //         vendorWiseApprovalItems[vendor].totalInclGst += itemTotalInclGst;

// //         approvalOverallTotalExclGst += baseItemTotal;
// //         approvalOverallTotalInclGst += itemTotalInclGst;
// //       }
// //     });

// //     return {
// //       allDelayedItems,
// //       vendorWiseApprovalItems,
// //       approvalOverallTotal: approvalOverallTotalExclGst,
// //       approvalOverallTotalInclGst,
// //       delayedItemsTotalInclGst,
// //     };
// //   }, [orderData, getLowest, getItemEstimate]);

// const generateActionSummary = useCallback(() => {
//   let allDelayedItems: DisplayItem[] = [];
//   let vendorWiseApprovalItems: VendorWiseApprovalItems = {};

//   let approvalOverallTotalExclGst: number = 0;
//   let approvalOverallTotalInclGst: number = 0;
//   let delayedItemsTotalExclGst: number = 0;
//   let delayedItemsTotalInclGst: number = 0;

//   orderData?.order_list.forEach((item: ProcurementRequestItemDetail) => {
//     const vendor = item?.vendor;
//     const quote = parseNumber(item.quote);
//     const quantity = parseNumber(item.quantity);
//     const taxRate = parseNumber(item.tax) / 100;

//     const baseItemTotal = quantity * quote;
//     const itemTotalInclGst = baseItemTotal * (1 + taxRate);

//     if (!vendor || !quote) {
//       allDelayedItems.push(item);
//       delayedItemsTotalExclGst += baseItemTotal;
//       delayedItemsTotalInclGst += itemTotalInclGst;
//     } else {
//       // --- THIS IS THE CORE LOGIC UPDATE ---

//       // 1. Calculate the targetRateValue exactly as done in the previous screen.
//       const targetRateDetail = targetRatesDataMap?.get(item.item_id);
//       // console.log("targetRateDetail",targetRateDetail)

//       let calculatedTargetRate = -1; // Use -1 as a 'not found' value
//       if (targetRateDetail?.rate && targetRateDetail.rate !== "-1") {
//           const parsedRate = parseNumber(targetRateDetail.rate);
//           if (!isNaN(parsedRate)) {
//               calculatedTargetRate = parsedRate * 0.98; // The 98% logic
//           }
//       }

//       // 2. Determine the benchmark for potential loss calculation.
//       // const lowestItemPrice = calculatedTargetRate > 0
//       //   ? calculatedTargetRate
//       //   : getLowest(item.item_id);
//         const lowestItemPrice = calculatedTargetRate > 0
//         && Math.min(calculatedTargetRate
//         , getLowest(item.item_id));

//       if (!vendorWiseApprovalItems[vendor]) {
//         vendorWiseApprovalItems[vendor] = {
//           items: [],
//           total: 0,
//           totalInclGst: 0,
//         };
//       }

//       // 3. Create the displayItem and add our new `targetRateValue` to it.
//       const displayItem: DisplayItem = {
//         ...item,
//         amount: itemTotalInclGst,
//         targetRateValue: lowestItemPrice, // Store the calculated value
//       };

//       // 4. Calculate potential loss using the benchmark.
//       if (lowestItemPrice && lowestItemPrice < quote) {
//         displayItem.potentialLoss = baseItemTotal - quantity * lowestItemPrice;
//       }

//       vendorWiseApprovalItems[vendor].items.push(displayItem);
//       vendorWiseApprovalItems[vendor].total += baseItemTotal;
//       vendorWiseApprovalItems[vendor].totalInclGst += itemTotalInclGst;

//       approvalOverallTotalExclGst += baseItemTotal;
//       approvalOverallTotalInclGst += itemTotalInclGst;
//     }
//   });

//   return {
//     allDelayedItems,
//     vendorWiseApprovalItems,
//     approvalOverallTotal: approvalOverallTotalExclGst,
//     approvalOverallTotalInclGst,
//     delayedItemsTotalInclGst,
//   };
// }, [orderData, getLowest, getItemEstimate, targetRatesDataMap]);
//   const {
//     allDelayedItems,
//     vendorWiseApprovalItems,
//     approvalOverallTotal,
//     approvalOverallTotalInclGst,
//     delayedItemsTotalInclGst,
//   } = useMemo(() => generateActionSummary(), [generateActionSummary]);

//   // =========================================
//   // --- SECTION E: NEW VALIDATION LOGIC ---
//   // =========================================
//   const allVendorsHaveTerms = useMemo(() => {
//     const approvalVendorIds = Object.keys(vendorWiseApprovalItems);
//     if (approvalVendorIds.length === 0) return true; // No vendors to set terms for
//     return approvalVendorIds.every((id) => !!paymentTerms[id]);
//   }, [vendorWiseApprovalItems, paymentTerms]);

//   if (sent_back_loading || vendor_list_loading) return <LoadingFallback />;

//   // console.log("orderData", orderData);
//   // console.log("vendorWiseApprovalItems", vendorWiseApprovalItems); // this is empty why

//   if (orderData?.workflow_state !== "Pending") {
//     return (
//       <div className="flex items-center justify-center h-[90vh]">
//         <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
//           <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
//           <p className="text-gray-600 text-lg">
//             Hey there, the PR:{" "}
//             <span className="font-medium text-gray-900">{orderData?.name}</span>{" "}
//             is no longer available in the{" "}
//             <span className="italic">In Progress</span> state. The current state
//             is{" "}
//             <span className="font-semibold text-blue-600">
//               {orderData?.workflow_state}
//             </span>{" "}
//             And the last modification was done by{" "}
//             <span className="font-medium text-gray-900">
//               {orderData?.modified_by === "Administrator"
//                 && orderData?.modified_by
//               }
//             </span>
//             !
//           </p>
//           <button
//             className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
//             onClick={() => navigate("/procurement-requests")}
//           >
//             Go Back to PR List
//           </button>
//         </div>
//       </div>
//     );
//   }
//   return (
//     <>
//       {orderData && (
//         <div className="flex-1 space-y-4">
//           <div className="flex items-center">
//             <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">
//               Comparison
//             </h2>
//           </div>
//           <ProcurementHeaderCard orderData={orderData} sentBack />
//           <div className="flex flex-col gap-4">
//             {/* Approval Items Summary */}
//             {Object.keys(vendorWiseApprovalItems).length > 0 && (
//               <div className="p-6 rounded-lg bg-green-50 border border-green-200">
//                 {" "}
//                 {/* Changed background, removed opacity, added border */}
//                 <div className="flex items-center mb-2">
//                   <ListChecks className="h-5 w-5 mr-2 text-green-600" />
//                   <h3 className="text-lg font-semibold text-gray-800">
//                     Items for Approval
//                   </h3>{" "}
//                   {/* Slightly bolder heading */}
//                 </div>
//                 <p className="text-sm text-gray-600 mb-4">
//                   {" "}
//                   {/* Adjusted text color and margin */}
//                   These items have been assigned to vendors and require project
//                   lead approval.
//                 </p>
//                 {/* Using a definition list style for vendors for better structure */}
//                 <dl className="space-y-4">
//                   {Object.entries(vendorWiseApprovalItems).map(
//                     ([vendor, { items, total, totalInclGst }]) => {
//                       const termsForVendor = paymentTerms[vendor];

//                       return (
//                         <div
//                           key={vendor}
//                           className="border-t border-green-200 pt-4"
//                         >
//                           <dt className="flex justify-between items-center text-sm border-b border-grey-200 font-medium pb-2">
//                             <p>
//                               Vendor:{" "}
//                               <span className="font-semibold text-red-600">
//                                 {getVendorName(vendor)}
//                               </span>
//                             </p>

//                             <div>
//                               {termsForVendor ? (
//                                 // --- If terms exist, show the summary and an Edit button ---
//                                 <div className="flex items-center gap-2">
//                                   <RenderPaymentTermsSummary
//                                     terms={termsForVendor}
//                                   />
//                                   <Button
//                                     variant="outline"
//                                 size="sm"
//                                  className="text-primary border-primary justify-start hover:text-white hover:bg-red-600"
//                                     onClick={() =>
//                                       setEditingVendor({
//                                         id: vendor,
//                                         name: getVendorName(vendor),
//                                         total: totalInclGst,
//                                       })
//                                     }
//                                   >
//                                     <Pencil className="mr-2 h-4 w-4 flex-shrink-0" />{" "}
//                                     Edit
//                                   </Button>
//                                 </div>
//                               ) : (
//                                 // --- If terms don't exist, show the "Add Payment Terms" button ---
//                                 <Button
//                                   variant="outline"
//                                   size="sm"
//                                   className="text-primary border-primary justify-start hover:text-white hover:bg-red-600"
//                                   onClick={() =>
//                                     setEditingVendor({
//                                       id: vendor,
//                                       name: getVendorName(vendor),
//                                       total: totalInclGst,
//                                     })
//                                   }
//                                 >
//                                   <CirclePlus className="mr-2 h-4 w-4 flex-shrink-0" />{" "}
//                                   Add Payment Terms
//                                 </Button>
//                               )}
//                             </div>
//                           </dt>
//                           {/* // Payment Terms xAnd REPLACE IT with this: */}
//                           <dd className="mt-1 pl-5">
//                             {/* This is the existing list of products. It stays the same. */}
//                             <ul className="list-disc space-y-1 text-gray-800">
//                               {items.map((item) => (
//                                 <li key={item.item_id} className="text-sm">
//                                   {item.item_name}
//                                   {item.make && (
//                                     <span className="text-gray-500 italic ml-1">
//                                       ({item.make})
//                                     </span>
//                                   )}
//                                   <span className="mx-1">-</span>{" "}
//                                   {item.quantity} x{" "}
//                                   {formatToIndianRupee(item.quote)}
//                                   <span className="mx-1 text-gray-500">
//                                     +
//                                   </span>{" "}
//                                   {item.tax}% GST
//                                   <span className="mx-1">=</span>{" "}
//                                   <span className="font-medium">
//                                     {formatToIndianRupee(item.amount)}
//                                   </span>
//                                   {item?.potentialLoss && (
//                                     <span className="block text-xs text-red-600 mt-0.5">
//                                       Potential Loss:{" "}
//                                       {formatToIndianRupee(item.potentialLoss)}
//                                     </span>
//                                   )}
//                                 </li>
//                               ))}
//                             </ul>

//                             {/*
//       --- THIS IS THE NEWLY ADDED LOGIC ---
//       This block checks if payment terms have been set for the current vendor.
//       If they have, it renders our new display component.
//     */}
//                             {(() => {
//                               // 1. Get the payment terms for the *current* vendor in the loop.
//                               const termsForThisVendor = paymentTerms[vendor];

//                               // 2. If terms exist for this vendor...
//                               if (termsForThisVendor) {
//                                 // 3. ...render our new display component, passing the terms data as a prop.
//                                 return (
//                                   <PaymentTermsDetailsDisplay
//                                     terms={termsForThisVendor}
//                                   />
//                                 );
//                               }

//                               // 4. Otherwise, render nothing.
//                               return null;
//                             })()}

//                             {/* This is the existing subtotal display. It stays the same. */}
//                             <div className="mt-2 text-right text-sm font-medium text-gray-800">
//                               <p>
//                                 Subtotal:{" "}
//                                 <span className="font-semibold">
//                                   {formatToIndianRupee(total)}
//                                 </span>
//                               </p>
//                               <p>
//                                 Subtotal (inc. GST):{" "}
//                                 <span className="font-semibold text-green-700">
//                                   {formatToIndianRupee(totalInclGst)}
//                                 </span>
//                               </p>
//                             </div>
//                           </dd>
//                         </div>
//                       );
//                     }
//                   )}
//                 </dl>
//                 <div className="mt-4 pt-4 border-t border-green-200 text-right">
//                   <p className="text-sm font-medium text-gray-800">
//                     Approval Grand Total:{" "}
//                     <span className="font-semibold">
//                       {formatToRoundedIndianRupee(approvalOverallTotal)}
//                     </span>
//                   </p>
//                   <p className="text-sm font-medium text-gray-800">
//                     Approval Grand Total (inc. GST):{" "}
//                     <span className="text-base font-semibold text-green-700">
//                       {formatToRoundedIndianRupee(approvalOverallTotalInclGst)}
//                     </span>
//                   </p>
//                 </div>
//               </div>
//             )}
//             {/* Delayed Items Summary */}
//             {/* {allDelayedItems.length > 0 && (
//                       <div className="p-6 rounded-lg bg-red-50 border border-red-200 space-y-2">
//                         <div className="flex items-center mb-2">
//                           <SendToBack className="h-5 w-5 text-red-600 mr-2" />
//                           <h3 className="text-lg font-semibold text-gray-800">
//                             Delayed Items
//                           </h3>
//                         </div>
//                         <p className="text-sm text-gray-600">
//                           These items will be moved to a new 'Delayed Sent Back' list:
//                         </p>
//                         <ul className="list-disc space-y-1 pl-5 text-gray-800">
//                           {allDelayedItems.map((item) => (
//                             <li key={item.item_id} className="text-sm">
//                               {item.item_name}
//                               {item.make && (
//                                 <span className="text-gray-500 italic ml-1">
//                                   ({item.make})
//                                 </span>
//                               )}
//                               <span className="mx-1">-</span>
//                               {item.quantity} {item.unit}
//                             </li>
//                           ))}
//                         </ul>
//                         {delayedItemsTotalInclGst > 0 && (
//                           <div className="mt-4 pt-4 border-t border-red-200 text-right">
//                             <p className="text-sm font-medium text-gray-800">
//                               Estimated Delayed Total (inc. GST):
//                               <span className="text-base font-semibold text-red-700">
//                                 {" "}
//                                 {formatToRoundedIndianRupee(delayedItemsTotalInclGst)}
//                               </span>
//                             </p>
//                             <p className="text-xs text-gray-500 italic">
//                               (Based on last entered quotes)
//                             </p>
//                           </div>
//                         )}
//                       </div>
//                     )} */}
//           </div>

//           <div className="flex flex-col justify-end items-end mr-2 my-4">
//             <Dialog>
//               <DialogTrigger asChild>
//                 <Button
//                   className="flex items-center gap-1"
//                   disabled={!allVendorsHaveTerms || update_loading}
//                 >
//                   <ArrowBigUpDash className="" />
//                   Send for Approval
//                 </Button>
//               </DialogTrigger>
//               <DialogContent className="sm:max-w-[425px]">
//                 <DialogHeader>
//                   <DialogTitle>
//                     Have you cross-checked your selections?
//                   </DialogTitle>
//                   <DialogDescription>
//                     {Object.keys(vendorWiseApprovalItems).length !== 0 && (
//                       <div className="flex flex-col gap-2 mt-2 text-start">
//                         <h4 className="font-bold">
//                           Any remarks for the Project Lead?
//                         </h4>
//                         <TextArea
//                           className="border-green-400 focus:border-green-800 bg-green-200"
//                           placeholder="type here..."
//                           value={comment}
//                           onChange={(e) => setComment(e.target.value)}
//                         />
//                       </div>
//                     )}
//                   </DialogDescription>
//                 </DialogHeader>
//                 <DialogDescription className="flex items-center justify-center gap-2">
//                   {create_loading || update_loading ? (
//                     <TailSpin width={60} color={"red"} />
//                   ) : (
//                     <>
//                       <DialogClose>
//                         <Button
//                           variant="secondary"
//                           className="flex items-center gap-1"
//                         >
//                           <Undo2 className="h-4 w-4" />
//                           Cancel
//                         </Button>
//                       </DialogClose>
//                       <Button
//                         variant="default"
//                         onClick={handleSubmit}
//                         className="flex items-center gap-1"
//                       >
//                         <CheckCheck className="h-4 w-4" />
//                         Confirm
//                       </Button>
//                     </>
//                   )}
//                 </DialogDescription>
//               </DialogContent>
//             </Dialog>
//             {/* --- ADDED: Validation error message --- */}
//             {!allVendorsHaveTerms && (
//               <p className="text-xs text-red-500 mt-2">
//                 Please add payment terms for all vendors before proceeding.
//               </p>
//             )}
//           </div>
//           {editingVendor && (
//             <PaymentTermsDialog
//               isOpen={!!editingVendor}
//               onClose={() => setEditingVendor(null)}
//               vendorName={editingVendor.name}
//               poAmount={editingVendor.total}
//               initialData={paymentTerms[editingVendor.id]}
//               onConfirm={(data) =>
//                 handleConfirmPaymentTerms(editingVendor.id, data)
//               }
//             />
//           )}
//         </div>
//       )}
//     </>
//   );
// };

// // This component is now smarter to handle the detailed milestone data.
// const RenderPaymentTermsSummary: React.FC<{ terms: VendorPaymentTerm }> = ({
//   terms,
// }) => {
//   // If for some reason terms are missing, show a fallback.
//   if (!terms.terms || terms.terms.length === 0) {
//     return (
//       <span className="text-xs font-normal text-gray-600">{terms.type}</span>
//     );
//   }

//   // Show the breakdown of milestones
//   return (
//     <div className="flex items-center gap-2 text-xs font-normal text-gray-600">
//       <span className="font-medium">{terms.type}:</span>
//       {terms.terms.map((milestone, index) => (
//         <React.Fragment key={milestone.id}>
//           <span>
//             {/* Display the name if it's not a generic default like "1st Payment" */}
//             {/* {milestone.name && !milestone.name.match(/^\d+(st|nd|rd|th) Payment$/i) ? `${milestone.name}: ` : ''} */}
//             <strong>{milestone.percentage.toFixed(0)}%</strong>
//           </span>
//           {/* Add a separator between milestones */}
//           {index < terms.terms.length - 1 && (
//             <span className="text-gray-300">|</span>
//           )}
//         </React.Fragment>
//       ))}
//     </div>
//   );
// };

// export default SBQuotesSelectionReview;
