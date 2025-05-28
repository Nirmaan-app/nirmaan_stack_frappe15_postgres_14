import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { useUserData } from '@/hooks/useUserData';
import { DeliveryDataType, ProcurementOrder, PurchaseOrderItem } from '@/types/NirmaanStack/ProcurementOrders';
import { parseNumber } from '@/utils/parseNumber';
import { useFrappeFileUpload, useFrappePostCall, useSWRConfig, FrappeDoc } from 'frappe-react-sdk';
import { ArrowDown, ArrowUp, Check, ListChecks, MessageCircleMore, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TailSpin } from "react-loader-spinner";
import { CustomAttachment } from "../../../components/helpers/CustomAttachment";
import { KeyedMutator } from 'swr';

interface DeliveryNoteItemsDisplayProps {
  poMutate: KeyedMutator<FrappeDoc<ProcurementOrder>>;
  data: ProcurementOrder | null;
  toggleDeliveryNoteSheet?: () => void;
}

interface ModifiedItems {
  [itemId: string]: {
    previousReceived: number;
    newReceived: number;
  };
}

export const DeliveryNoteItemsDisplay: React.FC<DeliveryNoteItemsDisplayProps> = ({
  data, poMutate, toggleDeliveryNoteSheet
}) => {
  const userData = useUserData();
  const { toast } = useToast();
  const {mutate} = useSWRConfig();

  // State management
  const [originalOrder, setOriginalOrder] = useState<PurchaseOrderItem[]>([]);
  const [modifiedItems, setModifiedItems] = useState<ModifiedItems>({});
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [proceedDialog, setProceedDialog] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState<string>(new Date().toISOString().split("T")[0]);

  // API hooks
  const { call: DNUpdateCall, loading: DnUpdateCallLoading } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.update_delivery_note.update_delivery_note"
  );
  const { upload, loading: uploadLoading } = useFrappeFileUpload();

  // Derived state
  const hasChanges = useMemo(
    () => Object.keys(modifiedItems).length > 0 || selectedAttachment !== null,
    [modifiedItems, selectedAttachment]
  );

  // Initialize original order
  useEffect(() => {
    if (data?.order_list) {
      const parsedOrder = typeof data.order_list === "string" 
        ? JSON.parse(data.order_list) 
        : data.order_list;
      setOriginalOrder(parsedOrder.list);
    }
  }, [data]);

  // Handle quantity changes
  const handleReceivedChange = useCallback(
    (item: PurchaseOrderItem, value: string) => {
      const parsedValue = parseNumber(value);
      const originalReceived = item.received ?? 0;

      setModifiedItems((prevModifiedItems) => {
        const updatedItems = { ...prevModifiedItems };

        if (updatedItems[item.name]) {
          if (parsedValue === originalReceived) {
            delete updatedItems[item.name];
          } else {
            updatedItems[item.name].newReceived = parsedValue;
          }
        } else {
          updatedItems[item.name] = {
            previousReceived: originalReceived || item.quantity,
            newReceived: parsedValue,
          };
        }

        return updatedItems;
      });
    },
    []
  );

  // Transform changes to delivery data format
  const transformChangesToDeliveryData = useCallback(() => {
    // const now = new Date();
    // const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padEnd(6, '0')}`;

    const deliveryData: DeliveryDataType = {
      [deliveryDate]: {
        items: [],
        updated_by: userData?.user_id,
      }
    };

    
    Object.entries(modifiedItems).forEach(([itemId, { previousReceived, newReceived }]) => {
      const originalItem = originalOrder.find(item => item.name === itemId);
      if (!originalItem) return;

      deliveryData[deliveryDate].items.push({
        item_id: itemId,
        item_name: originalItem.item,
        unit: originalItem.unit,
        from: previousReceived,
        to: newReceived,
      });
    });

    return deliveryData;
  }, [modifiedItems, originalOrder, userData, selectedAttachment]);

  // Handle file upload
  const uploadAttachment = useCallback(async () => {
    if (!selectedAttachment) return null;

    try {
      const result = await upload(selectedAttachment, {
        doctype: "Procurement Orders",
        docname: data?.name,
        fieldname: "attachment",
        isPrivate: true
      });
      return result.file_url;
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: "Failed to upload delivery challan",
        variant: "destructive"
      });
      return null;
    }
  }, [selectedAttachment, data, upload, toast]);

  // Submit handler
  const handleUpdateDeliveryNote = useCallback(async () => {
    try {
      const attachmentId = await uploadAttachment();
      const deliveryData = transformChangesToDeliveryData();

      // Update delivery data with actual attachment ID
      // if (attachmentId) {
      //   Object.values(deliveryData).forEach(entry => {
      //     entry.dc_attachment_id = attachmentId;
      //   });
      // }
      const modifiedItemsPayload: { [itemId: string]: number } = {};
      Object.entries(modifiedItems).forEach(([itemId, receivedObject]) => {
        modifiedItemsPayload[itemId] = receivedObject.newReceived;
      });


      const payload = {
        po_id: data?.name,
        modified_items: modifiedItemsPayload,
        delivery_data: deliveryData,
        delivery_challan_attachment: attachmentId
      };

      const response = await DNUpdateCall(payload);

      if (response.message.status === 200) {
        await poMutate();
        await mutate(`Nirmaan Attachments-${data?.name}`)
        setShowEdit(false);
        setProceedDialog(false);
        setModifiedItems({});
        setSelectedAttachment(null);

        toast({
          title: "Success!",
          description: response.message.message,
          variant: "success"
        });

        toggleDeliveryNoteSheet?.();
      } else if (response.message.status === 400) {
        toast({
          title: "Failed!",
          description: response.message.error,
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error updating delivery note:", error);
      toast({
        title: "Update Failed",
        description: "Failed to update delivery note",
        variant: "destructive"
      });
    }
  }, [data, userData, DNUpdateCall, poMutate, toggleDeliveryNoteSheet, toast, transformChangesToDeliveryData, uploadAttachment]);

  // Render helpers
  const renderReceivedCell = (item: PurchaseOrderItem) => {
    const originallyAllReceived = item.received === item.quantity;
    const modifiedValue = modifiedItems[item.name]?.newReceived;

    if (!showEdit) {
      return (
        <div className="flex items-center gap-1">
          {originallyAllReceived ? (
            <Check className="h-5 w-5 text-green-500" />
          ) : item.received && (item.received > item.quantity) ? (
            <ArrowUp className="text-primary" />
          ) : item.received && (item.received < item.quantity) ? (
            <ArrowDown className="text-primary" />
          ) : null}
          {!originallyAllReceived ? (
            <span className="">{parseNumber(item.received)}
            {/* <span> (original : {item.quantity})</span> */}
            </span>
          ) : (<span>{item.quantity}</span>)}
        </div>
      );
    }

    if (originallyAllReceived) {
      return <Check className="h-5 w-5 text-green-500" />;
    }

    return (
      <>
      <Input
        type="number"
        value={modifiedValue ?? item.received}
        onChange={(e) => handleReceivedChange(item, e.target.value)}
        // min={0}
        // max={item.quantity * 2} // Allow reasonable over-delivery
        placeholder={`${String(item.received || item.quantity)}`}
        className="w-24"
      />
      {/* {item.received ? (
        <span className="text-xs text-gray-400">
          (Ordered: {item.quantity})
        </span>
      ) : (
        <span />
      )}   */}
      </>
    );
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b">
          <CardTitle className="text-xl font-semibold text-red-600">
            Item List
          </CardTitle>
          {data?.status !== "Delivered" && (
            showEdit ? (
              <div className="flex gap-4 items-start">
                <CustomAttachment
                  maxFileSize={20 * 1024 * 1024} // 20MB
                  selectedFile={selectedAttachment}
                  onFileSelect={setSelectedAttachment}
                  label="Attach DC"
                  className="w-full"
                />
                <Button
                  onClick={() => setProceedDialog(true)}
                  disabled={!hasChanges}
                  className="gap-1"
                >
                  <ListChecks className="h-4 w-4" />
                  Update
                </Button>
                <Button
                  onClick={() => setShowEdit(false)}
                  className="gap-1"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </div>
            ) : (
              <Button onClick={() => setShowEdit(true)} className="gap-1">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )
          )}
        </CardHeader>
        <CardContent>
        <div className="overflow-auto">
          <Table>
            <TableHeader className="bg-gray-100">
              <TableRow>
                <TableHead className="w-[50%] min-w-[200px]">Item Name</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Ordered</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {originalOrder.map((item) => (
                <TableRow key={item.name}>
                  <TableCell>
                    <div className="inline items-baseline">
                      <p>{item.item}</p>
                      {item.comment && (
                        <HoverCard>
                          <HoverCardTrigger>
                            <MessageCircleMore className="text-blue-400 w-4 h-4 inline-block ml-1" />
                          </HoverCardTrigger>
                          <HoverCardContent>
                            <div className="pb-4">
                              <span className="block">{item.comment}</span>
                              <span className="text-xs italic text-gray-600">
                                - Comment by PL
                              </span>
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell className="text-center">{item.quantity}</TableCell>
                  <TableCell>
                    {renderReceivedCell(item)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </CardContent>
      </Card>

      <AlertDialog open={proceedDialog} onOpenChange={setProceedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Delivery Update</AlertDialogTitle>
            <AlertDialogDescription>
              {Object.keys(modifiedItems).length} item changes detected
              {selectedAttachment && " with attached delivery challan"}
              <div className="flex gap-4 items-center w-full mt-4" >
                <Label className="w-[40%]">Delivery Date: <sup className="text-sm text-red-600">*</sup></Label>
                    <Input
                        type="date"
                        placeholder="DD/MM/YYYY"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        max={new Date().toISOString().split("T")[0]}
                        onKeyDown={(e) => e.preventDefault()}
                     />
            </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {uploadLoading || DnUpdateCallLoading ? <TailSpin color="red" width={40} height={40} /> : (
              <>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button 
                onClick={handleUpdateDeliveryNote}
                disabled={DnUpdateCallLoading || uploadLoading || !deliveryDate}
              >
                Confirm Update
              </Button>
            </>)}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};