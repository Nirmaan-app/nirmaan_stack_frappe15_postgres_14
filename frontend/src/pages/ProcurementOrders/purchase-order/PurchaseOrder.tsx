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
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
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
  PurchaseOrderItem,
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
import { Tree } from "antd";
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
  List,
  Merge,
  MessageCircleMore,
  MessageCircleWarning,
  Split,
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
import { POAdjustmentHistory } from "@/pages/POAdjustment/POAdjustmentHistory";

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

  const [isRedirecting, setIsRedirecting] = useState(false);
  const poId = id?.replaceAll("&=", "/");

  const { data: lockData } = usePOLockCheck(poId);
  const isItemLocked = lockData?.is_item_locked || false;
  const isPaymentLocked = lockData?.is_payment_locked || false;

  const { data: allLockedPOs } = useAllLockedPOs();

  const [orderData, setOrderData] = useState<PurchaseOrderItem[]>([]);
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
      const doc = po;
      setPO(doc);
      setOrderData(doc?.items || []);
      // --- NEW: Initialize payment terms with the current PO's terms ---
      setMergedPaymentTerms(doc?.payment_terms || []);
    }
    if (po) {
      const data = { ...po, invoice_data: po?.invoice_data && JSON.parse(po?.invoice_data), delivery_data: po?.delivery_data && JSON.parse(po?.delivery_data) }
      setInvoicePO(data);
    }


  }, [po]);//po add




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

  const [unMergeDialog, setUnMergeDialog] = useState(false);

  const toggleUnMergeDialog = useCallback(() => {
    setUnMergeDialog((prevState) => !prevState);
  }, []);

  const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);

  const { toggleRequestPaymentDialog } = useDialogStore();

  const { updateDoc } = useFrappeUpdateDoc();

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

    // console.log("handleMerge: Tagged Items", mergedItems,taggedItems, orderData);
    // console.log("newMergedItems", newMergedItems);
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
      // console.log("payload",poId,mergedItems,sanitizedOrderData,mergedPaymentTerms)
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

  const treeData = useMemo(() => {
    if (!PO?.items) {
      return [{ title: PO?.name, key: "mainPO", children: [] }];
    }

    const allSourcePoNames = PO.items.map(item => item.po).filter(Boolean);
    const uniqueSourcePoNames = [...new Set(allSourcePoNames)];

    const childrenNodes = uniqueSourcePoNames.map((poName, idx) => ({
      title: poName,
      key: `po-${idx}-${poName}`,
      isLeaf: true,
    }));

    return [
      {
        title: PO?.name,
        key: "mainPO",
        children: childrenNodes,
      },
    ];
  }, [PO]);

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

  const CANCELPOVALIDATION = useMemo(
    () =>
      !summaryPage &&
      !accountsPage &&
      !PO?.custom &&
      !estimatesViewing &&
      !isAccountant &&
      ["PO Approved"].includes(PO?.status) &&
      !((poPayments || []).length > 0) &&
      PO?.merged !== "true",
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

  const UNMERGEPOVALIDATIONS = useMemo(
    () =>
      !summaryPage &&
      !accountsPage &&
      !PO?.custom &&
      !estimatesViewing &&
      !isAccountant &&
      PO?.merged === "true",
    [PO, summaryPage, accountsPage, estimatesViewing, isAccountant]
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

        <div className="flex gap-2 items-center justify-end">
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
        orderData={orderData}
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
      {/* PO Adjustment History */}
      {poId && <POAdjustmentHistory poId={poId} />}

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
