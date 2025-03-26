import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFrappeFileUpload, useFrappePostCall } from 'frappe-react-sdk';
import { ArrowDown, ArrowUp, Check, CheckCheck, ListChecks, MessageCircleMore, Paperclip, Pencil, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from 'react';
// import { z } from "zod";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useToast } from '@/components/ui/use-toast';
import { useUserData } from '@/hooks/useUserData';
import { PurchaseOrderItem } from '@/types/NirmaanStack/ProcurementOrders';
import { parseNumber } from '@/utils/parseNumber';
import { TailSpin } from 'react-loader-spinner';

interface DeliveryNoteItemsDisplayProps {
  poMutate: any
  data?: any
  toggleDeliveryNoteSheet?: () => void 
}

export const DeliveryNoteItemsDisplay : React.FC<DeliveryNoteItemsDisplayProps> = ({data, poMutate, toggleDeliveryNoteSheet}) => {

  const userData = useUserData();
  const { toast } = useToast();

  const [order, setOrder] = useState<{list : PurchaseOrderItem[]} | null>(null);
  const [modifiedOrder, setModifiedOrder] = useState<{list : PurchaseOrderItem[]} | null>(null);

  const [show, setShow] = useState(false)
  const [selectedDeliveryChallan, setSelectedDeliveryChallan] = useState<File | null>(null);
  const [selectedPoInvoice, setSelectedPoInvoice] = useState<File | null>(null);
  
  const {call : DNUpdateCall, loading: DnUpdateCallLoading} = useFrappePostCall("nirmaan_stack.api.delivery_notes.update_delivery_note.update_delivery_note");
  
  const {upload, loading: uploadLoading} = useFrappeFileUpload()
  
  const [proceedDialog, setProceedDialog] = useState(false)
  
  const toggleProceedDialog = useCallback(() => {
      setProceedDialog(!proceedDialog)
    }, [proceedDialog])

    useEffect(() => {
      if (data) {
        const parsedOrder = typeof data.order_list === "string" ? JSON.parse(data.order_list) : data.order_list;
        setOrder(parsedOrder);
        setModifiedOrder(parsedOrder);
      }
    }, [data]);

  const handleReceivedChange = useCallback((itemName: string, value: string) => {
      const parsedValue = parseNumber(value);
      setModifiedOrder(prevState => ({
        ...prevState,
        list: prevState.list.map(item =>
          item.item === itemName ? { ...item, received: parsedValue } : item
        )
      }));
    }, [modifiedOrder, setModifiedOrder]);
  

  const checkIfNoValueItems = useMemo(() => {
      return (modifiedOrder?.list?.filter(item => !item.received || item.received === 0) || []).length > 0;
    }, [proceedDialog]);
  
  const handleUpdateDeliveryNote = async () => {
      try {
        let orderToUpdate = modifiedOrder;
  
        if (checkIfNoValueItems) {
          const noValueItems = modifiedOrder?.list?.filter(item => !item.received || item.received === 0) || [];
          orderToUpdate = {
            ...modifiedOrder,
            list: modifiedOrder?.list.map(item =>
              noValueItems?.includes(item) ? { ...item, received: 0 } : item
            ),
          };
        }
  
        let deliveryChallanUrl = null;
        let poInvoiceUrl = null;
  
        // Upload delivery challan if selected
        if (selectedDeliveryChallan) {
          const deliveryChallanArgs = {
            doctype: "Procurement Orders",
            docname: data?.name,
            fieldname: "attachment", // Assuming this is the fieldname
            isPrivate: true,
          };
          const deliveryChallanUploadResult = await upload(selectedDeliveryChallan, deliveryChallanArgs);
          deliveryChallanUrl = deliveryChallanUploadResult.file_url;
        }
  
        // Upload PO invoice if selected
        if (selectedPoInvoice) {
          const poInvoiceArgs = {
            doctype: "Procurement Orders",
            docname: data?.name,
            fieldname: "attachment", // Assuming this is the fieldname
            isPrivate: true,
          };
          const poInvoiceUploadResult = await upload(selectedPoInvoice, poInvoiceArgs);
          poInvoiceUrl = poInvoiceUploadResult.file_url;
        }
  
        // Call the backend API
        const response = await DNUpdateCall({
            po_id: data?.name,
            order: orderToUpdate?.list,
            delivery_challan_attachment: deliveryChallanUrl ? { file_url: deliveryChallanUrl } : null,
            po_invoice_attachment: poInvoiceUrl ? { file_url: poInvoiceUrl } : null,
          },
        );
  
        if(response.message.status === 200) {
          await poMutate();
          setShow(false);
          toggleProceedDialog();
          setSelectedDeliveryChallan(null);
          setSelectedPoInvoice(null);
          if(toggleDeliveryNoteSheet){
            toggleDeliveryNoteSheet()
          }
          toast({
            title: "Success!",
            description: response.message.message,
            variant: "success",
          });
        } else if(response.message.status === 400) {
          toast({
            title: "Failed!",
            description: response.message.error,
            variant: "destructive",
          });
        }
  
      } catch (error) {
        console.error("Error updating delivery note", error);
        toast({
          title: "Failed!",
          description: `Error while updating Delivery Note: ${data?.name?.split('/')[1]}`,
          variant: "destructive",
        });
      }
    };

  return (
        <>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-xl max-md:text-lg font-semibold text-red-600">
                Item List
              </CardTitle>
              {[
                "Nirmaan Project Manager Profile",
                "Nirmaan Admin Profile",
                "Nirmaan Project Lead Profile"
              ].includes(userData?.role) &&
                !show &&
                data?.status !== "Delivered" && (
                  <Button
                    onClick={() => setShow(true)}
                    className="flex items-center gap-1"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                )}
              {show && data?.status !== "Delivered" && (
                <div className="flex gap-4">
            <div className="flex flex-col gap-2">
              <div
                className={`text-blue-500 cursor-pointer flex gap-1 items-center justify-center border rounded-md border-blue-500 p-1 ${selectedDeliveryChallan && "opacity-50 cursor-not-allowed"}`}
                onClick={() => document.getElementById("delivery-challan-upload")?.click()}
              >
                <Paperclip size="15px" />
                <span className="p-0 text-sm">Delivery Challan</span>
                <input
                  type="file"
                  id="delivery-challan-upload"
                  className="hidden"
                  onChange={(e) => setSelectedDeliveryChallan(e.target.files?.[0] || null)}
                  disabled={!!selectedDeliveryChallan}
                />
              </div>
              {selectedDeliveryChallan && (
                <div className="flex items-center justify-between bg-slate-100 px-4 py-1 rounded-md">
                  <span className="text-sm">
                    {typeof selectedDeliveryChallan === "object" ? selectedDeliveryChallan.name : selectedDeliveryChallan}
                  </span>
                  <button className="ml-1 text-red-500" onClick={() => setSelectedDeliveryChallan(null)}>
                    ✖
                  </button>
                </div>
              )}
            </div>
    
            <div className="flex flex-col gap-2">
              <div
                className={`text-blue-500 cursor-pointer flex gap-1 items-center justify-center border rounded-md border-blue-500 p-1 ${selectedPoInvoice && "opacity-50 cursor-not-allowed"}`}
                onClick={() => document.getElementById("po-invoice-upload")?.click()}
              >
                <Paperclip size="15px" />
                <span className="p-0 text-sm">PO Invoice</span>
                <input
                  type="file"
                  id="po-invoice-upload"
                  className="hidden"
                  onChange={(e) => setSelectedPoInvoice(e.target.files?.[0] || null)}
                  disabled={!!selectedPoInvoice}
                />
              </div>
              {selectedPoInvoice && (
                <div className="flex items-center justify-between bg-slate-100 px-4 py-1 rounded-md">
                  <span className="text-sm">
                    {typeof selectedPoInvoice === "object" ? selectedPoInvoice.name : selectedPoInvoice}
                  </span>
                  <button className="ml-1 text-red-500" onClick={() => setSelectedPoInvoice(null)}>
                    ✖
                  </button>
                </div>
              )}
            </div>
          </div>
              )}
            </CardHeader>
            <CardContent>
              {show && (
                <div className="pl-2 transition-all duration-500 ease-in-out">
                  <i className="text-sm text-gray-600">
                    "Please Update the quantity received for delivered items"
                  </i>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-bold">Item Name</TableHead>
                    <TableHead className="font-bold">Unit</TableHead>
                    <TableHead className="font-bold">Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data &&
                    order?.list.map((item) => (
                      <TableRow key={item.name}>
                        <TableCell>
                          <div className="inline items-baseline">
                            <p>{item.item}{item?.makes?.list?.length > 0 && (
                                <span className="text-xs italic font-semibold text-gray-500">
                                  - {item.makes.list.find((i) => i?.enabled === "true")?.make || "no make specified"}
                                </span>
                              )}
                            </p>
                            {item.comment && (
                              <HoverCard>
                                <HoverCardTrigger>
                                  <MessageCircleMore className="text-blue-400 w-4 h-4 inline-block ml-1" />
                                </HoverCardTrigger>
                                <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                  <div className="relative pb-4">
                                    <span className="block">{item.comment}</span>
                                    <span className="text-xs absolute right-0 italic text-gray-200">
                                      -Comment by PL
                                    </span>
                                  </div>
                                </HoverCardContent>
                              </HoverCard>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>
                          {!show ? (
                            item.received === item.quantity ? (
                              <div className="flex gap-2">
                                <Check className="h-5 w-5 text-green-500" />
                                <span>{item.received}</span>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                {(item.received || 0) > item.quantity ? (
                                  <ArrowUp className="text-primary" />
                                ) : (
                                  <ArrowDown className="text-primary" />
                                )}
                                <span className="text-sm text-gray-600">
                                  {item.received || 0}
                                </span>
                              </div>
                            )
                          ) : item.received !== item.quantity ? (
                            <div>
                              <Input
                                type="number"
                                value={
                                  modifiedOrder?.list?.find(
                                    (mod) => mod?.name === item.name
                                  )?.received || ""
                                }
                                onChange={(e) =>
                                  handleReceivedChange(item.item, e.target.value)
                                }
                                placeholder={item?.quantity.toString()}
                              />
                              {/* <span className='text-sm font-light text-red-500'>{validateMessage[item.item]}</span> */}
                            </div>
                          ) : (
                            <Check className="h-5 w-5 text-green-500" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {data?.status !== "Delivered" && show && (
                <Button
                  onClick={toggleProceedDialog}
                  variant={"default"}
                  className="w-full mt-6 flex items-center gap-1"
                >
                  <ListChecks className="h-4 w-4" />
                  Update
                </Button>
              )}
            </CardContent>
          </Card>
      
       <AlertDialog open={proceedDialog} onOpenChange={toggleProceedDialog}>
              <AlertDialogTrigger>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  {checkIfNoValueItems && (
                    <AlertDialogDescription>
                    You have provided some items with 0 or no value, they will be
                    marked as <span className="underline">'0 items received'</span>.
                  </AlertDialogDescription>
                  )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                {DnUpdateCallLoading || uploadLoading ? (
                  <TailSpin width={40} height={40} color={"red"} />
                ) : (
                    <>
                    <AlertDialogCancel className="flex items-center gap-1">
                    <Undo2 className="h-4 w-4" />
                    Cancel
                  </AlertDialogCancel>
                  <Button
                    onClick={handleUpdateDeliveryNote}
                    className="flex items-center gap-1"
                  >
                    <CheckCheck className="h-4 w-4" />
                    Confirm
                  </Button>
                    </>
                  )}
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </>
  )
}