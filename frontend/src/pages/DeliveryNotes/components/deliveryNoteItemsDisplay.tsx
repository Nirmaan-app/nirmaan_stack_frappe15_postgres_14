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
import { safeJsonParse } from "../constants";

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

  // console.log("updateDN Data", data,data?.items?.length)
  // console.log("updateDN Data",JSON.parse(data?.deliveryDate))

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
    if (data?.items.length > 0) {
      // const parsedOrder = data?.items;
      setOriginalOrder(data?.items);
    }
  }, [data]);

  // When toggling edit mode, reset the inputs
  useEffect(() => {
    if (!showEdit) {
      setNewlyDeliveredQuantities({});
      setSelectedAttachment(null);
    }
  }, [showEdit]);


  // --- BEFORE ---
  /*
  const handleNewlyDeliveredChange = useCallback(
    (item: PurchaseOrderItem, value: string) => {
      const MAX_ALLOWED_QUANTITY = 20; // Static value
      // ...
    },
    []
  );
  */

  // // --- AFTER (The New Dynamic Logic) ---
  // const handleNewlyDeliveredChange = useCallback(
  //   (item: PurchaseOrderItem, value: string) => {
  //     // 1. Calculate the remaining quantity for this specific item.
  //     const alreadyDelivered = item.received_quantity ?? 0;
  //     const remainingQuantity = item.quantity - alreadyDelivered;

  //     // 2. Determine the maximum allowed input. If remaining is negative (over-delivered), max is 0.
  //     //    Math.max is a clean way to handle this.
  //     const maxAllowed = Math.max(0, remainingQuantity);

  //     // 3. Handle the user clearing the input (no changes needed here)
  //     if (value === '') {
  //       setNewlyDeliveredQuantities((prev) => {
  //         const updated = { ...prev };
  //         delete updated[item.name];
  //         return updated;
  //       });
  //       return;
  //     }

  //     // 4. Parse the input value (no changes needed here)
  //     const numericValue = parseFloat(value);

  //     // 5. Enforce the DYNAMIC maximum limit.
  //     const cappedValue = Math.min(numericValue, maxAllowed);

  //     // 6. Update the state with the capped value (no changes needed here)
  //     setNewlyDeliveredQuantities((prev) => ({
  //       ...prev,
  //       [item.name]: String(cappedValue),
  //     }));
  //   },
  //   [] // No dependencies needed as 'item' is passed directly
  // );

    // --- AFTER (The Corrected Dynamic Logic) ---
  const handleNewlyDeliveredChange = useCallback(
    (item: PurchaseOrderItem, value: string) => {
      // 1. Calculate the remaining quantity for this specific item (no changes here).
      const alreadyDelivered = item.received_quantity ?? 0;
      const remainingQuantity = item.quantity - alreadyDelivered;

      // 2. Determine the maximum allowed input (no changes here).
      const maxAllowed = Math.max(0, remainingQuantity);

      // 3. Handle the user clearing the input (no changes here).
      if (value === '') {
        setNewlyDeliveredQuantities((prev) => {
          const updated = { ...prev };
          delete updated[item.name];
          return updated;
        });
        return;
      }

      // --- FIX STARTS HERE ---

      // 4. Validate the input format. Only allow numbers and a single decimal point.
      //    This regex ensures strings like "1..2" or "abc" are rejected immediately.
      //    It allows for an empty string before the dot (e.g., ".5") and partial numbers (e.g., "5.").
      const isValidFormat = /^[0-9]*\.?[0-9]*$/.test(value);
      if (!isValidFormat) {
        return; // Ignore invalid characters and prevent state update.
      }

      // 5. Parse the input value.
      const numericValue = parseFloat(value);

      // 6. Conditionally update the state.
      //    - If the number exceeds the max, we FORCE the state to be the max allowed.
      //    - Otherwise, we trust the user's input string to preserve formatting like "1." or "5.0".
      const finalValue = numericValue > maxAllowed ? String(maxAllowed) : value;

      setNewlyDeliveredQuantities((prev) => ({
        ...prev,
        [item.name]: finalValue,
      }));
    },
    [] // No dependencies needed as 'item' is passed directly
  );


  // --- (Indicator) MODIFIED LOGIC: This now builds the history log based on the new input state ---
  const transformChangesToDeliveryData = useCallback(() => {


    // 1. First, parse the 'delivery_data' string into a JavaScript object.
    const deliveryDataString = data?.delivery_data;
    const parsedDeliveryObject = safeJsonParse(data.delivery_data, {});
    // This will turn "{\"data\":{...}}" into { data: {...} }

    // 2. Now you can safely access the 'data' property on the newly parsed object.
    const deliveryHistory = parsedDeliveryObject.data || {};
    // This will give you the object you actually want: { "2025-07-16": {...} }

    // 3. Now you can count the keys as intended.
    const numberOfPreviousDeliveries = Object.keys(deliveryHistory).length;
    const newNoteNumber = numberOfPreviousDeliveries + 1;

    // console.log('Final delivery history object:', deliveryHistory);
    // console.log('Number of previous deliveries:', numberOfPreviousDeliveries);

    const deliveryData: DeliveryDataType = {
      [deliveryDate]: {
        note_no: String(newNoteNumber),
        items: [],
        updated_by: userData?.user_id,
      }
    };

    Object.entries(newlyDeliveredQuantities).forEach(([itemId, newlyDeliveredStr]) => {
      const newlyDeliveredQty = parseNumber(newlyDeliveredStr);
      if (newlyDeliveredQty <= 0) return; // Don't log entries with no new delivery

      const originalItem = originalOrder.find(item => item.name === itemId);
      if (!originalItem) return;

      const alreadyDelivered = originalItem.received_quantity ?? 0;
      const newTotal = alreadyDelivered + newlyDeliveredQty;



      deliveryData[deliveryDate].items.push({
        item_id: itemId,
        item_name: originalItem.item_name,
        unit: originalItem.unit,
        from: alreadyDelivered, // The quantity before this update
        to: newTotal,           // The new total quantity
      });
    });

    return deliveryData;
  }, [newlyDeliveredQuantities, originalOrder, userData, deliveryDate, data]);

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

      const alreadyDelivered = originalItem.received_quantity ?? 0;
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
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between border-b gap-2">
          <CardTitle className="text-xl font-semibold text-red-600">Item List</CardTitle>
          {/* {data?.status !== "Delivered" && ( */}
          {showEdit ? (
            <div className="flex flex-wrap gap-2 items-center">
              {/* <CustomAttachment maxFileSize={20 * 1024 * 1024} selectedFile={selectedAttachment} onFileSelect={setSelectedAttachment} label="Attach DC" className="w-auto" /> */}
              <div className="flex gap-2">
                <Button onClick={() => setProceedDialog(true)} disabled={!hasChanges} size="sm" className="gap-1"><ListChecks className="h-4 w-4" /> Update</Button>
                <Button onClick={() => setShowEdit(false)} variant="secondary" size="sm" className="gap-1"><X className="h-4 w-4" /> Cancel</Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setShowEdit(true)} className="gap-1"><Pencil className="h-4 w-4" /> Record New Updates</Button>
          )}
          {/* )} */}
        </CardHeader>
        <CardContent>
          <div className="overflow-auto hidden sm:block">
            <Table>
              <TableHeader className="bg-red-100">
                <TableRow>
                  <TableHead className="w-[40%] min-w-[200px]">Item Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Quantity Ordered</TableHead>
                  {/* --- (Indicator) MODIFIED HEADERS: Dynamically change based on edit mode --- */}
                  {showEdit ? (
                    <>
                      <TableHead>Quantity Received Previously</TableHead>
                      <TableHead>Quantity Newly Delivered</TableHead>
                    </>
                  ) : (
                    <TableHead>Total Received</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {originalOrder.map((item) => {
                  const alreadyDelivered = item.received_quantity ?? 0;
                  const isFullyDelivered = alreadyDelivered >= item.quantity;
                  const remainingQuantity = item.quantity - alreadyDelivered;
                  const maxInput = Math.max(0, remainingQuantity);


                  return (
                    <TableRow key={item.name}>
                      <TableCell>
                        <div className="inline items-baseline">
                          <p>{item.item_name}</p>
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
                              min={0.00}
                              max={maxInput}
                              disabled={isFullyDelivered}


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
          {/* --- (Indicator) NEW MOBILE CARD-WITH-TABLE VIEW --- */}
          <div className="block sm:hidden">
            <div className="divide-y">
              {originalOrder.map(item => {
                const alreadyDelivered = item.received_quantity ?? 0;
                const isFullyDelivered = alreadyDelivered >= item.quantity;
                const remainingQuantity = item.quantity - alreadyDelivered;
                const maxInput = Math.max(0, remainingQuantity);

                return (
                  <div key={`mobile-card-${item.name}`} className="p-4">
                    {/* Item Name and Unit */}
                    <div className="mb-3">
                      <p className="font-semibold text-gray-800">{item.item_name}</p>
                      <p className="text-sm text-gray-500">Unit: {item.unit}</p>
                    </div>

                    {/* --- Inner Table for Quantities --- */}
                    <Table className="text-sm">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-8 px-2">Qty Ordered</TableHead>
                          {showEdit ? (
                            <>
                              <TableHead className="h-8 px-2">Qty Already Received</TableHead>
                              <TableHead className="h-8 px-2 text-center">Qty Newly Received</TableHead>
                            </>
                          ) : (
                            <TableHead className="h-8 px-2">Total Received</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="px-2 py-2 font-medium">{item.quantity}</TableCell>

                          {showEdit ? (
                            <>
                              <TableCell className="px-2 py-2">
                                <div className="flex items-center gap-1">
                                  {isFullyDelivered ? (<Check className="h-5 w-5 text-green-500" />)
                                    : alreadyDelivered > 0 ? (<ArrowDown className="text-primary" />) : null}
                                  <span>{alreadyDelivered}</span>
                                </div>
                              </TableCell>
                              <TableCell className="px-2 py-2 text-center">
                                {/* {!isFullyDelivered ? (
                                  <Input
                                    type="number"
                                    value={newlyDeliveredQuantities[item.name] ?? ''}
                                    onChange={(e) => handleNewlyDeliveredChange(item, e.target.value)}
                                    placeholder="0"
                                    className="w-full h-9 p-1 text-center"
                                    min={0}
                                  />
                                ) : (
                                  <Check className="h-5 w-5 mx-auto text-green-600" />
                                )} */}
                                <Input
                                  type="number"
                                  step="any"
                                  value={newlyDeliveredQuantities[item.name] ?? ''}
                                  onChange={(e) => handleNewlyDeliveredChange(item, e.target.value)}
                                  placeholder="0"
                                  className="w-full h-9 p-1 text-center"
                                  min={0}
                                  max={maxInput}
                                  disabled={isFullyDelivered}
                                />
                              </TableCell>
                            </>
                          ) : (
                            <TableCell className="px-2 py-2">
                              <div className="flex items-center gap-1">
                                {isFullyDelivered ? (<Check className="h-5 w-5 text-green-500" />)
                                  : alreadyDelivered > 0 ? (<ArrowDown className="text-primary" />) : null}
                                <span>{alreadyDelivered}</span>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      </TableBody>
                    </Table>

                    {/* Comment section if available */}
                    {item.comment && (
                      <div className="mt-2 flex items-start gap-2 text-xs text-gray-600 border-t pt-2">
                        <MessageCircleMore className="h-4 w-4 flex-shrink-0 mt-0.5 text-blue-500" />
                        <p className="italic">{item.comment}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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