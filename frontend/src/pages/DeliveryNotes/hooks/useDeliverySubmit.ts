import { useCallback, useMemo, useState } from "react";
import { useFrappeFileUpload, useFrappePostCall, useSWRConfig } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import {
  DeliveryDataType,
  ProcurementOrder,
} from "@/types/NirmaanStack/ProcurementOrders";
import { parseNumber } from "@/utils/parseNumber";
import { safeJsonParse } from "../constants";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";
import { ADDITIONAL_CHARGES_CATEGORY } from "../components/pivot-table/types";

interface UseDeliverySubmitOptions {
  po: ProcurementOrder;
  onSuccess?: () => void;
  onDnRefetch?: () => void;
}

interface UseDeliverySubmitReturn {
  newlyDeliveredQuantities: Record<string, string>;
  deliveryDate: string;
  setDeliveryDate: (date: string) => void;
  selectedAttachment: File | null;
  setSelectedAttachment: (file: File | null) => void;
  isSubmitting: boolean;
  hasChanges: boolean;
  handleNewlyDeliveredChange: (
    itemId: string,
    value: string,
    maxAllowed: number
  ) => void;
  handleSubmit: () => Promise<void>;
  resetForm: () => void;
}

export function useDeliverySubmit({
  po,
  onSuccess,
  onDnRefetch,
}: UseDeliverySubmitOptions): UseDeliverySubmitReturn {
  const userData = useUserData();
  const { toast } = useToast();
  const { mutate: globalMutate } = useSWRConfig();

  // State
  const [newlyDeliveredQuantities, setNewlyDeliveredQuantities] = useState<
    Record<string, string>
  >({});
  const [deliveryDate, setDeliveryDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(
    null
  );

  // API hooks
  const { call: updateDNCall, loading: updateLoading } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.update_delivery_note.update_delivery_note"
  );
  const { upload, loading: uploadLoading } = useFrappeFileUpload();

  const isSubmitting = updateLoading || uploadLoading;

  const hasChanges = useMemo(
    () =>
      Object.values(newlyDeliveredQuantities).some(
        (val) => parseNumber(val) > 0
      ) || selectedAttachment !== null,
    [newlyDeliveredQuantities, selectedAttachment]
  );

  const handleNewlyDeliveredChange = useCallback(
    (itemId: string, value: string, _maxAllowed: number) => {
      // Handle clearing input
      if (value === "") {
        setNewlyDeliveredQuantities((prev) => {
          const updated = { ...prev };
          delete updated[itemId];
          return updated;
        });
        return;
      }

      // Validate input format — only numbers and single decimal point
      if (!/^[0-9]*\.?[0-9]*$/.test(value)) return;

      setNewlyDeliveredQuantities((prev) => ({
        ...prev,
        [itemId]: value,
      }));
    },
    []
  );

  const resetForm = useCallback(() => {
    setNewlyDeliveredQuantities({});
    setSelectedAttachment(null);
    setDeliveryDate(new Date().toISOString().split("T")[0]);
  }, []);

  const handleSubmit = useCallback(async () => {
    // 1. Build modified_items payload (cumulative totals)
    const modifiedItems: Record<string, number> = {};
    let hasInvalid = false;

    Object.entries(newlyDeliveredQuantities).forEach(
      ([itemId, newlyDeliveredStr]) => {
        const newlyDeliveredQty = parseNumber(newlyDeliveredStr);
        if (newlyDeliveredQty < 0) {
          toast({
            title: "Invalid Quantity",
            description: `Cannot deliver a negative quantity.`,
            variant: "destructive",
          });
          hasInvalid = true;
          return;
        }
        if (newlyDeliveredQty === 0) return;

        const originalItem = po.items.find((item) => item.name === itemId);
        if (!originalItem) return;
        if (originalItem.category === ADDITIONAL_CHARGES_CATEGORY) return;

        const alreadyDelivered = originalItem.received_quantity ?? 0;
        modifiedItems[itemId] = alreadyDelivered + newlyDeliveredQty;
      }
    );

    if (hasInvalid) return;
    if (Object.keys(modifiedItems).length === 0 && !selectedAttachment) {
      toast({
        title: "No Changes",
        description:
          "Please enter a delivery quantity or attach a challan.",
      });
      return;
    }

    try {
      // 2. Upload attachment if selected
      let attachmentId: string | null = null;
      if (selectedAttachment) {
        try {
          const result = await upload(selectedAttachment, {
            doctype: "Procurement Orders",
            docname: po.name,
            fieldname: "attachment",
            isPrivate: true,
          });
          attachmentId = result.file_url;
        } catch {
          toast({
            title: "Upload Failed",
            description: "Failed to upload delivery challan",
            variant: "destructive",
          });
          return;
        }
      }

      // 3. Build legacy delivery_data format
      const parsedDeliveryObject = safeJsonParse(po.delivery_data, {} as Record<string, unknown>);
      const deliveryHistory = (parsedDeliveryObject as Record<string, unknown>)?.data || {};
      const newNoteNumber = Object.keys(deliveryHistory).length + 1;

      const deliveryData: DeliveryDataType = {
        [deliveryDate]: {
          note_no: String(newNoteNumber),
          items: [],
          updated_by: userData?.user_id || "",
        },
      };

      Object.entries(newlyDeliveredQuantities).forEach(
        ([itemId, newlyDeliveredStr]) => {
          const newlyDeliveredQty = parseNumber(newlyDeliveredStr);
          if (newlyDeliveredQty <= 0) return;

          const originalItem = po.items.find((item) => item.name === itemId);
          if (!originalItem) return;

          const alreadyDelivered = originalItem.received_quantity ?? 0;
          deliveryData[deliveryDate].items.push({
            item_id: itemId,
            item_name: originalItem.item_name,
            unit: originalItem.unit,
            from: alreadyDelivered,
            to: alreadyDelivered + newlyDeliveredQty,
          });
        }
      );

      // 4. Call API
      const response = await updateDNCall({
        po_id: po.name,
        modified_items: modifiedItems,
        delivery_data: deliveryData,
        delivery_challan_attachment: attachmentId,
      });

      if (response.message.status === 200) {
        onSuccess?.();
        onDnRefetch?.();
        await globalMutate(`Nirmaan Attachments-${po.name}`);
        invalidateSidebarCounts();
        resetForm();
        toast({
          title: "Success!",
          description: response.message.message,
          variant: "success",
        });
      } else if (response.message.status === 400) {
        toast({
          title: "Failed!",
          description: response.message.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error updating delivery note:", error);
      toast({
        title: "Update Failed",
        description: "Failed to update delivery note",
        variant: "destructive",
      });
    }
  }, [
    po,
    newlyDeliveredQuantities,
    deliveryDate,
    selectedAttachment,
    userData?.user_id,
    updateDNCall,
    upload,
    globalMutate,
    onSuccess,
    onDnRefetch,
    resetForm,
    toast,
  ]);

  return {
    newlyDeliveredQuantities,
    deliveryDate,
    setDeliveryDate,
    selectedAttachment,
    setSelectedAttachment,
    isSubmitting,
    hasChanges,
    handleNewlyDeliveredChange,
    handleSubmit,
    resetForm,
  };
}
