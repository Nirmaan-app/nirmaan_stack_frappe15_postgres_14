import logo from "@/assets/logo-svg.svg";
import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import { AddressView } from "@/components/address-view";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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
import { toast } from "@/components/ui/use-toast";
import { VendorHoverCard } from "@/components/ui/vendor-hover-card";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getPOTotal, getTotalAmountPaid } from "@/utils/getAmounts";
import { useDialogStore } from "@/zustand/useDialogStore";
import { Tree } from "antd";
import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeFileUpload,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappePostCall,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { debounce } from "lodash";
import {
  AlertTriangle,
  BookCheck,
  CalendarDays,
  CheckCheck,
  CircleX,
  Download,
  Eye,
  HandCoins,
  Info,
  List,
  ListChecks,
  Mail,
  Merge,
  MessageCircleMore,
  MessageCircleWarning,
  Paperclip,
  Pencil,
  PencilIcon,
  PencilRuler,
  Phone,
  Printer,
  Send,
  Split,
  SquarePlus,
  Trash2,
  TriangleAlert,
  Truck,
  Undo,
  Undo2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import ReactSelect, { components } from "react-select";
import { useReactToPrint } from "react-to-print";
import RequestPaymentDialog from "../ProjectPayments/request-payment-dialog";

interface PurchaseOrderProps {
  summaryPage?: boolean;
  accountsPage?: boolean;
}

export const PurchaseOrder = ({
  summaryPage = false,
  accountsPage = false,
}: PurchaseOrderProps) => {
  const params = useParams();

  const id = accountsPage ? params.id : params.poId;

  const [isRedirecting, setIsRedirecting] = useState(false);

  const [searchParams] = useSearchParams();

  const tab = searchParams.get("tab") || "Approved PO";

  const poId = id?.replaceAll("&=", "/");

  const navigate = useNavigate();

  const userData = useUserData();

  const [estimatesViewing, setEstimatesViewing] = useState(false);

  useEffect(() => {
    if (userData?.role === "Nirmaan Estimates Executive Profile") {
      setEstimatesViewing(true);
    }
  }, [userData]);

  const [advance, setAdvance] = useState(0);
  const [materialReadiness, setMaterialReadiness] = useState(0);
  const [afterDelivery, setAfterDelivery] = useState(0);
  const [xDaysAfterDelivery, setXDaysAfterDelivery] = useState(0);
  const [xDays, setXDays] = useState(0);
  const [loadingCharges, setLoadingCharges] = useState(0);
  const [freightCharges, setFreightCharges] = useState(0);
  const [includeComments, setIncludeComments] = useState(false);
  const [notes, setNotes] = useState("");
  const [contactPerson, setContactPerson] = useState({
    name: "",
    number: "",
  });

  const [selectedGST, setSelectedGST] = useState(null);

  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [emailError, setEmailError] = useState("");

  const [mergeablePOs, setMergeablePOs] = useState([]);
  const [mergedItems, setMergedItems] = useState([]);
  const [prevMergedPOs, setPrevMergedPos] = useState([]);

  const [loadingFuncName, setLoadingFuncName] = useState("");

  const [orderData, setOrderData] = useState({
    list: [],
  });

  const [quantity, setQuantity] = useState<number | null | string>(null);
  const [stack, setStack] = useState([]);
  const [comment, setComment] = useState("");

  const [editMakeOptions, setEditMakeOptions] = useState([]);

  const [selectedMake, setSelectedMake] = useState(null);

  const [amendEditItem, setAmendEditItem] = useState("");

  const [poPdfSheet, setPoPdfSheet] = useState(false);

  const togglePoPdfSheet = () => {
    setPoPdfSheet((prevState) => !prevState);
  };

  const [editPOTermsDialog, setEditPOTermsDialog] = useState(false);

  const toggleEditPOTermsDialog = () => {
    setEditPOTermsDialog((prevState) => !prevState);
  };

  const [mergeSheet, setMergeSheet] = useState(false);

  const toggleMergeSheet = () => {
    setMergeSheet((prevState) => !prevState);
  };

  const [mergeConfirmDialog, setMergeConfirmDialog] = useState(false);

  const toggleMergeConfirmDialog = () => {
    setMergeConfirmDialog((prevState) => !prevState);
  };

  const [amendPOSheet, setAmendPOSheet] = useState(false);

  const toggleAmendPOSheet = () => {
    setAmendPOSheet((prevState) => !prevState);
  };

  const [cancelPODialog, setCancelPODialog] = useState(false);

  const toggleCancelPODialog = () => {
    setCancelPODialog((prevState) => !prevState);
  };

  const [unMergeDialog, setUnMergeDialog] = useState(false);

  const toggleUnMergeDialog = () => {
    setUnMergeDialog((prevState) => !prevState);
  };

  const [amendEditItemDialog, setAmendEditItemDialog] = useState(false);

  const toggleAmendEditItemDialog = () => {
    setAmendEditItemDialog((prevState) => !prevState);
  };

  const [showAddNewMake, setShowAddNewMake] = useState(false);

  const toggleAddNewMake = () => {
    setShowAddNewMake((prevState) => !prevState);
  };

  const [revertDialog, setRevertDialog] = useState(false);

  const toggleRevertDialog = () => {
    setRevertDialog((prevState) => !prevState);
  };

  const [newPaymentDialog, setNewPaymentDialog] = useState(false);

  const toggleNewPaymentDialog = () => {
    setNewPaymentDialog((prevState) => !prevState);
  };

  const { toggleRequestPaymentDialog} = useDialogStore()

  const [warning, setWarning] = useState("");

  const [newPayment, setNewPayment] = useState({
    amount: "",
    payment_date: "",
    utr: "",
  });

  const [paymentScreenshot, setPaymentScreenshot] = useState(null);

  const handleFileChange = (event) => {
    setPaymentScreenshot(event.target.files[0]);
  };

  const { updateDoc } = useFrappeUpdateDoc();

  const { createDoc } = useFrappeCreateDoc();

  const { deleteDoc } = useFrappeDeleteDoc();

  const { upload: upload } = useFrappeFileUpload();

  const { call } = useFrappePostCall("frappe.client.set_value");

  const [deleteFlagged, setDeleteFlagged] = useState(null);

  const {
    data: po,
    isLoading: poLoading,
    error: poError,
    mutate: poMutate,
  } = useFrappeGetDoc("Procurement Orders", poId);

  const {
    data: associated_po_list,
    error: associated_po_list_error,
    isLoading: associated_po_list_loading,
    mutate: associated_po_list_mutate,
  } = useFrappeGetDocList("Procurement Orders", {
    fields: ["*"],
    limit: 100000,
  });

  const { data: poProject } = useFrappeGetDoc(
    "Projects",
    po?.project,
    po ? undefined : null
  );

  const {
    data: pr,
    isLoading: prLoading,
    error: prError,
  } = useFrappeGetDoc("Procurement Requests", po?.procurement_request);

  // const { data: vendor_address, isLoading: vendor_address_loading, error: vendor_address_error } = useFrappeGetDoc("Address", po?.vendor_address, po ? undefined : null)

  // const { data: project_address, isLoading: project_address_loading, error: project_address_error } = useFrappeGetDoc("Address", po?.project_address, po ? undefined : null)

  const {
    data: usersList,
    isLoading: usersListLoading,
    error: usersListError,
  } = useFrappeGetDocList("Nirmaan Users", {
    fields: ["name", "full_name"],
    limit: 1000,
  });

  const {
    data: poPayments,
    isLoading: poPaymentsLoading,
    error: poPaymentsError,
    mutate: poPaymentsMutate,
  } = useFrappeGetDocList("Project Payments", {
    fields: ["*"],
    filters: [["document_name", "=", poId]],
    limit: 1000,
  });

  const { data: AllPoPaymentsList, mutate: AllPoPaymentsListMutate } =
    useFrappeGetDocList("Project Payments", {
      fields: ["*"],
      filters: [["document_type", "=", "Procurement Orders"]],
      limit: 1000,
    });

  const { control, handleSubmit, reset } = useForm({
    defaultValues: {
      advance: 0,
      materialReadiness: 0,
      afterDelivery: 0,
      xDaysAfterDelivery: 0,
      xDays: 0,
      loadingCharges: 0,
      freightCharges: 0,
      notes: "",
    },
  });

  useEffect(() => {
    if (po) {
      const chargesArray = po?.advance?.split(", ");
      setAdvance(parseFloat(chargesArray[0] || 0));
      setMaterialReadiness(parseFloat(chargesArray[1] || 0));
      setAfterDelivery(parseFloat(chargesArray[2] || 0));
      setXDaysAfterDelivery(parseFloat(chargesArray[3] || 0));
      setXDays(parseFloat(chargesArray[4] || 0));
      setLoadingCharges(parseFloat(po?.loading_charges || 0));
      setFreightCharges(parseFloat(po?.freight_charges || 0));
      setNotes(po?.notes || "");
      reset({
        advance: parseFloat(chargesArray[0] || 0),
        materialReadiness: parseFloat(chargesArray[1] || 0),
        afterDelivery: parseFloat(chargesArray[2] || 0),
        xDaysAfterDelivery: parseFloat(chargesArray[3] || 0),
        xDays: parseFloat(chargesArray[4] || 0),
        loadingCharges: parseFloat(po.loading_charges || 0),
        freightCharges: parseFloat(po.freight_charges || 0),
        notes: po.notes || "",
      });
      setOrderData(po?.order_list ? JSON.parse(po?.order_list) : { list: [] });
      if (po?.project_gst) {
        setSelectedGST((prev) => ({ ...prev, gst: po?.project_gst }));
      }
    }
  }, [po, reset]);

  useEffect(() => {
    if (associated_po_list && associated_po_list?.length > 0) {
      if (po?.status === "PO Approved") {
        const mergeablePOs = associated_po_list.filter(
          (item) =>
            item.project === po?.project &&
            item.vendor === po?.vendor &&
            item.status === "PO Approved" &&
            item.name !== poId &&
            !AllPoPaymentsList?.some((j) => j?.document_name === item.name)
            // item.merged !== "true" &&
        );
        setMergeablePOs(mergeablePOs);
        if (po?.merged === "true") {
          const mergedPOs = associated_po_list.filter(
            (po) => po?.merged === poId
          );
          setPrevMergedPos(mergedPOs);
        }
      }
    }
  }, [associated_po_list, po, AllPoPaymentsList]);

  // const categoryTotals = useMemo(() => orderData?.list?.reduce((acc, item) => {
  //   const category = acc[item.category] || { withoutGst: 0, withGst: 0 };
  //   const itemTotal = item.quantity * item.quote;
  //   const itemTotalWithGst = itemTotal * (1 + item.tax / 100);
  //   category.withoutGst += itemTotal;
  //   category.withGst += itemTotalWithGst;
  //   acc[item.category] = category;
  //   return acc;
  // }, {}), [orderData]);

  // const overallTotal = useMemo(() => Object.values(categoryTotals || "[]").reduce(
  //   (acc, totals) => ({
  //     withoutGst: acc.withoutGst + totals.withoutGst,
  //     withGst: acc.withGst + totals.withGst,
  //   }),
  //   { withoutGst: 0, withGst: 0 }
  // ), [categoryTotals]);

  const componentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current || null,
    documentTitle: `${po?.name}_${po?.vendor_name}`,
  });


  const onSubmit = async (data: any) => {
    try {
      setLoadingFuncName("onSubmit");
      const updateData = {
        advance: `${data.advance !== "" ? parseInt(data.advance) : 0}, ${
          data.materialReadiness !== "" ? parseInt(data.materialReadiness) : 0
        }, ${data.afterDelivery !== "" ? parseInt(data.afterDelivery) : 0}, ${
          data.xDaysAfterDelivery !== "" ? parseInt(data.xDaysAfterDelivery) : 0
        }, ${data.xDays !== "" ? parseInt(data.xDays) : 0}`,
        loading_charges:
          data.loadingCharges !== "" ? parseInt(data.loadingCharges) : 0,
        freight_charges:
          data.freightCharges !== "" ? parseInt(data.freightCharges) : 0,
        notes: data.notes || "",
        project_gst: selectedGST?.gst,
      };

      const res = await updateDoc("Procurement Orders", po?.name, updateData);

      await poMutate();
      toggleEditPOTermsDialog();
      toast({
        title: "Success!",
        description: `${res.name} updated successfully!`,
        variant: "success",
      });
    } catch (error) {
      console.log("update_submit_error", error);
      toast({
        title: "Failed!",
        description: `Failed to update ${po?.name}`,
        variant: "destructive",
      });
    } finally {
      setLoadingFuncName("");
    }
  };

  const checkPrintDisabled =
    advance > 100 ||
    advance < 0 ||
    materialReadiness > 100 ||
    materialReadiness < 0 ||
    afterDelivery > 100 ||
    afterDelivery < 0 ||
    xDaysAfterDelivery > 100 ||
    xDaysAfterDelivery < 0 ||
    ![100, 0].includes(
      advance + materialReadiness + afterDelivery + xDaysAfterDelivery
    );

  useEffect(() => {
    if (!mergeSheet) {
      handleUnmergeAll();
    }
  }, [mergeSheet]);

  useEffect(() => {
    if (!editPOTermsDialog && po) {
      const chargesArray = po?.advance?.split(", ");
      setAdvance(parseFloat(chargesArray[0] || 0));
      setMaterialReadiness(parseFloat(chargesArray[1] || 0));
      setAfterDelivery(parseFloat(chargesArray[2] || 0));
      setXDaysAfterDelivery(parseFloat(chargesArray[3] || 0));
      setXDays(parseFloat(chargesArray[4] || 0));
      setLoadingCharges(parseFloat(po?.loading_charges || 0));
      setFreightCharges(parseFloat(po?.freight_charges || 0));
      setNotes(po?.notes || "");
      reset({
        advance: parseFloat(chargesArray[0] || 0),
        materialReadiness: parseFloat(chargesArray[1] || 0),
        afterDelivery: parseFloat(chargesArray[2] || 0),
        xDaysAfterDelivery: parseFloat(chargesArray[3] || 0),
        xDays: parseFloat(chargesArray[4] || 0),
        loadingCharges: parseFloat(po.loading_charges || 0),
        freightCharges: parseFloat(po.freight_charges || 0),
        notes: po.notes || "",
      });
    }
  }, [editPOTermsDialog]);

  const getTotal = useMemo(() => {
    if (po) {
      return getPOTotal(po, freightCharges, loadingCharges);
    }
  }, [po, freightCharges, loadingCharges]);

  const handleMerge = (po) => {
    let updatedOrderList = po.order_list.list;
    if (po?.merged !== "true") {
      updatedOrderList = po.order_list.list.map((item) => ({
        ...item,
        po: po.name,
      }));
    }

    if (orderData) {
      const updatedList = [...orderData.list, ...updatedOrderList];

      setOrderData({ list: updatedList });

      setMergedItems((prev) => [...prev, po]);
    }
  };

  const handleUnmerge = (po) => {
    if (orderData) {
      let updatedList;
      if (po?.merged === "true") {
        const associated_merged_pos =
          associated_po_list
            ?.filter((item) => item.merged === po?.name)
            ?.map((i) => i?.name) || [];
        updatedList = orderData.list.filter(
          (item) => !associated_merged_pos.includes(item.po)
        );
      } else {
        updatedList = orderData.list.filter((item) => item.po !== po.name);
      }

      setOrderData({ list: updatedList });

      // Remove the unmerged PO from the mergedItems array
      setMergedItems((prev) =>
        prev.filter((mergedPo) => mergedPo?.name !== po.name)
      );
    }
  };

  const handleUnmergeAll = () => {
    if (mergedItems.length) {
      const updatedList = orderData.list.filter((item) => !item.po);

      setOrderData({ list: updatedList });

      setMergedItems([]);
    }
  };

  const handleMergePOs = async () => {
    setLoadingFuncName("handleMergePOs");

    try {
      const sanitizeOrderItems = (items) =>
        items.map((item) => (item?.po ? item : { ...item, po: po?.name }));

      const updatedOrderList = sanitizeOrderItems(orderData.list);
      const freshMergedPos = [
        ...(mergedItems?.filter((item) => item?.merged !== "true") || []),
        po,
      ];

      // 2. Previous Merge Handling
      const previouslyMergedPos = mergedItems?.filter(
        (item) => item?.merged === "true"
      );
      const mergeHierarchy = previouslyMergedPos?.reduce((acc, curr) => {
        if (!acc[curr.name]) {
          acc[curr.name] = associated_po_list
            ?.filter((item) => item.merged === curr.name)
            ?.map((j) => j.name);
        }
        return acc;
      }, {});

      // ✅ Step 1: Create new Master PO (non-blocking)
      const newDoc = await createDoc("Procurement Orders", {
        procurement_request: po?.procurement_request,
        project: po?.project,
        project_name: po?.project_name,
        project_address: po?.project_address,
        vendor: po?.vendor,
        vendor_name: po?.vendor_name,
        vendor_address: po?.vendor_address,
        vendor_gst: po?.vendor_gst,
        order_list: { list: updatedOrderList },
        merged: "true",
      });

      // 4. Batch Operations
      const updateOperations = [
        ...freshMergedPos.map((po) =>
          updateDoc("Procurement Orders", po.name, {
            status: "Merged",
            merged: newDoc.name,
          })
        ),
        ...Object.values(mergeHierarchy)
          .flat()
          .map((poName) =>
            updateDoc("Procurement Orders", poName, {
              status: "Merged",
              merged: newDoc.name,
            })
          ),
        ...Object.keys(mergeHierarchy).map((key) =>
          deleteDoc("Procurement Orders", key)
        ),
      ];

      // 5. Atomic Execution
      await Promise.allSettled(
        updateOperations.map((op) =>
          op.catch((error) => ({ status: "rejected", reason: error }))
        )
      );

      await associated_po_list_mutate();

      // ✅ Step 4: Success message & UI updates (Batch State Updates)
      setMergeablePOs([]);
      toast({
        title: "Merge Successful!",
        description: `${
          freshMergedPos.length + Object.keys(mergeHierarchy)?.length
        } POs merged into ${newDoc.name}`,
        variant: "success",
      });
      toggleMergeConfirmDialog();
      toggleMergeSheet();

      // ✅ Step 5: Add redirect overlay, then navigate smoothly
      setIsRedirecting(true);

      setTimeout(() => {
        setIsRedirecting(false);
        navigate(
          `/purchase-orders/${newDoc?.name.replaceAll(
            "/",
            "&="
          )}?tab=Approved%20PO`
        );
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error("Error in merging POs:", error);
      toast({
        title: "Error!",
        description: "Failed to merge POs. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingFuncName("");
    }
  };

  const handleUnmergePOs = async () => {
    setLoadingFuncName("handleUnmergePOs");
    try {
      await Promise.all(
        prevMergedPOs.map((po) =>
          updateDoc("Procurement Orders", po?.name, {
            status: "PO Approved",
            merged: null,
          })
        )
      );

      // prevMergedPOs.map(async (po) => {
      //   try {
      //     await updateDoc("Procurement Orders", po?.name, {
      //       status: "PO Approved",
      //       merged: null,
      //     });
      //   } catch (error) {
      //     console.error(`Error while unmerging PO(s)`, error);

      //   }
      // });

      await deleteDoc("Procurement Orders", po?.name);

      toggleUnMergeDialog();

      toast({
        title: "Success!",
        description: `Successfully unmerged PO(s)`,
        variant: "success",
      });

      setIsRedirecting(true); // Show overlay

      setTimeout(() => {
        setIsRedirecting(false);
        navigate(`/purchase-orders`);
      }, 1000); // Small delay ensures UI has time to update
    } catch (error) {
      console.log("error while unmerging po's", error);
    } finally {
      setLoadingFuncName("");
    }
  };

  const handleDispatchPO = async () => {
    setLoadingFuncName("handleDispatchPO");
    try {
      if (contactPerson.name !== "" || contactPerson.number !== "") {
        await updateDoc("Procurement Orders", poId, {
          status: "Dispatched",
          delivery_contact: `${contactPerson.name}:${contactPerson.number}`,
        });
      } else {
        await updateDoc("Procurement Orders", poId, {
          status: "Dispatched",
        });
      }

      await poMutate();

      toast({
        title: "Success!",
        description: `PO: ${poId} status updated to 'Dispatched' successfully!`,
        variant: "success",
      });

      navigate(`/purchase-orders/${id}?tab=Dispatched+PO`);
    } catch (error) {
      console.log(
        "error while updating the status of the PO to dispatch",
        error
      );
      toast({
        title: "Failed!",
        description: `PO: ${poId} Updation Failed!`,
        variant: "destructive",
      });
    } finally {
      setLoadingFuncName("");
    }
  };

  const handleRevertPO = async () => {
    setLoadingFuncName("handleRevertPO");
    try {
      await updateDoc("Procurement Orders", poId, {
        status: "PO Approved",
        delivery_contact: null,
      });

      if (comment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Procurement Orders",
          reference_name: poId,
          comment_by: userData?.user_id,
          content: comment,
          subject: "reverting po",
        });
      }

      await poMutate();

      toast({
        title: "Success!",
        description: `PO: ${poId} Reverted back to PO Approved!`,
        variant: "success",
      });

      navigate(`/purchase-orders/${id}?tab=Approved+PO`);
    } catch (error) {
      toast({
        title: "Failed!",
        description: `PO: ${poId} Revert Failed!`,
        variant: "destructive",
      });
    } finally {
      setLoadingFuncName("");
    }
  };

  const handleAmendPo = async () => {
    setLoadingFuncName("handleAmendPo");
    try {
      await updateDoc("Procurement Orders", poId, {
        status: "PO Amendment",
        order_list: orderData,
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

      navigate("/purchase-orders");
    } catch (error) {
      console.log("Error while cancelling po", error);
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
    setLoadingFuncName("handleCancelPo");

    const categories = [];

    const itemList = [];

    const prCategories = JSON.parse(pr?.category_list)?.list;

    orderData?.list?.map((item) => {
      if (categories?.every((i) => i?.name !== item.category)) {
        const makes = prCategories?.find(
          (j) => j?.name === item?.category
        )?.makes;
        categories.push({ name: item.category, makes });
      }
      delete item["makes"];
      itemList.push({ ...item, status: "Pending" });
    });
    try {
      await updateDoc("Procurement Orders", poId, {
        status: "Cancelled",
      });

      const newSentBack = await createDoc("Sent Back Category", {
        type: "Cancelled",
        procurement_request: po?.procurement_request,
        project: po?.project,
        category_list: { list: categories },
        item_list: { list: itemList },
      });
      if (comment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Sent Back Category",
          reference_name: newSentBack.name,
          comment_by: userData?.user_id,
          content: comment,
          subject: "creating sent-back(cancelled)",
        });
      }

      toast({
        title: "Success!",
        description: `Cancelled Po & New Sent Back: ${newSentBack.name} created successfully!`,
        variant: "success",
      });
      navigate("/purchase-orders");
    } catch (error) {
      console.log("Error while cancelling po", error);
      toast({
        title: "Failed!",
        description: `PO: ${poId} Cancellation Failed!`,
        variant: "destructive",
      });
    } finally {
      setLoadingFuncName("");
    }
  };

  const handlePhoneChange = (e: any) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 10);
    setPhoneNumber(value);
    if (value.length === 10) {
      setPhoneError("");
    }
  };

  const handleEmailChange = (e: any) => {
    setEmail(e.target.value);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value)) {
      setEmailError("");
    }
  };

  const handleUnAmendAll = () => {
    setOrderData(po?.order_list ? JSON.parse(po?.order_list) : { list: [] });
    setStack([]);
  };

  useEffect(() => {
    if (!amendPOSheet && stack.length) {
      handleUnAmendAll();
    }
  }, [amendPOSheet]);

  const handleSave = (
    itemName: string,
    newQuantity: string,
    selectedMake: any
  ) => {
    let curRequest = orderData?.list;

    // Find the current item and store its previous quantity in the stack
    const previousItem = curRequest.find(
      (curValue) => curValue.item === itemName
    );

    if (parseFloat(newQuantity) !== parseFloat(previousItem?.quantity)) {
      setStack((prevStack) => [
        ...prevStack,
        {
          operation: "quantity_change",
          item: previousItem.item,
          previousQuantity: previousItem.quantity,
        },
      ]);
    }

    const makes = previousItem?.makes?.list?.map((i) =>
      i?.make === selectedMake?.value
        ? { make: selectedMake?.value, enabled: "true" }
        : { make: i?.make, enabled: "false" }
    );

    if (
      previousItem?.makes?.list?.find((i) => i?.make === selectedMake?.value)
        ?.enabled === "false"
    ) {
      setStack((prevStack) => [
        ...prevStack,
        {
          operation: "make_change",
          item: previousItem.item,
          previousMakeList: previousItem.makes?.list,
        },
      ]);
    }

    curRequest = curRequest.map((curValue) => {
      if (curValue.item === itemName) {
        return {
          ...curValue,
          quantity: parseInt(newQuantity),
          makes: { list: makes },
        };
      }
      return curValue;
    });
    setOrderData({
      list: curRequest,
    });
    setQuantity("");

    toggleAmendEditItemDialog();
  };

  const handleDelete = (item: string) => {
    let curRequest = orderData?.list;
    let itemToPush = curRequest.find((curValue) => curValue.item === item);

    // Push the delete operation into the stack
    setStack((prevStack) => [
      ...prevStack,
      {
        operation: "delete",
        item: itemToPush,
      },
    ]);
    curRequest = curRequest.filter((curValue) => curValue.item !== item);
    setOrderData({
      list: curRequest,
    });

    setQuantity("");
    toggleAmendEditItemDialog();
  };

  const UndoDeleteOperation = () => {
    if (stack.length === 0) return; // No operation to undo

    let curRequest = orderData?.list;
    const lastOperation = stack.pop();

    if (lastOperation.operation === "delete") {
      // Restore the deleted item
      curRequest.push(lastOperation.item);
    } else if (lastOperation.operation === "quantity_change") {
      // Restore the previous quantity of the item
      curRequest = curRequest.map((curValue) => {
        if (curValue.item === lastOperation.item) {
          return { ...curValue, quantity: lastOperation.previousQuantity };
        }
        return curValue;
      });
    } else if (lastOperation.operation === "make_change") {
      curRequest = curRequest.map((curValue) => {
        if (curValue.item === lastOperation.item) {
          return {
            ...curValue,
            makes: { list: lastOperation?.previousMakeList },
          };
        }
        return curValue;
      });
    }

    // Update the order data with the restored item or quantity
    setOrderData({
      list: curRequest,
    });

    // Update the stack after popping the last operation
    setStack([...stack]);
  };

  const treeData = [
    {
      title: po?.name,
      key: "mainPO",
      children: prevMergedPOs?.map((po, idx) => ({
        title: po?.name,
        key: `po-${idx}`,
        children: po?.order_list?.list.map((item, itemIdx) => ({
          title: item?.item,
          key: `item-${idx}-${itemIdx}`,
        })),
      })),
    },
  ];

  const AddPayment = async () => {
    try {
      setLoadingFuncName("AddPayment");
      const res = await createDoc("Project Payments", {
        document_type: "Procurement Orders",
        document_name: poId,
        project: po?.project,
        vendor: po?.vendor,
        utr: newPayment?.utr,
        amount: newPayment?.amount,
        payment_date: newPayment?.payment_date,
        status: "Paid"
      });

      const fileArgs = {
        doctype: "Project Payments",
        docname: res?.name,
        fieldname: "payment_attachment",
        isPrivate: true,
      };

      const uploadedFile = await upload(paymentScreenshot, fileArgs);

      await call({
        doctype: "Project Payments",
        name: res?.name,
        fieldname: "payment_attachment",
        value: uploadedFile.file_url,
      });

      await AllPoPaymentsListMutate();

      await poPaymentsMutate();

      toggleNewPaymentDialog();

      toast({
        title: "Success!",
        description: "Payment added successfully!",
        variant: "success",
      });

      setNewPayment({
        amount: "",
        payment_date: "",
        utr: "",
      });

      setPaymentScreenshot(null);
    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: "Failed to add Payment!",
        variant: "destructive",
      });
    } finally {
      setLoadingFuncName("");
    }
  };


  const handleDeletePayment = async () => {
    try {

      setLoadingFuncName("handleDeletePayment");
      await deleteDoc("Project Payments", deleteFlagged?.name);

      await AllPoPaymentsListMutate();

      await poPaymentsMutate();

      toast({
        title: "Success!",
        description: "Payment deleted successfully!",
        variant: "success",
      });
      
    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: "Failed to delete Payment!",
        variant: "destructive",
      });
    } finally {
      setLoadingFuncName("");
    }
  }

  const amountPaid = getTotalAmountPaid(poPayments?.filter(i => i?.status === "Paid"));

  const validateAmount = debounce((amount) => {
    const { totalAmt } = getTotal;

    const compareAmount = totalAmt - amountPaid;

    if (parseFloat(amount) > compareAmount) {
      setWarning(
        `Entered amount exceeds the total ${
          amountPaid ? "remaining" : ""
        } amount including GST: ${formatToIndianRupee(compareAmount)}`
      );
    } else {
      setWarning(""); // Clear warning if within the limit
    }
  }, 300);

  // Handle input change
  const handleAmountChange = (e) => {
    const amount = e.target.value;
    setNewPayment({ ...newPayment, amount });
    validateAmount(amount);
  };

  const getUserName = (id) => {
    if (usersList) {
      return usersList.find((user) => user?.name === id)?.full_name;
    }
  };

  const siteUrl = `${window.location.protocol}//${window.location.host}`;

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
    associated_po_list_loading ||
    prLoading ||
    poPaymentsLoading
  )
    return (
      <div className="flex items-center h-[90vh] w-full justify-center">
        <TailSpin color={"red"} />{" "}
      </div>
    );
  if (
    associated_po_list_error ||
    // vendor_address_error ||
    // project_address_error ||
    usersListError ||
    prError ||
    poError ||
    poPaymentsError
  )
    return <h1>Error</h1>;
  if (
    !summaryPage &&
    !accountsPage &&
    tab === "Approved PO" &&
    !estimatesViewing &&
    !["PO Approved"].includes(po?.status)
  )
    return (
      <div className="flex items-center justify-center h-[90vh]">
        <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
          <p className="text-gray-600 text-lg">
            Hey there, the Purchase Order:{" "}
            <span className="font-medium text-gray-900">{po?.name}</span> is no
            longer available in <span className="italic">PO Approved</span>{" "}
            state. The current state is{" "}
            <span className="font-semibold text-blue-600">{po?.status}</span>{" "}
            And the last modification was done by{" "}
            <span className="font-medium text-gray-900">
              {po?.modified_by === "Administrator"
                ? "Administrator"
                : getUserName(po?.modified_by)}
            </span>
            !
          </p>
          <button
            className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
            onClick={() => navigate("/purchase-orders")}
          >
            Go Back
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex-1 space-y-4">
      {/* <div className="flex items-center gap-1 text-lg">
        <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
        <span>
          Summary-<span className="text-red-700">{po?.name}</span>
        </span>
      </div> */}
      {!summaryPage &&
        !accountsPage &&
        !estimatesViewing &&
        po?.status === "PO Approved" &&
        po?.merged !== "true" &&
        !(poPayments?.length > 0) &&
        mergeablePOs.length > 0 && (
          <>
            <Alert variant="warning" className="">
              <AlertTitle className="text-sm flex items-center gap-2">
                <MessageCircleWarning className="h-4 w-4" />
                Heads Up
              </AlertTitle>
              <AlertDescription className="text-xs flex justify-between items-center">
                PO Merging Feature is available for this PO.
                <Sheet open={mergeSheet} onOpenChange={toggleMergeSheet}>
                  <SheetTrigger asChild>
                    <Button className="flex items-center gap-1" color="primary">
                      <Merge className="w-4 h-4" />
                      Merge PO(s)
                    </Button>
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
                              {po?.project_name}
                            </p>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm text-gray-500">
                              Vendor:
                            </span>
                            <p className="text-base font-medium tracking-tight text-black">
                              {po?.vendor_name}
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
                              <TableRow key={po?.name}>
                                <TableCell>
                                  {po?.name?.slice(3, 6)}/
                                  {po?.procurement_request?.slice(9)}
                                </TableCell>
                                <TableCell>
                                  {
                                    orderData?.list?.filter((i) => !i?.po)
                                      ?.length
                                  }
                                </TableCell>
                                <TableCell>
                                  <ul className="list-disc">
                                    {orderData?.list
                                      ?.filter((i) => !i?.po)
                                      ?.map((j) => (
                                        <li key={j?.item}>
                                          {j?.item}{" "}
                                          <span>(Qty-{j?.quantity})</span>
                                          <p className="text-primary text-sm">
                                            Make:{" "}
                                            <span className="text-xs text-gray-500 italic">
                                              {j?.makes?.list?.find(
                                                (k) => k?.enabled === "true"
                                              )?.make || "--"}
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
                                // Helper function to check if merge should be disabled
                                const isMergeDisabled = po.order_list.list.some(
                                  (poItem) => {
                                    // Check if any item in orderData has the same name but different rate
                                    return orderData?.list?.some(
                                      (currentItem) =>
                                        currentItem.name === poItem.name &&
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
                                    <TableCell>
                                      {po.order_list.list.length}
                                    </TableCell>
                                    <TableCell>
                                      <ul className="list-disc">
                                        {po?.order_list?.list?.map((i) => (
                                          <li key={i?.item}>
                                            {i?.item}{" "}
                                            <span>(Qty-{i?.quantity})</span>
                                            <p className="text-primary text-sm">
                                              Make:{" "}
                                              <span className="text-xs text-gray-500 italic">
                                                {i?.makes?.list?.find(
                                                  (k) => k?.enabled === "true"
                                                )?.make || "--"}
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
                                                overlapping item(s) with
                                                different quotes
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
                            {loadingFuncName === "handleMergePOs" ? (
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

      <Card className="rounded-sm shadow-m col-span-3 overflow-x-auto">
        <CardHeader>
          <CardTitle className="text-xl max-sm:text-lg text-red-600 flex items-center justify-between">
            <div>
              <h2>PO Details</h2>
              <Badge
                variant={
                  po?.status === "PO Approved"
                    ? "default"
                    : po?.status === "Dispatched"
                    ? "orange"
                    : "green"
                }
              >
                {po?.status === "Partially Delivered"
                  ? "Delivered"
                  : po?.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {!summaryPage &&
                !accountsPage &&
                !estimatesViewing &&
                po?.status === "Dispatched" &&
                !(poPayments?.length > 0) && (
                  <Button
                  variant="outline"
                    onClick={toggleRevertDialog}
                    className="text-xs flex items-center gap-1 border border-red-500 rounded-md p-1 h-8"
                  >
                    <Undo2 className="w-4 h-4" />
                    Revert
                  </Button>
                )}
              {(po?.status !== "PO Approved" ||
                summaryPage ||
                accountsPage ||
                estimatesViewing) && (
                <Button
                  variant="outline"
                  onClick={togglePoPdfSheet}
                  className="text-xs flex items-center gap-1 border border-red-500 rounded-md p-1 h-8"
                >
                  <Eye className="w-4 h-4" />
                  Preview
                </Button>
              )}
            </div>
            {!summaryPage &&
              !accountsPage &&
              !estimatesViewing &&
              po?.status === "PO Approved" && (
                <Sheet>
                  <SheetTrigger asChild>
                    <Button className="flex items-center gap-1">
                      <Send className="h-4 w-4" />
                      Dispatch PO
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="overflow-y-auto">
                    <Card className="border-yellow-500 shadow-lg overflow-auto my-4">
                      <CardHeader className="bg-yellow-50">
                        <CardTitle className="text-2xl text-yellow-800">
                          Send this PO to{" "}
                          <span className="font-bold text-yellow-600">
                            {po?.vendor_name}
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6">
                        <div className="space-y-6">
                          <div className="bg-yellow-100 p-4 rounded-lg">
                            <h3 className="font-semibold text-yellow-800 mb-2 flex items-center">
                              <AlertTriangle className="w-5 h-5 mr-2" />
                              Important Notes
                            </h3>
                            <ul className="list-disc list-inside space-y-1 text-sm text-yellow-700">
                              <li>
                                You can add{" "}
                                <span className="font-bold">
                                  charges, notes & payment terms
                                </span>{" "}
                                above.
                              </li>
                              <li>
                                You can also{" "}
                                <span className="font-bold">merge POs</span>{" "}
                                with same vendor and project. Look out for{" "}
                                <span className="font-bold">Heads Up</span> box
                                above.
                              </li>
                              <li>
                                You can download the prepared PO to notify
                                vendor:{" "}
                                <span className="font-medium">
                                  {po?.vendor_name}
                                </span>{" "}
                                through <span> Contact Options</span> section
                                below
                              </li>
                            </ul>
                          </div>
                          <Separator />

                          <div className="space-y-4">
                            <h3 className="font-semibold text-lg">
                              Vendor Contact Options
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <Label
                                  htmlFor="phone"
                                  className="text-sm font-medium"
                                >
                                  Phone Number
                                </Label>
                                <div className="flex flex-col mt-1">
                                  <div className="flex">
                                    <Input
                                      id="phone"
                                      type="tel"
                                      placeholder="Enter 10-digit number"
                                      value={phoneNumber}
                                      onChange={handlePhoneChange}
                                      className="rounded-r-none"
                                    />
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <Button
                                          className="rounded-l-none bg-green-600 hover:bg-green-700"
                                          disabled={phoneNumber.length !== 10}
                                        >
                                          <Phone className="w-4 h-4 mr-2" />
                                          WhatsApp
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent>
                                        <DialogHeader>
                                          <DialogTitle className="text-center">
                                            Send PO via WhatsApp
                                          </DialogTitle>
                                          <DialogDescription className="text-center">
                                            Download the PO and send it via
                                            WhatsApp to {phoneNumber}
                                          </DialogDescription>
                                        </DialogHeader>
                                        <div className="flex justify-center space-x-4">
                                          <Button
                                            onClick={togglePoPdfSheet}
                                            variant="outline"
                                          >
                                            <Download className="h-4 w-4 mr-2" />
                                            PO PDF
                                          </Button>
                                          <Button
                                            onClick={() =>
                                              window.open(
                                                `https://wa.me/${phoneNumber}`
                                              )
                                            }
                                            className="bg-green-600 hover:bg-green-700"
                                          >
                                            <CheckCheck className="h-4 w-4 mr-2" />
                                            Open WhatsApp
                                          </Button>
                                        </div>
                                      </DialogContent>
                                    </Dialog>
                                  </div>
                                  {phoneError && (
                                    <p className="text-red-500 text-xs mt-1">
                                      {phoneError}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div>
                                <Label
                                  htmlFor="email"
                                  className="text-sm font-medium"
                                >
                                  Email
                                </Label>
                                <div className="flex flex-col mt-1">
                                  <div className="flex">
                                    <Input
                                      id="email"
                                      type="email"
                                      placeholder="Enter email address"
                                      value={email}
                                      onChange={handleEmailChange}
                                      className="rounded-r-none"
                                    />
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <Button
                                          className="rounded-l-none bg-blue-600 hover:bg-blue-700"
                                          disabled={
                                            !email.trim() ||
                                            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                                              email
                                            )
                                          }
                                        >
                                          <Mail className="w-4 h-4 mr-2" />
                                          Email
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent className="max-w-3xl">
                                        <DialogHeader>
                                          <DialogTitle>
                                            Send PO via Email
                                          </DialogTitle>
                                          <DialogDescription>
                                            Customize your email and send the PO
                                            to {email}
                                          </DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4">
                                          <div>
                                            <Label htmlFor="emailSubject">
                                              Subject
                                            </Label>
                                            <Input
                                              id="emailSubject"
                                              value={emailSubject}
                                              onChange={(e) =>
                                                setEmailSubject(e.target.value)
                                              }
                                              placeholder="Enter email subject"
                                            />
                                          </div>
                                          <div>
                                            <Label htmlFor="emailBody">
                                              Body
                                            </Label>
                                            <Textarea
                                              id="emailBody"
                                              value={emailBody}
                                              onChange={(e) =>
                                                setEmailBody(e.target.value)
                                              }
                                              placeholder="Enter email body"
                                              rows={5}
                                            />
                                          </div>
                                          <div className="bg-gray-100 p-4 rounded-md">
                                            <h4 className="font-medium mb-2">
                                              Email Preview
                                            </h4>
                                            <p>
                                              <strong>To:</strong> {email}
                                            </p>
                                            <p>
                                              <strong>Subject:</strong>{" "}
                                              {emailSubject}
                                            </p>
                                            <p>
                                              <strong>Body:</strong> {emailBody}
                                            </p>
                                          </div>
                                        </div>
                                        <DialogFooter>
                                          <Button
                                            onClick={togglePoPdfSheet}
                                            variant="outline"
                                          >
                                            <Download className="h-4 w-4 mr-2" />
                                            PO PDF
                                          </Button>
                                          <Button
                                            onClick={() =>
                                              window.open(
                                                `https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${encodeURIComponent(
                                                  emailSubject
                                                )}&body=${encodeURIComponent(
                                                  emailBody
                                                )}`
                                              )
                                            }
                                            className="bg-blue-600 hover:bg-blue-700"
                                          >
                                            <CheckCheck className="h-4 w-4 mr-2" />
                                            Send Email
                                          </Button>
                                        </DialogFooter>
                                      </DialogContent>
                                    </Dialog>
                                  </div>
                                  {emailError && (
                                    <p className="text-red-500 text-xs mt-1">
                                      {emailError}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                      <CardFooter className="bg-gray-50 flex justify-between p-4 max-md:flex-col max-md:items-start max-md:gap-4">
                        <p className="text-sm text-gray-600 italic">
                          Check all details before sending this PO.
                        </p>
                        <div className="space-x-2 space-y-2 max-md:text-end max-md:w-full">
                          {po?.status === "PO Approved" && !po?.project_gst ? (
                            <HoverCard>
                              <HoverCardTrigger>
                                <div className="space-x-2 space-y-2 max-md:text-end max-md:w-full">
                                  <Button
                                    variant="outline"
                                    disabled={
                                      po?.status === "PO Approved" &&
                                      !po?.project_gst
                                    }
                                  >
                                    <Printer className="h-4 w-4 mr-2" />
                                    PO PDF
                                  </Button>
                                  <Button
                                    disabled={!po?.project_gst}
                                    variant="default"
                                    className="bg-yellow-500 hover:bg-yellow-600"
                                  >
                                    <Send className="h-4 w-4 mr-2" />
                                    Mark as Dispatched
                                  </Button>
                                </div>
                              </HoverCardTrigger>
                              <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                Please select and confirm <i>Project GST</i> for
                                this PO from the{" "}
                                <span className="text-primary">
                                  Edit Payment Terms Dialog
                                </span>{" "}
                                in order to enable PDF and Dispatch buttons!
                              </HoverCardContent>
                            </HoverCard>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                onClick={togglePoPdfSheet}
                              >
                                <Printer className="h-4 w-4 mr-2" />
                                PO PDF
                              </Button>
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button
                                    variant="default"
                                    className="bg-yellow-500 hover:bg-yellow-600"
                                  >
                                    <Send className="h-4 w-4 mr-2" />
                                    Mark as Dispatched
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>
                                      Confirm PO Dispatch?
                                    </DialogTitle>
                                    <DialogDescription className="pt-2 flex flex-col gap-2">
                                      <p>
                                        You can add the delivery person's
                                        details here.
                                      </p>
                                      <div>
                                        <Label
                                          htmlFor="personName"
                                          className="text-sm font-medium"
                                        >
                                          Person Name{" "}
                                          <span className="text-gray-400">
                                            (optional)
                                          </span>
                                        </Label>
                                        <Input
                                          id="personName"
                                          type="text"
                                          value={contactPerson.name}
                                          placeholder="Enter person name"
                                          onChange={(e) =>
                                            setContactPerson((prev) => ({
                                              ...prev,
                                              name: e.target.value,
                                            }))
                                          }
                                          className="mt-1"
                                        />
                                      </div>
                                      <div>
                                        <Label
                                          htmlFor="contactNumber"
                                          className="text-sm font-medium"
                                        >
                                          Contact Number{" "}
                                          <span className="text-gray-400">
                                            (optional)
                                          </span>
                                        </Label>
                                        <Input
                                          id="contactNumber"
                                          type="tel"
                                          value={contactPerson.number}
                                          placeholder="Enter 10-digit number"
                                          onChange={(e) =>
                                            setContactPerson((prev) => ({
                                              ...prev,
                                              number: e.target.value.slice(
                                                0,
                                                10
                                              ),
                                            }))
                                          }
                                          className="mt-1"
                                        />
                                      </div>
                                    </DialogDescription>
                                  </DialogHeader>
                                  {loadingFuncName === "handleDispatchPO" ? (
                                    <div className="flex items-center justify-center">
                                      <TailSpin width={80} color="red" />{" "}
                                    </div>
                                  ) : (
                                    <DialogFooter>
                                      <DialogClose asChild>
                                        <Button
                                          variant="outline"
                                          className="flex items-center gap-1"
                                        >
                                          <CircleX className="h-4 w-4" />
                                          Cancel
                                        </Button>
                                      </DialogClose>
                                      <Button
                                        onClick={handleDispatchPO}
                                        className="bg-yellow-500 hover:bg-yellow-600 flex items-center gap-1"
                                      >
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm
                                      </Button>
                                    </DialogFooter>
                                  )}
                                </DialogContent>
                              </Dialog>
                            </>
                          )}
                        </div>
                      </CardFooter>
                    </Card>
                  </SheetContent>
                </Sheet>
              )}
            <Dialog open={revertDialog} onOpenChange={toggleRevertDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Are you sure?</DialogTitle>
                </DialogHeader>

                <DialogDescription>
                  Clicking on Confirm will revert this PO's status back to{" "}
                  <span className="text-primary">PO Approved</span>.
                </DialogDescription>

                <div className="flex items-center justify-end gap-2">
                  {loadingFuncName === "handleRevertPO" ? (
                    <TailSpin color="red" height={40} width={40} />
                  ) : (
                    <>
                      <DialogClose asChild>
                        <Button variant={"outline"}>
                          <CircleX className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                      </DialogClose>
                      <Button onClick={handleRevertPO}>
                        <CheckCheck className="h-4 w-4 mr-1" />
                        Confirm
                      </Button>
                    </>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </CardTitle>
        </CardHeader>

        <CardContent className="max-sm:text-xs">
          <div className="grid grid-cols-3 gap-4 space-y-2 max-sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label className=" text-red-700">Vendor</Label>
              <VendorHoverCard vendor_id={po?.vendor} />
            </div>
            <div className="flex flex-col gap-2 sm:items-center max-sm:text-end">
              <Label className=" text-red-700">Package</Label>
              <span>{pr?.work_package}</span>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Label className=" text-red-700">Date Created</Label>
              <span>{formatDate(po?.creation)}</span>
            </div>
            <div className="flex flex-col gap-2 max-sm:items-end">
              <Label className=" text-red-700">Total (Excl. GST)</Label>
              <span>{formatToIndianRupee(getTotal?.total)}</span>
            </div>
            <div className="flex flex-col gap-2 sm:items-center">
              <Label className=" text-red-700">Total Amount Paid</Label>
              <span>{amountPaid ? formatToIndianRupee(amountPaid) : "--"}</span>
            </div>
            <div className="flex flex-col gap-2 items-end">
              <Label className=" text-red-700">Total (Incl. GST)</Label>
              <span>
                {formatToIndianRupee(Math.floor(getTotal?.totalAmt))}
              </span>
            </div>
            {/* <div className="flex flex-col gap-2">
                                      <Label className=" text-red-700">Vendor GST</Label>
                                      <span>{po?.vendor_gst || "--"}</span>
                                  </div> */}
            {/* <div>
                                  <Label className="pr-1 text-red-700">Vendor Address</Label>
                                  <AddressView className="block" id={po?.vendor_address}/>
                                </div> */}

            {/* <div className="flex flex-col gap-2">
                                      <Label className=" text-red-700">Project</Label>
                                      <span>{po?.project_name}</span>
                                  </div> */}

            {/* <div className="text-end">
                                  <Label className="text-red-700 pr-1">Project Address</Label>
                                  <AddressView className="block" id={po?.project_address}/>
                                </div> */}
          </div>
        </CardContent>
      </Card>

      <Accordion type="multiple" 
      defaultValue={tab !== "Delivered PO" ? ["transac&payments"] : []}
      className="w-full">
        <AccordionItem key="transac&payments" value="transac&payments">
          {tab === "Delivered PO" && (
            <AccordionTrigger>
            <p className="font-semibold text-lg text-red-600 pl-6">
              Payment Details
            </p>
          </AccordionTrigger>
          )}
          <AccordionContent>
        {!summaryPage && (
        <div className="grid gap-4 max-[1000px]:grid-cols-1 grid-cols-6">
          <Card className="rounded-sm shadow-m col-span-3 overflow-x-auto">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <p className="text-xl max-sm:text-lg text-red-600">
                  Transaction Details
                </p>

                {!accountsPage && !estimatesViewing && (
                  <>
                  <Button
                  variant="outline"
                  className="text-primary border-primary text-xs px-2"
                  onClick={toggleRequestPaymentDialog}
                >
                  Request Payment
                </Button>
                <RequestPaymentDialog totalAmount={getTotal?.totalAmt} totalAmountWithoutGST={getTotal?.total} totalPaid={amountPaid}
                  po={po} paymentsMutate={poPaymentsMutate}
                  />
                </>
                )}

                {accountsPage && (
                        <AlertDialog open={newPaymentDialog} onOpenChange={toggleNewPaymentDialog}>
                            <AlertDialogTrigger
                            onClick={() => setNewPayment({...newPayment, payment_date: new Date().toISOString().split("T")[0]})}
                            >
                                <SquarePlus className="w-5 h-5 text-red-500 cursor-pointer" />
                            </AlertDialogTrigger>
                            <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                                <AlertDialogHeader className="text-start">
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Project:</Label>
                                    <span className="">{po?.project_name}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Vendor:</Label>
                                    <span className="">{po?.vendor_name}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">PO Amt excl. Tax:</Label>
                                    <span className="">{formatToIndianRupee(getTotal?.total)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">PO Amt incl. Tax:</Label>
                                    <span className="">{formatToIndianRupee(Math.floor(getTotal?.totalAmt))}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Amt Paid Till Now:</Label>
                                    <span className="">{amountPaid ? formatToIndianRupee(amountPaid) : "--"}</span>
                                </div>

                                <div className="flex flex-col gap-4 pt-4">
                                                            <div className="flex gap-4 w-full">
                                                                <Label className="w-[40%]">Amount Paid<sup className=" text-sm text-red-600">*</sup></Label>
                                                                <div className="w-full">
                                                                <Input
                                                                    type="number"
                                                                    placeholder="Enter Amount"
                                                                    value={newPayment.amount}
                                                                    onChange={(e) => handleAmountChange(e)}
                                                                />
                                                                    {warning && <p className="text-red-600 mt-1 text-xs">{warning}</p>}
                                                                </div> 
                                                            </div>
                                                            <div className="flex gap-4 w-full">
                                                                <Label className="w-[40%]">UTR<sup className=" text-sm text-red-600">*</sup></Label>
                                                                <Input
                                                                    type="text"
                                                                    placeholder="Enter UTR"
                                                                    value={newPayment.utr}
                                                                    onChange={(e) => setNewPayment({ ...newPayment, utr: e.target.value })}
                                                                />
                                                            </div>

                                                            <div className="flex gap-4 w-full" >
                                                                <Label className="w-[40%]">Payment Date<sup className=" text-sm text-red-600">*</sup></Label>
                                                                <Input
                                                                        type="date"
                                                                        value={newPayment.payment_date}
                                                                        placeholder="DD/MM/YYYY"
                                                                        onChange={(e) => setNewPayment({...newPayment, payment_date: e.target.value})}
                                                                        max={new Date().toISOString().split("T")[0]}
                                                                        onKeyDown={(e) => e.preventDefault()}
                                                                     />
                                                            </div>

                                                        </div>

                                <div className="flex flex-col gap-2">
                                    <div className={`text-blue-500 cursor-pointer flex gap-1 items-center justify-center border rounded-md border-blue-500 p-2 mt-4 ${paymentScreenshot && "opacity-50 cursor-not-allowed"}`}
                                    onClick={() => document.getElementById("file-upload")?.click()}
                                    >
                                        <Paperclip size="15px" />
                                        <span className="p-0 text-sm">Attach Screenshot</span>
                                        <input
                                            type="file"
                                            id={`file-upload`}
                                            className="hidden"
                                            onChange={handleFileChange}
                                            disabled={paymentScreenshot ? true : false}
                                        />
                                    </div>
                                    {(paymentScreenshot) && (
                                        <div className="flex items-center justify-between bg-slate-100 px-4 py-1 rounded-md">
                                            <span className="text-sm">{paymentScreenshot?.name}</span>
                                            <button
                                                className="ml-1 text-red-500"
                                                onClick={() => setPaymentScreenshot(null)}
                                            >
                                                ✖
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-2 items-center pt-4 justify-center">
                                    {loadingFuncName === "AddPayment" ? <TailSpin color="red" width={40} height={40} /> : (
                                        <>
                                        <AlertDialogCancel className="flex-1" asChild>
                                            <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                        </AlertDialogCancel>
                                        <Button
                                            onClick={AddPayment}
                                            disabled={!paymentScreenshot || !newPayment.amount || !newPayment.utr || !newPayment.payment_date || warning}
                                            className="flex-1">Add Payment
                                        </Button>
                                        </>
                                    )}
                                </div>
                                
                                </AlertDialogHeader>
                            </AlertDialogContent>
                        </AlertDialog>
                        )}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-black font-bold">Amount</TableHead>
                    <TableHead className="text-black font-bold">UTR No.</TableHead>
                    <TableHead className="text-black font-bold">Date</TableHead>
                    <TableHead className="text-black font-bold w-[5%]">Status</TableHead>
                    <TableHead ></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {poPayments?.length > 0 ? (
                    poPayments?.map((payment) => {
                      return (
                        <TableRow key={payment?.name}>
                          <TableCell>
                            {formatToIndianRupee(payment?.amount)}
                          </TableCell>
                            {payment?.utr ? (
                              <TableCell className="text-blue-500 underline">
                              {import.meta.env.MODE === "development" ? (
                                <a
                                  href={`http://localhost:8000${payment?.payment_attachment}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {payment?.utr}
                                </a>
                              ) : (
                                <a
                                  href={`${siteUrl}${payment?.payment_attachment}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {payment?.utr}
                                </a>
                              )}
                              </TableCell>
                            ) : (
                              <TableCell>
                                --
                              </TableCell>
                            )}
                          <TableCell>
                            {formatDate(
                              payment?.payment_date || payment?.creation
                            )}
                          </TableCell>
                          <TableCell>{payment?.status}</TableCell>
                          <TableCell className="text-red-500 text-end w-[5%]">
                            {payment?.status !== "Paid" && !estimatesViewing && 
                            <Dialog>
                              <DialogTrigger>
                                <Trash2
                                  onClick={() => setDeleteFlagged(payment)}
                                  className="w-4 h-4" />
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Are you sure?</DialogTitle>
                                </DialogHeader>
                                <div className="flex items-center justify-end gap-2">
                                  {loadingFuncName === "handleDeletePayment" ? <TailSpin color="red" height={40} width={40} /> : (
                                    <>
                                      <DialogClose asChild>
                                        <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                        </DialogClose>
                                      <Button onClick={() => handleDeletePayment()}>Delete</Button>
                                    </>
                                  )}
                                </div>

                              </DialogContent>
                            </Dialog>
                            }
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-2">
                        No Payments Found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="rounded-sm shadow-md col-span-3 overflow-x-auto">
            <CardHeader>
              <CardTitle className="text-xl max-sm:text-lg text-red-600 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  Payment Terms
                  {!po?.project_gst && (
                    <TriangleAlert className="text-primary" />
                  )}
                </div>
                {!summaryPage &&
                  !accountsPage &&
                  !estimatesViewing &&
                  po?.status === "PO Approved" && (
                    <Dialog
                      open={editPOTermsDialog}
                      onOpenChange={toggleEditPOTermsDialog}
                    >
                      <DialogTrigger>
                        <Button
                          variant={"outline"}
                          className="flex items-center gap-1"
                        >
                          <PencilIcon className="w-4 h-4" />
                          Edit
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader className="text-start">
                          <DialogTitle className="text-center">
                            Edit Terms and Charges
                          </DialogTitle>

                          <div className="px-4 flex flex-col gap-4 pt-2">
                            <div className="flex flex-col gap-1">
                              <h3
                                className={`font-semibold text-lg tracking-tight ${
                                  !selectedGST?.gst ? "text-primary" : ""
                                }`}
                              >
                                Project GST Selection
                                <sup className="text-sm text-red-600">*</sup>
                              </h3>
                              {poProject &&
                                JSON.parse(poProject?.project_gst_number)?.list
                                  ?.length > 0 && (
                                  <>
                                    <Select
                                      value={selectedGST?.gst}
                                      defaultValue={po?.project_gst}
                                      onValueChange={(selectedOption) => {
                                        const gstArr = JSON.parse(
                                          poProject?.project_gst_number
                                        )?.list;
                                        setSelectedGST(
                                          gstArr.find(
                                            (item) =>
                                              item.gst === selectedOption
                                          )
                                        );
                                      }}
                                    >
                                      <SelectTrigger
                                        className={`${
                                          !selectedGST?.gst
                                            ? "text-primary border-primary ring-1 ring-inset ring-primary"
                                            : ""
                                        }`}
                                      >
                                        <SelectValue placeholder="Select Project GST" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {JSON.parse(
                                          poProject?.project_gst_number
                                        )?.list?.map((option) => (
                                          <SelectItem
                                            key={option.location}
                                            value={option.gst}
                                          >
                                            {option.location}
                                            {` (${option.gst})`}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {selectedGST?.gst && !po?.project_gst && (
                                      <span className="text-sm">
                                        <strong>Note:</strong>{" "}
                                        <span className="text-primary">
                                          GST selected but not saved, click on
                                          Save below!
                                        </span>
                                      </span>
                                    )}
                                  </>
                                )}
                            </div>
                            <h3 className="font-semibold text-lg tracking-tight">
                              Terms:
                            </h3>
                            <div className="flex justify-between items-center pb-2 border-b border-gray-300">
                              <p className="text-sm text-gray-500">Terms</p>
                              <p className="text-sm text-gray-500">
                                Percentage(%)
                              </p>
                            </div>
                            <form
                              onSubmit={handleSubmit(onSubmit)}
                              className="space-y-4"
                            >
                              {/* Payments Section */}
                              <section className="space-y-2">
                                <div className="flex flex-col gap-2">
                                  <div className="flex justify-between items-center">
                                    <Label>After Delivery</Label>
                                    <Controller
                                      control={control}
                                      name="afterDelivery"
                                      render={({ field }) => (
                                        <Input
                                          {...field}
                                          className="max-w-[120px]"
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            field.onChange(e);
                                            setAfterDelivery(
                                              value !== "" ? parseInt(value) : 0
                                            );
                                          }}
                                        />
                                      )}
                                    />
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <Label>Advance</Label>
                                    <Controller
                                      control={control}
                                      name="advance"
                                      render={({ field }) => (
                                        <Input
                                          {...field}
                                          className="max-w-[120px]"
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            field.onChange(e);
                                            setAdvance(
                                              value !== "" ? parseInt(value) : 0
                                            );
                                          }}
                                        />
                                      )}
                                    />
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <Label>Material Readiness</Label>
                                    <Controller
                                      control={control}
                                      name="materialReadiness"
                                      render={({ field }) => (
                                        <Input
                                          {...field}
                                          className="max-w-[120px]"
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            field.onChange(e);
                                            setMaterialReadiness(
                                              value !== "" ? parseInt(value) : 0
                                            );
                                          }}
                                        />
                                      )}
                                    />
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <Label>
                                      After{" "}
                                      <Controller
                                        control={control}
                                        name="xDays"
                                        render={({ field }) => (
                                          <input
                                            {...field}
                                            className="max-w-[45px] inline border px-2 rounded text-center text-black"
                                            onChange={(e) => {
                                              const value = e.target.value;
                                              field.onChange(e);
                                              setXDays(
                                                value !== ""
                                                  ? parseInt(value)
                                                  : 0
                                              );
                                            }}
                                          />
                                        )}
                                      />{" "}
                                      days of delivery
                                    </Label>
                                    <Controller
                                      control={control}
                                      name="xDaysAfterDelivery"
                                      render={({ field }) => (
                                        <Input
                                          {...field}
                                          className="max-w-[120px]"
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            field.onChange(e);
                                            setXDaysAfterDelivery(
                                              value !== "" ? parseInt(value) : 0
                                            );
                                          }}
                                        />
                                      )}
                                    />
                                  </div>
                                </div>

                                <div className="flex items-center gap-1">
                                  <Badge>
                                    Total aggregated percentages:{" "}
                                    {advance +
                                      materialReadiness +
                                      afterDelivery +
                                      xDaysAfterDelivery}
                                    %
                                  </Badge>
                                  <HoverCard>
                                    <HoverCardTrigger>
                                      <Info className="w-4 h-4 text-blue-500" />
                                    </HoverCardTrigger>
                                    <HoverCardContent side="left">
                                      <Badge variant={"red"}>Note</Badge>{" "}
                                      <strong className="text-xs">
                                        Total aggregated percentage must sum up
                                        to 100% to enable save button!
                                      </strong>
                                    </HoverCardContent>
                                  </HoverCard>
                                </div>
                              </section>

                              {/* Additional Charges Section */}
                              <section className="flex flex-col gap-2">
                                <h3 className="font-semibold text-lg tracking-tight">
                                  Additional Charges:
                                </h3>
                                <div className="flex justify-between items-center pb-2 border-b border-gray-300">
                                  <p className="text-sm text-gray-500">Type</p>
                                  <p className="text-sm text-gray-500">
                                    Amount
                                  </p>
                                </div>
                                <div className="flex items-center justify-between">
                                  <Label>Loading</Label>
                                  <Controller
                                    control={control}
                                    name="loadingCharges"
                                    render={({ field }) => (
                                      <Input
                                        {...field}
                                        className="max-w-[120px]"
                                        onChange={(e) => {
                                          const value = e.target.value;
                                          field.onChange(e);
                                          setLoadingCharges(
                                            value !== "" ? parseInt(value) : 0
                                          );
                                        }}
                                      />
                                    )}
                                  />
                                </div>
                                <div className="flex items-center justify-between">
                                  <Label>Freight</Label>
                                  <Controller
                                    control={control}
                                    name="freightCharges"
                                    render={({ field }) => (
                                      <Input
                                        {...field}
                                        className="max-w-[120px]"
                                        onChange={(e) => {
                                          const value = e.target.value;
                                          field.onChange(e);
                                          setFreightCharges(
                                            value !== "" ? parseInt(value) : 0
                                          );
                                        }}
                                      />
                                    )}
                                  />
                                </div>
                              </section>

                              {/* <section className="flex justify-between items-center">
                      <h3 className="text-black font-semibold tracking-tight">Show Comments</h3>
                      <Checkbox
                        className="mr-1"
                        id="commentsToggler"
                        defaultChecked={includeComments}
                        onCheckedChange={(e) => setIncludeComments(e)}
                       />
                    </section> */}

                              {/* Notes Section */}
                              <section>
                                <Label>Add Notes:</Label>
                                <Controller
                                  control={control}
                                  name="notes"
                                  render={({ field }) => (
                                    <Textarea
                                      {...field}
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        field.onChange(value);
                                        setNotes(value);
                                      }}
                                      className="w-full"
                                    />
                                  )}
                                />
                              </section>
                            </form>

                            <div className="flex gap-2 items-center justify-end">
                              {loadingFuncName === "OnSubmit" ? (
                                <TailSpin color="red" height={40} width={40} />
                              ) : (
                                <>
                                  <DialogClose asChild>
                                    <Button
                                      variant={"outline"}
                                      className="flex items-center gap-1"
                                    >
                                      <CircleX className="h-4 w-4" />
                                      Cancel
                                    </Button>
                                  </DialogClose>
                                  <Button
                                    type="submit"
                                    className="flex items-center gap-1"
                                    disabled={checkPrintDisabled}
                                    onClick={() =>
                                      onSubmit(control._formValues)
                                    }
                                  >
                                    <ListChecks className="h-4 w-4" />
                                    Save
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  )}
              </CardTitle>
            </CardHeader>
            <CardContent className="max-sm:text-xs">
              <div className="grid grid-cols-5">
                {/* Terms */}
                <div className="col-span-3 flex flex-col gap-4">
                  <div className="flex items-center gap-1 border-b-2 pb-1 border-gray-400">
                    <span className="font-semibold">Terms</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <HandCoins className="w-4 h-4 text-muted-foreground" />
                    <Label className="font-light">Advance</Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <BookCheck className="w-4 h-4 text-muted-foreground" />
                    <Label className="font-light">Material Readiness</Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Truck className="w-4 h-4 text-muted-foreground" />
                    <Label className="font-light">After Delivery</Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <CalendarDays className="w-4 h-4 text-muted-foreground" />
                    <Label className="font-light">
                      After {xDays || "--"} days of delivery
                    </Label>
                  </div>
                </div>

                {/* Percentages */}
                <div className="col-span-1 flex flex-col gap-4">
                  <div className="flex items-center gap-1 border-b-2 pb-1 border-gray-400">
                    <span className="font-semibold">%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">{advance}%</Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">{materialReadiness}%</Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">{afterDelivery}%</Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">{xDaysAfterDelivery}%</Label>
                  </div>
                </div>

                {/* Amounts  */}
                <div className="col-span-1 flex flex-col gap-4">
                  <div className="flex items-center gap-1 border-b-2 pb-1 border-gray-400">
                    <span className="font-semibold">Amount</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">
                      {formatToIndianRupee(
                        getTotal?.totalAmt * (advance / 100)
                      )}
                    </Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">
                      {formatToIndianRupee(
                        getTotal?.totalAmt * (materialReadiness / 100)
                      )}
                    </Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">
                      {formatToIndianRupee(
                        getTotal?.totalAmt * (afterDelivery / 100)
                      )}
                    </Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">
                      {formatToIndianRupee(
                        getTotal?.totalAmt * (xDaysAfterDelivery / 100)
                      )}
                    </Label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-5 mt-4">
                <div className="col-span-4 flex flex-col gap-4">
                  <div className="flex items-center gap-1 border-b-2 pb-1 border-gray-400">
                    <span className="font-semibold">Additional Charges</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">Loading</Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">Freight</Label>
                  </div>
                </div>

                {/* Amounts  */}
                <div className="col-span-1 flex flex-col gap-4">
                  <div className="flex items-center gap-1 border-b-2 pb-1 border-gray-400">
                    <span className="font-semibold">Amount</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">
                      {formatToIndianRupee(loadingCharges * 1.18)}
                    </Label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="font-light">
                      {formatToIndianRupee(freightCharges * 1.18)}
                    </Label>
                  </div>
                </div>
              </div>
              {/* <div className="flex flex-col gap-2 items-start mt-6">
              <Label className="font-bold">Notes</Label>
              <span className="whitespace-pre-wrap tracking-tight">{po?.notes || "--"}</span>
            </div> */}

              {/* <div className="flex items-end justify-between mt-4">
              <div className="flex flex-col gap-2 items-start max-w-[60%]">
                <Label className="font-bold">Item Comments Included for the PO PDF?</Label>
                <span>{includeComments ? "Yes" : "No"}</span>
              </div>
            </div> */}
            </CardContent>
          </Card>
        </div>
      )}
      </AccordionContent>

        </AccordionItem>
      </Accordion>

      {/* Order Details  */}
      <Card className="rounded-sm shadow-md md:col-span-3 overflow-x-auto">
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
        <CardContent>
          <table className="table-auto w-full">
            <thead>
              <tr className="border-gray-400 border-b-2 text-primary max-sm:text-sm">
                <th className="w-[5%] text-left ">S.No.</th>
                <th className="w-[50%] text-left px-2">Item Name</th>
                <th className="w-[10%]  text-center px-2">Unit</th>
                <th className="w-[10%]  text-center px-2">Quantity</th>
                <th className="w-[10%]  text-center px-2">Rate</th>
                <th className="w-[10%]  text-center px-2">Amount</th>
                {tab === "Delivered PO" && (
                   <th className="w-[5%] text-center px-2">OD</th>
                )}
              </tr>
            </thead>
            {/* <tbody className="max-sm:text-xs text-sm max-h-[100px] overflow-y-auto">
              {orderData?.list?.map((item, index) => (
                <tr key={index} className="border-b-2">
                  <td className="w-[5%] text-start ">
                    {index + 1}
                  </td>
                  <td className="w-[50%] text-left py-1">
                    <span>{item.item} {item?.makes?.list?.length > 0 && (
  <span className="text-xs italic font-semibold text-gray-500">
    - {item.makes.list.find((i) => i?.enabled === "true")?.make || "no make specified"}
  </span>
)}</span>
                    {item.comment && (
                      <div className="flex gap-1 items-start block border rounded-md p-1 md:w-[60%]">
                        <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                        <div className="text-xs ">
                          {item.comment}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="w-[10%]  text-center">
                    {item.unit}
                  </td>
                  <td className="w-[10%]  text-center">
                    {item.quantity}
                  </td>
                  <td className="w-[10%]  text-center">
                    {formatToIndianRupee(item?.quote)}
                  </td>
                  <td className="w-[10%]  text-center">
                    {formatToIndianRupee(item?.quote * item?.quantity)}
                  </td>
                </tr>
              ))}
            </tbody> */}
          </table>
          <div className={`${!summaryPage && "max-h-32"} overflow-y-auto`}>
            <table className="w-full">
              <tbody className="max-sm:text-xs text-sm">
                {orderData?.list?.map((item, index) => (
                  <tr key={index} className="border-b-2">
                    <td className="w-[5%] text-start ">{index + 1}</td>
                    <td className="w-[50%] text-left py-1">
                      <span>
                        {item.item}{" "}
                        {item?.makes?.list?.length > 0 && (
                          <span className="text-xs italic font-semibold text-gray-500">
                            -{" "}
                            {item.makes.list.find((i) => i?.enabled === "true")
                              ?.make || "no make specified"}
                          </span>
                        )}
                      </span>
                      {item.comment && (
                        <div className="flex gap-1 items-start border rounded-md p-1 md:w-[60%]">
                          <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                          <div className="text-xs ">{item.comment}</div>
                        </div>
                      )}
                    </td>
                    <td className="w-[10%] text-center">{item.unit}</td>
                    <td className="w-[10%] text-center">{item.quantity}</td>
                    <td className="w-[10%] text-center">
                      {formatToIndianRupee(item?.quote)}
                    </td>
                    <td className="w-[10%] text-center">
                      {formatToIndianRupee(item?.quote * item?.quantity)}
                    </td>
                    {tab === "Delivered PO" && (
                   <th className={`w-[5%] text-center ${item?.received === item?.quantity ? "text-green-600" : "text-red-700"}`}>{item?.received || 0}</th>
                )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Unmerge, Amend and Cancel PO Buttons  */}

      {/* Unmerge */}
      <div className="flex items-center justify-between">
        {!summaryPage &&
        !accountsPage &&
        !estimatesViewing &&
        po?.merged === "true" ? (
          po?.status === "PO Approved" &&
          !(poPayments?.length > 0) && (
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
              <AlertDialogContent className="overflow-auto">
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

                  {/* <ul className="list-disc list-inside">
                                    {prevMergedPOs?.map((po) => (
                                      <li key={po?.name}>{po?.name}</li>
                                    ))}
                                  </ul> */}

                  <p className="">
                    Click on confirm to proceed with unmerging!
                  </p>
                </AlertDialogDescription>
                {loadingFuncName === "handleUnmergePOs" ? (
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
          // : (
          //   <HoverCard>
          //       <HoverCardTrigger>
          //       <Button
          //         disabled
          //         variant={"outline"}
          //         className="flex border-primary items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
          //       >
          //         <Split className="h-4 w-4" />
          //         Unmerge
          //       </Button>
          //       </HoverCardTrigger>
          //       <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
          //         <div>
          //           <span className="text-primary underline">
          //             PO Unmerging
          //           </span>{" "}
          //           cannot happen at this stage as its delivery note or
          //           status has already been updated or there are payment(s) created for it!
          //         </div>
          //       </HoverCardContent>
          //     </HoverCard>
          // )
          <div />
        )}

        {/* Amend PO */}
        <div className="flex gap-2 items-center justify-end">
          {
            !summaryPage &&
              !accountsPage &&
              !estimatesViewing &&
              ["PO Approved"].includes(po?.status) &&
              po?.merged !== "true" && (
                <Button
                  onClick={toggleAmendPOSheet}
                  variant={"outline"}
                  className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
                >
                  <PencilRuler className="w-4 h-4" />
                  Amend PO
                </Button>
                // : (
                //   <HoverCard>
                //     <HoverCardTrigger>
                //       <Button
                //         disabled
                //         variant={"outline"}
                //         className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
                //       >
                //         <PencilRuler className="w-4 h-4" />
                //         Amend PO
                //       </Button>
                //     </HoverCardTrigger>
                //     <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                //       <div>
                //         As this is a{" "}
                //         <span className="text-primary">
                //           Merged PO
                //         </span>
                //         , in order to Amend this, you should unmerge
                //         the POs first!
                //       </div>
                //     </HoverCardContent>
                //   </HoverCard>
                // )
              )
            // : (
            //   <HoverCard>
            //     <HoverCardTrigger>
            //       <Button
            //         disabled
            //         variant={"outline"}
            //         className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
            //       >
            //         <PencilRuler className="w-4 h-4" />
            //         Amend PO
            //       </Button>
            //     </HoverCardTrigger>
            //     <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
            //       <div>
            //         <span className="text-primary underline">
            //           Amendment
            //         </span>{" "}
            //         not allowed for this PO as its delivery note or
            //         status has already been updated!
            //       </div>
            //     </HoverCardContent>
            //   </HoverCard>
            // )
          }
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
                      {orderData?.list?.map((item) => {
                        return (
                          <tr key={item.name}>
                            <td className="w-[45%] text-left border-b-2 py-1 text-sm">
                              {item.item}
                            </td>
                            <td className="w-[20%] border-b-2 py-1 text-sm text-center">
                              {item?.makes?.list?.find(
                                (i) => i?.enabled === "true"
                              )?.make || "--"}
                            </td>
                            <td className="w-[10%] border-b-2 py-1 text-sm text-center">
                              {item.unit}
                            </td>
                            <td className="w-[5%] border-b-2 py-1 text-sm text-center">
                              {item.quantity}
                            </td>
                            <td className="w-[10%] border-b-2 py-1 text-sm text-center">
                              <div className="flex items-center justify-center">
                                <Pencil
                                  onClick={() => {
                                    const options =
                                      item?.makes?.list?.map((i) => ({
                                        label: i?.make,
                                        value: i?.make,
                                      })) || [];
                                    const selected = item?.makes?.list?.find(
                                      (i) => i?.enabled === "true"
                                    );

                                    setQuantity(parseFloat(item.quantity));
                                    setAmendEditItem(item);
                                    setEditMakeOptions(options);
                                    setSelectedMake({
                                      label: selected?.make,
                                      value: selected?.make,
                                    });
                                    toggleAmendEditItemDialog();
                                  }}
                                  className="w-4 h-4 cursor-pointer"
                                />
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
                                {/* <DialogClose className="flex items-center gap-1">
                                  <Undo2 className="h-4 w-4" />
                                  Cancel
                                </DialogClose> */}
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
                      <DialogTitle className="flex justify-between">
                        Edit Item
                        {/* <AlertDialogCancel
                                        onClick={() => {
                                          setQuantity("")
                                          setAmendEditItem("")
                                        }
                                        }
                                        className="border-none shadow-none p-0"
                                      >
                                        X
                                      </AlertDialogCancel> */}
                      </DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="flex flex-col gap-2">
                      <div className="flex space-x-2 max-md:flex-col space-y-2">
                        <div className="w-full md:w-2/3">
                          <h5 className="text-base text-gray-400 text-left mb-1">
                            Item Name
                          </h5>
                          <div className="w-full  p-1 text-left">
                            {amendEditItem?.item}
                          </div>
                        </div>
                        <div className="flex space-x-2 w-full">
                          <div className="w-[60%]">
                            <h5 className="text-base text-gray-400 text-left mb-1">
                              Make
                            </h5>
                            <div className="w-full">
                              {/* {item.unit} */}
                              {/* <ReactSelect className="w-full" placeholder="Select Make..." value={selectedMake} options={editMakeOptions}
                                                onChange={(e) => setSelectedMake(e)}
                                              /> */}
                              <MakesSelection
                                selectedMake={selectedMake}
                                setSelectedMake={setSelectedMake}
                                editMakeOptions={editMakeOptions}
                                toggleAddNewMake={toggleAddNewMake}
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

                      {showAddNewMake && (
                        <AddNewMakes
                          orderData={orderData?.list}
                          setOrderData={setOrderData}
                          editMakeOptions={editMakeOptions}
                          amendEditItem={amendEditItem}
                          toggleAddNewMake={toggleAddNewMake}
                          setEditMakeOptions={setEditMakeOptions}
                        />
                      )}
                    </DialogDescription>
                    <DialogDescription className="flex justify-end">
                      <div className="flex gap-2">
                        {orderData?.list?.length === 1 ? (
                          <Button className="flex items-center gap-1" disabled>
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleDelete(amendEditItem.item)}
                            className="flex gap-1 items-center bg-gray-100 text-black hover:text-white"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        )}
                        <Button
                          disabled={!quantity}
                          onClick={() =>
                            handleSave(
                              amendEditItem.item,
                              quantity,
                              selectedMake
                            )
                          }
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
          {
            !summaryPage &&
              !accountsPage &&
              !estimatesViewing &&
              ["PO Approved"].includes(po?.status) &&
              !(poPayments?.length > 0) &&
              //  && (orderData?.order_list.list.some(item => 'po' in item) === false)
              po?.merged !== "true" && (
                <Button
                  onClick={toggleCancelPODialog}
                  variant={"outline"}
                  className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
                >
                  <X className="w-4 h-4" />
                  Cancel PO
                </Button>
                // : (
                //   <HoverCard>
                //     <HoverCardTrigger>
                //       <Button disabled variant={"outline"} className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8">
                //         <X className="w-4 h-4" />
                //         Cancel PO
                //       </Button>
                //     </HoverCardTrigger>
                //     <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                //       <div>
                //         As this is a{" "}
                //         <span className="text-primary">
                //           Merged PO
                //         </span>
                //         , in order to Cancel this, you should unmerge
                //         the POs first!
                //       </div>
                //     </HoverCardContent>
                //   </HoverCard>
                // )
              )
            // : (
            //   <HoverCard>
            //     <HoverCardTrigger>
            //       <Button disabled variant={"outline"} className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8">
            //         <X className="w-4 h-4" />
            //         Cancel PO
            //       </Button>
            //     </HoverCardTrigger>
            //     <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
            //       <div>
            //         <span className="text-primary underline">
            //           Cancellation
            //         </span>
            //         is not allowed for this PO. This might be due to
            //         the status is not PO Approved or there are payment(s) created for it.
            //       </div>
            //     </HoverCardContent>
            //   </HoverCard>
            // )
          }

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
                        This action will create a{" "}
                        <Badge variant="destructive">Cancelled</Badge> Sent Back
                        Request within{" "}
                        <span className="text-red-700 font-semibold">
                          New Sent Back
                        </span>{" "}
                        side option.
                      </li>
                    </ul>
                  </div>
                </div>

                <AlertDialogDescription className="flex flex-col text-center gap-1">
                  Cancelling this PO will create a new cancelled Sent Back.
                  Continue?
                  <div className="flex flex-col gap-2 mt-2">
                    <Textarea
                      placeholder="input the reason for cancelling..."
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </div>
                  {loadingFuncName === "handleCancelPo" ? (
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

      {/* PO Pdf  */}

      <Sheet open={poPdfSheet} onOpenChange={togglePoPdfSheet}>
        <SheetContent className="overflow-y-auto md:min-w-[700px]">
          <Button onClick={handlePrint} className="flex items-center gap-1">
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <div className={`w-full border mt-6`}>
            <div ref={componentRef} className="w-full p-2">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-gray-200">
                  <thead className="border-b border-black">
                    <tr>
                      <th colSpan={8}>
                        <div className="flex justify-between border-gray-600 pb-1">
                          <div className="mt-2 flex justify-between">
                            <div>
                              {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
                              <img
                                src={logo}
                                alt="Nirmaan"
                                width="180"
                                height="52"
                              />
                              <div className="pt-2 text-lg text-gray-600 font-semibold">
                                Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="pt-2 text-xl text-gray-600 font-semibold">
                              Purchase Order No.
                            </div>
                            <div className="text-lg font-light italic text-black">
                              {po?.name?.toUpperCase()}
                            </div>
                          </div>
                        </div>

                        <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                          <div className="text-xs text-gray-600 font-normal">
                            {po?.project_gst
                              ? po?.project_gst === "29ABFCS9095N1Z9"
                                ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                                : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
                              : "Please set company GST number in order to display the Address!"}
                          </div>
                          <div className="text-xs text-gray-600 font-normal">
                            GST: {po?.project_gst || "N/A"}
                          </div>
                        </div>

                        <div className="flex justify-between">
                          <div>
                            <div className="text-gray-600 text-sm pb-2 text-left">
                              Vendor Address
                            </div>
                            <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">
                              {po?.vendor_name}
                            </div>
                            <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                              {/* {vendor_address?.address_line1}, {vendor_address?.address_line2}, {vendor_address?.city}, {vendor_address?.state}-{vendor_address?.pincode} */}
                              <AddressView id={po?.vendor_address} />
                            </div>
                            <div className="text-sm font-medium text-gray-900 text-left">
                              GSTIN: {po?.vendor_gst}
                            </div>
                          </div>
                          <div>
                            <div>
                              <h3 className="text-gray-600 text-sm pb-2 text-left">
                                Delivery Location
                              </h3>
                              <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                                {/* {project_address?.address_line1}, {project_address?.address_line2}, {project_address?.city}, {project_address?.state}-{project_address?.pincode} */}
                                <AddressView id={po?.project_address} />
                              </div>
                            </div>
                            <div className="pt-2">
                              <div className="text-sm font-normal text-gray-900 text-left">
                                <span className="text-gray-600 font-normal">
                                  Date:
                                </span>
                                &nbsp;&nbsp;&nbsp;
                                <i>{po?.creation?.split(" ")[0]}</i>
                              </div>
                              <div className="text-sm font-normal text-gray-900 text-left">
                                <span className="text-gray-600 font-normal">
                                  Project Name:
                                </span>
                                &nbsp;&nbsp;&nbsp;
                                <i>{po?.project_name}</i>
                              </div>
                            </div>
                          </div>
                        </div>
                      </th>
                    </tr>
                    <tr className="border-t border-black">
                      <th
                        scope="col"
                        className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider"
                      >
                        S. No.
                      </th>
                      <th
                        scope="col"
                        className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48"
                      >
                        Items
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
                      >
                        Unit
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                      >
                        Qty
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                      >
                        Rate
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                      >
                        Tax
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                      >
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className={`bg-white`}>
                    {/* {orderData?.order_list?.list.map((item: any, index: number) => {
                                                    return (<tr key={index} className={`${(!loadingCharges && !freightCharges && index === orderData?.order_list?.list.length - 1) && "border-b border-black"} page-break-inside-avoid ${index === 15 ? 'page-break-before' : ''}`}>
                                                        <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index + 1}.</td>
                                                        <td className=" py-2 text-sm whitespace-nowrap text-wrap">{item.item}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.quote)}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(((item.quote) * (item.quantity)))}</td>
                                                    </tr>)
                                                })} */}

                    {[
                      ...new Map(
                        orderData?.list?.map((item) => [
                          item.item,
                          {
                            ...item,
                            quantity: orderData?.list
                              ?.filter(
                                ({ item: itemName }) => itemName === item.item
                              )
                              ?.reduce(
                                (total, curr) => total + curr.quantity,
                                0
                              ),
                          },
                        ])
                      )?.values(),
                    ]?.map((item, index) => {
                      const length = [
                        ...new Map(
                          orderData?.list?.map((item) => [
                            item.item,
                            {
                              ...item,
                              quantity: orderData?.list
                                ?.filter(
                                  ({ item: itemName }) => itemName === item.item
                                )
                                ?.reduce(
                                  (total, curr) => total + curr.quantity,
                                  0
                                ),
                            },
                          ])
                        ).values(),
                      ].length;
                      return (
                        <tr
                          key={index}
                          className={`${
                            !loadingCharges &&
                            !freightCharges &&
                            index === length - 1 &&
                            "border-b border-black"
                          } page-break-inside-avoid ${
                            index === 15 ? "page-break-before" : ""
                          }`}
                        >
                          <td className="py-2 px-2 text-sm whitespace-nowrap w-[7%]">
                            {index + 1}.
                          </td>
                          <td className="py-2 text-xs whitespace-nowrap text-wrap">
                            {item.item?.toUpperCase()}
                            {item?.makes?.list?.length > 0 && (
                              <p className="text-xs italic font-semibold text-gray-500">
                                -{" "}
                                {item.makes.list
                                  .find((i) => i?.enabled === "true")
                                  ?.make?.toLowerCase()
                                  ?.replace(/\b\w/g, (char) =>
                                    char.toUpperCase()
                                  ) || "No Make Specified"}
                              </p>
                            )}
                            {item.comment && includeComments && (
                              <div className="flex gap-1 items-start block p-1">
                                <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                                <div className="text-xs text-gray-400">
                                  {item.comment}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap">
                            {item.unit}
                          </td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap">
                            {item.quantity}
                          </td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap">
                            {formatToIndianRupee(item.quote)}
                          </td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap">
                            {item.tax}%
                          </td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap">
                            {formatToIndianRupee(item.quote * item.quantity)}
                          </td>
                        </tr>
                      );
                    })}
                    {/* {[...Array(19)].map((_, index) => (
                                        orderData?.list.map((item) => (
                                             <tr className="">
                                                <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index+1}.</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap text-wrap">sijdoodsjfo sfjdofjdsofjdsofj sdifjsojfosdjfjs </td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                                <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quote}</td>
                                                <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                                                <td className="px-4 py-2 text-sm whitespace-nowrap">{(item.quote) * (item.quantity)}</td>
                                            </tr>
                                        )
                                    )))} */}
                    {loadingCharges ? (
                      <tr
                        className={`${
                          !freightCharges && "border-b border-black"
                        }`}
                      >
                        <td className="py-2 text-sm whitespace-nowrap w-[7%]">
                          -
                        </td>
                        <td className=" py-2 text-xs whitespace-nowrap">
                          LOADING CHARGES
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          NOS
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          1
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {formatToIndianRupee(loadingCharges)}
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          18%
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {formatToIndianRupee(loadingCharges)}
                        </td>
                      </tr>
                    ) : (
                      <></>
                    )}
                    {freightCharges ? (
                      <tr className={`border-b border-black`}>
                        <td className="py-2 text-sm whitespace-nowrap w-[7%]">
                          -
                        </td>
                        <td className=" py-2 text-xs whitespace-nowrap">
                          FREIGHT CHARGES
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          NOS
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          1
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {formatToIndianRupee(freightCharges)}
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          18%
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {formatToIndianRupee(freightCharges)}
                        </td>
                      </tr>
                    ) : (
                      <></>
                    )}
                    <tr className="">
                      <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                      <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                        Sub-Total
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                        {formatToIndianRupee(getTotal?.total)}
                      </td>
                    </tr>
                    <tr className="border-none">
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                        <div>Total Tax(GST):</div>
                        <div>Round Off:</div>
                        <div>Total:</div>
                      </td>

                      <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                        <div className="ml-4">
                          {formatToIndianRupee(getTotal?.totalGst)}
                        </div>
                        <div className="ml-4">
                          -{" "}
                          {formatToIndianRupee(
                            getTotal?.totalAmt -
                              Math.floor(getTotal?.totalAmt)
                          )}
                        </div>
                        <div className="ml-4">
                          {formatToIndianRupee(Math.floor(getTotal?.totalAmt))}
                        </div>
                      </td>
                    </tr>
                    <tr className="end-of-page page-break-inside-avoid">
                      <td colSpan={6}>
                        {notes !== "" && (
                          <>
                            <div className="text-gray-600 font-bold text-sm py-2">
                              Note
                            </div>
                            <div className="text-sm text-gray-900">{notes}</div>
                          </>
                        )}
                        {advance ||
                        materialReadiness ||
                        afterDelivery ||
                        xDaysAfterDelivery ? (
                          <>
                            <div className="text-gray-600 font-bold text-sm py-2">
                              Payment Terms
                            </div>
                            <div className="text-sm text-gray-900">
                              {(() => {
                                // Check if any of the variables is 100
                                if (advance === 100) {
                                  return `${advance}% advance`;
                                } else if (materialReadiness === 100) {
                                  return `${materialReadiness}% on material readiness`;
                                } else if (afterDelivery === 100) {
                                  return `${afterDelivery}% after delivery to the site`;
                                } else if (xDaysAfterDelivery === 100) {
                                  return `${xDaysAfterDelivery}% after ${xDays} days of delivering the material(s)`;
                                }

                                // If none of the variables is 100, render non-zero values
                                const parts = [];
                                if (advance > 0) {
                                  parts.push(`${advance}% advance`);
                                }
                                if (materialReadiness > 0) {
                                  parts.push(
                                    `${materialReadiness}% on material readiness`
                                  );
                                }
                                if (afterDelivery > 0) {
                                  parts.push(
                                    `${afterDelivery}% after delivery to the site`
                                  );
                                }
                                if (xDaysAfterDelivery > 0) {
                                  parts.push(
                                    `${xDaysAfterDelivery}% after ${xDays} days of delivering the material(s)`
                                  );
                                }

                                // Join the parts with commas and return
                                return parts.join(", ");
                              })()}
                            </div>
                          </>
                        ) : (
                          ""
                        )}

                        <img src={Seal} className="w-24 h-24" />
                        <div className="text-sm text-gray-900 py-6">
                          For, Stratos Infra Technologies Pvt. Ltd.
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div
                style={{ display: "block", pageBreakBefore: "always" }}
              ></div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-gray-200">
                  <thead className="border-b border-black">
                    <tr>
                      <th colSpan={6}>
                        <div className="flex justify-between border-gray-600 pb-1">
                          <div className="mt-2 flex justify-between">
                            <div>
                              {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
                              <img
                                src={logo}
                                alt="Nirmaan"
                                width="180"
                                height="52"
                              />
                              <div className="pt-2 text-lg text-gray-600 font-semibold">
                                Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="pt-2 text-xl text-gray-600 font-semibold">
                              Purchase Order No. :
                            </div>
                            <div className="text-lg font-light italic text-black">
                              {po?.name?.toUpperCase()}
                            </div>
                          </div>
                        </div>

                        <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                          <div className="text-xs text-gray-600 font-normal">
                            {po?.project_gst
                              ? po?.project_gst === "29ABFCS9095N1Z9"
                                ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                                : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
                              : "Please set company GST number in order to display the Address!"}
                          </div>
                          <div className="text-xs text-gray-600 font-normal">
                            GST: {po?.project_gst || "N/A"}
                          </div>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <div className="max-w-4xl mx-auto p-6 text-gray-800">
                      <h1 className="text-xl font-bold mb-4">
                        Terms and Conditions
                      </h1>
                      <h2 className="text-lg font-semibold mt-6">
                        1. Invoicing:
                      </h2>
                      <ol className="list-decimal pl-6 space-y-2 text-sm">
                        <li className="pl-2">
                          All invoices shall be submitted in original and shall
                          be tax invoices showing the breakup of tax
                          structure/value payable at the prevailing rate and a
                          clear description of goods.
                        </li>
                        <li className="pl-2">
                          All invoices submitted shall have Delivery
                          Challan/E-waybill for supply items.
                        </li>
                        <li className="pl-2">
                          All Invoices shall have the tax registration numbers
                          mentioned thereon. The invoices shall be raised in the
                          name of “Stratos Infra Technologies Pvt Ltd,
                          Bangalore”.
                        </li>
                        <li className="pl-2">
                          Payments shall be only entertained after receipt of
                          the correct invoice.
                        </li>
                        <li className="pl-2">
                          In case of advance request, Advance payment shall be
                          paid after the submission of an advance receipt (as
                          suggested under GST law).
                        </li>
                      </ol>

                      <h2 className="text-lg font-semibold mt-6">
                        2. Payment:
                      </h2>
                      <ol className="list-decimal pl-6 space-y-2 text-sm">
                        <li className="pl-2">
                          Payment shall be done through RTGS/NEFT.
                        </li>
                        <li className="pl-2">
                          A retention amount shall be deducted as per PO payment
                          terms and:
                        </li>
                        <ol className="list-decimal pl-6 space-y-1 text-sm">
                          <li className="pl-2">
                            In case the vendor is not completing the task
                            assigned by Nirmaan a suitable amount, as decided by
                            Nirmaan, shall be deducted from the retention
                            amount.
                          </li>
                          <li className="pl-2">
                            The adjusted amount shall be paid on completion of
                            the defect liability period.
                          </li>
                          <li className="pl-2">
                            Vendors are expected to pay GST as per the
                            prevailing rules. In case the vendor is not making
                            GST payments to the tax authority, Nirmaan shall
                            deduct the appropriated amount from the invoice
                            payment of the vendor.
                          </li>
                          <li className="pl-2">
                            Nirmaan shall deduct the following amounts from the
                            final bills:
                          </li>
                          <ol className="list-decimal pl-6 space-y-1 text-sm">
                            <li className="pl-2">
                              Amount pertaining to unfinished supply.
                            </li>
                            <li className="pl-2">
                              Amount pertaining to Liquidated damages and other
                              fines, as mentioned in the documents.
                            </li>
                            <li className="pl-2">
                              Any agreed amount between the vendor and Nirmaan.
                            </li>
                          </ol>
                        </ol>
                      </ol>

                      <h2 className="text-lg font-semibold mt-6">
                        3. Technical Specifications of the Work:
                      </h2>
                      <ol className="list-decimal pl-6 space-y-2 text-sm">
                        <li className="pl-2">
                          All goods delivered shall conform to the technical
                          specifications mentioned in the vendor’s quote
                          referred to in this PO or as detailed in Annexure 1 to
                          this PO.
                        </li>
                        <li className="pl-2">
                          Supply of goods or services shall be strictly as per
                          Annexure - 1 or the Vendor’s quote/PI in case of the
                          absence of Annexure - I.
                        </li>
                        <li className="pl-2">
                          Any change in line items or quantities shall be duly
                          approved by Nirmaan with rate approval prior to
                          supply. Any goods supplied by the agency without
                          obtaining due approvals shall be subject to the
                          acceptance or rejection from Nirmaan.
                        </li>
                        <li className="pl-2">
                          Any damaged/faulty material supplied needs to be
                          replaced with a new item free of cost, without
                          extending the completion dates.
                        </li>
                        <li className="pl-2">
                          Material supplied in excess and not required by the
                          project shall be taken back by the vendor at no cost
                          to Nirmaan.
                        </li>
                      </ol>
                      <br />
                      <br />
                      <br />
                      <br />
                      <br />

                      <h1 className="text-xl font-bold mb-4">
                        General Terms & Conditions for Purchase Order
                      </h1>
                      <ol className="list-decimal pl-6 space-y-2 text-sm">
                        <li className="pl-2">
                          <div className="font-semibold">
                            Liquidity Damages:
                          </div>{" "}
                          Liquidity damages shall be applied at 2.5% of the
                          order value for every day of delay.
                        </li>
                        <li className="pl-2">
                          <div className="font-semibold">
                            Termination/Cancellation:
                          </div>{" "}
                          If Nirmaan reasonably determines that it can no longer
                          continue business with the vendor in accordance with
                          applicable legal, regulatory, or professional
                          obligations, Nirmaan shall have the right to
                          terminate/cancel this PO immediately.
                        </li>
                        <li className="pl-2">
                          <div className="font-semibold">
                            Other General Conditions:
                          </div>
                        </li>
                        <ol className="list-decimal pl-6 space-y-1 text-sm">
                          <li className="pl-2">
                            Insurance: All required insurance including, but not
                            limited to, Contractors’ All Risk (CAR) Policy,
                            FLEXA cover, and Workmen’s Compensation (WC) policy
                            are in the vendor’s scope. Nirmaan in any case shall
                            not be made liable for providing these insurance.
                            All required insurances are required prior to the
                            commencement of the work at the site.
                          </li>
                          <li className="pl-2">
                            Safety: The safety and security of all men deployed
                            and materials placed by the Vendor or its agents for
                            the project shall be at the risk and responsibility
                            of the Vendor. Vendor shall ensure compliance with
                            all safety norms at the site. Nirmaan shall have no
                            obligation or responsibility on any safety, security
                            & compensation related matters for the resources &
                            material deployed by the Vendor or its agent.
                          </li>
                          <li className="pl-2">
                            Notice: Any notice or other communication required
                            or authorized under this PO shall be in writing and
                            given to the party for whom it is intended at the
                            address given in this PO or such other address as
                            shall have been notified to the other party for that
                            purpose, through registered post, courier, facsimile
                            or electronic mail.
                          </li>
                          <li className="pl-2">
                            Force Majeure: Neither party shall be liable for any
                            delay or failure to perform if such delay or failure
                            arises from an act of God or of the public enemy, an
                            act of civil disobedience, epidemic, war,
                            insurrection, labor action, or governmental action.
                          </li>
                          <li className="pl-2">
                            Name use: Vendor shall not use, or permit the use
                            of, the name, trade name, service marks, trademarks,
                            or logo of Nirmaan in any form of publicity, press
                            release, advertisement, or otherwise without
                            Nirmaan's prior written consent.
                          </li>
                          <li className="pl-2">
                            Arbitration: Any dispute arising out of or in
                            connection with the order shall be settled by
                            Arbitration in accordance with the Arbitration and
                            Conciliation Act,1996 (As amended in 2015). The
                            arbitration proceedings shall be conducted in
                            English in Bangalore by the sole arbitrator
                            appointed by the Purchaser.
                          </li>
                          <li className="pl-2">
                            The law governing: All disputes shall be governed as
                            per the laws of India and subject to the exclusive
                            jurisdiction of the court in Karnataka.
                          </li>
                        </ol>
                      </ol>
                    </div>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

const MakesSelection = ({
  selectedMake,
  setSelectedMake,
  editMakeOptions,
  amendEditItem,
  toggleAddNewMake,
}) => {
  const CustomMenu = (props) => {
    const { MenuList } = components;

    return (
      <MenuList {...props}>
        {props.children}
        <div
          className="p-2 bg-gray-100 hover:bg-gray-200 text-center cursor-pointer"
          onClick={() => toggleAddNewMake()}
        >
          <strong>Add New Make</strong>
        </div>
      </MenuList>
    );
  };

  return (
    <>
      <div className="w-full">
        <ReactSelect
          className="w-full"
          placeholder="Select Make..."
          value={selectedMake}
          options={editMakeOptions}
          onChange={(selectedOption) => setSelectedMake(selectedOption)}
          components={{ MenuList: CustomMenu }}
        />
      </div>
    </>
  );
};

const AddNewMakes = ({
  orderData,
  setOrderData,
  editMakeOptions,
  amendEditItem,
  toggleAddNewMake,
  setEditMakeOptions,
}) => {
  const [makeOptions, setMakeOptions] = useState([]);

  const [newSelectedMakes, setNewSelectedMakes] = useState([]);

  const { data: categoryMakeList } = useFrappeGetDocList("Category Makelist", {
    fields: ["*"],
    limit: 10000,
  });

  useEffect(() => {
    if (categoryMakeList?.length > 0) {
      const categoryMakes = categoryMakeList?.filter(
        (i) => i?.category === amendEditItem.category
      );
      const makeOptionsList =
        categoryMakes?.map((i) => ({ label: i?.make, value: i?.make })) || [];
      const filteredOptions = makeOptionsList?.filter(
        (i) => !editMakeOptions?.some((j) => j?.value === i?.value)
      );
      setMakeOptions(filteredOptions);
    }
  }, [categoryMakeList, editMakeOptions, amendEditItem]);

  const handleSumbit = () => {
    const allOptions = [...editMakeOptions, ...newSelectedMakes];

    const currentMakes = editMakeOptions?.map((j) => ({
      make: j?.value,
      enabled: "false",
    }));

    const reformattedNewMakes = newSelectedMakes?.map((i) => ({
      make: i?.value,
      enabled: "false",
    }));

    const combinedMakes = [...currentMakes, ...reformattedNewMakes];

    const curRequest = orderData.map((curValue) => {
      if (curValue.item === amendEditItem?.item) {
        return { ...curValue, makes: { list: combinedMakes } };
      }
      return curValue;
    });

    setOrderData({
      list: curRequest,
    });

    setEditMakeOptions(allOptions);

    toggleAddNewMake();
  };

  return (
    <Card className="w-full bg-gray-100 my-2">
      <CardContent className="py-2">
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">Existing Makes for this item:</h2>
          {editMakeOptions?.length > 0 ? (
            <div className="flex gap-1 flex-wrap">
              {editMakeOptions?.map((i) => (
                <Badge>{i?.value}</Badge>
              ))}
            </div>
          ) : (
            "--"
          )}
        </div>
        <div className="flex gap-4 items-end my-4">
          <div className="w-[70%]">
            <Label>Select New Make</Label>
            {categoryMakeList && (
              <ReactSelect
                options={makeOptions}
                value={newSelectedMakes}
                isMulti
                onChange={(selectedOptions) =>
                  setNewSelectedMakes(selectedOptions)
                }
              />
            )}
          </div>

          <div className="flex gap-2 items-center">
            <Button onClick={() => toggleAddNewMake()} variant="outline">
              <CircleX className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button
              onClick={handleSumbit}
              disabled={!newSelectedMakes?.length}
              className="flex items-center gap-1"
            >
              <ListChecks className="h-4 w-4" />
              Confirm
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
