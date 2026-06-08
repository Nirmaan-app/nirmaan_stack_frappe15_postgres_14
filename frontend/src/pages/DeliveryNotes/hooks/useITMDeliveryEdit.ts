import { useCallback, useMemo, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { isCreatedToday } from "@/utils/FormatDate";
import { parseNumber } from "@/utils/parseNumber";

const ALWAYS_EDIT_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Project Lead Profile",
  "Nirmaan Procurement Executive Profile",
];

// ITM DNs aggregate by (item_id, make) — the row key encodes both so two ITM
// rows with the same item in different makes don't collide. Format must stay
// in sync with the `rowKey` helper in the ITM pivot components.
const splitRowKey = (rowKey: string): { itemId: string; make: string | null } => {
  const idx = rowKey.indexOf("|");
  if (idx === -1) return { itemId: rowKey, make: null };
  const itemId = rowKey.slice(0, idx);
  const make = rowKey.slice(idx + 1);
  return { itemId, make: make === "" ? null : make };
};

export interface ITMDNColumn {
  dnName: string;
  /** User who last updated the DN — for the same-day PM check. */
  updatedBy?: string | null;
  /** Frappe `creation` timestamp — for the same-day check. */
  creationDate?: string;
}

interface UseITMDeliveryEditOptions {
  onSuccess?: () => void;
  onDnRefetch?: () => void;
}

export interface UseITMDeliveryEditReturn {
  editingDnName: string | null;
  editedQuantities: Record<string, string>;
  isEditSubmitting: boolean;
  initEdit: (
    dn: ITMDNColumn,
    initialQuantitiesByRowKey: Record<string, number>
  ) => void;
  cancelEdit: () => void;
  handleEditQuantityChange: (rowKey: string, value: string) => void;
  submitEdit: () => Promise<void>;
  canEditDn: (col: ITMDNColumn) => boolean;
  hasEditChanges: boolean;
}

export function useITMDeliveryEdit({
  onSuccess,
  onDnRefetch,
}: UseITMDeliveryEditOptions): UseITMDeliveryEditReturn {
  const userData = useUserData();
  const { toast } = useToast();

  const [editingDnName, setEditingDnName] = useState<string | null>(null);
  const [editedQuantities, setEditedQuantities] = useState<
    Record<string, string>
  >({});
  const initialQuantitiesRef = useRef<Record<string, string>>({});

  const { call: editDNCall, loading: editLoading } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.edit_itm_delivery_note.edit_itm_delivery_note"
  );

  const isEditSubmitting = editLoading;

  const canEditDn = useCallback(
    (col: ITMDNColumn): boolean => {
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
    (
      dn: ITMDNColumn,
      initialQuantitiesByRowKey: Record<string, number>
    ) => {
      setEditingDnName(dn.dnName);

      const initial: Record<string, string> = {};
      for (const [rowKey, qty] of Object.entries(initialQuantitiesByRowKey)) {
        if (qty != null && qty > 0) {
          initial[rowKey] = String(qty);
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
    (rowKey: string, value: string) => {
      if (value === "") {
        setEditedQuantities((prev) => {
          const updated = { ...prev };
          delete updated[rowKey];
          return updated;
        });
        return;
      }

      if (!/^[0-9]*\.?[0-9]*$/.test(value)) return;

      setEditedQuantities((prev) => ({ ...prev, [rowKey]: value }));
    },
    []
  );

  const hasEditChanges = useMemo(() => {
    const initial = initialQuantitiesRef.current;
    const currentKeys = new Set(Object.keys(editedQuantities));
    const initialKeys = new Set(Object.keys(initial));

    for (const k of initialKeys) {
      if (!currentKeys.has(k) && parseNumber(initial[k]) > 0) return true;
    }
    for (const k of currentKeys) {
      if (parseNumber(editedQuantities[k]) !== parseNumber(initial[k])) return true;
    }
    return false;
  }, [editedQuantities]);

  const submitEdit = useCallback(async () => {
    if (!editingDnName) return;

    // Build the payload as [{item_id, make, delivered_quantity}, ...] using
    // the composite row keys. Items present in the initial set but cleared
    // are sent with qty=0 so the backend removes them.
    const payloadMap: Record<string, number> = {};
    for (const [rowKey, qtyStr] of Object.entries(editedQuantities)) {
      payloadMap[rowKey] = parseNumber(qtyStr);
    }
    for (const rowKey of Object.keys(initialQuantitiesRef.current)) {
      if (!(rowKey in payloadMap)) {
        payloadMap[rowKey] = 0;
      }
    }

    const modifiedItems = Object.entries(payloadMap).map(([rowKey, qty]) => {
      const { itemId, make } = splitRowKey(rowKey);
      return { item_id: itemId, make, delivered_quantity: qty };
    });

    if (modifiedItems.length === 0) {
      toast({
        title: "No Changes",
        description: "No quantities were modified.",
      });
      return;
    }

    try {
      const response = await editDNCall({
        dn_name: editingDnName,
        modified_items: JSON.stringify(modifiedItems),
      });

      if (response.message.status === 200) {
        onSuccess?.();
        onDnRefetch?.();
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
      console.error("Error editing ITM delivery note:", error);
      toast({
        title: "Edit Failed",
        description: "Failed to update delivery note",
        variant: "destructive",
      });
    }
  }, [editingDnName, editedQuantities, editDNCall, onSuccess, onDnRefetch, cancelEdit, toast]);

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
