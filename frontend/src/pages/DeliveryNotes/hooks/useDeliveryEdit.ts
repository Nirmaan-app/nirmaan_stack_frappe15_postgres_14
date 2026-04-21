import { useCallback, useMemo, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { DNColumn, PivotRow } from "../components/pivot-table/types";
import { parseNumber } from "@/utils/parseNumber";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";
import { isCreatedToday } from "@/utils/FormatDate";

const ALWAYS_EDIT_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Project Lead Profile",
  "Nirmaan Procurement Executive Profile",
];

interface UseDeliveryEditOptions {
  onSuccess?: () => void;
  onDnRefetch?: () => void;
}

export interface UseDeliveryEditReturn {
  editingDnName: string | null;
  editedQuantities: Record<string, string>;
  isEditSubmitting: boolean;
  initEdit: (dnCol: DNColumn, rows: PivotRow[]) => void;
  cancelEdit: () => void;
  handleEditQuantityChange: (
    itemItemId: string,
    value: string,
    maxAllowed: number
  ) => void;
  submitEdit: () => Promise<void>;
  canEditDn: (col: DNColumn) => boolean;
  hasEditChanges: boolean;
}

export function useDeliveryEdit({
  onSuccess,
  onDnRefetch,
}: UseDeliveryEditOptions): UseDeliveryEditReturn {
  const userData = useUserData();
  const { toast } = useToast();

  // State
  const [editingDnName, setEditingDnName] = useState<string | null>(null);
  const [editedQuantities, setEditedQuantities] = useState<
    Record<string, string>
  >({});

  // Store the initial quantities to detect changes
  const initialQuantitiesRef = useRef<Record<string, string>>({});

  // API hook
  const { call: editDNCall, loading: editLoading } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.edit_delivery_note.edit_delivery_note"
  );

  const isEditSubmitting = editLoading;

  const canEditDn = useCallback(
    (col: DNColumn): boolean => {
      if (col.isReturn) return false;

      const role = userData?.role;
      if (!role || role === "Loading" || role === "Error") return false;

      if (
        userData.user_id === "Administrator" ||
        ALWAYS_EDIT_ROLES.includes(role)
      ) {
        return true;
      }

      if (role === "Nirmaan Project Manager Profile") {
        return (
          col.updatedBy === userData.user_id &&
          isCreatedToday(col.creationDate)
        );
      }

      return false;
    },
    [userData?.role, userData?.user_id]
  );

  const initEdit = useCallback(
    (dnCol: DNColumn, rows: PivotRow[]) => {
      setEditingDnName(dnCol.dnName);

      const initial: Record<string, string> = {};
      for (const row of rows) {
        if (row.isOrphaned) continue;
        const qty = row.dnQuantities[dnCol.dnName];
        if (qty != null) {
          initial[row.itemItemId] = String(qty);
        }
      }
      setEditedQuantities(initial);
      initialQuantitiesRef.current = { ...initial };
    },
    []
  );

  const cancelEdit = useCallback(() => {
    setEditingDnName(null);
    setEditedQuantities({});
    initialQuantitiesRef.current = {};
  }, []);

  const handleEditQuantityChange = useCallback(
    (
      itemItemId: string,
      value: string,
      _maxAllowed: number
    ) => {
      // Handle clearing input
      if (value === "") {
        setEditedQuantities((prev) => {
          const updated = { ...prev };
          delete updated[itemItemId];
          return updated;
        });
        return;
      }

      // Validate input format — only numbers and single decimal point
      if (!/^[0-9]*\.?[0-9]*$/.test(value)) return;

      setEditedQuantities((prev) => ({
        ...prev,
        [itemItemId]: value,
      }));
    },
    []
  );

  const hasEditChanges = useMemo(() => {
    const initial = initialQuantitiesRef.current;
    const currentKeys = Object.keys(editedQuantities);
    const initialKeys = Object.keys(initial);

    // Check if any key was removed (cleared)
    if (currentKeys.length !== initialKeys.length) {
      // If a key was removed and its initial value was > 0, that's a change
      for (const key of initialKeys) {
        if (!(key in editedQuantities) && parseNumber(initial[key]) > 0) {
          return true;
        }
      }
      // If a key was added
      for (const key of currentKeys) {
        if (!(key in initial) && parseNumber(editedQuantities[key]) > 0) {
          return true;
        }
      }
    }

    // Check if any value differs
    for (const key of currentKeys) {
      const currentVal = parseNumber(editedQuantities[key]);
      const initialVal = parseNumber(initial[key]);
      if (currentVal !== initialVal) return true;
    }

    return false;
  }, [editedQuantities]);

  const submitEdit = useCallback(async () => {
    if (!editingDnName) return;

    // Build modified_items: keyed by item_id (Item doctype ID)
    const modifiedItems: Record<string, number> = {};

    for (const [itemItemId, qtyStr] of Object.entries(editedQuantities)) {
      const qty = parseNumber(qtyStr);
      // Include all items that were in the original DN, even if unchanged,
      // but we only send items that the user has in the form
      modifiedItems[itemItemId] = qty;
    }

    // Also mark items that were in the initial set but removed (cleared) as 0
    for (const itemItemId of Object.keys(initialQuantitiesRef.current)) {
      if (!(itemItemId in modifiedItems)) {
        modifiedItems[itemItemId] = 0;
      }
    }

    if (Object.keys(modifiedItems).length === 0) {
      toast({
        title: "No Changes",
        description: "No quantities were modified.",
      });
      return;
    }

    try {
      const response = await editDNCall({
        dn_name: editingDnName,
        modified_items: modifiedItems,
      });

      if (response.message.status === 200) {
        onSuccess?.();
        onDnRefetch?.();
        invalidateSidebarCounts();
        cancelEdit();
        toast({
          title: "Success!",
          description: response.message.message,
          variant: "success",
        });
      } else {
        toast({
          title: "Failed!",
          description: response.message.error || "Unexpected error",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error editing delivery note:", error);
      toast({
        title: "Edit Failed",
        description: "Failed to update delivery note",
        variant: "destructive",
      });
    }
  }, [
    editingDnName,
    editedQuantities,
    editDNCall,
    onSuccess,
    onDnRefetch,
    cancelEdit,
    toast,
  ]);

  return {
    editingDnName,
    editedQuantities,
    isEditSubmitting,
    initEdit,
    cancelEdit,
    handleEditQuantityChange,
    submitEdit,
    canEditDn,
    hasEditChanges,
  };
}
