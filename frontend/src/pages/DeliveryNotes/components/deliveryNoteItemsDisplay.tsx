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

// --- (Indicator) MODIFIED STATE: We no longer track the "total diff", but the "newly delivered" amount.
interface NewlyDeliveredQuantities {
  [itemId: string]: string; // Store as string to handle empty inputs
}

export const DeliveryNoteItemsDisplay: React.FC<DeliveryNoteItemsDisplayProps> = ({
  data, poMutate, toggleDeliveryNoteSheet
}) => {
  const userData = useUserData();
  const { toast } = useToast();
  const { mutate } = useSWRConfig();

  // State management
  const [originalOrder, setOriginalOrder] = useState<PurchaseOrderItem[]>([]);
  // --- (Indicator) NEW STATE: Tracks only the values entered in the "Newly Delivered" input boxes ---
  const [newlyDeliveredQuantities, setNewlyDeliveredQuantities] = useState<NewlyDeliveredQuantities>({});
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [proceedDialog, setProceedDialog] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState<string>(new Date().toISOString().split("T")[0]);

  // API hooks
  const { call: DNUpdateCall, loading: DnUpdateCallLoading } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.update_delivery_note.update_delivery_note"
  );
  const { upload, loading: uploadLoading } = useFrappeFileUpload();

  // --- (Indicator) MODIFIED DERIVED STATE: hasChanges now depends on the new state ---
  const hasChanges = useMemo(
    () => Object.values(newlyDeliveredQuantities).some(val => parseNumber(val) > 0) || selectedAttachment !== null,
    [newlyDeliveredQuantities, selectedAttachment]
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

  // When toggling edit mode, reset the inputs
  useEffect(() => {
    if (!showEdit) {
      setNewlyDeliveredQuantities({});
      setSelectedAttachment(null);
    }
  }, [showEdit]);

  // --- (Indicator) MODIFIED HANDLER: Updates the new state for newly delivered quantities ---
  const handleNewlyDeliveredChange = useCallback(
    (item: PurchaseOrderItem, value: string) => {
      // Allow empty string to clear input, but only add to state if it's a valid number
      const parsedValue = parseNumber(value);

      setNewlyDeliveredQuantities((prev) => {
        const updated = { ...prev };
        if (value === '' || parsedValue === 0) {
          delete updated[item.name]; // Remove from state if cleared or zero
        } else {
          updated[item.name] = value; // Store the raw string value
        }
        return updated;
      });
    },
    []
  );

  // --- (Indicator) MODIFIED LOGIC: This now builds the history log based on the new input state ---
  const transformChangesToDeliveryData = useCallback(() => {
    const deliveryData: DeliveryDataType = {
      [deliveryDate]: {
        items: [],
        updated_by: userData?.user_id,
      }
    };

    Object.entries(newlyDeliveredQuantities).forEach(([itemId, newlyDeliveredStr]) => {
      const newlyDeliveredQty = parseNumber(newlyDeliveredStr);
      if (newlyDeliveredQty <= 0) return; // Don't log entries with no new delivery

      const originalItem = originalOrder.find(item => item.name === itemId);
      if (!originalItem) return;

      const alreadyDelivered = originalItem.received ?? 0;
      const newTotal = alreadyDelivered + newlyDeliveredQty;

      deliveryData[deliveryDate].items.push({
        item_id: itemId,
        item_name: originalItem.item,
        unit: originalItem.unit,
        from: alreadyDelivered, // The quantity before this update
        to: newTotal,           // The new total quantity
      });
    });

    return deliveryData;
  }, [newlyDeliveredQuantities, originalOrder, userData, deliveryDate]);

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

  // --- (Indicator) MODIFIED SUBMISSION LOGIC: Calculates the new total before sending to backend ---
  const handleUpdateDeliveryNote = useCallback(async () => {
    const modifiedItemsPayload: { [itemId: string]: number } = {};
    let hasInvalidEntry = false;

    // Build the payload and validate quantities
    Object.entries(newlyDeliveredQuantities).forEach(([itemId, newlyDeliveredStr]) => {
      const newlyDeliveredQty = parseNumber(newlyDeliveredStr);
      if (newlyDeliveredQty < 0) {
        toast({ title: "Invalid Quantity", description: `Cannot deliver a negative quantity for item ${itemId}.`, variant: "destructive" });
        hasInvalidEntry = true;
        return;
      }
      if (newlyDeliveredQty === 0) return; // Skip items with 0 new quantity

      const originalItem = originalOrder.find(item => item.name === itemId);
      if (!originalItem) return;

      const alreadyDelivered = originalItem.received ?? 0;
      const newTotalReceived = alreadyDelivered + newlyDeliveredQty;

      // Optional: Add a check for over-delivery if needed, for now we allow it.
      // if (newTotalReceived > originalItem.quantity) { /* can show warning */ }

      modifiedItemsPayload[itemId] = newTotalReceived;
    });

    if (hasInvalidEntry) return;
    if (Object.keys(modifiedItemsPayload).length === 0 && !selectedAttachment) {
      toast({ title: "No Changes", description: "Please enter a delivery quantity or attach a challan.", variant: "default" });
      return;
    }

    try {
      const attachmentId = await uploadAttachment();
      const deliveryData = transformChangesToDeliveryData();

      const payload = {
        po_id: data?.name,
        modified_items: modifiedItemsPayload,
        delivery_data: deliveryData,
        delivery_challan_attachment: attachmentId
      };

      const response = await DNUpdateCall(payload);

      if (response.message.status === 200) {
        await poMutate();
        await mutate(`Nirmaan Attachments-${data?.name}`);
        setShowEdit(false);
        setProceedDialog(false);
        setNewlyDeliveredQuantities({}); // Reset new state
        setSelectedAttachment(null);
        toast({ title: "Success!", description: response.message.message, variant: "success" });
        toggleDeliveryNoteSheet?.();
      } else if (response.message.status === 400) {
        toast({ title: "Failed!", description: response.message.error, variant: "destructive" });
      }
    } catch (error) {
      console.error("Error updating delivery note:", error);
      toast({ title: "Update Failed", description: "Failed to update delivery note", variant: "destructive" });
    }
  }, [data, originalOrder, newlyDeliveredQuantities, DNUpdateCall, poMutate, toggleDeliveryNoteSheet, toast, transformChangesToDeliveryData, uploadAttachment, selectedAttachment, mutate]);

  // Render helpers
  // const renderReceivedCell = (item: PurchaseOrderItem) => {
  //   const originallyAllReceived = item.received === item.quantity;
  //   const modifiedValue = modifiedItems[item.name]?.newReceived;

  //   if (!showEdit) {
  //     return (
  //       <div className="flex items-center gap-1">
  //         {originallyAllReceived ? (
  //           <Check className="h-5 w-5 text-green-500" />
  //         ) : item.received && (item.received > item.quantity) ? (
  //           <ArrowUp className="text-primary" />
  //         ) : item.received && (item.received < item.quantity) ? (
  //           <ArrowDown className="text-primary" />
  //         ) : null}
  //         {!originallyAllReceived ? (
  //           <span className="">{parseNumber(item.received)}
  //           {/* <span> (original : {item.quantity})</span> */}
  //           </span>
  //         ) : (<span>{item.quantity}</span>)}
  //       </div>
  //     );
  //   }

  //   if (originallyAllReceived) {
  //     return <Check className="h-5 w-5 text-green-500" />;
  //   }

  //   return (
  //     <>
  //     <Input
  //       type="number"
  //       value={modifiedValue ?? item.received}
  //       onChange={(e) => handleReceivedChange(item, e.target.value)}
  //       // min={0}
  //       // max={item.quantity * 2} // Allow reasonable over-delivery
  //       placeholder={`${String(item.received || item.quantity)}`}
  //       className="w-24"
  //     />
  //     {/* {item.received ? (
  //       <span className="text-xs text-gray-400">
  //         (Ordered: {item.quantity})
  //       </span>
  //     ) : (
  //       <span />
  //     )}   */}
  //     </>
  //   );
  // };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b">
          <CardTitle className="text-xl font-semibold text-red-600">Item List</CardTitle>
          {data?.status !== "Delivered" && (
            showEdit ? (
              <div className="flex gap-4 items-center"> {/* Use items-center for better alignment */}
                <CustomAttachment maxFileSize={20 * 1024 * 1024} selectedFile={selectedAttachment} onFileSelect={setSelectedAttachment} label="Attach DC" className="w-auto" />
                <Button onClick={() => setProceedDialog(true)} disabled={!hasChanges} className="gap-1"><ListChecks className="h-4 w-4" /> Update</Button>
                <Button onClick={() => setShowEdit(false)} variant="ghost" className="gap-1"><X className="h-4 w-4" /> Cancel</Button>
              </div>
            ) : (
              <Button onClick={() => setShowEdit(true)} className="gap-1"><Pencil className="h-4 w-4" /> Edit</Button>
            )
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader className="bg-gray-100">
                <TableRow>
                  <TableHead className="w-[40%] min-w-[200px]">Item Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Ordered</TableHead>
                  {/* --- (Indicator) MODIFIED HEADERS: Dynamically change based on edit mode --- */}
                  {showEdit ? (
                    <>
                      <TableHead>Already Delivered</TableHead>
                      <TableHead>Newly Delivered</TableHead>
                    </>
                  ) : (
                    <TableHead>Total Received</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {originalOrder.map((item) => {
                  const alreadyDelivered = item.received ?? 0;
                  const isFullyDelivered = alreadyDelivered >= item.quantity;

                  return (
                    <TableRow key={item.name}>
                      <TableCell>
                        <div className="inline items-baseline">
                          <p>{item.item}</p>
                          {item.comment && (
                            <HoverCard><HoverCardTrigger><MessageCircleMore className="text-blue-400 w-4 h-4 inline-block ml-1" /></HoverCardTrigger><HoverCardContent><div className="pb-4"><span className="block">{item.comment}</span><span className="text-xs italic text-gray-600">- Comment by PL</span></div></HoverCardContent></HoverCard>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell className="text-center">{item.quantity}</TableCell>

                      {/* --- (Indicator) MODIFIED CELL RENDERING --- */}
                      {showEdit ? (
                        <>
                          <TableCell className="text-center">
                            <div className="flex items-center gap-1">
                              {/* Show icon based on delivery status */}
                              {isFullyDelivered ? (<Check className="h-5 w-5 text-green-500" />)
                                : alreadyDelivered > 0 ? (<ArrowDown className="text-primary" />) : null}
                              <span>{alreadyDelivered}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {/* Render input only if not fully delivered */}
                            {/* {!isFullyDelivered ? (
                              <Input
                                type="number"
                                value={newlyDeliveredQuantities[item.name] ?? ''}
                                onChange={(e) => handleNewlyDeliveredChange(item, e.target.value)}
                                placeholder="0"
                                className="w-24"
                                min={0}
                              />
                            ) : (
                              <div className="flex items-center justify-center text-green-600">
                                <Check className="h-5 w-5" />
                                <span className="ml-1 text-xs">Complete</span>
                              </div>
                            )} */}
                            <Input
                              type="number"
                              value={newlyDeliveredQuantities[item.name] ?? ''}
                              onChange={(e) => handleNewlyDeliveredChange(item, e.target.value)}
                              placeholder="0"
                              className="w-24"
                              min={0}
                            />
                          </TableCell>
                        </>
                      ) : (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {isFullyDelivered ? (<Check className="h-5 w-5 text-green-500" />)
                              : alreadyDelivered > 0 ? (<ArrowDown className="text-primary" />) : null}
                            <span>{alreadyDelivered}</span>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={proceedDialog} onOpenChange={setProceedDialog}>
        {/* ... (Confirmation Dialog unchanged) ... */}
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Delivery Update</AlertDialogTitle>
            <AlertDialogDescription>
              {Object.keys(newlyDeliveredQuantities).length} item(s) will be updated
              {selectedAttachment && " and a new delivery challan will be attached"}
              .
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
                <Button onClick={handleUpdateDeliveryNote} disabled={DnUpdateCallLoading || uploadLoading || !deliveryDate}>
                  Confirm Update
                </Button>
              </>)}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};