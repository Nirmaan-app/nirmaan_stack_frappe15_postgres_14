import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Sheet,
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
} from "@/types/NirmaanStack/ProcurementOrders";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import formatToIndianRupee from "@/utils/FormatPrice";
import {
  // getPOTotal,
  // getTotalAmountPaid,
  getTotalVendorInvoiceAmount,
  // getPreviewTotal,
} from "@/utils/getAmounts";
import { useDialogStore } from "@/zustand/useDialogStore";
import {
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
  Merge,
  MessageCircleMore,
  MessageCircleWarning,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DeliveryPivotTable, DELIVERY_EDIT_ROLES, RETURN_NOTE_ROLES } from "@/pages/DeliveryNotes/components/pivot-table";
import { InvoiceDialog } from "../invoices-and-dcs/components/InvoiceDialog";
import POAttachments from "./components/POAttachments";
import POPaymentTermsCard from "./components/POPaymentTermsCard";
import TransactionDetailsCard from "./components/TransactionDetailsCard";
import PORemarks from "./components/PORemarks";
import RequestPaymentDialog from "@/pages/ProjectPayments/request-payment/RequestPaymentDialog"; // Import the dialog component
import { DocumentAttachments } from "../invoices-and-dcs/DocumentAttachments";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Projects } from "@/types/NirmaanStack/Projects";
import { PaymentTerm, POTotals } from "@/types/NirmaanStack/ProcurementOrders";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";
import { PORevisionWarning } from "@/pages/PORevision/PORevisionWarning";
import { usePOLockCheck, useAllLockedPOs } from "@/pages/PORevision/data/usePORevisionQueries";
import { POAdjustmentDialog } from "@/pages/POAdjustment/POAdjustmentDialog";
import { PORevisionsAndAdjustments } from "./components/PORevisionsAndAdjustments";
import {
  MergePOTable,
  MergeConflictResolution,
  MergeEligibilityBanner,
  MergeMatchCriteria,
  useMergeResolution,
  type MergeStep,
} from "./merge";

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
  const isAccountant = useMemo(
    () => userData?.role === "Nirmaan Accountant Profile",
    [userData?.role]
  );
  const isProjectManager = useMemo(
    () => userData?.role === "Nirmaan Project Manager Profile",
    [userData?.role]
  );

  const navigate = useNavigate();
  const params = useParams();
  const id = summaryPage ? params.poId : params.id;
  // console.log("ID",id,params)

  if (!id) return <div>No PO ID Provided</div>;

  const poId = id?.replaceAll("&=", "/");

  const { data: lockData } = usePOLockCheck(poId);
  const isItemLocked = lockData?.is_item_locked || false;
  const isPaymentLocked = lockData?.is_payment_locked || false;

  const { data: allLockedPOs } = useAllLockedPOs();

  const [PO, setPO] = useState<ProcurementOrder | null>(null);


  const {
    data: po,
    isLoading: poLoading,
    error: poError,
    mutate: poMutate,
  } = useFrappeGetDoc<ProcurementOrder>("Procurement Orders", poId);

  // Fetch Vendor Invoices for this PO
  const { data: vendorInvoices } = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      fields: ["name", "invoice_no", "invoice_date", "invoice_amount", "status"],
      filters: [
        ["document_type", "=", "Procurement Orders"],
        ["document_name", "=", poId],
      ],
      limit: 1000,
    },
    poId ? `VendorInvoices-PO-${poId}` : null
  );


  //editing PO terms




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
  const [searchParams] = useSearchParams();

  const [openAccordionItems, setOpenAccordionItems] = useState(false);


  // --- MODIFICATION: Update the useEffect to also control the accordion ---
  useEffect(() => {
    // Check if the 'isEditing' parameter from the URL is 'true'
    if (searchParams.get('isEditing') === 'true') {
      // 1. Open the dialog

      // 2. ALSO, open the "Payment Details" accordion
      // We ensure we don't add duplicates by checking first
      setOpenAccordionItems(true);
    }
  }, [searchParams]); // This effect still runs on load and if URL params change.


  const { errors, isValid } = usePOValidation(PO);
  const [invoicePO, setInvoicePO] = useState<ProcurementOrder | null>(null);

  useEffect(() => {
    if (po) {
      setPO(po);
      const data = { ...po, invoice_data: po?.invoice_data && JSON.parse(po?.invoice_data), delivery_data: po?.delivery_data && JSON.parse(po?.delivery_data) }
      setInvoicePO(data);
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
  const [mergeStep, setMergeStep] = useState<MergeStep>("selection");

  const {
    regularConflicts,
    chargeConflicts,
    hasConflicts,
    allResolved,
    estimatedTotal,
    effectiveRegularResolutions,
    effectiveChargeResolutions,
    setRegularResolution,
    setChargeResolution,
    resetResolutions,
    buildResolvedOrderData,
  } = useMergeResolution(PO, mergedItems);

  const [comment, setComment] = useState("");

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

  const [cancelPODialog, setCancelPODialog] = useState(false);

  const toggleCancelPODialog = useCallback(() => {
    setCancelPODialog((prevState) => !prevState);
  }, [cancelPODialog]);


  const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);

  const { toggleRequestPaymentDialog } = useDialogStore();

  const { updateDoc } = useFrappeUpdateDoc();

  const { call: cancelPOCall, loading: cancelPOCallLoading } =
    useFrappePostCall("nirmaan_stack.api.handle_cancel_po.handle_cancel_po");

  const { call: mergePOCall, loading: mergePOCallLoading } = useFrappePostCall(
    "nirmaan_stack.api.po_merge_and_unmerge.handle_merge_pos"
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

  const { data: project, isLoading: project_loading } = useFrappeGetDoc<Projects>("Projects", PO?.project, PO?.project ? `Projects ${PO?.project}` : null)

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
      limit: 0,
    },
    poId ? undefined : null
  );

  // Fetch PO Attachments for counter in header
  const { data: poAttachmentsData } = useFrappeGetDocList(
    "Nirmaan Attachments",
    {
      fields: ["name", "attachment_type"],
      filters: [
        ["associated_doctype", "=", "Procurement Orders"],
        ["associated_docname", "=", poId],
      ],
      limit: 1000,
    },
    poId ? `Nirmaan Attachments-${poId}-counter` : null
  );

  const { data: AllPoPaymentsList, mutate: AllPoPaymentsListMutate } =
    useFrappeGetDocList<ProjectPayments>("Project Payments", {
      fields: ["*"],
      filters: [["document_type", "=", "Procurement Orders"]],
      limit: 0,
      orderBy: { field: "name", order: "desc" },
    });


  useEffect(() => {
    // console.log("STEP 1: Initial list from database:", potentialMergePOsList);

    // Wait until the main PO and the efficient list of names are ready.
    if (!potentialMergePOsList || !po || !AllPoPaymentsList) return;

    // A. Perform the final filtering that MUST be done on the frontend.
    //    (Checking against the AllPoPaymentsList is easier here).
    const mergeablePoNames = potentialMergePOsList
      .filter(
        (item) =>
          item.custom !== "true" &&
          !AllPoPaymentsList.some((j) => j.document_name === item.name) &&
          !allLockedPOs?.includes(item.name)
      )
      .map((item) => item.name); // We only need the names for the next step.

    // B. If we have names, call our backend function to get the FULL documents.
    // console.log("STEP 2: Names after client-side filter:", mergeablePoNames);
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
            // console.log("fullDocs:", fullDocs);
            const finalMergeablePOs = fullDocs.message?.filter((doc) => {
              const docPaymentType = doc.payment_terms?.[0]?.payment_type;

              // This check is now explicit:
              // 1. The other PO must HAVE a payment type.
              // 2. That type must MATCH the main PO's type.
              return docPaymentType && docPaymentType === mainPoPaymentType;
            });

            // console.log(
            //   "Final Filter: The final list of mergeable POs is:",
            //   finalMergeablePOs
            // );

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



  // Fetch DN records from API
  const {
    call: fetchDNs,
    result: dnResult,
  } = useFrappePostCall(
    'nirmaan_stack.api.delivery_notes.get_delivery_notes.get_delivery_notes'
  );

  useEffect(() => {
    if (poId) {
      fetchDNs({ procurement_order: poId });
    }
  }, [poId, PO?.modified]);

  const dnRecords: DeliveryNote[] = useMemo(
    () => (dnResult?.message as DeliveryNote[]) || [],
    [dnResult]
  );

  useEffect(() => {
    if (!mergeSheet) {
      handleUnmergeAll();
      setMergeStep("selection");
      resetResolutions();
    }
  }, [mergeSheet]);

  // const getTotal = useMemo(() => {
  //   return getPOTotal(PO);
  // }, [PO]);
  // --- NEW: Helper function to calculate merged terms ---
  // --- REPLACE with this corrected function ---
  // PurchaseOrder.tsx

  // const previewTotal = useMemo<POTotals>(() => {
  //   return getPreviewTotal(orderData);
  // }, [orderData, setOrderData, PO])
  // --- REPLACE with this corrected function ---
  // Derive merged payment terms from resolved items — recalculates whenever
  // resolutions change (via estimatedTotal dependency)
  const mergedPaymentTerms = useMemo((): PaymentTerm[] => {
    if (!PO || mergedItems.length === 0) return PO?.payment_terms || [];

    // Step 1: Combine terms by label (sums original amounts, picks latest due_date)
    const allPOs = [PO, ...mergedItems];
    const combinedTerms: { [label: string]: PaymentTerm } = {};

    allPOs.forEach(p => {
      (p.payment_terms || []).forEach(term => {
        const termAmount = parseFloat(String(term.amount)) || 0;

        if (combinedTerms[term.label]) {
          combinedTerms[term.label].amount = (combinedTerms[term.label].amount || 0) + termAmount;

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
          combinedTerms[term.label] = { ...term, amount: termAmount };
        }
      });
    });

    const rawTerms = Object.values(combinedTerms);
    const rawTotal = rawTerms.reduce((sum, t) => sum + t.amount, 0);

    // Step 2: Rescale amounts proportionally to match the resolved grand total
    // This handles the case where conflict resolution changes the effective total
    if (rawTotal === 0 || estimatedTotal === 0) return rawTerms;

    return rawTerms.map(term => ({
      ...term,
      amount: (term.amount / rawTotal) * estimatedTotal,
      percentage: (term.amount / rawTotal) * 100,
    }));
  }, [PO, mergedItems, estimatedTotal]);

  const handleMerge = (poToMerge: ProcurementOrder) => {
    setMergedItems((prev) => [...prev, poToMerge]);
  };

  const handleUnmerge = (poToUnmerge: ProcurementOrder) => {
    setMergedItems((prev) => prev.filter((m) => m.name !== poToUnmerge.name));
  };

  const handleUnmergeAll = () => {
    setMergedItems([]);
  };

  const handleMergePOs = async () => {
    try {
      const resolvedItems = buildResolvedOrderData();
      const sanitizedOrderData = resolvedItems.map(
        ({ po, ...restOfItem }) => restOfItem
      );
      const response = await mergePOCall({
        po_id: poId,
        merged_items: mergedItems,
        order_data: sanitizedOrderData,
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

        invalidateSidebarCounts();
        navigate(
          `/purchase-orders/${response.message.new_po_name.replaceAll(
            "/",
            "&="
          )}?tab=Approved%20PO`
        );
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
        invalidateSidebarCounts();
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

  // const amountPaid = useMemo(
  //   () =>
  //     getTotalAmountPaid(
  //       (poPayments || []).filter((i) => i?.status === "Paid")
  //     ),
  //   [poPayments]
  // );

  // const amountPending = useMemo(
  //   () =>
  //     getTotalAmountPaid(
  //       (poPayments || []).filter((i) =>
  //         ["Requested", "Approved"].includes(i?.status)
  //       )
  //     ),
  //   [poPayments]
  // );

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
      !isAccountant &&
      PO?.status === "PO Approved" &&
      PO?.merged !== "true" &&
      !((poPayments || [])?.length > 0) &&
      mergeablePOs.length > 0,
    [PO, mergeablePOs, poPayments, summaryPage, accountsPage, estimatesViewing, isAccountant]
  );

  const mergeConditions = useMemo(() => [
    { label: "PO Approved", met: PO?.status === "PO Approved", detail: PO?.status },
    { label: "Not Custom", met: PO?.custom !== "true" },
    { label: "Not Merged", met: PO?.merged !== "true" },
    { label: "No Payments", met: !((poPayments || []).length > 0) },
    { label: "Not Locked", met: !isItemLocked },
    { label: "Matches Found", met: mergeablePOs.length > 0, detail: `${mergeablePOs.length}` },
  ], [PO, poPayments, isItemLocked, mergeablePOs]);

  const CANCELPOVALIDATION = useMemo(
    () =>
      !summaryPage &&
      !accountsPage &&
      !PO?.custom &&
      !estimatesViewing &&
      !isAccountant &&
      ["PO Approved"].includes(PO?.status) &&
      !((poPayments || []).length > 0),
    [PO, poPayments, summaryPage, accountsPage, estimatesViewing, isAccountant]
  );

  const totalInvoiceAmount = useMemo(
    () =>
      vendorInvoices
        ?.reduce((sum, inv) => sum + (inv.invoice_amount || 0), 0) || 0,
    [vendorInvoices]
  );

  const totalPendingInvoiceAmount = useMemo(
    () =>
      vendorInvoices
        ?.filter((inv) => inv.status === "Pending")
        .reduce((sum, inv) => sum + (inv.invoice_amount || 0), 0) || 0,
    [vendorInvoices]
  );

  const totalApprovedInvoiceAmount = useMemo(
    () =>
      vendorInvoices
        ?.filter((inv) => inv.status === "Approved")
        .reduce((sum, inv) => sum + (inv.invoice_amount || 0), 0) || 0,
    [vendorInvoices]
  );

  // Calculate invoice count from Vendor Invoices
  const invoiceCount = useMemo(
    () => vendorInvoices?.length || 0,
    [vendorInvoices]
  );

  // Calculate DC & MIR count
  const dcMirCount = useMemo(
    () =>
      poAttachmentsData?.filter(
        (att) =>
          att.attachment_type === "po delivery challan" ||
          att.attachment_type === "material inspection report"
      ).length || 0,
    [poAttachmentsData]
  );

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
            onClick={() => { invalidateSidebarCounts(); navigate("/purchase-orders?tab=Approved%20PO"); }}
          >
            Go Back
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex-1 space-y-4">
      <PORevisionWarning poId={poId} />

      {MERGEPOVALIDATIONS && !isItemLocked && (
        <>
          <Alert variant="warning">
            <AlertTitle className="text-sm flex items-center gap-2">
              <MessageCircleWarning className="h-4 w-4" />
              PO Merge Available
            </AlertTitle>
            <AlertDescription>
              <MergeEligibilityBanner
                conditions={mergeConditions}
                matchCount={mergeablePOs.length}
              />
              <div className="flex justify-end mt-3">
                <Sheet open={mergeSheet} onOpenChange={toggleMergeSheet}>
                  <SheetTrigger
                    disabled={!isValid}
                    className="disabled:opacity-50"
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={
                            isValid ? "Merge PO(s)" : "Merge unavailable"
                          }
                          className="flex items-center gap-1"
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
                  </SheetTrigger>
                  <SheetContent className="overflow-y-auto">
                    <div className="md:p-6">
                      <h2 className="text-2xl font-bold mb-4">
                        Merge Purchase Orders
                      </h2>

                      {/* Step indicator */}
                      {hasConflicts && (
                        <div className="flex items-center gap-2 mb-4">
                          <div className={`h-2 w-2 rounded-full ${mergeStep === "selection" ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          <span className={`text-xs ${mergeStep === "selection" ? "font-medium" : "text-muted-foreground"}`}>
                            Select POs
                          </span>
                          <div className="h-px w-4 bg-border" />
                          <div className={`h-2 w-2 rounded-full ${mergeStep === "resolution" ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          <span className={`text-xs ${mergeStep === "resolution" ? "font-medium" : "text-muted-foreground"}`}>
                            Resolve Conflicts
                          </span>
                        </div>
                      )}

                      <MergeMatchCriteria
                        project={PO?.project_name || ""}
                        vendor={PO?.vendor_name || ""}
                        paymentType={PO?.payment_terms?.[0]?.payment_type || "N/A"}
                        matchCount={mergeablePOs.length}
                      />

                    {/* Step content */}
                    {mergeStep === "selection" ? (
                      PO && (
                        <MergePOTable
                          basePO={PO}
                          mergeablePOs={mergeablePOs}
                          mergedItems={mergedItems}
                          onMerge={handleMerge}
                          onUnmerge={handleUnmerge}
                        />
                      )
                    ) : (
                      <MergeConflictResolution
                        regularConflicts={regularConflicts}
                        chargeConflicts={chargeConflicts}
                        regularResolutions={effectiveRegularResolutions}
                        chargeResolutions={effectiveChargeResolutions}
                        onRegularResolutionChange={setRegularResolution}
                        onChargeResolutionChange={setChargeResolution}
                        estimatedTotal={estimatedTotal}
                      />
                    )}

                    {/* Button Section */}
                    <div className="flex justify-end space-x-4 mt-6">
                      {mergeStep === "resolution" && (
                        <Button
                          variant="outline"
                          onClick={() => setMergeStep("selection")}
                        >
                          Back
                        </Button>
                      )}
                      <Button
                        className="flex items-center gap-1"
                        onClick={togglePoPdfSheet}
                        variant="outline"
                      >
                        <Eye className="w-4 h-4" />
                        Preview
                      </Button>

                      {mergeStep === "selection" && hasConflicts && mergedItems.length > 0 ? (
                        <Button
                          className="flex items-center gap-1"
                          onClick={() => setMergeStep("resolution")}
                        >
                          Next: Resolve
                        </Button>
                      ) : (
                        <AlertDialog
                          open={mergeConfirmDialog}
                          onOpenChange={toggleMergeConfirmDialog}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              className="flex items-center gap-1"
                              disabled={
                                !mergedItems.length ||
                                (mergeStep === "resolution" && !allResolved)
                              }
                            >
                              <CheckCheck className="h-4 w-4" />
                              {mergeStep === "resolution" ? "Confirm Merge" : "Confirm"}
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
                      )}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
              </div>
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
        totalInvoice={totalInvoiceAmount}
        totalUploadedInvoiceAmount={totalInvoiceAmount}
        totalPendingInvoiceAmount={totalPendingInvoiceAmount}
        totalApprovedInvoiceAmount={totalApprovedInvoiceAmount}
        amountPaid={PO?.amount_paid}
        poMutate={poMutate}
        onAdjustPayments={() => setIsAdjustmentDialogOpen(true)}
      />
      {/* Payment Details - hidden for Project Manager */}
      {!isProjectManager && (
        <Card className="rounded-sm  md:col-span-3 p-2">
          <Accordion
            type="multiple"
            defaultValue={openAccordionItems == true ? ["transac&payments"] : []}
            // value={openAccordionItems}
            className="w-full"
          >
            <AccordionItem key="transac&payments" value="transac&payments">
              {/* {tab === "Delivered PO" && ( */}
              <AccordionTrigger>
                <div className="flex items-center gap-3 pl-6">
                  <p className="font-semibold text-lg text-red-600">
                    Payment Details
                  </p>
                  {(poPayments || []).filter((p) => p?.status === "Paid").length > 0 && (
                    <Badge variant="secondary">
                      {(poPayments || []).filter((p) => p?.status === "Paid").length}
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              {/* )} */}
              <AccordionContent>
                <div className="grid gap-4 max-[1000px]:grid-cols-1 grid-cols-6">
                  <TransactionDetailsCard
                    accountsPage={accountsPage}
                    estimatesViewing={estimatesViewing}
                    summaryPage={summaryPage}
                    PO={PO}
                    getTotal={PO?.total_amount}
                    amountPaid={PO?.amount_paid}
                    poPayments={poPayments}
                    poPaymentsMutate={poPaymentsMutate}
                    AllPoPaymentsListMutate={AllPoPaymentsListMutate}
                  />

                  <POPaymentTermsCard
                    accountsPage={accountsPage}
                    estimatesViewing={estimatesViewing}
                    summaryPage={summaryPage}
                    PO={PO}
                    getTotal={PO?.total_amount}
                    poMutate={poMutate}
                    projectPaymentsMutate={poPaymentsMutate}
                    isLocked={isPaymentLocked}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      )}

      {/* Delivery Notes Accordion - Only for dispatched/delivered statuses */}
      {PO?.status &&
        ["Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"].includes(
          PO?.status
        ) && (
          <Card className="rounded-sm md:col-span-3 p-2">
            <Accordion type="multiple" className="w-full">
              <AccordionItem value="delivery-notes">
                <AccordionTrigger>
                  <div className="flex items-center gap-3 pl-6">
                    <p className="font-semibold text-lg text-primary">
                      Delivery Notes
                    </p>
                    <Badge variant="secondary">
                      {dnRecords.length} updates
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-2">
                  <DeliveryPivotTable
                    po={PO}
                    dnRecords={dnRecords}
                    onPoMutate={poMutate}
                    onDnRefetch={() => fetchDNs({ procurement_order: poId })}
                    canEdit={(DELIVERY_EDIT_ROLES as readonly string[]).includes(userData?.role) && ["Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"].includes(PO?.status || "")}
                    canReturn={(RETURN_NOTE_ROLES as readonly string[]).includes(userData?.role) && ["Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"].includes(PO?.status || "")}
                    returnCount={dnRecords.filter(dn => dn.is_return === 1).length}
                    isEmbedded
                    isProjectManager={isProjectManager}
                    isLocked={isItemLocked}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Card>
        )}

      {/* PO Attachments Accordion */}

      {PO?.status && (
        <Card className="rounded-sm md:col-span-3 p-2">
          <Accordion
            type="multiple"
            // defaultValue={tab !== "Delivered PO" ? ["poattachments"] : []}
            className="w-full"
          >
            <AccordionItem key="poattachments" value="poattachments">
              {/* {tab === "Delivered PO" && ( */}
              <AccordionTrigger>
                <div className="flex items-center gap-3 pl-6">
                  <p className="font-semibold text-lg text-red-600">
                    PO Attachments
                  </p>
                  <div className="flex items-center gap-2 text-sm">
                    {!isProjectManager && (
                      <>
                        <span className="text-gray-600">Invoices:</span>
                        <Badge variant="secondary">{invoiceCount}</Badge>
                        <span className="text-gray-400">|</span>
                      </>
                    )}
                    <span className="text-gray-600">DC & MIRs:</span>
                    <Badge variant="secondary">{dcMirCount}</Badge>
                  </div>
                </div>
              </AccordionTrigger>
              {/* )} */}
              <AccordionContent>
                <DocumentAttachments
                  docType="Procurement Orders"
                  docName={PO?.name}
                  documentData={invoicePO}
                  docMutate={poMutate}
                  project={project}
                  disabledAddInvoice={PO?.status == "Inactive"}
                  isProjectManager={isProjectManager}
                  isEstimatesExecutive={estimatesViewing}
                />

                {/* <POAttachments PO={PO} poMutate={poMutate} /> */}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      )}

      {/* Revisions & Adjustments Accordion */}
      {poId && <PORevisionsAndAdjustments poId={poId} />}

      {/* Invoice Dialog */}
      <InvoiceDialog
        docName={PO?.name}
        docType="Procurement Orders"
        docMutate={poMutate}
        vendor={PO?.vendor}
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
          {/* Desktop Table View (≥1024px) */}
          <div className="hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] border-collapse">
                <thead className="bg-red-100">
                  <tr className="text-sm font-semibold text-gray-700">
                    <th className="text-left pl-4 py-3">S.No.</th>
                    <th className="text-left pl-2 py-3">Item Name</th>
                    <th className="text-center py-3">Unit</th>
                    <th className="text-center py-3">Qty</th>
                    {["Partially Delivered", "Delivered"].includes(PO?.status) && (
                      <th className="text-center py-3">Delivered Qty</th>
                    )}
                    {!isProjectManager && <th className="text-center py-3">Rate</th>}
                    {!isProjectManager && <th className="text-center py-3">Tax</th>}
                    {!isProjectManager && <th className="text-center py-3">Amount</th>}
                    {!isProjectManager && <th className="text-center pr-4 py-3">Amount (incl.GST)</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {PO?.items?.map((item, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors text-sm text-gray-600">
                      <td className="pl-4 py-3 align-top">{index + 1}</td>
                      <td className="pl-2 py-3 align-top">
                        <div className="flex flex-col gap-1">
                          <span>{item.item_name}</span>
                          <small className="font-medium text-red-700">{item?.make}</small>
                          {item.comment && (
                            <div className="flex gap-1 items-start bg-gray-50 rounded p-1.5 mt-1">
                              <MessageCircleMore className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
                              <div className="text-xs text-gray-600 leading-snug">{item.comment}</div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="text-center py-3 align-top">{item.unit}</td>
                      <td className="text-center py-3 align-top">{item.quantity}</td>
                      {["Partially Delivered", "Delivered"].includes(PO?.status) && (
                        <td className={`text-center py-3 align-top ${item?.received_quantity === item?.quantity ? "text-green-600" : "text-red-700"
                          }`}>
                          {item?.received_quantity || 0}
                        </td>
                      )}
                      {!isProjectManager && <td className="text-center py-3 align-top">{formatToIndianRupee(item?.quote)}</td>}
                      {!isProjectManager && <td className="text-center py-3 align-top">{item?.tax}%</td>}
                      {!isProjectManager && <td className="text-center py-3 align-top font-medium">{formatToIndianRupee(item?.amount)}</td>}
                      {!isProjectManager && (
                        <td className="text-center pr-4 py-3 align-top font-medium">
                          {formatToIndianRupee(item?.quote * item?.quantity * (1 + item?.tax / 100))}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile/Tablet Card View (<1024px) */}
          <div className="lg:hidden divide-y divide-gray-200">
            {PO?.items?.map((item, index) => (
              <div key={index} className="p-4 hover:bg-gray-50 transition-colors">
                {/* Item Header */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1">
                    <div className="flex items-start gap-2">
                      <Badge variant="outline" className="shrink-0">{index + 1}</Badge>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 text-sm leading-tight">{item.item_name}</p>
                        <p className="text-xs text-red-700 font-medium mt-1">{item?.make}</p>
                      </div>
                    </div>
                    {item.comment && (
                      <div className="flex gap-1 items-start bg-gray-100 rounded p-2 mt-2">
                        <MessageCircleMore className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
                        <div className="text-xs text-gray-600 leading-snug">{item.comment}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Item Details Grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Unit:</span>
                    <span className="font-medium text-gray-900">{item.unit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Qty:</span>
                    <span className="font-medium text-gray-900">{item.quantity}</span>
                  </div>

                  {["Partially Delivered", "Delivered"].includes(PO?.status) && (
                    <div className="flex justify-between col-span-2">
                      <span className="text-gray-500">Delivered:</span>
                      <span className={`font-medium ${item?.received_quantity === item?.quantity ? "text-green-600" : "text-red-700"
                        }`}>
                        {item?.received_quantity || 0} / {item.quantity}
                      </span>
                    </div>
                  )}

                  {/* Financial fields hidden for Project Manager */}
                  {!isProjectManager && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Rate:</span>
                        <span className="font-medium text-gray-900">{formatToIndianRupee(item?.quote)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Tax:</span>
                        <span className="font-medium text-gray-900">{item?.tax}%</span>
                      </div>

                      <div className="flex justify-between col-span-2 pt-2 border-t border-gray-200 mt-1">
                        <span className="text-gray-700 font-medium">Total (incl. GST):</span>
                        <span className="font-semibold text-gray-900">
                          {formatToIndianRupee(item?.quote * item?.quantity * (1 + item?.tax / 100))}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {/* Cancel PO Button */}
      <div className="flex items-center justify-end">
        <div className="flex gap-2 items-center justify-end">
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
                      {PO?.merged === "true" && (
                        <li>
                          This is a <Badge variant="orange">Merged PO</Badge>. Cancelling will also cancel
                          all source POs that were merged into it.
                        </li>
                      )}
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
      {/* PO Remarks Section */}
      {poId && (
        <Card className="rounded-sm md:col-span-3 p-2">
          <PORemarks poId={poId} />
        </Card>
      )}

      {/* PO Pdf  */}
      <POPdf
        poPdfSheet={poPdfSheet}
        togglePoPdfSheet={togglePoPdfSheet}
        po={PO}
        orderData={mergedItems.length > 0 ? buildResolvedOrderData() : PO?.items}
        includeComments={includeComments}
        paymentTerms={mergedPaymentTerms} // make set term state
        // getTotal={getTotal}
        // POTotals={previewTotal}
        advance={advance}
        materialReadiness={materialReadiness}
        afterDelivery={afterDelivery}
        xDaysAfterDelivery={xDaysAfterDelivery}
        xDays={xDays}
      />
      {/* Render RequestPaymentDialog here, outside the Accordion */}
      <RequestPaymentDialog
        totalIncGST={PO?.total_amount || 0}
        totalExGST={PO?.amount || 0}
        paid={PO?.amount_paid}
        pending={PO?.total_amount - PO?.amount_paid}
        gst={true}
        docType="Procurement Orders"
        docName={PO?.name || "Unknown"}
        project={PO?.project || "Unknown"}
        vendor={PO?.vendor || "Unknown"}
        onSuccess={poPaymentsMutate}
      />
      {/* PO Adjustment Button - moved to PODetails Section 5 buttons row */}

      {/* PO Adjustment Dialog */}
      {poId && PO?.vendor && (
        <POAdjustmentDialog
          poId={poId}
          vendor={PO.vendor}
          isOpen={isAdjustmentDialogOpen}
          onClose={() => setIsAdjustmentDialogOpen(false)}
        />
      )}
    </div>
  );
};

export default PurchaseOrder;
