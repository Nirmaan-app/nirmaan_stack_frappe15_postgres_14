import { useState, useCallback } from "react";
import { useFrappeDeleteDoc } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";

export interface ITMDNDeleteTarget {
  dnName: string;
}

interface UseITMDeliveryDeleteProps {
  onSuccess?: () => void;
  onRefresh?: () => void;
}

// Pull the user-facing message out of a Frappe error response. Server-side
// `frappe.throw(...)` messages arrive in `_server_messages` (JSON-encoded
// list of stringified payloads). Fall back to standard fields.
function extractFrappeErrorMessage(error: unknown): string {
  const err = error as { _server_messages?: string; message?: string; exception?: string };
  if (err?._server_messages) {
    try {
      const messages = JSON.parse(err._server_messages);
      if (Array.isArray(messages) && messages.length > 0) {
        const first = typeof messages[0] === "string" ? JSON.parse(messages[0]) : messages[0];
        if (first?.message) return String(first.message);
      }
    } catch {
      /* fall through */
    }
  }
  return err?.message || err?.exception || "Failed to delete delivery note";
}

export function useITMDeliveryDelete({
  onSuccess,
  onRefresh,
}: UseITMDeliveryDeleteProps) {
  const { deleteDoc, isPending: isDeleting } = useFrappeDeleteDoc();
  const { toast } = useToast();

  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState(false);
  const [dnToDelete, setDnToDelete] = useState<ITMDNDeleteTarget | null>(null);

  const handleDeleteClick = useCallback((target: ITMDNDeleteTarget) => {
    setDnToDelete(target);
    setDeleteConfirmDialog(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!dnToDelete) return;
    try {
      await deleteDoc("Delivery Notes", dnToDelete.dnName);
      setDeleteConfirmDialog(false);
      setDnToDelete(null);
      if (onRefresh) onRefresh();
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error("Failed to delete ITM DN", error);
      toast({
        title: "Delete Failed",
        description: extractFrappeErrorMessage(error),
        variant: "destructive",
      });
    }
  }, [dnToDelete, deleteDoc, onRefresh, onSuccess, toast]);

  return {
    isDeleting,
    deleteConfirmDialog,
    setDeleteConfirmDialog,
    dnToDelete,
    setDnToDelete,
    handleDeleteClick,
    handleConfirmDelete,
  };
}
