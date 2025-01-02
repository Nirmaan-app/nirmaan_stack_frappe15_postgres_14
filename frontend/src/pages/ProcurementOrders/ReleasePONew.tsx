import React, { useState } from 'react';
import { Button, Layout, Tree } from 'antd';
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom";
import { useReactToPrint } from 'react-to-print';
import redlogo from "@/assets/red-logo.png"
// import { Button } from "../ui/button";
import { AlertTriangle, ArrowLeft, ArrowLeftToLine, CheckCheck, Download, Eye, List, ListChecks, ListTodo, ListX, Mail, Merge, MessageCircleMore, MessageCircleWarning, NotebookPen, Pencil, Phone, Printer, Send, Split, Trash2, Truck, Undo, Undo2, X } from "lucide-react";
import Seal from "../../assets/NIRMAAN-SEAL.jpeg";
import { Controller, useForm } from "react-hook-form";
import { Input } from '@/components/ui/input';
import { Label } from "../../components/ui/label";
import TextArea from "antd/es/input/TextArea";
import { useToast } from "../../components/ui/use-toast";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/card";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../../components/ui/alert-dialog";
import { AlertDialogAction } from "@radix-ui/react-alert-dialog";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import formatToIndianRupee from '@/utils/FormatPrice';
import { useUserData } from '@/hooks/useUserData';
import { Badge } from '../../components/ui/badge';
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '../../components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Dialog, DialogTrigger, DialogTitle, DialogDescription, DialogContent, DialogHeader, DialogClose, DialogFooter } from '../../components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radiogroup';
import { Button as ShadButton } from "@/components/ui/button";
import { Separator } from '../../components/ui/separator';
import { ProcurementOrders as ProcurementOrdersType } from '@/types/NirmaanStack/ProcurementOrders';
import { TailSpin } from 'react-loader-spinner';
import logo from "@/assets/logo-svg.svg"
import { Switch } from '../../components/ui/switch';

const { Sider, Content } = Layout;

