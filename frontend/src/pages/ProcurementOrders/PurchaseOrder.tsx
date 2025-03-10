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
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PODetails } from "@/components/ui/PODetails";
import { POPdf } from "@/components/ui/POPdf";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useUserData } from "@/hooks/useUserData";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ProcurementOrder, PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
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
  Eye,
  HandCoins,
  Info,
  List,
  ListChecks,
  Merge,
  MessageCircleMore,
  MessageCircleWarning,
  Paperclip,
  Pencil,
  PencilIcon,
  PencilRuler,
  Split,
  SquarePlus,
  Trash2,
  TriangleAlert,
  Truck,
  Undo,
  X
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import ReactSelect, { components } from "react-select";
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
  const [selectedGST, setSelectedGST] = useState<{gst : string | undefined, location : string | undefined} | null>(null);

  const [mergeablePOs, setMergeablePOs] = useState<ProcurementOrder[]>([]);
  const [mergedItems, setMergedItems] = useState<ProcurementOrder[]>([]);
  const [prevMergedPOs, setPrevMergedPos] = useState<ProcurementOrder[]>([]);

  const [loadingFuncName, setLoadingFuncName] = useState("");

  const [orderData, setOrderData] = useState<{ list : PurchaseOrderItem[]}>({
    list: []
  });

  const [quantity, setQuantity] = useState<number | null | string>(null);

  interface Make {
    make: string;
    enabled: string;
  }

  interface Operation {
    operation: 'delete' | 'quantity_change' | 'make_change';
    item: string | PurchaseOrderItem;
    previousQuantity?: number;
    previousMakeList?: Make[];
  }

  const [stack, setStack] = useState<Operation[]>([]);
  const [comment, setComment] = useState("");

  const [editMakeOptions, setEditMakeOptions] = useState<{label : string, value : string}[]>([]);

  const [selectedMake, setSelectedMake] = useState<{label : string, value : string} | null>(null);

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
    tds: ""
  });

  const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);

  const handleFileChange = (event : React.ChangeEvent<HTMLInputElement>) => {
    if(event.target.files){
      setPaymentScreenshot(event.target.files[0]);
    }
  };

  const { updateDoc } = useFrappeUpdateDoc();

  const { createDoc } = useFrappeCreateDoc();

  const { deleteDoc } = useFrappeDeleteDoc();

  const { upload: upload } = useFrappeFileUpload();

  const { call } = useFrappePostCall("frappe.client.set_value");

  const {call : cancelPOCall, loading : cancelPOCallLoading} = useFrappePostCall("nirmaan_stack.api.handle_cancel_po.handle_cancel_po");

  const {call : mergePOCall, loading : mergePOCallLoading} = useFrappePostCall("nirmaan_stack.api.po_merge_and_unmerge.handle_merge_pos");

  const {call : unMergePOCall, loading : unMergePOCallLoading} = useFrappePostCall("nirmaan_stack.api.po_merge_and_unmerge.handle_unmerge_pos");

  const [deleteFlagged, setDeleteFlagged] = useState<ProjectPayments | null>(null);

  const [PO, setPO] = useState<ProcurementOrder | null>(null)

  const { data: po, isLoading: poLoading, error: poError, mutate: poMutate} = useFrappeGetDocList<ProcurementOrder>("Procurement Orders", {
    fields: ["*"],
    filters: [["name", "=", poId]],
  });

  useEffect(() => {
    if(po) {
      const doc = po[0]
      setPO(doc)
      setOrderData(doc?.order_list || { list: [] });
    }
  }, [po])

  const {
    data: associated_po_list,
    error: associated_po_list_error,
    isLoading: associated_po_list_loading,
    mutate: associated_po_list_mutate,
  } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders", {
    fields: ["*"],
    limit: 100000,
  });

  const { data: poProject } = useFrappeGetDoc<Projects>(
    "Projects",
    PO?.project,
    PO ? undefined : null
  );

  const {
    data: pr,
    isLoading: prLoading,
    error: prError,
  } = useFrappeGetDoc("Procurement Requests", PO?.procurement_request, PO ? undefined : null);

  const {
    data: usersList,
    isLoading: usersListLoading,
    error: usersListError,
  } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
    fields: ["name", "full_name"],
    limit: 1000,
  });

  const {
    data: poPayments,
    isLoading: poPaymentsLoading,
    error: poPaymentsError,
    mutate: poPaymentsMutate,
  } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
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
    if (associated_po_list && associated_po_list?.length > 0) {
      if (PO?.status === "PO Approved") {
        const mergeablePOs = associated_po_list.filter(
          (item) =>
            item.project === PO?.project &&
            item.vendor === PO?.vendor &&
            item.status === "PO Approved" &&
            item.name !== poId &&
            !AllPoPaymentsList?.some((j) => j?.document_name === item.name)
            // item.merged !== "true" &&
        );
        setMergeablePOs(mergeablePOs);
        if (PO?.merged === "true") {
          const mergedPOs = associated_po_list.filter(
            (po) => po?.merged === poId
          );
          setPrevMergedPos(mergedPOs);
        }
      }
    }
  }, [associated_po_list, PO, AllPoPaymentsList]);


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

      const res = await updateDoc("Procurement Orders", poId, updateData);

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
        description: `Failed to update ${poId}`,
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


  const resetForm = useCallback((poData: typeof PO) => {
    if (!poData) return;
    
    const chargesArray = poData.advance?.split(', ') || ['0', '0', '0', '0', '0'];
    const parsedCharges = chargesArray.map(charge => parseFloat(charge));
    
    setAdvance(parsedCharges[0]);
    setMaterialReadiness(parsedCharges[1]);
    setAfterDelivery(parsedCharges[2]);
    setXDaysAfterDelivery(parsedCharges[3]);
    setXDays(parsedCharges[4]);
    setLoadingCharges(parseFloat(poData.loading_charges || "0"));
    setFreightCharges(parseFloat(poData.freight_charges || "0"));
    setNotes(poData.notes || '');

    reset({
      advance: parsedCharges[0],
      materialReadiness: parsedCharges[1],
      afterDelivery: parsedCharges[2],
      xDaysAfterDelivery: parsedCharges[3],
      xDays: parsedCharges[4],
      loadingCharges: parseFloat(poData.loading_charges || "0"),
      freightCharges: parseFloat(poData.freight_charges || "0"),
      notes: poData.notes || '',
    });

    if (poData.project_gst) {
      setSelectedGST(prev =>  ({ ...prev, gst: poData.project_gst }));
    }

  }, [reset]);

  useEffect(() => {
    if (PO || !editPOTermsDialog) {
      resetForm(PO);
    }
  }, [PO, editPOTermsDialog, resetForm]);

  const getTotal = useMemo(() => {
    if (PO) {
      return getPOTotal(PO, freightCharges, loadingCharges);
    }
  }, [PO, freightCharges, loadingCharges]);

  const handleMerge = (po : ProcurementOrder) => {
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

  const handleUnmerge = (po : ProcurementOrder) => {
    if (orderData) {
      let updatedList;
      if (po?.merged === "true") {
        const associated_merged_pos =
          associated_po_list
            ?.filter((item) => item.merged === po?.name)
            ?.map((i) => i?.name) || [];
        updatedList = orderData.list.filter(
          (item) => !associated_merged_pos.includes(item.po || '')
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
    try {
        // Call the backend API for merging POs
        const response = await mergePOCall({
            po_id: poId,
            merged_items: mergedItems,
            order_data: orderData,
        });

        if (response.message.status === 200) {
            // ✅ Step 4: Success message & UI updates (Batch State Updates)
            setMergeablePOs([]);
            toast({
                title: "Merge Successful!",
                description: response.message.message,
                variant: "success",
            });
            toggleMergeConfirmDialog();
            toggleMergeSheet();

            // ✅ Step 5: Add redirect overlay, then navigate smoothly
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
        // Call the backend API for unmerging POs
        const response = await unMergePOCall({
            po_id: poId,
            prev_merged_pos: prevMergedPOs,
        });

        if (response.message.status === 200) {
            toggleUnMergeDialog();

            toast({
                title: "Success!",
                description: response.message,
                variant: "success",
            });

            setIsRedirecting(true); // Show overlay

            setTimeout(() => {
                setIsRedirecting(false);
                navigate(`/purchase-orders`);
                window.location.reload();
            }, 1000); // Small delay ensures UI has time to update
        } else if (response.message.status === 400) {
            toast({
                title: "Error!",
                description: response.message.error,
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
    try {
      const response = await cancelPOCall({
        po_id: poId,
        comment: comment
      });

      if (response.message.status === 200) {
        toast({
          title: "Success!",
          description: response.message.message,
          variant: "success",
        });
        navigate("/purchase-orders");
      } else if(response.message.status === 400) {
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
    setOrderData(PO?.order_list || { list: [] });
    setStack([]);
  };

  useEffect(() => {
    if (!amendPOSheet && stack.length) {
      handleUnAmendAll();
    }
  }, [amendPOSheet]);

  const handleSave = useCallback((
    itemName: string,
    newQuantity: string,
    selectedMake: {label : string, value : string}
  ) => {
    let curRequest = orderData?.list;

    // Find the current item and store its previous quantity in the stack
    const previousItem = curRequest.find(
      (curValue) => curValue.item === itemName
    );

    if (previousItem && parseFloat(newQuantity) !== parseFloat(previousItem?.quantity)) {
      setStack((prevStack) => [
        ...prevStack,
        {
          operation: "quantity_change",
          item: previousItem.item,
          previousQuantity: parseFloat(previousItem.quantity),
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
  }, [orderData, setOrderData, setQuantity, toggleAmendEditItemDialog, setStack]);

  const handleDelete = useCallback((item: string) => {
    let curRequest = orderData?.list;
    let itemToPush = curRequest.find((curValue) => curValue.item === item);

    if(itemToPush) {
      setStack((prevStack) => [
        ...prevStack,
        {
          operation: "delete",
          item: itemToPush,
        },
      ]);
    }
    curRequest = curRequest.filter((curValue) => curValue.item !== item);
    setOrderData({
      list: curRequest,
    });

    setQuantity("");
    toggleAmendEditItemDialog();
  }, [orderData, setOrderData, setQuantity, toggleAmendEditItemDialog, setStack]);

  const UndoDeleteOperation = useCallback(() => {
    if (stack.length === 0) return; // No operation to undo

    let curRequest = orderData?.list;
    const lastOperation = stack[stack.length - 1]; // Get the last operation
    const newStack = stack.slice(0, stack.length - 1); // Create a new stack without the last operation

    if (lastOperation.operation === "delete" && lastOperation.item) {
      // Restore the deleted item
      curRequest.push(lastOperation.item as PurchaseOrderItem); // Type assertion, as item is Item in delete operation
    } else if (lastOperation.operation === "quantity_change" && lastOperation.item) {
      // Restore the previous quantity of the item
      curRequest = curRequest.map((curValue) => {
        if (curValue.item === lastOperation.item) {
          return { ...curValue, quantity: lastOperation.previousQuantity };
        }
        return curValue;
      });
    } else if (lastOperation.operation === "make_change" && lastOperation.item) {
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
    setStack(newStack);
  }, [orderData, setOrderData, setStack, stack]);

  const treeData = [
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
  ];

  const AddPayment = async () => {
    try {
      setLoadingFuncName("AddPayment");
      const res = await createDoc("Project Payments", {
        document_type: "Procurement Orders",
        document_name: poId,
        project: PO?.project,
        vendor: PO?.vendor,
        utr: newPayment?.utr,
        tds: newPayment?.tds,
        amount: newPayment?.amount,
        payment_date: newPayment?.payment_date,
        status: "Paid"
      });

      if(paymentScreenshot) {
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
      }

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
        tds: ""
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

  const amountPaid = getTotalAmountPaid((poPayments || []).filter(i => i?.status === "Paid"));

  const validateAmount = debounce((amount : string | number) => {
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
  const handleAmountChange = (e : React.ChangeEvent<HTMLInputElement>) => {
    const amount = e.target.value;
    setNewPayment({ ...newPayment, amount });
    validateAmount(amount);
  };

  const getUserName = (id : string | undefined) => {
    if (usersList) {
      return usersList.find((user) => user?.name === id)?.full_name
    }
    return "";
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
            onClick={() => navigate("/purchase-orders")}
          >
            Go Back
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex-1 space-y-4">
      {!summaryPage &&
        !accountsPage &&
        !estimatesViewing &&
        PO?.status === "PO Approved" &&
        PO?.merged !== "true" &&
        !((poPayments || [])?.length > 0) &&
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
                              {PO?.project_name}
                            </p>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm text-gray-500">
                              Vendor:
                            </span>
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

          <PODetails po={PO} summaryPage={summaryPage} accountsPage={accountsPage} estimatesViewing={estimatesViewing} poPayments={poPayments} togglePoPdfSheet={togglePoPdfSheet}
            getTotal={getTotal} amountPaid={amountPaid} pr={pr} poMutate={poMutate} />

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
                                    <span className="">{PO?.project_name}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Vendor:</Label>
                                    <span className="">{PO?.vendor_name}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">PO Amt excl. Tax:</Label>
                                    <span className="">{formatToIndianRupee(getTotal?.total)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">PO Amt incl. Tax:</Label>
                                    <span className="">{formatToIndianRupee(Math.floor(getTotal?.totalAmt || 0))}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Amt Paid Till Now:</Label>
                                    <span className="">{amountPaid ? formatToIndianRupee(amountPaid) : "--"}</span>
                                </div>

                                <div className="flex flex-col gap-4 pt-4">
                                                            <div className="flex gap-4 w-full">
                                                                <Label className="w-[40%]">Amount<sup className=" text-sm text-red-600">*</sup></Label>
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
                                                                <Label className="w-[40%]">TDS Amount</Label>
                                                                <div className="w-full">
                                                                <Input
                                                                    type="number"
                                                                    placeholder="Enter TDS Amount"
                                                                    value={newPayment.tds}
                                                                    onChange={(e) => {
                                                                        const tdsValue = e.target.value;
                                                                        setNewPayment({ ...newPayment, tds: tdsValue })
                                                                    }}
                                                                />
                                                                {parseFloat(newPayment?.tds) > 0 && <span className="text-xs">Amount Paid : {formatToIndianRupee((parseFloat(newPayment?.amount) || 0) - parseFloat(newPayment?.tds))}</span>}
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
                                            disabled={!newPayment.amount || !newPayment.utr || !newPayment.payment_date || warning}
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
                  {(poPayments || [])?.length > 0 ? (
                    poPayments?.map((payment) => {
                      return (
                        <TableRow key={payment?.name}>
                          <TableCell>
                            {formatToIndianRupee(payment?.amount)}
                          </TableCell>
                            {(payment?.utr && payment?.payment_attachment) ? (
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
                                {payment?.utr || "--"}
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
                  {!PO?.project_gst && (
                    <TriangleAlert className="text-primary max-sm:w-4 max-sm:h-4" />
                  )}
                </div>
                {!summaryPage &&
                  !accountsPage &&
                  !estimatesViewing &&
                  PO?.status === "PO Approved" && (
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
                                      defaultValue={PO?.project_gst}
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
                                    {selectedGST?.gst && !PO?.project_gst && (
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
        PO?.merged === "true" ? (
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
          {
            !summaryPage &&
              !accountsPage &&
              !estimatesViewing &&
              ["PO Approved"].includes(PO?.status) &&
              PO?.merged !== "true" && 
              !((poPayments || [])?.length > 0) && (
                <Button
                  onClick={toggleAmendPOSheet}
                  variant={"outline"}
                  className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
                >
                  <PencilRuler className="w-4 h-4" />
                  Amend PO
                </Button>
              )
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
                              <MakesSelection
                                selectedMake={selectedMake}
                                setSelectedMake={setSelectedMake}
                                editMakeOptions={editMakeOptions}
                                toggleAddNewMake={toggleAddNewMake}
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
              ["PO Approved"].includes(PO?.status) &&
              !((poPayments || []).length > 0) &&
              PO?.merged !== "true" && (
                <Button
                  onClick={toggleCancelPODialog}
                  variant={"outline"}
                  className="border-primary text-primary flex items-center gap-1 max-sm:px-3 max-sm:py-2 max-sm:h-8"
                >
                  <X className="w-4 h-4" />
                  Cancel PO
                </Button>
              )
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

      {/* PO Pdf  */}
        
        <POPdf poPdfSheet={poPdfSheet} togglePoPdfSheet={togglePoPdfSheet} po={PO} orderData={orderData} loadingCharges={loadingCharges} freightCharges={freightCharges} notes={notes} includeComments={includeComments} getTotal={getTotal} advance={advance} materialReadiness={materialReadiness} afterDelivery={afterDelivery} xDaysAfterDelivery={xDaysAfterDelivery} xDays={xDays} />
      
    </div>
  );
};

interface Make {
  label : string
  value : string
}

interface MakesSelectionProps {
  selectedMake: Make | null;
  setSelectedMake: React.Dispatch<React.SetStateAction<Make | null>>;
  editMakeOptions: Make[];
  toggleAddNewMake: () => void;
}

const MakesSelection = ({
  selectedMake,
  setSelectedMake,
  editMakeOptions,
  toggleAddNewMake,
} : MakesSelectionProps) => {
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

interface AddNewMakesProps {
  orderData : PurchaseOrderItem[];
  setOrderData : React.Dispatch<React.SetStateAction<{ list : PurchaseOrderItem[]}>>; 
  editMakeOptions : Make[];
  toggleAddNewMake : () => void;
  amendEditItem: any;
  setEditMakeOptions : React.Dispatch<React.SetStateAction<Make[]>>;
}


const AddNewMakes = ({
  orderData,
  setOrderData,
  editMakeOptions,
  amendEditItem,
  toggleAddNewMake,
  setEditMakeOptions,
} : AddNewMakesProps) => {
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
