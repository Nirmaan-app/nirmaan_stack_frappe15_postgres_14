import { useCallback, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { parseNumber } from "@/utils/parseNumber";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";
import { ADDITIONAL_CHARGES_CATEGORY } from "../components/pivot-table/types";

const NUMERIC_INPUT_PATTERN = /^[0-9]*\.?[0-9]*$/;

interface UseReturnSubmitProps {
  poId: string;
  poItems: any[];
  onSuccess?: () => void;
  onDnRefetch?: () => void;
}

interface UseReturnSubmitReturn {
  returnQuantities: Record<string, string>;
  returnDate: string;
  setReturnDate: (date: string) => void;
  isSubmitting: boolean;
  hasChanges: boolean;
  handleReturnQuantityChange: (
    itemKey: string,
    value: string,
    maxAllowed: number
  ) => void;
  handleSubmit: () => Promise<void>;
  resetForm: () => void;
}

export function useReturnSubmit({
  poId,
  poItems,
  onSuccess,
  onDnRefetch,
}: UseReturnSubmitProps): UseReturnSubmitReturn {
  const userData = useUserData();
  const { toast } = useToast();

  // State
  const [returnQuantities, setReturnQuantities] = useState<
    Record<string, string>
  >({});
  const [returnDate, setReturnDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );

  // API hook
  const { call: updateDNCall, loading: updateLoading } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.update_delivery_note.update_delivery_note"
  );

  const isSubmitting = updateLoading;

  const hasChanges = useMemo(
    () =>
      Object.values(returnQuantities).some((val) => parseNumber(val) > 0),
    [returnQuantities]
  );

  const handleReturnQuantityChange = useCallback(
    (itemKey: string, value: string, maxAllowed: number) => {
      // Handle clearing input
      if (value === "") {
        setReturnQuantities((prev) => {
          const updated = { ...prev };
          delete updated[itemKey];
          return updated;
        });
        return;
      }

      // Validate input format — only numbers and single decimal point
      if (!NUMERIC_INPUT_PATTERN.test(value)) return;

      const numericValue = parseFloat(value);
      if (numericValue < 0) {
        setReturnQuantities((prev) => ({ ...prev, [itemKey]: "0" }));
        return;
      }

      const finalValue =
        numericValue > maxAllowed ? String(maxAllowed) : value;

      setReturnQuantities((prev) => ({
        ...prev,
        [itemKey]: finalValue,
      }));
    },
    []
  );

  const resetForm = useCallback(() => {
    setReturnQuantities({});
    setReturnDate(new Date().toISOString().split("T")[0]);
  }, []);

  const handleSubmit = useCallback(async () => {
    // 1. Build modified_items payload (received_quantity - returnQty)
    const modifiedItems: Record<string, number> = {};
    let hasInvalid = false;

    Object.entries(returnQuantities).forEach(([itemKey, returnStr]) => {
      const returnQty = parseNumber(returnStr);
      if (returnQty < 0) {
        toast({
          title: "Invalid Quantity",
          description: "Cannot return a negative quantity.",
          variant: "destructive",
        });
        hasInvalid = true;
        return;
      }
      if (returnQty === 0) return;

      const originalItem = poItems.find((item) => item.name === itemKey);
      if (!originalItem) return;
      if (originalItem.category === ADDITIONAL_CHARGES_CATEGORY) return;

      const alreadyDelivered = originalItem.received_quantity ?? 0;
      modifiedItems[itemKey] = alreadyDelivered - returnQty;
    });

    if (hasInvalid) return;
    if (Object.keys(modifiedItems).length === 0) {
      toast({
        title: "No Changes",
        description: "Please enter a return quantity for at least one item.",
      });
      return;
    }

    try {
      // 2. Build delivery_data with date and user info
      const deliveryData = {
        [returnDate]: {
          updated_by: userData?.user_id || "",
        },
      };

      // 3. Call API with is_return flag
      const response = await updateDNCall({
        po_id: poId,
        modified_items: modifiedItems,
        delivery_data: deliveryData,
        is_return: true,
      });

      if (response.message.status === 200) {
        onSuccess?.();
        onDnRefetch?.();
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
      console.error("Error submitting return note:", error);
      toast({
        title: "Return Failed",
        description: "Failed to submit return note",
        variant: "destructive",
      });
    }
  }, [
    poId,
    poItems,
    returnQuantities,
    returnDate,
    userData?.user_id,
    updateDNCall,
    onSuccess,
    onDnRefetch,
    resetForm,
    toast,
  ]);

  return {
    returnQuantities,
    returnDate,
    setReturnDate,
    isSubmitting,
    hasChanges,
    handleReturnQuantityChange,
    handleSubmit,
    resetForm,
  };
}
