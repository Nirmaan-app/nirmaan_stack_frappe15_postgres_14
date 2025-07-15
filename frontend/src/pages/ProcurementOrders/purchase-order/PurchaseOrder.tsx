import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { ValidationMessages } from "@/components/validations/ValidationMessages";
import { usePOValidation } from "@/hooks/usePOValidation";
import { useStateSyncedWithParams } from "@/hooks/useSearchParamsManager";
import { useUserData } from "@/hooks/useUserData";
import { PODetails } from "@/pages/ProcurementOrders/purchase-order/components/PODetails";
import { POPdf } from "./components/POPdf";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import {
  ProcurementOrder,
  PurchaseOrderItem,
} from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import formatToIndianRupee from "@/utils/FormatPrice";
import {
  getPOTotal,
  getTotalAmountPaid,
  getTotalInvoiceAmount,
  getPreviewTotal,
} from "@/utils/getAmounts";
import { useDialogStore } from "@/zustand/useDialogStore";
import { Tree } from "antd";
import {
  useFrappeCreateDoc,
  useFrappeDocumentEventListener,
  useFrappeGetDocList,
  useFrappePostCall,
  useFrappeUpdateDoc,
  useFrappeGetDoc,
} from "frappe-react-sdk";
import {
  AlertTriangle,
  CheckCheck,
  CircleX,
  Eye,
  List,
  ListChecks,
  Merge,
  MessageCircleMore,
  MessageCircleWarning,
  Pencil,
  PencilRuler,
  Split,
  Trash2,
  Undo,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import ReactSelect, { components } from "react-select";
import DeliveryHistoryTable from "@/pages/DeliveryNotes/components/DeliveryHistory";
import { InvoiceDialog } from "../invoices-and-dcs/components/InvoiceDialog";
import POAttachments from "./components/POAttachments";
import POPaymentTermsCard from "./components/POPaymentTermsCard";
import TransactionDetailsCard from "./components/TransactionDetailsCard";
import RequestPaymentDialog from "@/pages/ProjectPayments/request-payment/RequestPaymentDialog"; // Import the dialog component
import { DocumentAttachments } from "../invoices-and-dcs/DocumentAttachments";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { usePrintHistory } from "@/pages/DeliveryNotes/hooks/usePrintHistroy";
import {safeJsonParse} from "@/pages/DeliveryNotes/constants";

import { PaymentTerm ,POTotals,DeliveryDataType} from "@/types/NirmaanStack/ProcurementOrders";

interface PurchaseOrderProps {
  summaryPage?: boolean;
  accountsPage?: boolean;
}

export const PurchaseOrder = ({
  summaryPage = false,
  accountsPage = false,
}: PurchaseOrderProps) => {
  const [tab] = useStateSyncedWithParams<string>("tab", "Approved PO");

  const userData = useUserData();
  const estimatesViewing = useMemo(
    () => userData?.role === "Nirmaan Estimates Executive Profile",
    [userData?.role]
  );

  const navigate = useNavigate();
  const params = useParams();
  const id = summaryPage ? params.poId : params.id;

  if (!id) return <div>No PO ID Provided</div>;

  const [isRedirecting, setIsRedirecting] = useState(false);
  const poId = id?.replaceAll("&=", "/");

  const [orderData, setOrderData] = useState<PurchaseOrderItem[]>([]);
  const [PO, setPO] = useState<ProcurementOrder | null>(null);

  const {
    data: po,
    isLoading: poLoading,
    error: poError,
    mutate: poMutate,
  } = useFrappeGetDoc<ProcurementOrder>("Procurement Orders", poId);
  //  const { data: pos } = useFrappeGetDoc<ProcurementOrder>("Procurement Orders", poId);


  // --- FIX 2: PASS THE ENTIRE 'PO' OBJECT, NOT 'orderData.list' ---
  const { triggerHistoryPrint, PrintableHistoryComponent } =
    usePrintHistory(PO);

  useFrappeDocumentEventListener(
    "Procurement Orders",
    poId,
    (event) => {
      console.log("Procurement Orders document updated (real-time):", event);
      toast({
        title: "Document Updated",
        description: `Procurement Order ${event.name} has been modified.`,
      });
      poMutate(); // Re-fetch this specific document
    },
    true // emitOpenCloseEventsOnMount (default)
  );

  const { errors, isValid } = usePOValidation(PO);

  useEffect(() => {
    if (po) {
      const doc = po;
      setPO(doc);
      setOrderData(doc?.items || []);
      // --- NEW: Initialize payment terms with the current PO's terms ---
      setMergedPaymentTerms(doc?.payment_terms || []);
    }
  }, [po]);

  const [advance, setAdvance] = useState(0);
  const [materialReadiness, setMaterialReadiness] = useState(0);
  const [afterDelivery, setAfterDelivery] = useState(0);
  const [xDaysAfterDelivery, setXDaysAfterDelivery] = useState(0);
  const [xDays, setXDays] = useState(0);
  const [includeComments, setIncludeComments] = useState(false);

  const [mergeablePOs, setMergeablePOs] = useState<ProcurementOrder[]>([]);
  const [mergedItems, setMergedItems] = useState<ProcurementOrder[]>([]);
  const [prevMergedPOs, setPrevMergedPos] = useState<ProcurementOrder[]>([]);

  // --- NEW: State for merged payment terms ---
  const [mergedPaymentTerms, setMergedPaymentTerms] = useState<PaymentTerm[]>(
    []
  );

  const [loadingFuncName, setLoadingFuncName] = useState<string>("");

  const [quantity, setQuantity] = useState<number | null | string>(null);
  const [tax, setTax] = useState<number | null | string>(null);

  interface Make {
    make: string;
    enabled: string;
  }

  interface Operation {
    operation: "delete" | "quantity_change" | "make_change" | "tax_change";
    item: PurchaseOrderItem;
    previousQuantity?: number;
    previousMakeList?: string;
    previousTax?: number;
  }

  const [stack, setStack] = useState<Operation[]>([]);
  const [comment, setComment] = useState("");

  const [editMakeOptions, setEditMakeOptions] = useState<
    { label: string; value: string }[]
  >([]);

  const [selectedMake, setSelectedMake] = useState<{
    label: string;
    value: string;
  } | null>(null);

  const [amendEditItem, setAmendEditItem] = useState<PurchaseOrderItem | null>(
    null
  );

  const [poPdfSheet, setPoPdfSheet] = useState(false);

  const togglePoPdfSheet = useCallback(() => {
    setPoPdfSheet((prevState) => !prevState);
  }, []);

  const [mergeSheet, setMergeSheet] = useState(false);

  const toggleMergeSheet = useCallback(() => {
    setMergeSheet((prevState) => !prevState);
  }, []);

  const [mergeConfirmDialog, setMergeConfirmDialog] = useState(false);

  const toggleMergeConfirmDialog = useCallback(() => {
    setMergeConfirmDialog((prevState) => !prevState);
  }, [mergeConfirmDialog]);

  const [amendPOSheet, setAmendPOSheet] = useState(false);

  const toggleAmendPOSheet = useCallback(() => {
    setAmendPOSheet((prevState) => !prevState);
  }, []);

  const [cancelPODialog, setCancelPODialog] = useState(false);

  const toggleCancelPODialog = useCallback(() => {
    setCancelPODialog((prevState) => !prevState);
  }, [cancelPODialog]);

  const [unMergeDialog, setUnMergeDialog] = useState(false);

  const toggleUnMergeDialog = useCallback(() => {
    setUnMergeDialog((prevState) => !prevState);
  }, []);

  const [amendEditItemDialog, setAmendEditItemDialog] = useState(false);

  const toggleAmendEditItemDialog = useCallback(() => {
    setAmendEditItemDialog((prevState) => !prevState);
  }, [amendEditItemDialog]);

  const [showAddNewMake, setShowAddNewMake] = useState(false);

  const toggleAddNewMake = useCallback(() => {
    setShowAddNewMake((prevState) => !prevState);
  }, [showAddNewMake]);

  const { toggleRequestPaymentDialog } = useDialogStore();

  const { updateDoc } = useFrappeUpdateDoc();

  const { createDoc } = useFrappeCreateDoc();

  const { call: cancelPOCall, loading: cancelPOCallLoading } =
    useFrappePostCall("nirmaan_stack.api.handle_cancel_po.handle_cancel_po");

  const { call: mergePOCall, loading: mergePOCallLoading } = useFrappePostCall(
    "nirmaan_stack.api.po_merge_and_unmerge.handle_merge_pos"
  );

  const { call: unMergePOCall, loading: unMergePOCallLoading } =
    useFrappePostCall(
      "nirmaan_stack.api.po_merge_and_unmerge.handle_unmerge_pos"
    );

  const { data: potentialMergePOsList, isLoading: listIsLoading } =
    useFrappeGetDocList<ProcurementOrder>(
      "Procurement Orders",
      // This is the key: The query only runs if `po` exists.
      po
        ? {
            // We only need fields for the final client-side filtering steps.
            // We CANNOT get `items` or `payment_terms` here.
            fields: ["name", "custom"],

            // These filters are now run efficiently on the backend database!
            filters: [
              ["project", "=", po.project],
              ["vendor", "=", po.vendor],
              ["status", "=", "PO Approved"],
              ["docstatus", "!=", 2],
              ["name", "!=", poId],
            ],
            limit: 1000,
          }
        : null // This `null` is what pauses the hook, preventing the error.
    );

  const { call: fetchFullPoDetails, loading: fullPoDetailsLoading } =
    useFrappePostCall(
      "nirmaan_stack.api.po_merge_and_unmerge.get_full_po_details" // This path looks correct based on your Python file
    );

  const {
    data: usersList,
    isLoading: usersListLoading,
    error: usersListError,
  } = useFrappeGetDocList<NirmaanUsers>(
    "Nirmaan Users",
    {
      fields: ["name", "full_name"],
      limit: 1000,
    },
    `Nirmaan Users`
  );

  const {
    data: poPayments,
    isLoading: poPaymentsLoading,
    error: poPaymentsError,
    mutate: poPaymentsMutate,
  } = useFrappeGetDocList<ProjectPayments>(
    "Project Payments",
    {
      fields: ["*"],
      filters: [["document_name", "=", poId]],
      limit: 1000,
    },
    poId ? undefined : null
  );

  const { data: AllPoPaymentsList, mutate: AllPoPaymentsListMutate } =
    useFrappeGetDocList<ProjectPayments>("Project Payments", {
      fields: ["*"],
      filters: [["document_type", "=", "Procurement Orders"]],
      limit: 1000,
    });

  // +++ ADD THE FOLLOWING NEW CODE +++

  // ---
  // STEP 2.3: The NEW useEffect that connects everything together.
  // ---
  useEffect(() => {
    console.log("STEP 1: Initial list from database:", potentialMergePOsList);

    // Wait until the main PO and the efficient list of names are ready.
    if (!potentialMergePOsList || !po || !AllPoPaymentsList) return;

    // A. Perform the final filtering that MUST be done on the frontend.
    //    (Checking against the AllPoPaymentsList is easier here).
    const mergeablePoNames = potentialMergePOsList
      .filter(
        (item) =>
          item.custom !== "true" &&
          !AllPoPaymentsList.some((j) => j.document_name === item.name)
      )
      .map((item) => item.name); // We only need the names for the next step.

    // B. If we have names, call our backend function to get the FULL documents.
    console.log("STEP 2: Names after client-side filter:", mergeablePoNames);
    if (mergeablePoNames.length > 0) {
      fetchFullPoDetails({ po_names: mergeablePoNames })
        .then((fullDocs) => {
          // `fullDocs` is now an array of POs WITH `items` and `payment_terms`.

          // Now we can do the final payment type check on the full data.

          // +++ REPLACE WITH THIS +++
          const mainPoPaymentType = po.payment_terms?.[0]?.payment_type;

          // If the main PO has no payment terms, then nothing is mergeable.
          if (!mainPoPaymentType) {
            console.log(
              "Final Filter: Main PO has no payment terms. Result is an empty list."
            );
            setMergeablePOs([]);
          } else {
            console.log("fullDocs:", fullDocs);
            const finalMergeablePOs = fullDocs.message?.filter((doc) => {
              const docPaymentType = doc.payment_terms?.[0]?.payment_type;

              // This check is now explicit:
              // 1. The other PO must HAVE a payment type.
              // 2. That type must MATCH the main PO's type.
              return docPaymentType && docPaymentType === mainPoPaymentType;
            });

            console.log(
              "Final Filter: The final list of mergeable POs is:",
              finalMergeablePOs
            );
            setMergeablePOs(finalMergeablePOs);
          }
        })
        .catch((err) => {
          console.error("Failed to fetch full PO details:", err);
          toast({ variant: "destructive", title: "Error fetching PO details" });
        });
    } else {
      setMergeablePOs([]); // No POs matched all criteria.
    }
  }, [potentialMergePOsList, po, AllPoPaymentsList, fetchFullPoDetails]);

  const deliveryHistory = useMemo(() =>
      safeJsonParse<{ data: DeliveryDataType }>(PO?.delivery_data, { data: {} }),
      [PO?.delivery_data]
    );

  useEffect(() => {
    if (!mergeSheet) {
      handleUnmergeAll();
    }
  }, [mergeSheet]);

  const getTotal = useMemo(() => {
    return getPOTotal(PO, PO?.loading_charges, PO?.freight_charges);
  }, [PO]);
  // --- NEW: Helper function to calculate merged terms ---
  // --- REPLACE with this corrected function ---
  // PurchaseOrder.tsx

  const previewTotal=useMemo<POTotals>(()=>{
    return getPreviewTotal(orderData);
  },[orderData,setOrderData,PO])
// --- REPLACE with this corrected function ---
const calculateMergedTerms = useCallback((basePO: ProcurementOrder, additionalPOs: ProcurementOrder[]) => {
  const allPOs = [basePO, ...additionalPOs];
  const combinedTerms: { [label: string]: PaymentTerm } = {};

  allPOs.forEach(p => {
    (p.payment_terms || []).forEach(term => {
      // Ensure the amount from the API is a number
      const termAmount = parseFloat(String(term.amount)) || 0;

      if (combinedTerms[term.label]) {
        // --- THE FIX IS HERE ---
        // Ensure we are doing MATH (number + number), not joining strings.
        combinedTerms[term.label].amount = (combinedTerms[term.label].amount || 0) + termAmount;

        // The rest of your logic for due_date is fine
        if (
          term.payment_type === 'Credit' && 
          combinedTerms[term.label].payment_type === 'Credit' && 
          term.due_date && 
          combinedTerms[term.label].due_date
        ) {
          if (new Date(term.due_date) > new Date(combinedTerms[term.label].due_date!)) {
            combinedTerms[term.label].due_date = term.due_date;
          }
        }
      } else {
        // When adding a new term, also ensure its amount is a number
        combinedTerms[term.label] = { ...term, amount: termAmount };
      }
    });
  });

  return Object.values(combinedTerms);
}, []);

  // --- UPDATE: handleMerge function ---
  const handleMerge = (poToMerge: ProcurementOrder) => {
    // Merge items (existing logic)
    const taggedItems = (poToMerge.items || []).map((item) => ({
      ...item,
      po: poToMerge.name,
    }));
    setOrderData((currentOrderData) => [...currentOrderData, ...taggedItems]);

    const newMergedItems = [...mergedItems, poToMerge];
    setMergedItems(newMergedItems);

    console.log("handleMerge: Tagged Items", taggedItems, orderData);
    console.log("newMergedItems", newMergedItems);
    // --- NEW: Recalculate and set merged payment terms ---
    if (PO) {
      const newMergedPaymentTerms = calculateMergedTerms(PO, newMergedItems);
      setMergedPaymentTerms(newMergedPaymentTerms);
    }
  };

  // --- UPDATE: handleUnmerge function ---
  const handleUnmerge = (poToUnmerge: ProcurementOrder) => {
    // Unmerge items (existing logic)
    setOrderData((currentOrderData) =>
      currentOrderData.filter((item) => item.po !== poToUnmerge.name)
    );

    const newMergedItems = mergedItems.filter(
      (mergedPo) => mergedPo.name !== poToUnmerge.name
    );
    setMergedItems(newMergedItems);

    // --- NEW: Recalculate and set merged payment terms ---
    if (PO) {
      const newMergedPaymentTerms = calculateMergedTerms(PO, newMergedItems);
      setMergedPaymentTerms(newMergedPaymentTerms);
    }
  };

  const handleUnmergeAll = () => {
    if (mergedItems.length > 0) {
      // Directly filter the orderData ARRAY, keeping only the original items
      // (those that don't have a 'po' property).
      setOrderData((currentOrderData) =>
        currentOrderData.filter((item) => !item.po)
      );

      setMergedItems([]);
      // --- NEW: Reset payment terms back to the original PO's terms ---
      setMergedPaymentTerms(PO?.payment_terms || []);
    }
  };

  const handleMergePOs = async () => {
    try {
      const sanitizedOrderData = orderData.map(
        ({ po, ...restOfItem }) => restOfItem
      );
      // Call the backend API for merging POs
      console.log("payload",poId,mergedItems,sanitizedOrderData,mergedPaymentTerms)
      const response = await mergePOCall({
        po_id: poId,
        merged_items: mergedItems,
        order_data: sanitizedOrderData, // Use the sanitized list
        payment_terms: mergedPaymentTerms,
      });

      if (response.message.status === 200) {
        setMergeablePOs([]);
        toast({
          title: "Merge Successful!",
          description: response.message.message,
          variant: "success",
        });
        toggleMergeConfirmDialog();
        toggleMergeSheet();

        setIsRedirecting(true);

        setTimeout(() => {
          setIsRedirecting(false);
          navigate(
            `/purchase-orders/${response.message.new_po_name.replaceAll(
              "/",
              "&="
            )}?tab=Approved%20PO`
          );
          window.location.reload();
        }, 1000);
      } else if (response.message.status === 400) {
        toast({
          title: "Error!",
          description: response.message.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error in merging POs:", error);
      toast({
        title: "Error!",
        description: "Failed to merge POs. Please try again.",
        variant: "destructive",
      });
    }
  };

 const handleUnmergePOs = async () => {
    try {
      // The payload is simple: just the ID of the master PO.
      // The backend will handle the rest.
      const response = await unMergePOCall({
        po_id: poId,
      });

      // Handle the success or error response from the backend
      if (response.message.status === 200) {
        toggleUnMergeDialog();
        toast({
          title: "Success!",
          description: response.message.message,
          variant: "success",
        });
        setIsRedirecting(true);
        setTimeout(() => {
          setIsRedirecting(false);
          navigate(`/purchase-orders?tab=Approved%20PO`);
          window.location.reload();
        }, 1000);
      } else if (response.message.status === 400) {
        toast({
          title: "Error!",
          description: response.message.error, // Display the error from the backend
          variant: "destructive",
        });
      }
    } catch (error) {
      console.log("error while unmerging po's", error);
      toast({
        title: "Error!",
        description: "Failed to unmerge POs. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleAmendPo = async () => {
    setLoadingFuncName("handleAmendPo");

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // --- START: FULL FRONTEND VALIDATION (MIRRORS BACKEND) ---
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---

    // --- PRE-CALCULATIONS ---
    // Use a console.log to be 100% sure your PO object is loaded correctly.
    // console.log("Validating with PO data:", PO);

    // 1. Calculate the new total based on the user's changes (items only).
    const newTotalAmountForValidation = orderData.reduce((acc, item) => {
      const itemAmount = (item.quantity || 0) * (item.quote || 0);
      const taxAmount = itemAmount * ((item.tax || 0) / 100);
      return acc + itemAmount + taxAmount;
    }, 0);

    // 2. Get the total from the PO before any changes were made.
    const previousTotal = PO?.total_amount || 0;

    // --- CHECK 1: "Overpayment / Return" Scenario ---
    // This directly replicates the `frappe.throw` condition in your Python script.

    // A) Calculate the sum of all payments that cannot be changed.
    const lockedAmount = (PO?.payment_terms || [])
      .filter((term) => ["Paid", "Requested", "Approved"].includes(term.status))
      .reduce((sum, term) => sum + (term.amount || 0), 0);

    // B) Check if a "Return" term already exists from a previous amendment.
    const hasExistingReturn = PO?.payment_terms?.some(
      (term) => term.status === "Return"
    );

    // C) Check if the new total is less than what's already been paid/requested.
    const willCreateReturn =
      newTotalAmountForValidation < lockedAmount && lockedAmount > 0;

    // D) Perform the block if either condition is true.
    if (hasExistingReturn || willCreateReturn) {
      toast({
        title: "Amendment Blocked: Overpayment",
        description: `This change would create a negative balance. New total (${newTotalAmountForValidation.toFixed(
          2
        )}) cannot be less than the locked amount (${lockedAmount.toFixed(
          2
        )}).`,
        variant: "destructive",
        duration: 8000,
      });
      setLoadingFuncName("");
      return; // STOP EXECUTION
    }

    // --- CHECK 2: "Impossible Reduction" Scenario ---
    // This is the extra, intelligent check to prevent a logical error.

    // This check only matters if the total is being reduced.
    if (newTotalAmountForValidation < previousTotal) {
      const reductionAmount = previousTotal - newTotalAmountForValidation;

      // Calculate the total amount from terms that can actually be reduced.
      const modifiableAmount = (PO?.payment_terms || [])
        .filter((term) => ["Created", "Scheduled"].includes(term.status))
        .reduce((sum, term) => sum + (term.amount || 0), 0);

      console.log("DEBUG: Reduction Amount:", reductionAmount);
      console.log("DEBUG: Modifiable Amount:", modifiableAmount);
      // Block if the user is trying to reduce more than is available to be reduced.
      if (reductionAmount > modifiableAmount) {
        toast({
          title: "Amendment Blocked: Invalid Reduction",
          description: `Cannot reduce total by ${reductionAmount.toFixed(
            2
          )}. There is only ${modifiableAmount} available in 'Created' & 'Scheduled' payment terms.`,
          variant: "destructive",
          duration: 8000,
        });
        setLoadingFuncName("");
        return; // STOP EXECUTION
      }
    }

    try {
      // This part only runs if the validation above passes
      await updateDoc("Procurement Orders", poId, {
        status: "PO Amendment",
        items: orderData,
      });
      if (comment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Procurement Orders",
          reference_name: poId,
          comment_by: userData?.user_id,
          content: comment,
          subject: "updating po(amendment)",
        });
      }

      toast({
        title: "Success!",
        description: `${poId} amended and sent to Project Lead!`,
        variant: "success",
      });

      navigate("/purchase-orders?tab=Approved%20PO");
      setLoadingFuncName("");
    } catch (error) {
      console.log("Error while amending po", error); // Changed from "cancelling"
      toast({
        title: "Failed!",
        description: `${poId} Amendment Failed!`,
        variant: "destructive",
      });
    } finally {
      setLoadingFuncName("");
    }
  };

  const handleCancelPo = async () => {
    try {
      const response = await cancelPOCall({
        po_id: poId,
        comment: comment,
      });

      if (response.message.status === 200) {
        toast({
          title: "Success!",
          description: response.message.message,
          variant: "success",
        });
        navigate("/purchase-orders?tab=Approved%20PO");
      } else if (response.message.status === 400) {
        toast({
          title: "Failed!",
          description: response.message.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.log("Error while cancelling po", error);
      toast({
        title: "Failed!",
        description: `PO: ${poId} Cancellation Failed!`,
        variant: "destructive",
      });
    }
  };

  const handleUnAmendAll = () => {
    setOrderData(PO?.items || []);
    setStack([]);
  };

  useEffect(() => {
    if (!amendPOSheet && stack.length) {
      handleUnAmendAll();
    }
  }, [amendPOSheet]);

  const handleSave = useCallback(
    (itemName: string) => {
      const previousItem = orderData.find(
        (curValue) => curValue.name === itemName
      );
      if (!previousItem) return;

      // CORRECT: Get the make string from the `selectedMake` state object.
      const newMakeValue = selectedMake?.value || "";

      // Push quantity change to stack if different
      if (quantity !== null && quantity !== previousItem.quantity) {
        setStack((prev) => [
          ...prev,
          {
            operation: "quantity_change",
            item: previousItem,
            previousQuantity: previousItem.quantity,
          },
        ]);
      }
      // Push make change to stack if different
      if (newMakeValue !== previousItem.make) {
        setStack((prev) => [
          ...prev,
          {
            operation: "make_change",
            item: previousItem,
            previousMake: previousItem.make,
          },
        ]);
      }

      if (tax !== null && tax !== previousItem.tax) {
        setStack((prev) => [
          ...prev,
          {
            operation: "tax_change",
            item: previousItem,
            previousTax: previousItem.tax,
          },
        ]);
      }

      const updatedOrderData = orderData.map((curValue) => {
        if (curValue.name === itemName) {
          return {
            ...curValue,
            quantity: quantity !== null ? quantity : curValue.quantity,
            make: newMakeValue,
            tax: tax !== null ? Number(tax) : curValue.tax, // ➕ ADDED: Update tax
          };
        }
        return curValue;
      });

      setOrderData(updatedOrderData);

      // Reset state and close dialog
      setQuantity(null);
      setTax(null);
      setSelectedMake(null); // CORRECT: Reset selectedMake
      toggleAmendEditItemDialog();
    },
    [orderData, quantity, selectedMake, toggleAmendEditItemDialog]
  ); // CORRECT: Dependency is on selectedMake
  // NEW `handleDelete`
  const handleDelete = useCallback(
    (itemNameToDelete: string) => {
      // Pass the unique 'name' of the item row
      const itemToDelete = orderData.find(
        (curValue) => curValue.name === itemNameToDelete
      );

      if (itemToDelete) {
        setStack((prevStack) => [
          ...prevStack,
          {
            operation: "delete",
            item: itemToDelete, // Push the entire object to the stack
          },
        ]);
      }

      // Filter out the deleted item from the main array
      const updatedOrderData = orderData.filter(
        (curValue) => curValue.name !== itemNameToDelete
      );

      setOrderData(updatedOrderData); // Set the new array
      setTax(null);
      setQuantity(null); // Reset quantity state
      toggleAmendEditItemDialog();
    },
    [orderData, toggleAmendEditItemDialog] // Simplified dependencies
  );

  // NEW `UndoDeleteOperation`
  const UndoDeleteOperation = useCallback(() => {
    if (stack.length === 0) return;

    const lastOperation = stack[stack.length - 1];
    const newStack = stack.slice(0, -1); // More efficient way to pop

    let updatedOrderData = [...orderData]; // Work on a copy

    if (lastOperation.operation === "delete") {
      // Restore the deleted item
      updatedOrderData.push(lastOperation.item as PurchaseOrderItem);
    } else if (lastOperation.operation === "quantity_change") {
      // Find and restore the previous quantity
      updatedOrderData = updatedOrderData.map((item) => {
        if (item.name === (lastOperation.item as PurchaseOrderItem).name) {
          return { ...item, quantity: lastOperation.previousQuantity! };
        }
        return item;
      });
    } else if (lastOperation.operation === "make_change") {
      // Find and restore the previous make list
      updatedOrderData = updatedOrderData.map((item) => {
        if (item.name === (lastOperation.item as PurchaseOrderItem).name) {
          const originalItem = lastOperation.item as PurchaseOrderItem;
          return {
            ...item,
            makes: { list: lastOperation.previousMakeList! },
            // also restore the primary 'make' field
            make: originalItem.make,
          };
        }
        return item;
      });
    } else if (lastOperation.operation === "tax_change") {
      // ➕ ADDED: Handler for undoing tax changes
      updatedOrderData = updatedOrderData.map((item) => {
        if (item.name === (lastOperation.item as PurchaseOrderItem).name) {
          return { ...item, tax: lastOperation.previousTax! };
        }
        return item;
      });
    }

    setOrderData(updatedOrderData); // Set the restored array
    setStack(newStack); // Update the stack
  }, [orderData, stack]);

  const treeData = useMemo(
    () => [
      {
        title: PO?.name,
        key: "mainPO",
        children: prevMergedPOs?.map((po, idx) => ({
          title: po?.name,
          key: `po-${idx}`,
          children: po?.order_list?.list?.map((item, itemIdx) => ({
            title: item?.item,
            key: `item-${idx}-${itemIdx}`,
          })),
        })),
      },
    ],
    [prevMergedPOs, PO]
  );

  const amountPaid = useMemo(
    () =>
      getTotalAmountPaid(
        (poPayments || []).filter((i) => i?.status === "Paid")
      ),
    [poPayments]
  );

  const amountPending = useMemo(
    () =>
      getTotalAmountPaid(
        (poPayments || []).filter((i) =>
          ["Requested", "Approved"].includes(i?.status)
        )
      ),
    [poPayments]
  );

  const getUserName = useMemo(
    () => (id: string | undefined) => {
      return usersList?.find((user) => user?.name === id)?.full_name || "";
    },
    [usersList]
  );

  const MERGEPOVALIDATIONS = useMemo(
    () =>
      !summaryPage &&
      !accountsPage &&
      PO?.custom != "true" &&
      !estimatesViewing &&
      PO?.status === "PO Approved" &&
      PO?.merged !== "true" &&
      !((poPayments || [])?.length > 0) &&
      mergeablePOs.length > 0,
    [PO, mergeablePOs, poPayments, summaryPage, accountsPage, estimatesViewing]
  );

  const CANCELPOVALIDATION = useMemo(
    () =>
      !summaryPage &&
      !accountsPage &&
      !PO?.custom &&
      !estimatesViewing &&
      ["PO Approved"].includes(PO?.status) &&
      !((poPayments || []).length > 0) &&
      PO?.merged !== "true",
    [PO, poPayments, summaryPage, accountsPage, estimatesViewing]
  );

  const totalInvoiceAmount = useMemo(
    () => getTotalInvoiceAmount(PO?.invoice_data || []),
    [PO]
  );

  const AMENDPOVALIDATION = useMemo(
    () =>
      !summaryPage &&
      !accountsPage &&
      !estimatesViewing &&
      ["PO Approved"].includes(PO?.status) &&
      PO?.merged !== "true" && [
        // !((poPayments || [])?.length > 0),
        PO,
        poPayments,
        summaryPage,
        accountsPage,
        estimatesViewing,
      ]
  );

  const UNMERGEPOVALIDATIONS = useMemo(
    () =>
      !summaryPage &&
      !accountsPage &&
      !PO?.custom &&
      !estimatesViewing &&
      PO?.merged === "true",
    [PO, summaryPage, accountsPage, estimatesViewing]
  );

  if (isRedirecting) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
        <div className="bg-white p-6 rounded-lg shadow-lg text-center">
          <p className="text-lg font-semibold">Redirecting... Please wait</p>
        </div>
      </div>
    );
  }

  if (
    poLoading ||
    // vendor_address_loading ||
    // project_address_loading ||
    usersListLoading ||
    // associated_po_list_loading ||
    listIsLoading || // Use the new loading state from our list hook
    fullPoDetailsLoading || // Use the loading state from our full details hook
    poPaymentsLoading
  )
    return <LoadingFallback />;
  if (
    // associated_po_list_error ||
    // vendor_address_error ||
    // project_address_error ||
    usersListError ||
    poError ||
    poPaymentsError
  )
    return (
      <AlertDestructive
        error={
        
          usersListError ||
          poError ||
          poPaymentsError
        }
      />
    );
  if (
    !summaryPage &&
    !accountsPage &&
    tab === "Approved PO" &&
    !estimatesViewing &&
    !["PO Approved"].includes(PO?.status || "")
  )
    return (
      <div className="flex items-center justify-center h-[90vh]">
        <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
          <p className="text-gray-600 text-lg">
            Hey there, the Purchase Order:{" "}
            <span className="font-medium text-gray-900">{PO?.name}</span> is no
            longer available in <span className="italic">PO Approved</span>{" "}
            state. The current state is{" "}
            <span className="font-semibold text-blue-600">{PO?.status}</span>{" "}
            And the last modification was done by{" "}
            <span className="font-medium text-gray-900">
              {PO?.modified_by === "Administrator"
                ? "Administrator"
                : getUserName(PO?.modified_by)}
            </span>
            !
          </p>
          <button
            className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
            onClick={() => navigate("/purchase-orders?tab=Approved%20PO")}
          >
            Go Back
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex-1 space-y-4">
      {MERGEPOVALIDATIONS && (
        <>
          <Alert variant="warning" className="">
            <AlertTitle className="text-sm flex items-center gap-2">
              <MessageCircleWarning className="h-4 w-4" />
              Heads Up - PO Merging Available
            </AlertTitle>
            <AlertDescription className="text-xs flex justify-end items-center">
              <span className="sr-only">
                This purchase order can be merged with other compatible orders
              </span>
              {/* PO Merging Feature is available for this PO. */}
              <Sheet open={mergeSheet} onOpenChange={toggleMergeSheet}>
                <SheetTrigger
                  disabled={!isValid}
                  className="disabled:opacity-50"
                >
                  <div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={
                            isValid ? "Merge PO(s)" : "Merge unavailable"
                          }
                          className="flex items-center gap-1"
                          color="primary"
                        >
                          <Merge className="w-4 h-4" />
                          Merge PO(s)
                        </Button>
                      </TooltipTrigger>
                      {!isValid && (
                        <TooltipContent
                          side="bottom"
                          className="bg-background border border-border text-foreground w-80"
                        >
                          <ValidationMessages
                            title="Required Before Merging"
                            errors={errors}
                          />
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </div>
                </SheetTrigger>
                <SheetContent className="overflow-y-auto">
                  <div className="md:p-6">
                    <h2 className="text-2xl font-bold mb-4">
                      Merge Purchase Orders
                    </h2>

                    <Card className="mb-4">
                      <CardHeader className="flex flex-row justify-between items-center">
                        <div className="flex flex-col">
                          <span className="text-sm text-gray-500">
                            Project:
                          </span>
                          <p className="text-base font-medium tracking-tight text-black">
                            {PO?.project_name}
                          </p>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm text-gray-500">Vendor:</span>
                          <p className="text-base font-medium tracking-tight text-black">
                            {PO?.vendor_name}
                          </p>
                        </div>
                      </CardHeader>
                    </Card>

                    {mergeablePOs.length > 0 ? (
                      <div className="overflow-x-auto">
                        <Table className="min-w-[500px]">
                          <TableHeader>
                            <TableRow className="bg-red-100">
                              <TableHead className="w-[15%]">
                                ID(PO/PR)
                              </TableHead>
                              <TableHead>Items Count</TableHead>
                              <TableHead>Items List</TableHead>
                              <TableHead>Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow key={PO?.name}>
                              <TableCell>
                                {poId?.slice(3, 6)}/
                                {PO?.procurement_request?.slice(9)}
                              </TableCell>
                              <TableCell>{PO?.items?.length}</TableCell>
                              <TableCell>
                                <ul className="list-disc">
                                  {PO?.items?.map((j) => (
                                    <li key={j?.name}>
                                      {j?.item_name}{" "}
                                      <span>(Qty-{j?.quantity})</span>
                                      <p className="text-primary text-sm">
                                        Make:{" "}
                                        <span className="text-xs text-gray-500 italic">
                                          {j?.make || "--"}
                                        </span>
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              </TableCell>
                              <TableCell>
                                <Button
                                  className="flex items-center gap-1 bg-blue-500 text-white hover:text-white hover:bg-blue-400"
                                  variant={"ghost"}
                                  disabled
                                >
                                  <Split className="w-4 h-4" />
                                  Split
                                </Button>
                              </TableCell>
                            </TableRow>
                            {mergeablePOs.map((po) => {
                              // CORRECTED: Helper function now uses .items
                              const isMergeDisabled = po.items.some(
                                (poItem) => {
                                  return orderData?.some(
                                    (currentItem) =>
                                      currentItem.item_name ===
                                        poItem.item_name &&
                                      currentItem.quote !== poItem.quote
                                  );
                                }
                              );

                              return (
                                <TableRow key={po.name}>
                                  <TableCell>
                                    {po?.name?.slice(3, 6)}/
                                    {po?.procurement_request?.slice(9)}
                                  </TableCell>
                                  <TableCell>{po.items.length}</TableCell>
                                  <TableCell>
                                    <ul className="list-disc">
                                      {po?.items?.map((i) => (
                                        <li key={i?.name}>
                                          {i?.item_name}{" "}
                                          <span>(Qty-{i?.quantity})</span>
                                          <p className="text-primary text-sm">
                                            Make:{" "}
                                            <span className="text-xs text-gray-500 italic">
                                              {i?.make || "--"}
                                            </span>
                                          </p>
                                        </li>
                                      ))}
                                    </ul>
                                  </TableCell>
                                  <TableCell>
                                    {!mergedItems.some(
                                      (mergedItem) =>
                                        mergedItem?.name === po.name
                                    ) ? (
                                      isMergeDisabled ? (
                                        <HoverCard>
                                          <HoverCardTrigger>
                                            <Button
                                              className="flex items-center gap-1"
                                              disabled
                                            >
                                              <Merge className="w-4 h-4" />
                                              Merge
                                            </Button>
                                          </HoverCardTrigger>
                                          <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg mr-28">
                                            Unable to Merge this PO as it has
                                            some{" "}
                                            <span className="text-primary">
                                              overlapping item(s) with different
                                              quotes
                                            </span>
                                          </HoverCardContent>
                                        </HoverCard>
                                      ) : (
                                        <Button
                                          className="flex items-center gap-1"
                                          onClick={() => handleMerge(po)}
                                        >
                                          <Merge className="w-4 h-4" />
                                          Merge
                                        </Button>
                                      )
                                    ) : (
                                      <Button
                                        className="flex items-center gap-1 bg-blue-500 text-white hover:text-white hover:bg-blue-400"
                                        variant={"ghost"}
                                        onClick={() => handleUnmerge(po)}
                                      >
                                        <Split className="w-4 h-4" />
                                        Split
                                      </Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p>No mergeable POs available.</p>
                    )}

                    {/* Button Section */}
                    <div className="flex justify-end space-x-4 mt-6">
                      <Button
                        className="flex items-center gap-1"
                        onClick={togglePoPdfSheet}
                        variant={"outline"}
                      >
                        <Eye className="w-4 h-4" />
                        Preview
                      </Button>
                      <AlertDialog
                        open={mergeConfirmDialog}
                        onOpenChange={toggleMergeConfirmDialog}
                      >
                        <AlertDialogTrigger asChild>
                          <Button
                            className="flex items-center gap-1"
                            disabled={!mergedItems.length}
                          >
                            <CheckCheck className="h-4 w-4" />
                            Confirm
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="overflow-auto">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure!</AlertDialogTitle>
                          </AlertDialogHeader>
                          <AlertDialogDescription>
                            Below are the subsequent actions executed on
                            clicking the Confirm button:
                            <ul className="list-disc ml-6 italic">
                              <li>
                                Merged PO(s) including the current PO will be
                                marked as{" "}
                                <span className="text-primary">Merged</span>!
                              </li>
                              <li>
                                A <span className="text-primary">New PO</span>{" "}
                                will be created to contain the merged PO(s)
                                items
                              </li>
                            </ul>
                            <p className="mt-2 font-semibold text-base">
                              Continue?
                            </p>
                          </AlertDialogDescription>
                          {mergePOCallLoading ? (
                            <div className="flex items-center justify-center">
                              <TailSpin width={80} color="red" />{" "}
                            </div>
                          ) : (
                            <AlertDialogDescription className="flex gap-2 items-center justify-center">
                              <AlertDialogCancel className="flex items-center gap-1">
                                <CircleX className="h-4 w-4" />
                                Cancel
                              </AlertDialogCancel>
                              <Button
                                onClick={handleMergePOs}
                                className="flex gap-1 items-center"
                              >
                                <CheckCheck className="h-4 w-4" />
                                Confirm
                              </Button>
                            </AlertDialogDescription>
                          )}
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </AlertDescription>
          </Alert>
        </>
      )}
      <PODetails
        po={PO}
        toggleRequestPaymentDialog={toggleRequestPaymentDialog}
        summaryPage={summaryPage}
        accountsPage={accountsPage}
        estimatesViewing={estimatesViewing}
        poPayments={poPayments}
        togglePoPdfSheet={togglePoPdfSheet}
        // getTotal={getTotal}
        amountPaid={amountPaid}
        poMutate={poMutate}
      />
      <Card className="rounded-sm  md:col-span-3 p-2">
        <Accordion
          type="multiple"
          // defaultValue={tab !== "Delivered PO" ? ["transac&payments"] : []}
          className="w-full"
        >
          <AccordionItem key="transac&payments" value="transac&payments">
            {/* {tab === "Delivered PO" && ( */}
            <AccordionTrigger>
              <p className="font-semibold text-lg text-red-600 pl-6">
                Payment Details
              </p>
            </AccordionTrigger>
            {/* )} */}
            <AccordionContent>
              <div className="grid gap-4 max-[1000px]:grid-cols-1 grid-cols-6">
                <TransactionDetailsCard
                  accountsPage={accountsPage}
                  estimatesViewing={estimatesViewing}
                  summaryPage={summaryPage}
                  PO={PO}
                  getTotal={getTotal}
                  amountPaid={amountPaid}
                  poPayments={poPayments}
                  poPaymentsMutate={poPaymentsMutate}
                  AllPoPaymentsListMutate={AllPoPaymentsListMutate}
                />

                <POPaymentTermsCard
                  accountsPage={accountsPage}
                  estimatesViewing={estimatesViewing}
                  summaryPage={summaryPage}
                  PO={PO}
                  getTotal={getTotal}
                  poMutate={poMutate}
                  projectPaymentsMutate={poPaymentsMutate}
                  // advance={advance}
                  // materialReadiness={materialReadiness}
                  // afterDelivery={afterDelivery}
                  // xDaysAfterDelivery={xDaysAfterDelivery}
                  // xDays={xDays}
                  // setAdvance={setAdvance}
                  // setMaterialReadiness={setMaterialReadiness}
                  // setAfterDelivery={setAfterDelivery}
                  // setXDaysAfterDelivery={setXDaysAfterDelivery}
                  // setXDays={setXDays}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
      {/* PO Attachments Accordion */}

      {PO?.status !== "PO Approved" && (
        <Card className="rounded-sm  md:col-span-3 p-2">
          <Accordion
            type="multiple"
            // defaultValue={tab !== "Delivered PO" ? ["poattachments"] : []}
            className="w-full"
          >
            <AccordionItem key="poattachments" value="poattachments">
              {/* {tab === "Delivered PO" && ( */}
              <AccordionTrigger>
                <p className="font-semibold text-lg text-red-600 pl-6">
                  PO Attachments
                </p>
              </AccordionTrigger>
              {/* )} */}
              <AccordionContent>
                <DocumentAttachments
                  docType="Procurement Orders"
                  docName={poId}
                  documentData={PO}
                  docMutate={poMutate}
                />
                {/* <POAttachments PO={PO} poMutate={poMutate} /> */}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      )}

      {/* Invoice Dialog */}
      <InvoiceDialog
        docName={PO?.name}
        docType="Procurement Orders"
        docMutate={poMutate}
      />
      {/* Order Details */}
      <Card className="rounded-sm shadow-md md:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <p className="text-xl max-sm:text-lg text-red-600">Order Details</p>
            <div className="flex items-center gap-1">
              <span className="text-xs">Comments</span>
              <Switch
                className="w-8 h-4"
                value={includeComments}
                onCheckedChange={(e) => setIncludeComments(e)}
                id="includeComments"
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="relative overflow-hidden">
            {/* Synchronized Table Layout */}
            <div className="overflow-x-auto">
              {/* Header Table */}
              <table className="w-full border-collapse order-details-table">
                <colgroup>
                  <col className="w-[5%]" />
                  <col className="w-[50%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  {["Partially Delivered", "Delivered"].includes(
                    PO?.status
                  ) && <col className="w-[5%]" />}
                </colgroup>
                <thead className="bg-red-100">
                  <tr className="text-sm font-semibold text-gray-700">
                    <th className="sticky top-0 z-10 text-left pl-2 py-3 bg-red-100">
                      S.No.
                    </th>
                    <th className="sticky top-0 z-10 text-left pl-2 py-3 bg-red-100">
                      Item Name
                    </th>
                    <th className="sticky top-0 z-10 text-center py-3 bg-red-100">
                      Unit
                    </th>
                    <th className="sticky top-0 z-10 text-center py-3 bg-red-100">
                      Qty
                    </th>
                    <th className="sticky top-0 z-10 text-center py-3 bg-red-100">
                      Rate
                    </th>
                    <th className="sticky top-0 z-10 text-center py-3 bg-red-100">
                      Tax
                    </th>
                    <th className="sticky top-0 z-10 text-center pr-4 py-3 bg-red-100">
                      Amount
                    </th>
                    <th className="sticky top-0 z-10 text-center pr-4 py-3 bg-red-100">
                      Amount (incl.GST)
                    </th>
                    {["Partially Delivered", "Delivered"].includes(
                      PO?.status
                    ) && (
                      <th className="sticky top-0 z-10 text-center py-3 bg-red-100">
                        Delivered Quantity
                      </th>
                    )}
                  </tr>
                </thead>
              </table>
            </div>

            {/* Body Table with Synchronized Columns */}
            <div
              // className={`overflow-y-auto ${!summaryPage ? 'max-h-32' : ''} border-t border-gray-200`}
              className={`overflow-y-auto border-t border-gray-200`}
              role="region"
              aria-labelledby="order-details-table"
              tabIndex={0}
            >
              <table className="w-full border-collapse order-details-table">
                <colgroup>
                  <col className="w-[5%]" />
                  <col className="w-[50%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  {["Partially Delivered", "Delivered"].includes(
                    PO?.status
                  ) && <col className="w-[5%]" />}
                </colgroup>
                <tbody className="divide-y divide-gray-200">
                  {PO?.items?.map((item, index) => (
                    <tr
                      key={index}
                      className="hover:bg-gray-50 transition-colors text-sm text-gray-600"
                    >
                      {/* S.No. */}
                      <td className="pl-4 py-2 align-top">{index + 1}</td>

                      {/* Item Name */}
                      <td className="pl-2 py-2 align-top">
                        <div className="flex flex-col gap-1">
                              {item.item_name}
                          <small className="font-medium text-red-700 truncate">
                            {item?.make}
                          </small>
                          {item.comment && (
                            <div className="flex gap-1 items-start bg-gray-50 rounded p-1.5">
                              <MessageCircleMore className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
                              <div className="text-xs text-gray-600 leading-snug">
                                {item.comment}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Unit */}
                      <td className="text-center py-2 align-top">
                        {item.unit}
                      </td>

                      {/* Quantity */}
                      <td className="text-center py-2 align-top">
                        {item.quantity}
                      </td>

                      {/* Rate */}
                      <td className="text-center py-2 align-top">
                        {formatToIndianRupee(item?.quote)}
                      </td>

                      {/* Tax */}
                      <td className="text-center py-2 align-top">
                        {item?.tax}%
                      </td>

                      {/* Amount */}
                      <td className="pr-4 text-center py-2 align-top font-medium">
                        {formatToIndianRupee(item?.amount)}
                      </td>

                      {/* Amount (Incl GST) */}
                      <td className="pr-4 text-center py-2 align-top font-medium">
                        {formatToIndianRupee(
                          item?.quote * item?.quantity * (1 + item?.tax / 100)
                        )}
                      </td>

                      {/* OD (Conditional) */}
                      {["Partially Delivered", "Delivered"].includes(
                        PO?.status
                      ) && (
                        <td
                          className={`text-center py-2 align-top ${
                            item?.received_quantity === item?.quantity
                              ? "text-green-600"
                              : "text-red-700"
                          }`}
                        >
                          {item?.received_quantity || 0}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* Unmerge, Amend and Cancel PO Buttons  */}
      {/* Unmerge */}
      <div className="flex items-center justify-between">
        {UNMERGEPOVALIDATIONS ? (
          PO?.status === "PO Approved" &&
          !((poPayments || [])?.length > 0) && (
            <AlertDialog
              open={unMergeDialog}
              onOpenChange={toggleUnMergeDialog}
            >
              <AlertDialogTrigger asChild>
                <Button
                  variant={"outline"}
                  className="flex border-primary items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
                >
                  <Split className="h-4 w-4" />
                  Unmerge
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="overflow-auto max-h-[90vh]">
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="space-y-6">
                  <div className="bg-indigo-500/10 p-4 rounded-lg border border-indigo-500/20">
                    <h3 className="font-semibold text-indigo-500 mb-2 flex items-center">
                      <List className="w-5 h-5 mr-2" />
                      Associated Merged PO's
                    </h3>
                    <Tree
                      treeData={treeData}
                      defaultExpandedKeys={["mainPO"]}
                    />
                  </div>
                  <div className="bg-indigo-500/10 p-4 rounded-lg border border-indigo-500/20">
                    <h3 className="font-semibold text-indigo-500 mb-2 flex items-center">
                      <AlertTriangle className="w-5 h-5 mr-2" />
                      Important Notes
                    </h3>
                    <ul className="list-disc list-inside space-y-1 text-sm text-indigo-500/80">
                      <li>
                        If you need to{" "}
                        <span className="italic text-primary font-bold">
                          Amend / Cancel
                        </span>
                        , You should proceed with this option.
                      </li>
                      <li>
                        This action will delete the current PO, unmerge all{" "}
                        <span className="text-primary font-semibold">
                          the above listed merged PO(s)
                        </span>{" "}
                        and make them available in the table!
                      </li>
                    </ul>
                  </div>
                </div>
                <AlertDialogDescription className="space-y-2">
                  <div>
                    Please be informed that the above mentioned are the PO(s)
                    that are going to be unmerged and be available in the table,
                    it is advised to note these PO numbers!
                  </div>

                  <p className="">
                    Click on confirm to proceed with unmerging!
                  </p>
                </AlertDialogDescription>
                {unMergePOCallLoading ? (
                  <div className="flex items-center justify-center">
                    <TailSpin width={80} color="red" />{" "}
                  </div>
                ) : (
                  <div className="flex justify-end items-center gap-2">
                    <AlertDialogCancel>
                      <CircleX className="h-4 w-4 mr-1" />
                      Cancel
                    </AlertDialogCancel>
                    <Button
                      onClick={handleUnmergePOs}
                      className="flex items-center gap-1"
                    >
                      <Split className="h-4 w-4 mr-1" />
                      Confirm
                    </Button>
                  </div>
                )}
              </AlertDialogContent>
            </AlertDialog>
          )
        ) : (
          <div />
        )}

        {/* Amend PO */}
        <div className="flex gap-2 items-center justify-end">
          {AMENDPOVALIDATION && (
            <Button
              onClick={toggleAmendPOSheet}
              variant={"outline"}
              className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
            >
              <PencilRuler className="w-4 h-4" />
              Amend PO
            </Button>
          )}
          <Sheet open={amendPOSheet} onOpenChange={toggleAmendPOSheet}>
            <SheetContent className="overflow-auto">
              <>
                <div className="space-y-6 my-4">
                  <div className="bg-primary/10 p-4 rounded-lg border border-primary/20">
                    <h3 className="font-semibold text-primary mb-2 flex items-center">
                      <AlertTriangle className="w-5 h-5 mr-2" />
                      Important Notes
                    </h3>
                    <ul className="list-disc list-inside space-y-1 text-sm text-primary/80">
                      <li>
                        If you want to change quantities or remove items from
                        this PO, choose this option.
                      </li>
                      <li>
                        This action will create an{" "}
                        <span className="text-red-700 font-semibold">
                          Approve Amendment
                        </span>{" "}
                        for this PO and send it to Project Lead for
                        verification.
                      </li>
                    </ul>
                  </div>
                </div>
                <div className="pb-4 text-lg font-bold">
                  Amend: <span className="text-red-700">{poId}</span>
                </div>
                {/* PENDING CARD */}
                <Card className="p-4">
                  <div className="flex justify-between pb-2 gap-2">
                    <div className="text-red-700 text-sm font-light">
                      Order List
                    </div>
                    {stack.length !== 0 && (
                      <div className="flex items-center space-x-2">
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <Button
                              onClick={() => UndoDeleteOperation()}
                              className="flex items-center gap-1"
                            >
                              <Undo className="mr-2 max-md:w-4 max-md:h-4" />{" "}
                              {/* Undo Icon */}
                              Undo
                            </Button>
                          </HoverCardTrigger>
                          <HoverCardContent className="bg-gray-800 text-white p-2 rounded-md shadow-lg mr-[100px]">
                            Click to undo the last operation
                          </HoverCardContent>
                        </HoverCard>
                      </div>
                    )}
                  </div>

                  <table className="table-auto w-full">
                    <thead>
                      <tr className="bg-gray-200">
                        <th className="w-[45%] text-left  py-1 text-xs">
                          Item Name
                        </th>
                        <th className="w-[20%]  py-1 text-xs text-center">
                          Tax
                        </th>
                        <th className="w-[20%]  py-1 text-xs text-center">
                          Make
                        </th>
                        <th className="w-[10%]  py-1 text-xs text-center">
                          Unit
                        </th>
                        <th className="w-[5%]  py-1 text-xs text-center">
                          Qty
                        </th>
                        <th className="w-[10%]  py-1 text-xs text-center">
                          Edit
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderData?.map((item) => {
                        return (
                          <tr key={item.name}>
                            <td className="w-[45%] text-left border-b-2 py-1 text-sm">
                              {item.item_name}
                            </td>
                            <td className="w-[20%] border-b-2 py-1 text-sm text-center">
                              {item.tax}
                            </td>
                            <td className="w-[20%] border-b-2 py-1 text-sm text-center">
                              {item.make}
                            </td>
                            <td className="w-[10%] border-b-2 py-1 text-sm text-center">
                              {item.unit}
                            </td>
                            <td className="w-[5%] border-b-2 py-1 text-sm text-center">
                              {item.quantity}
                            </td>
                            <td className="w-[10%] border-b-2 py-1 text-sm text-center">
                              <div className="flex items-center justify-center">
                                {item.category != "Additional Charges" && (
                                  <Pencil
                                    onClick={() => {
                                      // Find all makes for this item (from its `makes.list` in the original PO data)
                                      const itemMakes =
                                        PO?.items.find(
                                          (i) => i.name === item.name
                                        )?.makes?.list || [];
                                      const options = itemMakes.map((m) => ({
                                        label: m.make,
                                        value: m.make,
                                      }));

                                      setEditMakeOptions(options);

                                      // Find the currently enabled make
                                      const currentMakeValue = item.make;
                                      // Create the correct object structure for react-select
                                      const currentSelectedObject = {
                                        label: currentMakeValue,
                                        value: currentMakeValue,
                                      };

                                      setSelectedMake(currentSelectedObject);
                                      setTax(item.tax);
                                      setQuantity(item.quantity);
                                      setAmendEditItem(item);
                                      setShowAddNewMake(false); // Make sure the card is hidden initially
                                      toggleAmendEditItemDialog();
                                    }}
                                    className="w-4 h-4 cursor-pointer"
                                  />
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>

                <div className="flex p-2 gap-2 items-end justify-end">
                  <SheetClose asChild>
                    <Button
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      <CircleX className="h-4 w-4" />
                      Cancel
                    </Button>
                  </SheetClose>
                  {stack.length === 0 ? (
                    <HoverCard>
                      <HoverCardTrigger>
                        <Button
                          variant="outline"
                          disabled
                          className="border-primary flex items-center gap-1"
                        >
                          <CheckCheck className="h-4 w-4" />
                          Confirm
                        </Button>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                        <div>
                          <span className="text-primary underline">
                            No Amend operations are performed in this PO
                          </span>
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  ) : (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          className="border-primary flex items-center gap-1"
                        >
                          <CheckCheck className="h-4 w-4" />
                          Confirm
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>
                            <h1 className="justify-center text-center">
                              Are you sure you want to amend this PO?
                            </h1>
                          </DialogTitle>

                          <DialogDescription className="flex flex-col text-center gap-1">
                            Amending this PO will send this to Project Lead for
                            approval. Continue?
                            <div className="flex flex-col gap-2 mt-2">
                              <Textarea
                                placeholder="input the reason for amending this PO..."
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                              />
                            </div>
                            {loadingFuncName === "handleAmendPo" ? (
                              <div className="flex items-center justify-center">
                                <TailSpin width={80} color="red" />{" "}
                              </div>
                            ) : (
                              <div className="flex gap-2 items-center justify-center pt-2">
                                <Button
                                  onClick={handleAmendPo}
                                  className="flex items-center gap-1"
                                >
                                  <CheckCheck className="h-4 w-4" />
                                  Confirm
                                </Button>
                              </div>
                            )}
                          </DialogDescription>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
                <Dialog
                  open={amendEditItemDialog}
                  onOpenChange={toggleAmendEditItemDialog}
                >
                  <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle className="flex justify-between border-b-2 border-gray-300 pb-2">
                        Edit Item
                      </DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="flex flex-col gap-2">
                      <div className="flex space-x-2 max-md:flex-col space-y-2">
                        <div className="w-full md:w-2/3">
                          <h5 className="text-base text-gray-400 text-left mb-1">
                            Item Name
                          </h5>
                          <div className="w-full  p-1 text-left">
                            {amendEditItem?.item_name}
                          </div>
                        </div>
                        <div className="w-[30%]">
                          <h5 className="text-base text-gray-400 text-left mb-1">
                            Tax %
                          </h5>
                          <Select
                            value={String(tax) || ""}
                            onValueChange={(value) => {
                              // console.log(`Tax selection changed for String(item.tax || "")item_id: ${item.item_id}. New value: ${value}`);
                              console.log("tax", value);
                              setTax(Number(value));
                              // onTaxChange(amendEditItem.item_id, value);
                            }}
                            // disabled={mode === "view" || isReadOnly}
                          >
                            <SelectTrigger>
                              <SelectValue
                                className="text-gray-200"
                                placeholder="Select Tax %"
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem key={5} value={"5"}>
                                5 %
                              </SelectItem>
                              <SelectItem key={12} value={"12"}>
                                12 %
                              </SelectItem>
                              <SelectItem key={18} value={"18"}>
                                18 %
                              </SelectItem>
                              <SelectItem key={28} value={"28"}>
                                28 %
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex space-x-2 w-full">
                          <div className="w-[60%]">
                            <h5 className="text-base text-gray-400 text-left mb-1">
                              Make
                            </h5>
                            <div className="w-full">
                              <MakesSelection
                                selectedMake={selectedMake}
                                setSelectedMake={setSelectedMake}
                                editMakeOptions={editMakeOptions}
                                setEditMakeOptions={setEditMakeOptions} // Pass the setter function
                                // toggleAddNewMake={toggleAddNewMake}
                                amendEditItem={amendEditItem}
                              />
                            </div>
                          </div>
                          <div className="w-[30%]">
                            <h5 className="text-base text-gray-400 text-left mb-1">
                              UOM
                            </h5>
                            <div className=" w-full  p-2 text-center justify-left flex">
                              {amendEditItem?.unit}
                            </div>
                          </div>
                          <div className="w-[25%]">
                            <h5 className="text-base text-gray-400 text-left mb-1">
                              Qty
                            </h5>
                            <Input
                              type="number"
                              value={quantity || ""}
                              onChange={(e) =>
                                setQuantity(
                                  e.target.value !== ""
                                    ? parseFloat(e.target.value)
                                    : null
                                )
                              }
                              disabled={false}
                              readOnly={false}
                            />
                          </div>
                        </div>
                      </div>

                      {/* {showAddNewMake && (
                        <AddNewMakes
                          orderData={orderData}
                          setOrderData={setOrderData}
                          editMakeOptions={editMakeOptions}
                          amendEditItem={amendEditItem}
                          toggleAddNewMake={toggleAddNewMake}
                          setEditMakeOptions={setEditMakeOptions}
                        />
                      )} */}
                    </DialogDescription>
                    <DialogDescription className="flex justify-end">
                      <div className="flex gap-2">
                        {orderData?.filter((item)=>item.category!=="Additional Charges").length === 1 ? (
                          <Button className="flex items-center gap-1" disabled>
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleDelete(amendEditItem?.name)}
                            className="flex gap-1 items-center bg-gray-100 text-black hover:text-white"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        )}
                        <Button
                          disabled={!quantity}
                          onClick={() => handleSave(amendEditItem?.name)}
                          variant={"outline"}
                          className="flex gap-1 items-center"
                        >
                          <ListChecks className="h-4 w-4" />
                          Save
                        </Button>
                      </div>
                    </DialogDescription>
                  </DialogContent>
                </Dialog>
              </>
            </SheetContent>
          </Sheet>

          {/* Cancel PO */}
          {CANCELPOVALIDATION && (
            <Button
              onClick={toggleCancelPODialog}
              variant={"outline"}
              className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
            >
              <X className="w-4 h-4" />
              Cancel PO
            </Button>
          )}

          <AlertDialog
            open={cancelPODialog}
            onOpenChange={toggleCancelPODialog}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  <h1 className="justify-center">Are you sure!</h1>
                </AlertDialogTitle>

                <div className="space-y-6">
                  <div className="bg-primary/10 p-4 rounded-lg border border-primary/20">
                    <h3 className="font-semibold text-primary mb-2 flex items-center">
                      <AlertTriangle className="w-5 h-5 mr-2" />
                      Important Notes
                    </h3>
                    <ul className="list-disc list-inside space-y-1 text-sm text-primary/80">
                      <li>
                        If you want to add/change vendor quotes, choose this
                        option.
                      </li>
                      <li>
                        This action will create a new{" "}
                        <Badge variant="destructive">Cancelled</Badge> type Sent
                        Back Request within{" "}
                        <span className="text-red-700 font-semibold">
                          Rejected PO tab of Procurement Requests
                        </span>{" "}
                        side option.
                      </li>
                    </ul>
                  </div>
                </div>

                <AlertDialogDescription className="flex flex-col text-center gap-1">
                  Cancelling this PO will create a new cancelled type Sent Back.
                  Continue?
                  <div className="flex flex-col gap-2 mt-2">
                    <Textarea
                      placeholder="input the reason for cancelling..."
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </div>
                  {cancelPOCallLoading ? (
                    <div className="flex items-center justify-center">
                      <TailSpin width={80} color="red" />{" "}
                    </div>
                  ) : (
                    <div className="flex gap-2 items-center justify-center pt-2">
                      <AlertDialogCancel className="flex items-center gap-1">
                        <CircleX className="h-4 w-4" />
                        Cancel
                      </AlertDialogCancel>
                      <Button
                        onClick={handleCancelPo}
                        className="flex items-center gap-1"
                      >
                        <CheckCheck className="h-4 w-4" />
                        Confirm
                      </Button>
                    </div>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {/* Delivery History */}
      {["Delivered", "Partially Delivered"].includes(PO?.status) && (
        <DeliveryHistoryTable
          deliveryData={deliveryHistory.data}
            onPrintHistory={triggerHistoryPrint}
        />
      )}
      {/* PO Pdf  */}
      <POPdf
        poPdfSheet={poPdfSheet}
        togglePoPdfSheet={togglePoPdfSheet}
        po={PO}
        orderData={orderData}
        includeComments={includeComments}
        paymentTerms={mergedPaymentTerms} // make set term state
        // getTotal={getTotal}
        POTotals={previewTotal}
        advance={advance}
        materialReadiness={materialReadiness}
        afterDelivery={afterDelivery}
        xDaysAfterDelivery={xDaysAfterDelivery}
        xDays={xDays}
      />
      {/* Render RequestPaymentDialog here, outside the Accordion */}
      <RequestPaymentDialog
        totalIncGST={getTotal?.totalAmt || 0}
        totalExGST={getTotal?.total || 0}
        paid={amountPaid}
        pending={amountPending}
        gst={true}
        docType="Procurement Orders"
        docName={PO?.name || "Unknown"}
        project={PO?.project || "Unknown"}
        vendor={PO?.vendor || "Unknown"}
        onSuccess={poPaymentsMutate}
      />
      {PrintableHistoryComponent}
    </div>
  );
};

export default PurchaseOrder;

// ===================================================================
// ✨ NEW, SIMPLIFIED SINGLE-SELECT MAKES COMPONENT
// ===================================================================
interface MakesSelectionProps {
  selectedMake: Make | null;
  setSelectedMake: React.Dispatch<React.SetStateAction<Make | null>>;
  amendEditItem: PurchaseOrderItem | null;
}

const MakesSelection = ({
  selectedMake,
  setSelectedMake,
  amendEditItem,
}: MakesSelectionProps) => {
  // State for the options available in this component's dropdown.
  const [availableMakeOptions, setAvailableMakeOptions] = useState<Make[]>([]);

  // Fetch the list of possible makes for the current item's category
  const { data: categoryMakeList, isLoading: makesLoading } =
    useFrappeGetDocList(
      "Category Makelist",
      {
        fields: ["make"],
        filters: [["category", "=", amendEditItem?.category]],
        limit: 1000,
      },
      amendEditItem?.category
        ? `category_makelist_for_${amendEditItem.category}`
        : null
    );

  // Populate the available makes dropdown when data is fetched
  useEffect(() => {
    if (categoryMakeList) {
      const allCategoryMakes = categoryMakeList.map((i) => ({
        label: i.make,
        value: i.make,
      }));
      setAvailableMakeOptions(allCategoryMakes);

      // ✨ Optional: If the current item's make is not in the list, add it.
      // This handles cases where a make was manually entered before this feature was added.
      const currentMakeExists = allCategoryMakes.some(
        (opt) => opt.value === amendEditItem?.make
      );
      if (amendEditItem?.make && !currentMakeExists) {
        setAvailableMakeOptions((prev) => [
          { label: amendEditItem.make, value: amendEditItem.make },
          ...prev,
        ]);
      }
    }
  }, [categoryMakeList, amendEditItem?.make]);

  return (
    <ReactSelect
      options={availableMakeOptions}
      value={selectedMake}
      isMulti={false} // Ensure single select
      isLoading={makesLoading}
      onChange={(selectedOption) =>
        setSelectedMake(selectedOption as Make | null)
      }
      placeholder="Select a make..."
      noOptionsMessage={() => "No makes available for this category."}
    />
  );
};
