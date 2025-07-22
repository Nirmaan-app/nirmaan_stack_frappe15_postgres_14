import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useItemEstimate } from "@/hooks/useItemEstimate";
import {
  ProcurementRequest,
  ProcurementRequestItemDetail,
} from "@/types/NirmaanStack/ProcurementRequests";
import formatToIndianRupee, {
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import getLowestQuoteFilled from "@/utils/getLowestQuoteFilled";
import { parseNumber } from "@/utils/parseNumber";
import TextArea from "antd/es/input/TextArea";
import {
  useFrappeDocumentEventListener,
  useFrappePostCall,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import memoize from "lodash/memoize";
import {
  ArrowBigUpDash,
  CheckCheck,
  ListChecks,
  SendToBack,
  Undo2,
  CirclePlus,
  Pencil,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { ProcurementHeaderCard } from "../../../components/helpers/ProcurementHeaderCard";
import { Button } from "../../../components/ui/button";
import { toast } from "../../../components/ui/use-toast";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useVendorsList } from "./hooks/useVendorsList";
import { useUsersList } from "../ApproveNewPR/hooks/useUsersList";
import { useProcurementRequest } from "@/hooks/useProcurementRequest";

// --- ADDED: New component and type imports for the payment terms feature ---
import { PaymentTermsDialog } from "./components/PaymentTermsDialog";
import { PaymentTermsData, VendorPaymentTerm } from "./types/paymentTerms";
import { PaymentTermsDetailsDisplay } from "./components/PaymentTermsDetailsDisplay";
//target value 
import { getItemListFromDocument } from "./types";
import {getCategoryListFromDocument} from "./types";
import { useTargetRatesForItems } from "./hooks/useTargetRatesForItems";

// Interface for items with calculated properties for display
interface DisplayItem extends ProcurementRequestItemDetail {
  amount?: number; // Calculated amount including GST
  vendor_name?: string;
  lowestQuotedAmount?: number;
  threeMonthsLowestAmount?: number;
  potentialLoss?: number;
  targetRateValue?:number;
}

// Interface for the vendor-wise summary object
interface VendorWiseApprovalItems {
  [vendor: string]: {
    // vendor here is vendor_id (DocName)
    items: DisplayItem[];
    total: number; // Total EXCLUDING GST
    totalInclGst: number; // Total INCLUDING GST
  };
}

export const VendorsSelectionSummary: React.FC = () => {
  const { prId } = useParams<{ prId: string }>();

  if (!prId) {
    return (
      <div className="flex items-center justify-center h-[90vh]">
        Error: PR ID is missing.
      </div>
    );
  }
  const navigate = useNavigate();
  const [comment, setComment] = useState<{
    approving: string;
    delaying: string;
  }>({ approving: "", delaying: "" });

  const { call: sendForApprCall, loading: sendForApprCallLoading } =
    useFrappePostCall(
      "nirmaan_stack.api.send_vendor_quotes.handle_delayed_items"
    );

  // --- ADD THIS LINE ---
  const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

  const [orderData, setOrderData] = useState<ProcurementRequest | null>(null);


  ///Target value get
 
  // This function will only run ONCE when the component first mounts.
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermsData>(() => {
    // Create a unique key for this specific Procurement Request.
    const storageKey = `paymentTermsDraft_${prId}`;
    try {
      const savedData = localStorage.getItem(storageKey);
      // If we find saved data, parse it and use it as the initial state.
      if (savedData) {
        return JSON.parse(savedData);
      }
    } catch (error) {
      console.error("Failed to parse payment terms from local storage", error);
    }
    // If no data is found, or if there's an error, start with an empty object.
    return {};
  });

  // --- ADD THIS ENTIRE useEffect HOOK ---
  // This hook will run every time the `paymentTerms` state changes.
  useEffect(() => {
    // Don't save anything if the paymentTerms object is empty.
    if (Object.keys(paymentTerms).length > 0) {
      const storageKey = `paymentTermsDraft_${prId}`;
      localStorage.setItem(storageKey, JSON.stringify(paymentTerms));
    }
  }, [paymentTerms, prId]); // The dependency array ensures this runs only when needed.
  // --- ADDED: State to control which vendor's payment terms are being edited ---

  const [editingVendor, setEditingVendor] = useState<{
    id: string;
    name: string;
    total: number;
  } | null>(null);

  const { getItemEstimate } = useItemEstimate();

  const {
    data: procurement_request,
    isLoading: procurement_request_loading,
    mutate: pr_mutate,
  } = useProcurementRequest(prId);

  useFrappeDocumentEventListener(
    "Procurement Requests",
    prId,
    (event) => {
      console.log("Procurement Request document updated (real-time):", event?.name);
      toast({
        title: "Document Updated",
        description: `Procurement Request ${event.name} has been modified.`,
      });
      pr_mutate(); // Re-fetch this specific document
    },
    true
  );

  const { data: usersList, isLoading: usersListLoading } = useUsersList();

  const { allVendors: vendor_list, isLoading: vendor_list_loading } =
    useVendorsList({ vendorTypes: ["Material", "Material & Service"] });

  const getFullName = useMemo(
    () => (id: string | undefined) => {
      return usersList?.find((user) => user?.name == id)?.full_name || "";
    },
    [usersList]
  );


  
 
useEffect(() => {
  if (procurement_request) {
    // Start with a deep copy to avoid mutating server data
    const newOrderData = JSON.parse(JSON.stringify(procurement_request));

    // 1. Normalize the item list to prevent errors
    if (!Array.isArray(newOrderData.order_list)) {
      newOrderData.order_list = [];
    }

    // 2. THIS IS THE CRITICAL FIX: Parse rfq_data if it's a string
    if (typeof newOrderData.rfq_data === 'string' && newOrderData.rfq_data) {
      try {
        newOrderData.rfq_data = JSON.parse(newOrderData.rfq_data);
      } catch (e) {
        console.error("Failed to parse rfq_data JSON in VendorsSelectionSummary:", e);
        newOrderData.rfq_data = { selectedVendors: [], details: {} };
      }
    }

    // 3. Ensure rfq_data is a valid object if it was null, undefined, or an empty string
    if (!newOrderData.rfq_data) {
      newOrderData.rfq_data = { selectedVendors: [], details: {} };
    }

    // 4. Set the fully normalized document as our component's working state.
    setOrderData(newOrderData);
  }
}, [procurement_request]);



  const getVendorName = useMemo(
    () =>
      (vendorId: string | undefined): string => {
        return (
          vendor_list?.find((v) => v?.name === vendorId)?.vendor_name || ""
        );
      },
    [vendor_list]
  );



const getLowest = useMemo(
  () =>
    memoize(
      (itemId: string): number => {
        // Guard clause: Ensure the path to the quotes exists in our data.
        if (!orderData?.rfq_data?.details?.[itemId]?.vendorQuotes) {
          // Return a very large number so Math.min will ignore it.
          return Infinity;
        }

        // Get the object containing all vendor quotes for this specific item.
        // e.g., { "V-001": { quote: "100" }, "V-002": { quote: "95" } }
        const allQuotesForItem = orderData.rfq_data.details[itemId].vendorQuotes;

        // 1. Get all quote values from the object.
        // 2. Convert them from strings to numbers.
        // 3. Filter out any non-positive values (e.g., 0, null, empty strings that become NaN).
        const numericQuotes = Object.values(allQuotesForItem)
          .map((vendorQuote: any) => parseNumber(vendorQuote.quote))
          .filter(q => q > 0);

        // If after filtering, there are no valid quotes, return Infinity.
        if (numericQuotes.length === 0) {
          return Infinity;
        }
        
        // Return the lowest number from the array of valid quotes.
        return Math.min(...numericQuotes);
      },
      // THIS IS THE CORRECTED MEMOIZATION KEY:
      // It depends on the itemID and the *entire* rfq_data object.
      // If any quote changes anywhere, the cache will be correctly busted.
      (itemId: string) => `${itemId}-${JSON.stringify(orderData?.rfq_data)}`
    ),
  [orderData] // The function is only recreated if `orderData` itself changes.
);
 

  // --- ADD THIS ENTIRE NEW FUNCTION ---
  const savePaymentTerms = async (): Promise<boolean> => {
    // This function will attempt to save the payment terms and return true on success or false on failure.

    // 1. Prepare the data payload, just like before.

    const paymentTermsJsonString = JSON.stringify({ list: paymentTerms });

    // 2. Use a try/catch block to handle potential errors from the API call.
    try {
      // console.log("Saving payment terms to PR:", prId);
      // console.log("Data for Payments_terms", paymentTermsJsonString);

      await updateDoc("Procurement Requests", prId, {
        payment_terms: paymentTermsJsonString,
      });

      // 4. Show a success message to the user.
      pr_mutate()
      toast({
        title: "Payment Terms Saved",
        description:
          "Payment terms have been successfully saved to the Procurement Request.",
        variant: "success",
      });

      localStorage.removeItem(`paymentTermsDraft_${prId}`);

      // 5. Return true to indicate success.
      return true;
    } catch (error) {
      console.error("Failed to save payment terms:", error);
      toast({
        title: "Error Saving Terms",
        description: "Could not save the payment terms. Please try again.",
        variant: "destructive",
      });

      // 6. Return false to indicate failure.
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
    setEditingVendor(null); // Close the dialog
  };

  const handleSubmit = async () => {
    try {
      // --- ADDED: Transform the paymentTerms state into an array for the API payload ---
      const termsSavedSuccessfully = await savePaymentTerms();

      // --- Step 2: Check if the save was successful. If not, stop here. ---
      if (!termsSavedSuccessfully) {
        // The error toast is already shown inside savePaymentTerms, so we just exit.
        return;
      }

      const response = await sendForApprCall({
        pr_id: orderData?.name,
        comments: comment,
        //payment_terms: JSON.stringify(paymentTermsForApi) // Send as a JSON string
      });

      if (response.message.status === 200) {
        toast({
          title: "Success!",
          description: response.message.message,
          variant: "success",
        });

        await pr_mutate();

        navigate(`/procurement-requests?tab=New PR Request`);
      } else if (response.message.status === 400) {
        toast({
          title: "Failed!",
          description: response.message.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error approving vendor:", error);
      toast({
        title: "Failed!",
        description: "Error while Sending vendor quotes for approval!",
        variant: "destructive",
      });
    }
  };
 


   const itemIdsToFetch = useMemo(
    () => getItemListFromDocument(orderData).map(item => item.item_id).filter(Boolean),
    [orderData]
  );

  // console.log("itemIdsToFetch", itemIdsToFetch)
  const {targetRatesDataMap } = useTargetRatesForItems(itemIdsToFetch, prId);

  // console.log(targetRatesDataMap)

// --- REPLACE THE ENTIRE generateActionSummary HOOK WITH THIS ---
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
      // --- THIS IS THE CORE LOGIC UPDATE ---

      // 1. Calculate the targetRateValue exactly as done in the previous screen.
      const targetRateDetail = targetRatesDataMap?.get(item.item_id);
      // console.log("targetRateDetail",targetRateDetail)

      let calculatedTargetRate = -1; // Use -1 as a 'not found' value
      if (targetRateDetail?.rate && targetRateDetail.rate !== "-1") {
          const parsedRate = parseNumber(targetRateDetail.rate);
          if (!isNaN(parsedRate)) {
              calculatedTargetRate = parsedRate * 0.98; // The 98% logic
          }
      }

      // 2. Determine the benchmark for potential loss calculation.
      // const lowestItemPrice = calculatedTargetRate > 0
      //   ? calculatedTargetRate
      //   : getLowest(item.item_id);
        const lowestItemPrice = calculatedTargetRate > 0
        ? Math.min(calculatedTargetRate
        , getLowest(item.item_id)): getLowest(item.item_id);

      if (!vendorWiseApprovalItems[vendor]) {
        vendorWiseApprovalItems[vendor] = {
          items: [],
          total: 0,
          totalInclGst: 0,
        };
      }

      // 3. Create the displayItem and add our new `targetRateValue` to it.
      const displayItem: DisplayItem = {
        ...item,
        amount: itemTotalInclGst,
        targetRateValue: lowestItemPrice, // Store the calculated value
      };
      // console.log("displayItem",displayItem)

      if(displayItem?.category === "Additional Charges"){
        displayItem.potentialLoss = 0;
      }
      // 4. Calculate potential loss using the benchmark.
      if(displayItem?.category !== "Additional Charges") {
      if (lowestItemPrice && lowestItemPrice < quote) {
        displayItem.potentialLoss = baseItemTotal - (quantity * lowestItemPrice);
      }else{
        displayItem.potentialLoss = 0;
      }
    }
      // else if(getLowest(item.item_id) > quote){
      //   displayItem.potentialLoss = -(getLowest(item.item_id)-lowestItemPrice)
      // }
    

      vendorWiseApprovalItems[vendor].items.push(displayItem);
      vendorWiseApprovalItems[vendor].total += baseItemTotal;
      vendorWiseApprovalItems[vendor].totalInclGst += itemTotalInclGst;

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
    delayedItemsTotalInclGst,
  } = useMemo(() => generateActionSummary(), [generateActionSummary]);
  // =========================================
  // --- SECTION E: NEW VALIDATION LOGIC ---
  // =========================================
  const allVendorsHaveTerms = useMemo(() => {
    const approvalVendorIds = Object.keys(vendorWiseApprovalItems);
    if (approvalVendorIds.length === 0) return true; // No vendors to set terms for
    return approvalVendorIds.every((id) => !!paymentTerms[id]);
  }, [vendorWiseApprovalItems, paymentTerms]);

  if (procurement_request_loading || vendor_list_loading || usersListLoading)
    return <LoadingFallback />;


  if (orderData?.workflow_state !== "In Progress") {
    return (
      <div className="flex items-center justify-center h-[90vh]">
        <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
          <p className="text-gray-600 text-lg">
            Hey there, the PR:{" "}
            <span className="font-medium text-gray-900">{orderData?.name}</span>{" "}
            is no longer available in the{" "}
            <span className="italic">In Progress</span> state. The current state
            is{" "}
            <span className="font-semibold text-blue-600">
              {orderData?.workflow_state}
            </span>{" "}
            And the last modification was done by{" "}
            <span className="font-medium text-gray-900">
              {orderData?.modified_by === "Administrator"
                ? orderData?.modified_by
                : getFullName(orderData?.modified_by)}
            </span>
            !
          </p>
          <button
            className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
            onClick={() => navigate("/procurement-requests")}
          >
            Go Back to PR List
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4">
      <div className="space-y-2">
        <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">
          Comparison
        </h2>
        <ProcurementHeaderCard orderData={orderData} />
      </div>

      <div className="flex flex-col gap-4">
        {/* Approval Items Summary */}
        {Object.keys(vendorWiseApprovalItems).length > 0 && (
          <div className="p-6 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center mb-2">
              <ListChecks className="h-5 w-5 mr-2 text-green-600" />
              <h3 className="text-lg font-semibold text-gray-800">
                Items for Approval
              </h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              These items have been assigned to vendors and require project lead
              approval.
            </p>
            <dl className="space-y-4">
              {Object.entries(vendorWiseApprovalItems).map(
                ([vendor, { items, total, totalInclGst }]) => {
                  const termsForVendor = paymentTerms[vendor];

                  return (
                    <div key={vendor} className="border-t border-green-200 pt-4">
                      <dt className="flex justify-between items-center text-sm border-b border-grey-200 font-medium  pb-2">
                        <p>
                          Vendor:{" "}
                          <span className="font-semibold text-red-600">
                            {getVendorName(vendor)}
                          </span>
                        </p>

                        <div>
                          {termsForVendor ? (
                            // --- If terms exist, show the summary and an Edit button ---
                            <div className="flex items-center gap-2">
                              <RenderPaymentTermsSummary
                                terms={termsForVendor}
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                 className="text-primary border-primary justify-start hover:text-white hover:bg-red-600"
                                onClick={() =>
                                  setEditingVendor({
                                    id: vendor,
                                    name: getVendorName(vendor),
                                    total: totalInclGst,
                                  })
                                }
                                
                              >
                                <Pencil className="mr-2 h-4 w-4 flex-shrink-0" />{" "}
                                Edit
                              </Button>
                            </div>
                          ) : (
                            // --- If terms don't exist, show the "Add Payment Terms" button ---
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-primary border-primary justify-start hover:text-white hover:bg-red-600"
                              onClick={() =>
                                setEditingVendor({
                                  id: vendor,
                                  name: getVendorName(vendor),
                                  total: totalInclGst,
                                })
                              }
                            >
                              <CirclePlus className="mr-2 h-4 w-4 flex-shrink-0" />{" "}
                              Add Payment Terms
                            </Button>
                          )}
                        </div>
                      </dt>
                      {/* // Payment Terms xAnd REPLACE IT with this: */}
                      <dd className="mt-1 pl-5">
                        {/* This is the existing list of products. It stays the same. */}
                        <ul className="list-disc space-y-1 text-gray-800">
                          {items.map((item) => (
                            <li key={item.item_id} className="text-sm">
                              {item.item_name}
                              {item.make && (
                                <span className="text-gray-500 italic ml-1">
                                  ({item.make})
                                </span>
                              )}
                              <span className="mx-1">-</span> {item.quantity} x{" "}
                              {formatToIndianRupee(item.quote)}
                              <span className="mx-1 text-gray-500">+</span>{" "}
                              {item.tax}% GST
                              <span className="mx-1">=</span>{" "}
                              <span className="font-medium">
                                {formatToIndianRupee(item.amount)}
                              </span>
                              {/* ---
                              <span className="font-medium">
                                {formatToIndianRupee(item.targetRateValue)}
                              </span> */}
                              
                              {item?.potentialLoss && (
                                <span className="block text-xs text-red-600 mt-0.5">
                                  Potential Loss:{" "}
                                  {formatToIndianRupee(item.potentialLoss)}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>

                       
                        {(() => {
                          // 1. Get the payment terms for the *current* vendor in the loop.
                          const termsForThisVendor = paymentTerms[vendor];

                          // 2. If terms exist for this vendor...
                          if (termsForThisVendor) {
                            // 3. ...render our new display component, passing the terms data as a prop.
                            return (
                              <PaymentTermsDetailsDisplay
                                terms={termsForThisVendor}
                              />
                            );
                          }

                          // 4. Otherwise, render nothing.
                          return null;
                        })()}

                        {/* This is the existing subtotal display. It stays the same. */}
                        <div className="mt-2 text-right text-sm font-medium text-gray-800">
                          <p>
                            Subtotal:{" "}
                            <span className="font-semibold">
                              {formatToIndianRupee(total)}
                            </span>
                          </p>
                          <p>
                            Subtotal (inc. GST):{" "}
                            <span className="font-semibold text-green-700">
                              {formatToIndianRupee(totalInclGst)}
                            </span>
                          </p>
                        </div>
                      </dd>
                    </div>
                  );
                }
              )}
            </dl>
            <div className="mt-4 pt-4 border-t border-green-200 text-right">
              <p className="text-sm font-medium text-gray-800">
                Approval Grand Total:{" "}
                <span className="font-semibold">
                  {formatToRoundedIndianRupee(approvalOverallTotal)}
                </span>
              </p>
              <p className="text-sm font-medium text-gray-800">
                Approval Grand Total (inc. GST):{" "}
                <span className="text-base font-semibold text-green-700">
                  {formatToRoundedIndianRupee(approvalOverallTotalInclGst)}
                </span>
              </p>
            </div>
          </div>
        )}
        {/* Delayed Items Summary */}
        {allDelayedItems.length > 0 && (
          <div className="p-6 rounded-lg bg-red-50 border border-red-200 space-y-2">
            <div className="flex items-center mb-2">
              <SendToBack className="h-5 w-5 text-red-600 mr-2" />
              <h3 className="text-lg font-semibold text-gray-800">
                Delayed Items
              </h3>
            </div>
            <p className="text-sm text-gray-600">
              These items will be moved to a new 'Delayed Sent Back' list:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-gray-800">
              {allDelayedItems.map((item) => (
                <li key={item.item_id} className="text-sm">
                  {item.item_name}
                  {item.make && (
                    <span className="text-gray-500 italic ml-1">
                      ({item.make})
                    </span>
                  )}
                  <span className="mx-1">-</span>
                  {item.quantity} {item.unit}
                </li>
              ))}
            </ul>
            {delayedItemsTotalInclGst > 0 && (
              <div className="mt-4 pt-4 border-t border-red-200 text-right">
                <p className="text-sm font-medium text-gray-800">
                  Estimated Delayed Total (inc. GST):
                  <span className="text-base font-semibold text-red-700">
                    {" "}
                    {formatToRoundedIndianRupee(delayedItemsTotalInclGst)}
                  </span>
                </p>
                <p className="text-xs text-gray-500 italic">
                  (Based on last entered quotes)
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col justify-end items-end mr-2 my-4">
        <Dialog>
          <DialogTrigger asChild>
            <Button
              className="flex items-center gap-1"
              disabled={!allVendorsHaveTerms || sendForApprCallLoading}
            >
              <ArrowBigUpDash className="" />
              Send for Approval
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Have you cross-checked your selections?</DialogTitle>
              <DialogDescription>
                {allDelayedItems.length !== 0 && (
                  <p>
                    Remainder: Items whose quotes are not selected will have a
                    delayed status attached to them. If confirmed, Delayed sent
                    back request will be created for those Items.
                  </p>
                )}

                {Object.keys(vendorWiseApprovalItems).length !== 0 && (
                  <div className="flex flex-col gap-2 mt-2 text-start">
                    <h4 className="font-bold">
                      Any remarks for the Project Lead?
                    </h4>
                    <TextArea
                      className="border-green-400 focus:border-green-800 bg-green-200"
                      placeholder="type here..."
                      value={comment?.approving}
                      onChange={(e) =>
                        setComment({ ...comment, approving: e.target.value })
                      }
                    />
                  </div>
                )}

                {allDelayedItems.length !== 0 ? (
                  <div className="flex flex-col gap-2 mt-2 text-start">
                    <h4 className="font-bold">
                      some items are delayed, any reason?
                    </h4>
                    <TextArea
                      className="border-primary focus:border-red-800 bg-red-200"
                      placeholder="type here..."
                      value={comment?.delaying}
                      onChange={(e) =>
                        setComment({ ...comment, delaying: e.target.value })
                      }
                    />
                  </div>
                ) : (
                  <></>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogDescription className="flex items-center justify-center gap-2">
              {sendForApprCallLoading ? (
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

        {/* --- ADDED: Validation error message --- */}
        {!allVendorsHaveTerms && (
          <p className="text-xs text-red-500 mt-2">
            Please add payment terms for all vendors before proceeding.
          </p>
        )}
      </div>

      {/* ======================================================== */}
      {/* --- SECTION G: ADDED - Conditional Dialog Renderer --- */}
      {/* ======================================================== */}
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
  );
};

// ========================================================
// --- SECTION H: MODIFIED - The Helper Component ---
// ========================================================
// This component is now smarter to handle the detailed milestone data.
const RenderPaymentTermsSummary: React.FC<{ terms: VendorPaymentTerm }> = ({
  terms,
}) => {
  // If for some reason terms are missing, show a fallback.
  if (!terms.terms || terms.terms.length === 0) {
    return (
      <span className="text-xs font-normal text-gray-600">{terms.type}</span>
    );
  }

  // Show the breakdown of milestones
  return (
    <div className="flex items-center gap-2 text-xs font-normal text-gray-600">
      <span className="font-medium">{terms.type}:</span>
      {terms.terms.map((milestone, index) => (
        <React.Fragment key={milestone.id}>
          <span>
            {/* Display the name if it's not a generic default like "1st Payment" */}
            {/* {milestone.name && !milestone.name.match(/^\d+(st|nd|rd|th) Payment$/i) ? `${milestone.name}: ` : ''} */}
            <strong>{milestone.percentage.toFixed(0)}%</strong>
          </span>
          {/* Add a separator between milestones */}
          {index < terms.terms.length - 1 && (
            <span className="text-gray-300">|</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default VendorsSelectionSummary;

