import { useState, useCallback } from "react";
import { useFrappeDeleteDoc } from "frappe-react-sdk";
import { DNColumn } from "../components/pivot-table/types";

interface UseDeliveryDeleteProps {
  onSuccess?: () => void;
  onRefresh?: () => void;
}

export function useDeliveryDelete({ onSuccess, onRefresh }: UseDeliveryDeleteProps) {
  const { deleteDoc, isPending: isDeleting } = useFrappeDeleteDoc();

  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState(false);
  const [dnToDelete, setDnToDelete] = useState<DNColumn | null>(null);

  const handleDeleteClick = useCallback((col: DNColumn) => {
    setDnToDelete(col);
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
      console.error("Failed to delete DN", error);
    }
  }, [dnToDelete, deleteDoc, onRefresh, onSuccess]);

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