export const ReleasePONew = ({ not }) => {

  const [collapsed, setCollapsed] = useState(true);
  const [comment, setComment] = useState('')
  const [orderData, setOrderData] = useState(null);
  const [projectAddress, setProjectAddress] = useState()
  const [vendorAddress, setVendorAddress] = useState()
  const [mergeablePOs, setMergeablePOs] = useState([])
  const [mergedItems, setMergedItems] = useState([]);
  const [customAdvance, setCustomAdvance] = useState(false);
  const [quantity, setQuantity] = useState<number | null | string>(null)
  const [stack, setStack] = useState([]);
  const [includeComments, setIncludeComments] = useState(false)

  const [phoneNumber, setPhoneNumber] = useState("")
  const [email, setEmail] = useState("")
  const [emailSubject, setEmailSubject] = useState("")
  const [emailBody, setEmailBody] = useState("")
  const [phoneError, setPhoneError] = useState("")
  const [emailError, setEmailError] = useState("")
  const [sheetOpen, setSheetOpen] = useState(false)

  const [advance, setAdvance] = useState(0)
  const [materialReadiness, setMaterialReadiness] = useState(0)
  const [afterDelivery, setAfterDelivery] = useState(0)
  const [xDaysAfterDelivery, setXDaysAfterDelivery] = useState(0)

  const [loadingCharges, setLoadingCharges] = useState(0)
  const [freightCharges, setFreightCharges] = useState(0)
  const [notes, setNotes] = useState("")
  const [contactPerson, setContactPerson] = useState({
    name: "",
    number: ""
  })

  const [vendor, setVendor] = useState("")
  const [vendorGST, setVendorGST] = useState()

  const [clicked, setClicked] = useState(false)
  const [prevMergedPOs, setPrevMergedPos] = useState([])


  const { poId: id } = useParams<{ id: string }>()
  const orderId = id?.replaceAll("&=", "/")

  const navigate = useNavigate()

  const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList("Procurement Orders",
    {
      fields: ["*"],
      limit: 1000
    },
    "Procurement Orders"
  );

  const { data: usersList, isLoading: usersListLoading, error: usersListError } = useFrappeGetDocList("Nirmaan Users", {
    fields: ["name", "full_name"],
    limit: 1000
  })

  const { data: vendor_data, isLoading: vendor_loading, error: vendor_error } = useFrappeGetDoc("Vendors", vendor, vendor === "" ? null : undefined)

  const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
    {
      fields: ["*"],
      limit: 1000
    },
    "Address"
  );

  const { control, handleSubmit, reset } = useForm({
    defaultValues: {
      advance: 0,
      materialReadiness: 0,
      afterDelivery: 0,
      xDaysAfterDelivery: 0,
      loadingCharges: 0,
      freightCharges: 0,
      notes: ""
      // afterDelivery: 0  // Initial values need to be set based on your state or props
    }
  });

  useEffect(() => {
    if (procurement_order_list && orderId) {
      const curOrder = procurement_order_list.find(item => item.name === orderId);
      if (curOrder?.status === "PO Approved") {
        const mergeablePOs = procurement_order_list.filter((item) => (item.project === curOrder?.project && item.vendor === curOrder?.vendor && item.status === "PO Approved" && item.name !== orderId))
        setMergeablePOs(mergeablePOs)
        if (curOrder?.merged === "true") {
          const mergedPOs = procurement_order_list.filter((po) => po?.merged === orderId)
          setPrevMergedPos(mergedPOs)
        }
      }

      if (curOrder) {
        setOrderData(curOrder);
        const chargesArray = curOrder?.advance?.split(", ")
        reset({
          advance: parseInt(chargesArray[0] || 0),
          materialReadiness: parseInt(chargesArray[1] || 0),
          afterDelivery: parseInt(chargesArray[2] || 0),
          xDaysAfterDelivery: parseInt(chargesArray[3] || 0),
          loadingCharges: parseInt(curOrder.loading_charges || 0),
          freightCharges: parseInt(curOrder.freight_charges || 0),
          notes: curOrder.notes || ""
          // afterDelivery: calculateAfterDelivery(curOrder) // Assuming you have a function to calculate this
        });
        setAdvance(parseInt(chargesArray[0] || 0))
        setMaterialReadiness(parseInt(chargesArray[1] || 0))
        setAfterDelivery(parseInt(chargesArray[2] || 0))
        setXDaysAfterDelivery(parseInt(chargesArray[3] || 0))
        setLoadingCharges(parseInt(curOrder.loading_charges || 0))
        setFreightCharges(parseInt(curOrder.freight_charges || 0))
        setNotes(curOrder.notes || "")
      }
    }
  }, [procurement_order_list, orderId, reset]);

  useEffect(() => {
    if (orderData?.project_address) {
      const doc = address_list?.find(item => item.name == orderData?.project_address);
      const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
      setProjectAddress(address)
      const doc2 = address_list?.find(item => item.name == orderData?.vendor_address);
      const address2 = `${doc2?.address_line1}, ${doc2?.address_line2}, ${doc2?.city}, ${doc2?.state}-${doc2?.pincode}`
      setVendorAddress(address2)
      setPhoneNumber(doc2?.phone || "")
      setEmail(doc2?.email_id || "")
    }
    if (orderData?.vendor) {
      setVendor(orderData?.vendor)
    }
    if (vendor_data) {
      setVendorGST(vendor_data?.vendor_gst)
    }

  }, [orderData, address_list, vendor_data]);

  const handlePhoneChange = (e: any) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 10)
    setPhoneNumber(value)
    if (value.length === 10) {
      setPhoneError("")
    }
  }

  const handleEmailChange = (e: any) => {
    setEmail(e.target.value)
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value)) {
      setEmailError("")
    }
  }

  const handleMerge = (po: ProcurementOrdersType) => {
    const updatedOrderList = po.order_list.list.map((item) => ({
      ...item,
      po: po.name,
    }));

    if (orderData) {
      const updatedList = [...orderData.order_list.list, ...updatedOrderList];

      setOrderData((prev) => ({
        ...prev,
        order_list: { ...prev.order_list, list: updatedList },
      }));
      setMergedItems((prev) => [...prev, po.name]);
    }
  };

  const handleUnmerge = (po) => {
    if (orderData) {
      const updatedList = orderData.order_list.list.filter((item) => item.po !== po.name);

      setOrderData((prev) => ({
        ...prev,
        order_list: { ...prev.order_list, list: updatedList },
      }));

      // Remove the unmerged PO from the mergedItems array
      setMergedItems((prev) => prev.filter((mergedPo) => mergedPo !== po.name));
    }
  };

  // console.log("mergedPOs", mergedItems)
  const handleUnmergeAll = () => {
    if (mergedItems.length) {
      const updatedList = orderData.order_list.list.filter((item) => !mergedItems.includes(item.po));

      setOrderData((prev) => ({
        ...prev,
        order_list: { ...prev.order_list, list: updatedList },
      }));
      setMergedItems([])
    }
  }

  useEffect(() => {
    if (!sheetOpen) {
      handleUnmergeAll()
    }
  }, [sheetOpen])

  const componentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: `${orderData?.name}_${orderData?.vendor_name}`
  });

  const { updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()
  const { createDoc, loading: create_loading } = useFrappeCreateDoc()

  const { toast } = useToast()

  // console.log("values", control._formValues)

  const onSubmit = (data: any) => {
    const updateData = {
      advance: `${data.advance !== "" ? parseInt(data.advance) : 0}, ${data.materialReadiness !== "" ? parseInt(data.materialReadiness) : 0}, ${data.afterDelivery !== "" ? parseInt(data.afterDelivery) : 0}, ${data.xDaysAfterDelivery !== "" ? parseInt(data.xDaysAfterDelivery) : 0}`,
      loading_charges: data.loadingCharges !== "" ? parseInt(data.loadingCharges) : 0,
      freight_charges: data.freightCharges !== "" ? parseInt(data.freightCharges) : 0,
      notes: data.notes || ""
    };

    updateDoc('Procurement Orders', orderData?.name, updateData)
      .then((doc) => {
        mutate()
        console.log("orderData?.name", orderData?.name)
        toast({
          title: "Success!",
          description: `${doc.name} updated successfully!`,
          variant: "success"
        })
        setCollapsed(true)
      }).catch(() => {
        console.log("update_submit_error", update_submit_error)
        toast({
          title: "Failed!",
          description: `Failed to update ${orderData?.name}`,
          variant: "destructive"
        })
      })
  };

  const getTotal = () => {
    let total: number = 0;
    let totalGst = 0;
    orderData?.order_list?.list?.map((item) => {
      const price = item.quote;
      const gst = (price) * (item.quantity) * (item.tax / 100)

      totalGst += gst
      total += (price ? parseFloat(price) : 0) * (item.quantity ? parseFloat(item.quantity) : 1);
    })

    total += loadingCharges + freightCharges
    totalGst += ((loadingCharges) * 0.18) + ((freightCharges) * 0.18)

    return { total, totalGst: totalGst, totalAmt: total + totalGst };
  }

  const userData = useUserData()

  const handleCancelPo = async () => {

    setClicked(true)

    const categories = []

    const itemList = []

    orderData?.order_list?.list.map((item) => {
      if (categories?.every((i) => i?.name !== item.category)) {
        categories.push({ name: item.category })
      }
      itemList.push({ ...item, status: "Pending" })
    })
    try {
      await updateDoc("Procurement Orders", orderId, {
        status: "Cancelled"
      })

      const newSentBack = await createDoc("Sent Back Category", {
        type: "Cancelled",
        procurement_request: orderData?.procurement_request,
        project: orderData?.project,
        category_list: { list: categories },
        item_list: { list: itemList },
      })
      if (comment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Sent Back Category",
          reference_name: newSentBack.name,
          comment_by: userData?.user_id,
          content: comment,
          subject: "creating sent-back(cancelled)"
        })
      }

      document.getElementById("CancelPOAlertCancel")?.click()

      toast({
        title: "Success!",
        description: `Cancelled Po & New Sent Back: ${newSentBack.name} created successfully!`,
        variant: "success"
      })
      navigate(-1)
    } catch (error) {
      console.log("Error while cancelling po", error)
      toast({
        title: "Failed!",
        description: `PO: ${orderId} Cancellation Failed!`,
        variant: "destructive"
      })
    } finally {
      setClicked(false)
    }
  }

  const handleAmendPo = async () => {
    setClicked(true)
    try {
      await updateDoc("Procurement Orders", orderId, {
        status: "PO Amendment",
        order_list: orderData.order_list
      })
      if (comment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Procurement Orders",
          reference_name: orderId,
          comment_by: userData?.user_id,
          content: comment,
          subject: "updating po(amendment)"
        })
      }

      document.getElementById("AmendPOAlertCancel")?.click()
      toast({
        title: "Success!",
        description: `${orderId} amended and sent to Project Lead!`,
        variant: "success"
      })
      navigate(-1)
    } catch (error) {
      console.log("Error while cancelling po", error)
      toast({
        title: "Failed!",
        description: `${orderId} Amendment Failed!`,
        variant: "destructive"
      })
    } finally {
      setClicked(false)
    }
  }

  const handleDispatchPO = async () => {
    setClicked(true)
    try {
      if (contactPerson.name !== "" || contactPerson.number !== "") {
        await updateDoc("Procurement Orders", orderId, {
          status: "Dispatched",
          delivery_contact: `${contactPerson.name}:${contactPerson.number}`
        })
      } else {
        await updateDoc("Procurement Orders", orderId, {
          status: "Dispatched",
        })
      }

      document.getElementById("SendPODialogClose")?.click()
      await mutate()

      navigate(-1)

      // document.getElementById("MarkDispatchedAlertClose")?.click()

      toast({
        title: "Success!",
        description: `PO: ${orderId} status updated to 'Dispatched' successfully!`,
        variant: "success"
      })
    } catch (error) {
      console.log("error while updating the status of the PO to dispatch", error)
      toast({
        title: "Failed!",
        description: `PO: ${orderId} Updation Failed!`,
        variant: "destructive"
      })
    } finally {
      setClicked(false)
    }
  }

  const { deleteDoc } = useFrappeDeleteDoc()

  // console.log("mergedItems", mergedItems)
  // console.log("po merged ", orderData)

  // console.log("order_data", orderData?.order_list?.list)

  const handleMergePOs = async () => {
    setClicked(true)
    const updatedOrderList = orderData.order_list.list.map(item => {
      if (!item?.po) {
        return { ...item, po: orderData?.name };
      }
      return item;
    });
    try {
      const newDoc = await createDoc("Procurement Orders", {
        procurement_request: orderData?.procurement_request,
        project: orderData?.project,
        project_name: orderData?.project_name,
        project_address: orderData?.project_address,
        vendor: orderData?.vendor,
        vendor_name: orderData?.vendor_name,
        vendor_address: orderData?.vendor_address,
        vendor_gst: orderData?.vendor_gst,
        order_list: { list: updatedOrderList },
        merged: "true"
      })

      mergedItems.map(async (po) => {
        try {
          await updateDoc("Procurement Orders", po, {
            status: "Merged",
            merged: newDoc?.name
          });
          // return { po, success: true };
        } catch (error) {
          console.error(`Error while merging PO(s)`, error);
          // return { po, success: false }; // Deletion failed
        }
      })

      await updateDoc("Procurement Orders", orderData?.name, {
        status: "Merged",
        merged: newDoc?.name
      })

      toast({
        title: "Success!",
        description: `Successfully merged PO(s)`,
        variant: "success",
      });

      setMergeablePOs([])

      document.getElementById("MergePOsAlertCancel")?.click()

      navigate(-1)

    } catch (error) {
      console.log("error while creating the master po", error)
    } finally {
      setClicked(false)
    }
    // const deletionResults = await Promise.all(
    //     mergedItems.map(async (po) => {
    //         try {
    //             await updateDoc("Procurement Orders", po, {status : "Merged"});
    //             return { po, success: true }; // Deletion successful
    //         } catch (error) {
    //             console.error(`Error while merging PO(s)`, error);
    //             return { po, success: false }; // Deletion failed
    //         }
    //     })
    // );

    // Filter out unsuccessful POs
    // const unsuccessfulPOs = deletionResults.filter(result => !result.success).map(result => result.po);

    // console.log("unsuccess", unsuccessfulPOs)
    // Update order_list based on successful deletions
    // const updatedOrderList = orderData.order_list.list.filter(item =>
    //     !unsuccessfulPOs.includes(item.po)
    // );

    // console.log("updatedOrderList", updatedOrderList)

    // Proceed to update the current PO
    // try {
    //     await updateDoc("Procurement Orders", orderId, {
    //         order_list: { list: updatedOrderList },
    //         status: "Merged"
    //     });

    //     toast({
    //         title: "Success!",
    //         description: `Successfully merged PO(s)`,
    //         variant: "success",
    //     });
    //     setMergeablePOs([])
    //     await mutate();
    //     document.getElementById("MergePOsAlertCancel")?.click()
    // } catch (error) {
    //     console.log("Error while updating the PO's order list", error);
    //     toast({
    //         title: "Failed!",
    //         description: `Unable to Merge PO(s)`,
    //         variant: "destructive",
    //     });
    // } finally {
    //     setClicked(false)
    // }
  };

  const handleUnmergePOs = async () => {
    setClicked(true)
    try {
      prevMergedPOs.map(async (po) => {
        try {
          await updateDoc("Procurement Orders", po?.name, {
            status: "PO Approved",
            merged: null
          });
          // return { po, success: true };
        } catch (error) {
          console.error(`Error while unmerging PO(s)`, error);
          // return { po, success: false }; // Deletion failed
        }
      })

      await deleteDoc("Procurement Orders", orderData?.name)

      toast({
        title: "Success!",
        description: `Successfully unmerged PO(s)`,
        variant: "success",
      });

      navigate(-1)

    } catch (error) {
      console.log("error while unmerging po's", error)
    } finally {
      setClicked(false)
    }
  }

  // const handleSendPO = async () => {
  //     setClicked(true)
  //     try {
  //         await updateDoc("Procurement Orders", orderId, {
  //             status: "PO Sent"
  //         })
  //         await mutate()
  //         toast({
  //             title: "Success!",
  //             description: `PO: ${orderId} status updated to 'PO Sent' successfully!`,
  //             variant: "success"
  //         })
  //         document.getElementById("SendPODialogClose")?.click()
  //         navigate(-1)
  //     } catch (error) {
  //         console.log("error while updating the status of the PO to PO Sent", error)
  //         toast({
  //             title: "Failed!",
  //             description: `PO: ${orderId} Updation Failed!`,
  //             variant: "destructive"
  //         })
  //     }
  //     finally {
  //         setClicked(false)
  //     }
  // }

  const handleSave = (itemName: string, newQuantity: string) => {
    let curRequest = orderData.order_list.list;

    // Find the current item and store its previous quantity in the stack
    const previousItem = curRequest.find(curValue => curValue.item === itemName);

    setStack(prevStack => [
      ...prevStack,
      {
        operation: 'quantity_change',
        item: previousItem.item,
        previousQuantity: previousItem.quantity
      }
    ]);

    curRequest = curRequest.map((curValue) => {
      if (curValue.item === itemName) {
        return { ...curValue, quantity: parseInt(newQuantity) };
      }
      return curValue;
    });
    setOrderData((prevState) => ({
      ...prevState,
      order_list: {
        list: curRequest,
      },
    }));
    setQuantity('')
  };
  const handleDelete = (item: string) => {
    let curRequest = orderData.order_list.list;
    let itemToPush = curRequest.find(curValue => curValue.item === item);

    // Push the delete operation into the stack
    setStack(prevStack => [
      ...prevStack,
      {
        operation: 'delete',
        item: itemToPush
      }
    ]);
    curRequest = curRequest.filter(curValue => curValue.item !== item);
    setOrderData(prevState => ({
      ...prevState,
      order_list: {
        list: curRequest
      }
    }));
    // setComments(prev => {
    //     delete prev[item]
    //     return prev
    // })
    setQuantity('')
    // setCurItem('')
  }

  const UndoDeleteOperation = () => {
    if (stack.length === 0) return; // No operation to undo

    let curRequest = orderData.order_list.list;
    const lastOperation = stack.pop();

    if (lastOperation.operation === 'delete') {
      // Restore the deleted item
      curRequest.push(lastOperation.item);
    } else if (lastOperation.operation === 'quantity_change') {
      // Restore the previous quantity of the item
      curRequest = curRequest.map(curValue => {
        if (curValue.item === lastOperation.item) {
          return { ...curValue, quantity: lastOperation.previousQuantity };
        }
        return curValue;
      });
    }

    // Update the order data with the restored item or quantity
    setOrderData(prevState => ({
      ...prevState,
      order_list: {
        list: curRequest
      }
    }));

    // Update the stack after popping the last operation
    setStack([...stack]);
  };

  const handleSheetChange = () => {
    setSheetOpen((prev) => !prev)
  }

  const getUserName = (id) => {
    if (usersList) {
      return usersList.find((user) => user?.name === id)?.full_name
    }
  }

  const treeData = [
    {
      title: orderData?.name,
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

  const checkPrintDisabled = (advance > 100 || advance < 0 || materialReadiness > 100 || materialReadiness < 0 || afterDelivery > 100 || afterDelivery < 0 || xDaysAfterDelivery > 100 || xDaysAfterDelivery < 0 || ![100, 0].includes((advance + materialReadiness + afterDelivery + xDaysAfterDelivery)))

  // console.log("advance", control.)
  // console.log("values", contactPerson)

  // console.log("orderData", orderData?.order_list?.list)
  // console.log("mergedItems", mergedItems)
  // console.log(orderData?.order_list.list.some((item) => 'po' in item))
  if (procurement_order_list_loading || address_list_loading || usersListLoading || vendor_loading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>
  if (procurement_order_list_error || address_list_error || vendor_error) return <h1>Error</h1>
  if (!not && !["PO Approved", "Merged"].includes(orderData?.status)) return (
    <div className="flex items-center justify-center h-screen">
      <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
        <h2 className="text-2xl font-semibold text-gray-800">
          Heads Up!
        </h2>
        <p className="text-gray-600 text-lg">
          Hey there, the Purchase Order:{" "}
          <span className="font-medium text-gray-900">{orderData?.name}</span>{" "}
          is no longer available in{" "}
          <span className="italic">PO Approved</span> state. The current state is{" "}
          <span className="font-semibold text-blue-600">
            {orderData?.status}
          </span>{" "}
          And the last modification was done by <span className="font-medium text-gray-900">
            {orderData?.modified_by === "Administrator" ? orderData?.modified_by : getUserName(orderData?.modified_by)}
          </span>
          !
        </p>
        <button
          className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
          onClick={() => navigate("/approved-po")}
        >
          Go Back
        </button>
      </div>
    </div>
  );

  return (
    <div className='flex-1 space-y-4'>
      <div className="flex items-center gap-1 ml-8">
        {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
        <div className="font-semibold text-xl md:text-2xl text-pageheader">PO PDF</div>
      </div>
      <Layout>
        <Sider theme='light' collapsedWidth={0} width={500} trigger={null} collapsible collapsed={collapsed}>
          <div className="py-2 px-4">
            <h3 className="text-black font-semibold pb-2">Include Comments</h3>
            <Switch id="hello" value={includeComments} onCheckedChange={(e) => setIncludeComments(e)} />
            <Separator className='my-2' />
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="px-4 pb-4">
            <div className="flex-col">
              <h3 className="font-semibold text-lg mt-4">Additional Charges</h3>
              <div className="flex-1 mt-2">
                <Label>Loading Charges</Label>
                <Controller
                  control={control}
                  name="loadingCharges"
                  render={({ field }) => (
                    <Input {...field} className="w-full" onChange={(e) => {
                      const value = e.target.value
                      field.onChange(e);
                      setLoadingCharges(value !== "" ? parseInt(value) : 0);
                    }} />
                  )}
                />
              </div>
              <div className="flex-1 mt-2 border-b border-gray-400 pb-4">
                <Label>Freight Charges</Label>
                <Controller
                  control={control}
                  name="freightCharges"
                  render={({ field }) => (
                    <Input {...field} className="w-full" onChange={(e) => {
                      const value = e.target.value
                      field.onChange(e);
                      setFreightCharges(value !== "" ? parseInt(value) : 0);
                    }} />
                  )}
                />
              </div>
              <h3 className="font-semibold text-lg mt-4">Terms and Other Description</h3>
              <div className="flex-1 py-2">
                <Label>Payments (in %)</Label>
                {/* <Controller
                                    control={control}
                                    name="advance"
                                    render={({ field }) => (
                                        <>
                                            <RadioGroup
                                                onValueChange={(value) => {
                                                    field.onChange(value === "Other" ? "" : value); // Reset value if 'Other'
                                                    setAdvance(value !== "Other" ? parseInt(value) : 0);
                                                    setCustomAdvance(value === "Other");
                                                }}
                                                className="flex flex-col space-y-2 mt-2"
                                            >
                                                <div className="flex gap-4 items-center">
                                                    <RadioGroupItem value="25" id="advance-25" />
                                                    <Label htmlFor="advance-25" className="font-medium text-gray-700">25%</Label>

                                                    <RadioGroupItem value="50" id="advance-50" />
                                                    <Label htmlFor="advance-50" className="font-medium text-gray-700">50%</Label>

                                                    <RadioGroupItem value="75" id="advance-75" />
                                                    <Label htmlFor="advance-75" className="font-medium text-gray-700">75%</Label>

                                                    <RadioGroupItem value="100" id="advance-100" />
                                                    <Label htmlFor="advance-100" className="font-medium text-gray-700">100%</Label>

                                                    <RadioGroupItem value="Other" id="advance-other" />
                                                    <Label htmlFor="advance-other" className="font-medium text-gray-700">Other</Label>
                                                </div>

                                                {customAdvance && (
                                                    <div className="mt-4">
                                                        <Label htmlFor="custom-advance">Enter Custom Advance %</Label>
                                                        <Input
                                                            id="custom-advance"
                                                            type="number"
                                                            min="0"
                                                            max="100"
                                                            placeholder="Enter percentage"
                                                            className="mt-2 border border-gray-300 rounded-lg p-2"
                                                            value={field.value}
                                                            onChange={(e) => {
                                                                const value = e.target.value
                                                                field.onChange(value)
                                                                setAdvance(value !== "" ? parseInt(value) : 0);
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </RadioGroup>
                                        </>
                                    )}
                                /> */}

                <div className='flex gap-8 py-4 ml-2'>
                  <div className='flex flex-col gap-8'>
                    <p>1. Advance:</p>
                    <p>2. Material Readiness:</p>
                    <p>3. After Delivery:</p>
                    <p>4. After 30 days of delivery:</p>
                  </div>
                  <div className='flex flex-col gap-4'>
                    <Controller
                      control={control}
                      name="advance"
                      render={({ field }) => (
                        <Input {...field} className="w-full" onChange={(e) => {
                          const value = e.target.value
                          field.onChange(e);
                          setAdvance(value !== "" ? parseInt(value) : 0);
                        }} />
                      )}
                    />
                    <Controller
                      control={control}
                      name="materialReadiness"
                      render={({ field }) => (
                        <Input {...field} className="w-full" onChange={(e) => {
                          const value = e.target.value
                          field.onChange(e);
                          setMaterialReadiness(value !== "" ? parseInt(value) : 0);
                        }} />
                      )}
                    />
                    <Controller
                      control={control}
                      name="afterDelivery"
                      render={({ field }) => (
                        <Input {...field} className="w-full" onChange={(e) => {
                          const value = e.target.value
                          field.onChange(e);
                          setAfterDelivery(value !== "" ? parseInt(value) : 0);
                        }} />
                      )}
                    />
                    <Controller
                      control={control}
                      name="xDaysAfterDelivery"
                      render={({ field }) => (
                        <Input {...field} className="w-full" onChange={(e) => {
                          const value = e.target.value
                          field.onChange(e);
                          setXDaysAfterDelivery(value !== "" ? parseInt(value) : 0);
                        }} />
                      )}
                    />
                  </div>
                  {/* <div className='ml-4 flex justify-between items-center'>
                                            <p>Advance:</p>
                                            <Input  />
                                    </div>
                                    <div className='ml-4 flex justify-between items-center'>
                                            <p>Material Readiness:</p>
                                            <Input  />
                                    </div>
                                    <div className='ml-4 flex justify-between items-center'>
                                            <p>After Delivery:</p>
                                            <Input  />
                                    </div>
                                    <div className='ml-4 flex justify-between items-center'>
                                            <p>X days after delivery:</p>
                                            <Input  />
                                    </div> */}
                </div>
                <p className='ml-2'><Badge variant={"gray"}>Total agregated percentages: </Badge> {advance + materialReadiness + afterDelivery + xDaysAfterDelivery} %</p>
                <p className='ml-2 my-2'><Badge variant={"red"}>Note:</Badge> <strong>Total agregated percentage must sum up to 100% in order to enable save button!</strong> </p>
              </div>
              <div className="flex-1 mt-2">
                <Label>Add Notes</Label>
                <Controller
                  control={control}
                  name="notes"
                  render={({ field }) => (
                    <TextArea {...field} onChange={(e) => {
                      const value = e.target.value;
                      field.onChange(value);
                      setNotes(value);
                    }} className="w-full" />
                  )}
                />
              </div>
              <div className="mt-2 flex items-center justify-center">
                <ShadButton type='submit' className='flex items-center gap-1' disabled={checkPrintDisabled} >
                  <ListChecks className="h-4 w-4" />
                  {update_loading ? "Saving..." : "Save"}
                </ShadButton>
              </div>
            </div>
          </form>
        </Sider>
        <Layout className='bg-white'>
          <div className="flex">
            <Button
              type="text"
              icon={collapsed ? <NotebookPen className='hover:text-primary/40' /> : <ArrowLeftToLine className='hover:text-primary/40' />}
              onClick={() => setCollapsed(!collapsed)}
              style={{
                fontSize: '16px',
                width: 64,
                height: 64,
                backgroundColor: "white"
              }}
            />
            <Content
              className={`${collapsed ? "md:mx-10 lg:mx-32" : ""} my-4 mx-2 flex flex-col gap-4 relative`}
            >
              <div className='absolute right-0 -top-14 flex items-center gap-4'>
                <Badge variant={orderData?.status === "PO Approved" ? "default" : orderData?.status === "PO Sent" ? "yellow" : orderData?.status === "Dispatched" ? "orange" : "green"}>{orderData?.status === "Partially Delivered" ? "Delivered" : orderData?.status}</Badge>
                {!["PO Sent", "PO Approved"].includes(orderData?.status) && (
                  checkPrintDisabled === true ? (
                    <Dialog>
                      <DialogTrigger>
                        <ShadButton className='flex items-center gap-1'>
                          <Printer className='h-4 w-4' />
                          Print
                        </ShadButton>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>
                            Important!
                          </DialogTitle>
                          <DialogDescription>
                            You are seeing this because of some validation checks from the payment terms inputs are not fulfilled,
                            please go the editing section and do the needful to proceed with printing!
                          </DialogDescription>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  ) : (
                    <ShadButton className='flex items-center gap-1' onClick={() => {
                      onSubmit(control._formValues)
                      handlePrint()
                    }}>
                      <Printer className='h-4 w-4' />
                      Print
                    </ShadButton>
                  )
                )}
              </div>

              {(orderData?.status === "PO Approved" && orderData?.merged !== "true" && mergeablePOs.length !== 0) && (
                <>
                  <Alert variant="warning" className="">
                    <AlertTitle className="text-sm flex items-center gap-2"><MessageCircleWarning className="h-4 w-4" />Heads Up</AlertTitle>
                    <AlertDescription className="text-xs flex justify-between items-center">
                      PO Merging Feature is available for this PO.
                      <Sheet open={sheetOpen} onOpenChange={handleSheetChange}>
                        <SheetTrigger>
                          <Button className='flex items-center gap-1' color="primary">
                            <Merge className="w-4 h-4" />
                            Merge PO(s)</Button>
                        </SheetTrigger>
                        <SheetContent className='overflow-auto'>
                          <div className="p-6">
                            <h2 className="text-2xl font-bold mb-4">Merge Purchase Orders</h2>

                            <Card className='mb-4'>
                              <CardHeader className="flex flex-row justify-between items-center">
                                <div className="flex flex-col">
                                  <span className="text-sm text-gray-500">Project:</span>
                                  <p className="text-base font-medium tracking-tight text-black">{orderData?.project_name}</p>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm text-gray-500">Vendor:</span>
                                  <p className="text-base font-medium tracking-tight text-black">{orderData?.vendor_name}</p>
                                </div>
                              </CardHeader>
                            </Card>

                            {mergeablePOs.length > 0 ? (
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-red-100">
                                    <TableHead className="w-[15%]">ID(PO/Project)</TableHead>
                                    {/* <TableHead>Project</TableHead> */}
                                    {/* <TableHead>Vendor</TableHead> */}
                                    {/* <TableHead>Status</TableHead> */}
                                    <TableHead>Items Count</TableHead>
                                    <TableHead>Items List</TableHead>
                                    <TableHead>Action</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  <TableRow key={orderData.name}>
                                    <TableCell>{orderData.name.slice(3, 12)}</TableCell>
                                    {/* <TableCell>{po.project.split("-").slice(1).join("-")}</TableCell> */}
                                    {/* <TableCell>{orderData.project_name}</TableCell> */}
                                    {/* <TableCell>{orderData.vendor_name}</TableCell> */}
                                    {/* <TableCell>{po.status}</TableCell> */}
                                    <TableCell>{orderData.order_list.list.filter((i) => !i?.po)?.length}</TableCell>
                                    <TableCell>
                                      <ul className='list-disc'>
                                        {orderData?.order_list?.list?.filter((i) => !i?.po)?.map((j) => (
                                          <li>{j?.item} <span>(Qty-{j?.quantity})</span></li>
                                        ))}
                                      </ul>
                                    </TableCell>
                                    <TableCell><Button
                                      className='flex items-center gap-1'
                                      danger
                                      disabled
                                    >
                                      <Split className='w-4 h-4' />
                                      Split
                                    </Button>
                                    </TableCell>
                                  </TableRow>
                                  {mergeablePOs.map((po) => {
                                    // Helper function to check if merge should be disabled
                                    const isMergeDisabled = po.order_list.list.some((poItem) => {
                                      // Check if any item in orderData has the same name but different rate
                                      return orderData?.order_list.list.some(
                                        (currentItem) => currentItem.name === poItem.name && currentItem.quote !== poItem.quote
                                      );
                                    });

                                    return (
                                      <TableRow key={po.name}>
                                        <TableCell>{po.name.slice(3, 12)}</TableCell>
                                        {/* <TableCell>{po.project.split("-").slice(1).join("-")}</TableCell> */}
                                        {/* <TableCell>{po.project_name}</TableCell> */}
                                        {/* <TableCell>{po.vendor_name}</TableCell> */}
                                        {/* <TableCell>{po.status}</TableCell> */}
                                        <TableCell>{po.order_list.list.length}</TableCell>
                                        <TableCell>
                                          <ul className='list-disc'>
                                            {po?.order_list?.list?.map((i) => (
                                              <li>{i?.item} <span>(Qty-{i?.quantity})</span></li>
                                            ))}
                                          </ul>
                                        </TableCell>
                                        <TableCell>
                                          {!mergedItems.includes(po.name) ? (
                                            isMergeDisabled ? (
                                              <HoverCard>
                                                <HoverCardTrigger>
                                                  <Button
                                                    className='flex items-center gap-1'
                                                    type="primary"
                                                    disabled={isMergeDisabled}
                                                    onClick={() => handleMerge(po)}
                                                  >
                                                    <Merge className="w-4 h-4" />
                                                    Merge
                                                  </Button>
                                                </HoverCardTrigger>
                                                <HoverCardContent className='w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg mr-28'>
                                                  Unable to Merge this PO as it has some <span className='text-primary'>overlapping item(s) with different quotes</span>
                                                </HoverCardContent>
                                              </HoverCard>
                                            ) : (
                                              <Button
                                                className='flex items-center gap-1'
                                                type="primary"
                                                onClick={() => handleMerge(po)}
                                              >
                                                <Merge className="w-4 h-4" />
                                                Merge
                                              </Button>
                                            )
                                          ) : (
                                            <Button
                                              className='flex items-center gap-1'
                                              danger
                                              onClick={() => handleUnmerge(po)}
                                            >
                                              <Split className='w-4 h-4' />
                                              Split
                                            </Button>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    )
                                  })}
                                </TableBody>
                              </Table>
                            ) : (
                              <p>No mergeable POs available.</p>
                            )}

                            {/* Summary Section */}
                            {/* <div className="mt-6 p-4 border rounded-lg">
                          <h3 className="text-xl font-semibold mb-2">Merged PO Details</h3>
                          <p>Total PO's Merged: {mergedItems.length}</p>
                        </div> */}

                            {/* Button Section */}
                            <div className="flex justify-end space-x-4 mt-6">
                              <Button className='flex items-center gap-1' onClick={handlePrint}>
                                <Eye className='w-4 h-4' />
                                Preview
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger disabled={!mergedItems.length}>
                                  <ShadButton
                                    className='flex items-center gap-1'
                                    disabled={!mergedItems.length}
                                  >
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                  </ShadButton>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Are you sure!
                                    </AlertDialogTitle>
                                  </AlertDialogHeader>
                                  <AlertDialogDescription>
                                    Below are the subsequent actions executed on clicking the Confirm button:
                                    <ul className='list-disc ml-6 italic'>
                                      <li>Merged PO(s) including the current PO will be marked as <span className='text-primary'>Merged</span>!</li>
                                      <li>A <span className='text-primary'>New PO</span> will be created to contain the merged PO(s) items</li>
                                    </ul>
                                    <p className='mt-2 font-semibold text-base'>Continue?</p>
                                  </AlertDialogDescription>
                                  {clicked ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                                    <AlertDialogDescription className='flex gap-2 items-center justify-center'>
                                      <AlertDialogCancel className="flex items-center gap-1" >
                                        <Undo2 className="h-4 w-4" />
                                        Cancel
                                      </AlertDialogCancel>
                                      <ShadButton onClick={handleMergePOs} className='flex gap-1 items-center' >
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm
                                      </ShadButton>
                                    </AlertDialogDescription>
                                  )}
                                  <AlertDialogCancel className='hidden' id='MergePOsAlertCancel'>
                                    Cancel
                                  </AlertDialogCancel>
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
              <div className={`w-full border rounded-lg h-screen overflow-y-scroll`}>
                <div ref={componentRef} className="w-full p-4">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-gray-200">
                      <thead className="border-b border-black">
                        <tr>
                          <th colSpan={8}>
                            <div className="flex justify-between border-gray-600 pb-1">
                              <div className="mt-2 flex justify-between">
                                <div>
                                  {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
                                  <img src={logo} alt="Nirmaan" width="180" height="52" />
                                  <div className="pt-2 text-lg text-gray-600 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                </div>
                              </div>
                              <div>
                                <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No.</div>
                                <div className="text-lg font-light italic text-black">{(orderData?.name)?.toUpperCase()}</div>
                              </div>
                            </div>

                            <div className=" border-b-2 border-gray-600 pb-1 mb-1">
                              <div className="flex justify-between">
                                <div className="text-xs text-gray-600 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                                <div className="text-xs text-gray-600 font-normal">GST: 29ABFCS9095N1Z9</div>
                              </div>
                            </div>

                            <div className="flex justify-between">
                              <div>
                                <div className="text-gray-600 text-sm pb-2 text-left">Vendor Address</div>
                                <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{orderData?.vendor_name}</div>
                                <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{vendorAddress}</div>
                                <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {vendorGST}</div>
                              </div>
                              <div>
                                <div>
                                  <h3 className="text-gray-600 text-sm pb-2 text-left">Delivery Location</h3>
                                  <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{projectAddress}</div>
                                </div>
                                <div className="pt-2">
                                  <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-600 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.creation?.split(" ")[0]}</i></div>
                                  <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-600 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.project_name}</i></div>
                                </div>
                              </div>
                            </div>
                          </th>
                        </tr>
                        <tr className="border-t border-black">
                          <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider">S. No.</th>
                          <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48">Items</th>
                          <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                          <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Qty</th>
                          <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                          <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>
                          <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
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
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(((item.quote) * (item.quantity)).toFixed(2))}</td>
                                                    </tr>)
                                                })} */}

                        {[...new Map(orderData?.order_list?.list.map(item =>
                          [item.item, {
                            ...item, quantity: orderData.order_list.list
                              .filter(({ item: itemName }) => itemName === item.item)
                              .reduce((total, curr) => total + curr.quantity, 0)
                          }]
                        )).values()].map((item, index) => {

                          const length = [...new Map(orderData?.order_list?.list.map(item =>
                            [item.item, {
                              ...item, quantity: orderData.order_list.list
                                .filter(({ item: itemName }) => itemName === item.item)
                                .reduce((total, curr) => total + curr.quantity, 0)
                            }]
                          )).values()].length
                          return (
                            <tr key={index} className={`${(!loadingCharges && !freightCharges && index === length - 1) && "border-b border-black"} page-break-inside-avoid ${index === 15 ? 'page-break-before' : ''}`}>
                              <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index + 1}.</td>
                              <td className="py-2 text-sm whitespace-nowrap text-wrap">{item.item}
                                {(item.comment && includeComments) &&
                                  <div className="flex gap-1 items-start block p-1">
                                    <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                                    <div className="text-xs text-gray-400">{item.comment}</div>
                                  </div>
                                }
                              </td>
                              <td className="px-4 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                              <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                              <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.quote)}</td>
                              <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                              <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(((item.quote) * (item.quantity)).toFixed(2))}</td>
                            </tr>
                          )
                        })}
                        {/* {[...Array(19)].map((_, index) => (
                                        orderData?.order_list?.list.map((item) => (
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
                        {loadingCharges ?
                          <tr className={`${!freightCharges && "border-b border-black"}`}>
                            <td className="py-2 text-sm whitespace-nowrap w-[7%]">-</td>
                            <td className=" py-2 text-sm whitespace-nowrap">LOADING CHARGES</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">NOS</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">1</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(loadingCharges)}</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(loadingCharges.toFixed(2))}</td>
                          </tr>
                          :
                          <></>
                        }
                        {freightCharges ?
                          <tr className={`border-b border-black`}>
                            <td className="py-2 text-sm whitespace-nowrap w-[7%]">-</td>
                            <td className=" py-2 text-sm whitespace-nowrap">FREIGHT CHARGES</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">NOS</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">1</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(freightCharges)}</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(freightCharges.toFixed(2))}</td>
                          </tr>
                          :
                          <></>
                        }
                        <tr className="">
                          <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                          <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">Sub-Total</td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{formatToIndianRupee(getTotal().total.toFixed(2))}</td>
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
                            <div className="ml-4">{formatToIndianRupee((getTotal().totalGst).toFixed(2))}</div>
                            <div className="ml-4">- {formatToIndianRupee(((getTotal().totalAmt).toFixed(2) - (Math.floor(getTotal().totalAmt)).toFixed(2)).toFixed(2))}</div>
                            <div className="ml-4">{formatToIndianRupee((Math.floor(getTotal().totalAmt)).toFixed(2))}</div>
                          </td>

                        </tr>
                        <tr className="end-of-page page-break-inside-avoid" >
                          <td colSpan={6}>
                            {notes !== "" && (
                              <>
                                <div className="text-gray-600 text-sm py-2">Note</div>
                                <div className="text-sm text-gray-900">{notes}</div>
                              </>
                            )}
                            {(advance || materialReadiness || afterDelivery || xDaysAfterDelivery) ? (
                              <>
                                <div className="text-gray-600 text-sm py-2">Payment Terms</div>
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
                                      return `${xDaysAfterDelivery}% after 30 days of delivering the material(s)`;
                                    }

                                    // If none of the variables is 100, render non-zero values
                                    const parts = [];
                                    if (advance > 0) {
                                      parts.push(`${advance}% advance`);
                                    }
                                    if (materialReadiness > 0) {
                                      parts.push(`${materialReadiness}% on material readiness`);
                                    }
                                    if (afterDelivery > 0) {
                                      parts.push(`${afterDelivery}% after delivery to the site`);
                                    }
                                    if (xDaysAfterDelivery > 0) {
                                      parts.push(`${xDaysAfterDelivery}% after 30 days of delivering the material(s)`);
                                    }

                                    // Join the parts with commas and return
                                    return parts.join(", ");
                                  })()}
                                </div>

                              </>
                            ) : ""}

                            <img src={Seal} className="w-24 h-24" />
                            <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'block', pageBreakBefore: 'always', }}></div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-gray-200">
                      <thead className="border-b border-black">
                        <tr>
                          <th colSpan={6}>
                            <div className="flex justify-between border-gray-600 pb-1">
                              <div className="mt-2 flex justify-between">
                                <div>
                                  {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
                                  <img src={logo} alt="Nirmaan" width="180" height="52" />
                                  <div className="pt-2 text-lg text-gray-600 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                </div>
                              </div>
                              <div>
                                <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No. :</div>
                                <div className="text-lg font-light italic text-black">{(orderData?.name)?.toUpperCase()}</div>
                              </div>
                            </div>

                            <div className=" border-b-2 border-gray-600 pb-1 mb-1">
                              <div className="flex justify-between">
                                <div className="text-xs text-gray-600 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                                <div className="text-xs text-gray-600 font-normal">GST: 29ABFCS9095N1Z9</div>
                              </div>
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <div className="max-w-4xl mx-auto p-6 text-gray-800">
                          <h1 className="text-xl font-bold mb-4">Terms and Conditions</h1>
                          <h2 className="text-lg font-semibold mt-6">1. Invoicing:</h2>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">All invoices shall be submitted in original and shall be tax invoices showing the breakup of tax structure/value payable at the prevailing rate and a clear description of goods.</li>
                            <li className="pl-2">All invoices submitted shall have Delivery Challan/E-waybill for supply items.</li>
                            <li className="pl-2">All Invoices shall have the tax registration numbers mentioned thereon. The invoices shall be raised in the name of “Stratos Infra Technologies Pvt Ltd, Bangalore”.</li>
                            <li className="pl-2">Payments shall be only entertained after receipt of the correct invoice.</li>
                            <li className="pl-2">In case of advance request, Advance payment shall be paid after the submission of an advance receipt (as suggested under GST law).</li>
                          </ol>

                          <h2 className="text-lg font-semibold mt-6">2. Payment:</h2>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">Payment shall be done through RTGS/NEFT.</li>
                            <li className="pl-2">A retention amount shall be deducted as per PO payment terms and:</li>
                            <ol className="list-decimal pl-6 space-y-1 text-sm">
                              <li className="pl-2">In case the vendor is not completing the task assigned by Nirmaan a suitable amount, as decided by Nirmaan, shall be deducted from the retention amount.</li>
                              <li className="pl-2">The adjusted amount shall be paid on completion of the defect liability period.</li>
                              <li className="pl-2">Vendors are expected to pay GST as per the prevailing rules. In case the vendor is not making GST payments to the tax authority, Nirmaan shall deduct the appropriated amount from the invoice payment of the vendor.</li>
                              <li className="pl-2">Nirmaan shall deduct the following amounts from the final bills:</li>
                              <ol className="list-decimal pl-6 space-y-1 text-sm">
                                <li className="pl-2">Amount pertaining to unfinished supply.</li>
                                <li className="pl-2">Amount pertaining to Liquidated damages and other fines, as mentioned in the documents.</li>
                                <li className="pl-2">Any agreed amount between the vendor and Nirmaan.</li>
                              </ol>
                            </ol>
                          </ol>

                          <h2 className="text-lg font-semibold mt-6">3. Technical Specifications of the Work:</h2>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">All goods delivered shall conform to the technical specifications mentioned in the vendor’s quote referred to in this PO or as detailed in Annexure 1 to this PO.</li>
                            <li className="pl-2">Supply of goods or services shall be strictly as per Annexure - 1 or the Vendor’s quote/PI in case of the absence of Annexure - I.</li>
                            <li className="pl-2">Any change in line items or quantities shall be duly approved by Nirmaan with rate approval prior to supply. Any goods supplied by the agency without obtaining due approvals shall be subject to the acceptance or rejection from Nirmaan.</li>
                            <li className="pl-2">Any damaged/faulty material supplied needs to be replaced with a new item free of cost, without extending the completion dates.</li>
                            <li className="pl-2">Material supplied in excess and not required by the project shall be taken back by the vendor at no cost to Nirmaan.</li>
                          </ol>
                          <br />
                          <br />
                          <br />
                          <br />
                          <br />

                          <h1 className="text-xl font-bold mb-4">General Terms & Conditions for Purchase Order</h1>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2"><div className="font-semibold">Liquidity Damages:</div> Liquidity damages shall be applied at 2.5% of the order value for every day of delay.</li>
                            <li className="pl-2"><div className="font-semibold">Termination/Cancellation:</div> If Nirmaan reasonably determines that it can no longer continue business with the vendor in accordance with applicable legal, regulatory, or professional obligations, Nirmaan shall have the right to terminate/cancel this PO immediately.</li>
                            <li className="pl-2"><div className="font-semibold">Other General Conditions:</div></li>
                            <ol className="list-decimal pl-6 space-y-1 text-sm">
                              <li className="pl-2">Insurance: All required insurance including, but not limited to, Contractors’ All Risk (CAR) Policy, FLEXA cover, and Workmen’s Compensation (WC) policy are in the vendor’s scope. Nirmaan in any case shall not be made liable for providing these insurance. All required insurances are required prior to the commencement of the work at the site.</li>
                              <li className="pl-2">Safety: The safety and security of all men deployed and materials placed by the Vendor or its agents for the project shall be at the risk and responsibility of the Vendor. Vendor shall ensure compliance with all safety norms at the site. Nirmaan shall have no obligation or responsibility on any safety, security & compensation related matters for the resources & material deployed by the Vendor or its agent.</li>
                              <li className="pl-2">Notice: Any notice or other communication required or authorized under this PO shall be in writing and given to the party for whom it is intended at the address given in this PO or such other address as shall have been notified to the other party for that purpose, through registered post, courier, facsimile or electronic mail.</li>
                              <li className="pl-2">Force Majeure: Neither party shall be liable for any delay or failure to perform if such delay or failure arises from an act of God or of the public enemy, an act of civil disobedience, epidemic, war, insurrection, labor action, or governmental action.</li>
                              <li className="pl-2">Name use: Vendor shall not use, or permit the use of, the name, trade name, service marks, trademarks, or logo of Nirmaan in any form of publicity, press release, advertisement, or otherwise without Nirmaan's prior written consent.</li>
                              <li className="pl-2">Arbitration: Any dispute arising out of or in connection with the order shall be settled by Arbitration in accordance with the Arbitration and Conciliation Act,1996 (As amended in 2015). The arbitration proceedings shall be conducted in English in Bangalore by the sole arbitrator appointed by the Purchaser.</li>
                              <li className="pl-2">The law governing: All disputes shall be governed as per the laws of India and subject to the exclusive jurisdiction of the court in Karnataka.</li>
                            </ol>
                          </ol>
                        </div>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {
                orderData?.status === "PO Approved" && (
                  <Card className="border-yellow-500 shadow-lg overflow-hidden">
                    <CardHeader className="bg-yellow-50">
                      <CardTitle className="text-2xl text-yellow-800">Send this PO to <span className='font-bold text-yellow-600'>{orderData?.vendor_name}</span></CardTitle>
                    </CardHeader>
                    <CardContent className='p-6'>
                      <div className="space-y-6">
                        <div className="bg-yellow-100 p-4 rounded-lg">
                          <h3 className="font-semibold text-yellow-800 mb-2 flex items-center">
                            <AlertTriangle className="w-5 h-5 mr-2" />
                            Important Notes
                          </h3>
                          <ul className="list-disc list-inside space-y-1 text-sm text-yellow-700">
                            <li>You can add <span className="font-bold">charges, notes & payment terms</span> above.</li>
                            <li>You can also <span className='font-bold'>merge POs</span> with same vendor and project. Look out for <span className="font-bold">Heads Up</span> box above.</li>
                            <li>You can download the prepared PO to notify vendor: <span className="font-medium">{orderData?.vendor_name}</span> through <span > Contact Options</span> section below</li>
                          </ul>
                        </div>
                        <Separator />
                        <div className="space-y-4">
                          <h3 className="font-semibold text-lg">Contact Options</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="phone" className="text-sm font-medium">Phone Number</Label>
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
                                      <ShadButton
                                        className="rounded-l-none bg-green-600 hover:bg-green-700"
                                        disabled={phoneNumber.length !== 10}
                                      >
                                        <Phone className="w-4 h-4 mr-2" />
                                        WhatsApp
                                      </ShadButton>
                                    </DialogTrigger>
                                    <DialogContent>
                                      <DialogHeader>
                                        <DialogTitle className='text-center'>Send PO via WhatsApp</DialogTitle>
                                        <DialogDescription className='text-center'>
                                          Download the PO and send it via WhatsApp to {phoneNumber}
                                        </DialogDescription>
                                      </DialogHeader>
                                      <div className="flex justify-center space-x-4">
                                        {
                                          checkPrintDisabled === true ? (
                                            <Dialog>
                                              <DialogTrigger>
                                                <ShadButton variant="outline">
                                                  <Download className="h-4 w-4 mr-2" />
                                                  Download PO
                                                </ShadButton>
                                              </DialogTrigger>
                                              <DialogContent>
                                                <DialogHeader>
                                                  <DialogTitle>
                                                    Important!
                                                  </DialogTitle>
                                                  <DialogDescription>
                                                    You are seeing this because of some validation checks from the payment terms inputs are not fulfilled,
                                                    please go the editing section and do the needful to proceed with printing!
                                                  </DialogDescription>
                                                </DialogHeader>
                                              </DialogContent>
                                            </Dialog>
                                          ) : (
                                            <ShadButton onClick={() => {
                                              onSubmit(control._formValues)
                                              handlePrint()
                                            }} variant="outline">
                                              <Download className="h-4 w-4 mr-2" />
                                              Download PO
                                            </ShadButton>
                                          )
                                        }
                                        <ShadButton onClick={() => window.open(`https://wa.me/${phoneNumber}`)} className="bg-green-600 hover:bg-green-700">
                                          <CheckCheck className="h-4 w-4 mr-2" />
                                          Open WhatsApp
                                        </ShadButton>
                                      </div>
                                    </DialogContent>
                                  </Dialog>

                                </div>
                                {phoneError && <p className="text-red-500 text-xs mt-1">{phoneError}</p>}
                              </div>
                            </div>
                            <div>
                              <Label htmlFor="email" className="text-sm font-medium">Email</Label>
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
                                      <ShadButton
                                        className="rounded-l-none bg-blue-600 hover:bg-blue-700"
                                        disabled={!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                                      >
                                        <Mail className="w-4 h-4 mr-2" />
                                        Email
                                      </ShadButton>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-3xl">
                                      <DialogHeader>
                                        <DialogTitle>Send PO via Email</DialogTitle>
                                        <DialogDescription>
                                          Customize your email and send the PO to {email}
                                        </DialogDescription>
                                      </DialogHeader>
                                      <div className="space-y-4">
                                        <div>
                                          <Label htmlFor="emailSubject">Subject</Label>
                                          <Input
                                            id="emailSubject"
                                            value={emailSubject}
                                            onChange={(e) => setEmailSubject(e.target.value)}
                                            placeholder="Enter email subject"
                                          />
                                        </div>
                                        <div>
                                          <Label htmlFor="emailBody">Body</Label>
                                          <TextArea
                                            id="emailBody"
                                            value={emailBody}
                                            onChange={(e) => setEmailBody(e.target.value)}
                                            placeholder="Enter email body"
                                            rows={5}
                                          />
                                        </div>
                                        <div className="bg-gray-100 p-4 rounded-md">
                                          <h4 className="font-medium mb-2">Email Preview</h4>
                                          <p><strong>To:</strong> {email}</p>
                                          <p><strong>Subject:</strong> {emailSubject}</p>
                                          <p><strong>Body:</strong> {emailBody}</p>
                                        </div>
                                      </div>
                                      <DialogFooter>
                                        {
                                          checkPrintDisabled === true ? (
                                            <Dialog>
                                              <DialogTrigger>
                                                <ShadButton variant="outline">
                                                  <Download className="h-4 w-4 mr-2" />
                                                  Download PO
                                                </ShadButton>
                                              </DialogTrigger>
                                              <DialogContent>
                                                <DialogHeader>
                                                  <DialogTitle>
                                                    Important!
                                                  </DialogTitle>
                                                  <DialogDescription>
                                                    You are seeing this because of some validation checks from the payment terms inputs are not fulfilled,
                                                    please go the editing section and do the needful to proceed with printing!
                                                  </DialogDescription>
                                                </DialogHeader>
                                              </DialogContent>
                                            </Dialog>
                                          ) : (
                                            <ShadButton onClick={() => {
                                              onSubmit(control._formValues)
                                              handlePrint()
                                            }} variant="outline">
                                              <Download className="h-4 w-4 mr-2" />
                                              Download PO
                                            </ShadButton>
                                          )
                                        }
                                        <ShadButton onClick={() => window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`)} className="bg-blue-600 hover:bg-blue-700">
                                          <CheckCheck className="h-4 w-4 mr-2" />
                                          Send Email
                                        </ShadButton>
                                      </DialogFooter>
                                    </DialogContent>
                                  </Dialog>

                                </div>
                                {emailError && <p className="text-red-500 text-xs mt-1">{emailError}</p>}
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>
                    </CardContent>
                    <CardFooter className="bg-gray-50 flex justify-between p-4">
                      <p className="text-sm text-gray-600 italic">Check all details before sending this PO.</p>
                      <div className="space-x-2">
                        {
                          checkPrintDisabled === true ? (
                            <Dialog>
                              <DialogTrigger>
                                <ShadButton variant="outline">
                                  <Printer className='h-4 w-4 mr-2' />
                                  Print
                                </ShadButton>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>
                                    Important!
                                  </DialogTitle>
                                  <DialogDescription>
                                    You are seeing this because of some validation checks from the payment terms inputs are not fulfilled,
                                    please go the editing section and do the needful to proceed with printing!
                                  </DialogDescription>
                                </DialogHeader>
                              </DialogContent>
                            </Dialog>
                          ) : (
                            <ShadButton variant="outline" onClick={() => { onSubmit(control._formValues); handlePrint(); }}>
                              <Printer className='h-4 w-4 mr-2' />
                              Print
                            </ShadButton>
                          )
                        }
                        <Dialog>
                          <DialogTrigger asChild>
                            <ShadButton variant="default" className="bg-yellow-500 hover:bg-yellow-600">
                              <Send className='h-4 w-4 mr-2' />
                              Mark as Dispatched
                            </ShadButton>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Confirm PO Sending</DialogTitle>
                              <DialogDescription className="pt-2 flex flex-col gap-2">
                                <div>
                                  <Label htmlFor="personName" className="text-sm font-medium">
                                    Person Name <span className="text-gray-400">(optional)</span>
                                  </Label>
                                  <Input
                                    id="personName"
                                    type='text'
                                    value={contactPerson.name}
                                    placeholder='Enter person name'
                                    onChange={(e) => setContactPerson((prev) => ({
                                      ...prev,
                                      name: e.target.value
                                    }))}
                                    className="mt-1"
                                  />
                                </div>
                                <div>
                                  <Label htmlFor="contactNumber" className="text-sm font-medium">
                                    Contact Number <span className="text-gray-400">(optional)</span>
                                  </Label>
                                  <Input
                                    id="contactNumber"
                                    type='tel'
                                    value={contactPerson.number}
                                    placeholder='Enter 10-digit number'
                                    onChange={(e) => setContactPerson((prev) => ({
                                      ...prev,
                                      number: e.target.value.slice(0, 10)
                                    }))}
                                    className="mt-1"
                                  />
                                </div>
                              </DialogDescription>
                            </DialogHeader>
                            {clicked ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                              <DialogFooter>
                                <DialogClose>
                                  <ShadButton variant="outline" className='flex items-center gap-1'>
                                    <Undo2 className="h-4 w-4 mr-2" />
                                    Cancel
                                  </ShadButton>
                                </DialogClose>
                                <ShadButton onClick={handleDispatchPO} className="bg-yellow-500 hover:bg-yellow-600">
                                  <CheckCheck className="h-4 w-4 mr-2" />
                                  Confirm
                                </ShadButton>
                              </DialogFooter>
                            )}
                            <DialogClose id='SendPODialogClose' className='hidden'>
                              close
                            </DialogClose>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </CardFooter>

                  </Card>
                )}
              {
                orderData?.status === "PO Sent" && (
                  <Card className="border-green-500 shadow-lg overflow-hidden">
                    <CardHeader className="bg-green-50 border-b border-green-200">
                      <CardTitle className="text-2xl text-green-800 flex items-center">
                        <Truck className="w-6 h-6 mr-2" />
                        Ready for Dispatch?
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='p-6'>
                      <CardDescription >
                        <div className='space-y-6'>
                          <div className="bg-green-100 p-4 rounded-lg border border-green-200">
                            <h3 className="font-semibold text-green-800 mb-2 flex items-center">
                              <AlertTriangle className="w-5 h-5 mr-2" />
                              Important Notes
                            </h3>
                            <ul className="list-disc list-inside space-y-1 text-sm text-green-700">
                              <li>Ensure all items are properly packed and labeled.</li>
                              <li>Verify the delivery address and contact information.</li>
                              <li>Attach any necessary documentation to the package.</li>
                            </ul>
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-gray-700 mb-2">Delivery Person Details</h3>
                            <p className="text-base text-gray-600 mb-4">Please enter the delivery person's Name and Contact Number:</p>
                            <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                              <div>
                                <Label htmlFor="personName" className="text-sm font-medium">
                                  Person Name <span className="text-gray-400">(optional)</span>
                                </Label>
                                <Input
                                  id="personName"
                                  type='text'
                                  value={contactPerson.name}
                                  placeholder='Enter person name'
                                  onChange={(e) => setContactPerson((prev) => ({
                                    ...prev,
                                    name: e.target.value
                                  }))}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label htmlFor="contactNumber" className="text-sm font-medium">
                                  Contact Number <span className="text-gray-400">(optional)</span>
                                </Label>
                                <Input
                                  id="contactNumber"
                                  type='tel'
                                  value={contactPerson.number}
                                  placeholder='Enter 10-digit number'
                                  onChange={(e) => setContactPerson((prev) => ({
                                    ...prev,
                                    number: e.target.value.slice(0, 10)
                                  }))}
                                  className="mt-1"
                                />
                              </div>
                            </div>
                          </div>
                          <div className='flex justify-end mt-4'>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <ShadButton className='bg-green-500 text-white hover:bg-green-600'>
                                  <ListChecks className="h-4 w-4 mr-2" />
                                  Mark Dispatched
                                </ShadButton>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Is this order dispatched?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This action will create a delivery note for the project manager on site. Are you sure you want to continue?
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                {clicked ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                                  <AlertDialogFooter>
                                    <AlertDialogCancel className="flex items-center">
                                      <Undo2 className="h-4 w-4 mr-2" />
                                      Cancel
                                    </AlertDialogCancel>
                                    <ShadButton onClick={handleDispatchPO} className='bg-green-500 text-white hover:bg-green-600'>
                                      <CheckCheck className="h-4 w-4 mr-2" />
                                      Confirm
                                    </ShadButton>
                                  </AlertDialogFooter>
                                )}
                                <AlertDialogCancel className='hidden' id='MarkDispatchedAlertClose'>
                                  Cancl
                                </AlertDialogCancel>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>

                      </CardDescription>

                    </CardContent>
                  </Card>
                )
              }
              {(orderData?.status === "PO Approved" && orderData?.merged === "true") && (
                <Card className="border-indigo-500 shadow-lg overflow-hidden">
                  <CardHeader className="bg-indigo-500/10 border-b border-indigo-500/20">
                    <CardTitle className="text-2xl text-indigo-500 flex items-center">
                      <Split className="w-6 h-6 mr-2" />
                      Unmerge PO
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='p-6'>
                    <CardDescription>
                      <div className="space-y-6">
                        <div className="bg-indigo-500/10 p-4 rounded-lg border border-indigo-500/20">
                          <h3 className="font-semibold text-indigo-500 mb-2 flex items-center">
                            <List className="w-5 h-5 mr-2" />
                            Associated Merged PO's
                          </h3>
                          <Tree treeData={treeData} defaultExpandedKeys={["mainPO"]} />
                        </div>
                        <div className="bg-indigo-500/10 p-4 rounded-lg border border-indigo-500/20">
                          <h3 className="font-semibold text-indigo-500 mb-2 flex items-center">
                            <AlertTriangle className="w-5 h-5 mr-2" />
                            Important Notes
                          </h3>
                          <ul className="list-disc list-inside space-y-1 text-sm text-indigo-500/80">
                            <li>If you need to <span className='italic text-primary font-bold'>Amend / Cancel</span>, You should proceed with this option.</li>
                            <li>This action will delete the current PO, unmerge all <span className="text-primary font-semibold">the above listed merged PO(s)</span> and make them available in the table!</li>
                          </ul>
                        </div>

                        <div className="flex justify-end">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <ShadButton
                                variant={"outline"}
                                className="flex border-primary items-center gap-1"
                              >
                                <Split className="h-4 w-4 mr-1" />
                                Unmerge
                              </ShadButton>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Are you sure?
                                </AlertDialogTitle>
                              </AlertDialogHeader>
                              <AlertDialogDescription className='space-y-2'>
                                <div>
                                  Please be informed that, the following are the PO(s) that are going to be unmerged and be available in the table, it is advised to note these PO numbers!
                                </div>

                                <ul className='list-disc list-inside'>
                                  {prevMergedPOs?.map((po) => (
                                    <li key={po?.name}>{po?.name}</li>
                                  ))}
                                </ul>

                                <p className=''>Click on confirm to proceed with unmerging!</p>
                              </AlertDialogDescription>
                              {clicked ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                                <div className='flex justify-end items-center gap-2'>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction asChild>
                                    <ShadButton
                                      onClick={handleUnmergePOs}
                                      className="flex items-center gap-1"
                                    >
                                      <Split className="h-4 w-4 mr-1" />
                                      Confirm
                                    </ShadButton>
                                  </AlertDialogAction>
                                </div>
                              )}
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </CardDescription>
                  </CardContent>
                </Card>
              )}
              <Card className="border-primary shadow-lg overflow-hidden">
                <CardHeader className="bg-primary/10 border-b border-primary/20">
                  <CardTitle className="text-2xl text-primary flex items-center">
                    <ListTodo className="w-6 h-6 mr-2" />
                    Amend PO
                  </CardTitle>
                </CardHeader>
                <CardContent className='p-6'>
                  <CardDescription>
                    <div className="space-y-6">
                      <div className="bg-primary/10 p-4 rounded-lg border border-primary/20">
                        <h3 className="font-semibold text-primary mb-2 flex items-center">
                          <AlertTriangle className="w-5 h-5 mr-2" />
                          Important Notes
                        </h3>
                        <ul className="list-disc list-inside space-y-1 text-sm text-primary/80">
                          <li>If you want to change quantities or remove items from this PO, choose this option.</li>
                          <li>This action will create an <span className="text-red-700 font-semibold">Approve Amendment</span> for this PO and send it to Project Lead for verification.</li>
                        </ul>
                      </div>

                      <div className="flex justify-end">
                        {(["PO Approved"].includes(orderData?.status)) ? (
                          orderData?.merged !== "true" ? (
                            <ShadButton
                              onClick={() => document.getElementById("amendAlertTrigger")?.click()}
                              className="flex items-center gap-1"
                            >
                              <ListTodo className="h-4 w-4 mr-1" />
                              Amend PO
                            </ShadButton>
                          ) : (
                            <HoverCard>
                              <HoverCardTrigger>
                                <ShadButton disabled className="flex items-center gap-1">
                                  <ListTodo className="h-4 w-4 mr-1" />
                                  Amend PO
                                </ShadButton>
                              </HoverCardTrigger>
                              <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                <div>As this is a <span className='text-primary'>Merged PO</span>, in order to Amend this, you should unmerge the POs first!</div>
                              </HoverCardContent>
                            </HoverCard>
                          )
                        ) : (
                          <HoverCard>
                            <HoverCardTrigger>
                              <ShadButton disabled className="flex items-center gap-1">
                                <ListTodo className="h-4 w-4 mr-1" />
                                Amend PO
                              </ShadButton>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                              <div><span className="text-primary underline">Amendment</span> not allowed for this PO as its delivery note or status has already been updated!</div>
                            </HoverCardContent>
                          </HoverCard>
                        )}

                        <Sheet>
                          <SheetTrigger asChild>
                            <button className="hidden" id="amendAlertTrigger">trigger</button>
                          </SheetTrigger>
                          <SheetContent className='overflow-auto'>
                            <>
                              <div className='pb-4 text-lg font-bold'>Amend: <span className='text-red-700'>{orderId}</span></div>
                              {/* PENDING CARD */}
                              <Card className="p-4">
                                <div className="flex justify-between pb-2 gap-2">
                                  <div className="text-red-700 text-sm font-light">Order List</div>
                                  {stack.length !== 0 && (
                                    <div className="flex items-center space-x-2">
                                      <HoverCard>
                                        <HoverCardTrigger asChild>
                                          <button
                                            onClick={() => UndoDeleteOperation()}
                                            className="flex items-center max-md:text-sm max-md:px-2 max-md:py-1  px-4 py-2 bg-blue-500 text-white font-semibold rounded-full shadow-md hover:bg-blue-600 transition duration-200 ease-in-out"
                                          >
                                            <Undo className="mr-2 max-md:w-4 max-md:h-4" /> {/* Undo Icon */}
                                            Undo
                                          </button>
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
                                      <th className="w-[60%] text-left  py-1 text-xs">Item Name</th>
                                      <th className="w-[20%]  py-1 text-xs text-center">Unit</th>
                                      <th className="w-[10%]  py-1 text-xs text-center">Quantity</th>
                                      <th className="w-[10%]  py-1 text-xs text-center">Edit</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {orderData?.order_list.list.map((item) => {
                                      return <tr key={item.item}>
                                        <td className="w-[60%] text-left border-b-2 py-1 text-sm">
                                          {item.item}
                                        </td>
                                        <td className="w-[20%] border-b-2 py-1 text-sm text-center">{item.unit}</td>
                                        <td className="w-[10%] border-b-2 py-1 text-sm text-center">{item.quantity}</td>
                                        <td className="w-[10%] border-b-2 py-1 text-sm text-center">
                                          <AlertDialog>
                                            <AlertDialogTrigger onClick={() => setQuantity(parseInt(item.quantity))}><Pencil className="w-4 h-4" /></AlertDialogTrigger>
                                            <AlertDialogContent>
                                              <AlertDialogHeader>
                                                <AlertDialogTitle className="flex justify-between">Edit Item
                                                  <AlertDialogCancel onClick={() => setQuantity('')} className="border-none shadow-none p-0">X</AlertDialogCancel>
                                                </AlertDialogTitle>
                                                <AlertDialogDescription className="flex flex-col gap-2">
                                                  <div className="flex space-x-2">
                                                    <div className="w-1/2 md:w-2/3">
                                                      <h5 className="text-base text-gray-400 text-left mb-1">Item Name</h5>
                                                      <div className="w-full  p-1 text-left">
                                                        {item.item}
                                                      </div>
                                                    </div>
                                                    <div className="w-[30%]">
                                                      <h5 className="text-base text-gray-400 text-left mb-1">UOM</h5>
                                                      <div className=" w-full  p-2 text-center justify-left flex">
                                                        {item.unit}
                                                      </div>
                                                    </div>
                                                    <div className="w-[25%]">
                                                      <h5 className="text-base text-gray-400 text-left mb-1">Qty</h5>
                                                      <input type="number" defaultValue={item.quantity} className=" rounded-lg w-full border p-2" onChange={(e) => setQuantity(e.target.value !== "" ? parseInt(e.target.value) : null)} />
                                                    </div>
                                                  </div>
                                                </AlertDialogDescription>
                                                <AlertDialogDescription className="flex justify-end">
                                                  <div className="flex gap-2">
                                                    {orderData.order_list.list.length === 1 ?
                                                      <ShadButton disabled>
                                                        <Trash2 className="h-4 w-4" />
                                                        Delete
                                                      </ShadButton>
                                                      :
                                                      <AlertDialogAction className="bg-gray-100 text-black hover:text-white flex gap-1 items-center" onClick={() => handleDelete(item.item)} asChild>
                                                        <ShadButton>
                                                          <Trash2 className="h-4 w-4" />
                                                          Delete
                                                        </ShadButton>
                                                      </AlertDialogAction>
                                                    }
                                                    <AlertDialogAction disabled={!quantity} onClick={() => handleSave(item.item, quantity)} className="flex gap-1 items-center" asChild>
                                                      <ShadButton variant={"outline"}>
                                                        <ListChecks className="h-4 w-4" />
                                                        Save
                                                      </ShadButton>
                                                    </AlertDialogAction>
                                                  </div>
                                                </AlertDialogDescription>
                                              </AlertDialogHeader>
                                            </AlertDialogContent>
                                          </AlertDialog>
                                        </td>
                                      </tr>

                                    })}
                                  </tbody>

                                </table>
                              </Card>

                              <div className='flex p-2 gap-2 items-end justify-end'>
                                <SheetClose asChild>
                                  <ShadButton
                                    variant="outline"
                                    className="flex items-center gap-1"
                                  >
                                    <Undo2 className="h-4 w-4" />
                                    Cancel
                                  </ShadButton>
                                </SheetClose>
                                {stack.length === 0 ?
                                  <HoverCard>
                                    <HoverCardTrigger asChild>
                                      <ShadButton variant="outline" disabled className="border-primary flex items-center gap-1">
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm
                                      </ShadButton>
                                    </HoverCardTrigger>
                                    <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                      <div>
                                        <span className="text-primary underline">No Amend operations are performed in this PO</span>
                                      </div>
                                    </HoverCardContent>
                                  </HoverCard>
                                  :
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <ShadButton
                                        variant="outline"
                                        className="border-primary flex items-center gap-1"
                                      >
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm
                                      </ShadButton>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          <h1 className="justify-center text-center">Are you sure you want to amend this PO?</h1>
                                        </AlertDialogTitle>

                                        <AlertDialogDescription className="flex flex-col text-center gap-1">
                                          Amending this PO will send this to Project Lead for approval. Continue?
                                          <div className='flex flex-col gap-2 mt-2'>
                                            <TextArea placeholder='input the reason for amending this PO...' value={comment} onChange={(e) => setComment(e.target.value)} />
                                          </div>
                                          {clicked ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                                            <div className='flex gap-2 items-center justify-center pt-2'>
                                              <AlertDialogCancel className="flex items-center gap-1">
                                                <Undo2 className="h-4 w-4" />
                                                Cancel
                                              </AlertDialogCancel>
                                              <ShadButton onClick={handleAmendPo} className='flex items-center gap-1'>
                                                <CheckCheck className="h-4 w-4" />
                                                Confirm
                                              </ShadButton>
                                            </div>
                                          )}
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogCancel className='hidden' id='AmendPOAlertCancel'>Close</AlertDialogCancel>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                }
                              </div>

                            </>
                            {/* <AlertDialogHeader>
                                                        <AlertDialogTitle>
                                                            <h1 className="justify-center">Are you sure!</h1>
                                                        </AlertDialogTitle>

                                                        <AlertDialogDescription className="flex flex-col text-center gap-1">
                                                            Cancelling this PO will create a new cancelled Sent Back. Continue?
                                                            <div className='flex flex-col gap-2 mt-2'>
                                                                <TextArea placeholder='input the reason for cancelling...' value={comment} onChange={(e) => setComment(e.target.value)} />
                                                            </div>
                                                            <div className='flex gap-2 items-center justify-center pt-2'>
                                                                <AlertDialogCancel className="flex items-center gap-1">
                                                                    <Undo2 className="h-4 w-4" />
                                                                    Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={handleCancelPo}>
                                                                    <button className='h-9 px-4 py-2 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 flex items-center gap-1'>
                                                                        <CheckCheck className="h-4 w-4" />
                                                                        Confirm</button>
                                                                </AlertDialogAction>
                                                            </div>
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader> */}
                          </SheetContent>
                        </Sheet>
                      </div>
                    </div>
                  </CardDescription>

                </CardContent>
              </Card>
              <Card className="border-primary shadow-lg overflow-hidden">
                <CardHeader className="bg-primary/10 border-b border-primary/20">
                  <CardTitle className="text-2xl text-primary flex items-center">
                    <ListX className="w-6 h-6 mr-2" />
                    Cancel PO
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <CardDescription>
                    <div className="space-y-6">
                      <div className="bg-primary/10 p-4 rounded-lg border border-primary/20">
                        <h3 className="font-semibold text-primary mb-2 flex items-center">
                          <AlertTriangle className="w-5 h-5 mr-2" />
                          Important Notes
                        </h3>
                        <ul className="list-disc list-inside space-y-1 text-sm text-primary/80">
                          <li>If you want to add/change vendor quotes, choose this option.</li>
                          <li>This action will create a <Badge variant="destructive">Cancelled</Badge> Sent Back Request within <span className="text-red-700 font-semibold">New Sent Back</span> side option.</li>
                        </ul>
                      </div>

                      <div className="flex justify-end">
                        {(["PO Approved"].includes(orderData?.status)
                          //  && (orderData?.order_list.list.some(item => 'po' in item) === false)
                        ) ? (
                          orderData?.merged !== "true" ? (
                            <ShadButton
                              onClick={() => document.getElementById("alertTrigger")?.click()}
                              className="border-primary flex items-center gap-1"
                            >
                              <ListX className="h-4 w-4 mr-1" />
                              Cancel PO
                            </ShadButton>
                          ) : (
                            <HoverCard>
                              <HoverCardTrigger>
                                <ShadButton disabled className="border-primary flex items-center gap-1">
                                  <ListX className="h-4 w-4 mr-1" />
                                  Cancel PO
                                </ShadButton>
                              </HoverCardTrigger>
                              <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                <div>As this is a <span className='text-primary'>Merged PO</span>, in order to Cancel this, you should unmerge the POs first!</div>
                              </HoverCardContent>
                            </HoverCard>
                          )
                        ) : (
                          <HoverCard>
                            <HoverCardTrigger>
                              <ShadButton disabled className="border-primary flex items-center gap-1">
                                <ListX className="h-4 w-4 mr-1" />
                                Cancel PO
                              </ShadButton>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                              <div>
                                <span className="text-primary underline">Cancellation</span>is not allowed for this PO. This might be due to the status is not PO Approved.
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger>
                            <button className="hidden" id="alertTrigger">trigger</button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                <h1 className="justify-center">Are you sure!</h1>
                              </AlertDialogTitle>

                              <AlertDialogDescription className="flex flex-col text-center gap-1">
                                Cancelling this PO will create a new cancelled Sent Back. Continue?
                                <div className='flex flex-col gap-2 mt-2'>
                                  <TextArea placeholder='input the reason for cancelling...' value={comment} onChange={(e) => setComment(e.target.value)} />
                                </div>
                                {clicked ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                                  <div className='flex gap-2 items-center justify-center pt-2'>
                                    <AlertDialogCancel className="flex items-center gap-1">
                                      <Undo2 className="h-4 w-4" />
                                      Cancel
                                    </AlertDialogCancel>
                                    <ShadButton onClick={handleCancelPo} className='flex items-center gap-1'>
                                      <CheckCheck className="h-4 w-4" />
                                      Confirm
                                    </ShadButton>
                                  </div>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogCancel className='hidden' id='CancelPOAlertCancel'>Close</AlertDialogCancel>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardDescription>
                </CardContent>
              </Card>
            </Content>
          </div>
        </Layout>
      </Layout>
    </div >
  );
};