import { useState, useCallback, useMemo } from "react";
import { toast } from "@/components/ui/use-toast";
import { useExecuteAdjustment } from "../data/usePOAdjustmentMutations";
import {
  usePOAdjustment,
  useAdjustmentCandidatePOs,
} from "../data/usePOAdjustmentQueries";
import { useFrappeFileUpload } from "frappe-react-sdk";
import type {
  RefundAdjustment,
  AdjustmentMethodType,
} from "@/pages/PORevision/types";

export type { AdjustmentMethodType };

export function usePOAdjustmentDialog(
  poId: string | undefined,
  vendor: string | undefined,
  isOpen = false,
  onSuccess?: () => void
) {
  const [adjustmentMethod, setAdjustmentMethod] =
    useState<AdjustmentMethodType>("Another PO");
  const [refundAdjustments, setRefundAdjustments] = useState<
    RefundAdjustment[]
  >([]);

  const { adjustment, isLoading, mutate } = usePOAdjustment(poId);
  const { candidatePOs, isLoading: candidatesLoading } =
    useAdjustmentCandidatePOs(vendor, poId, isOpen);

  // Hook for uploading physical files to Frappe
  const { upload, loading: fileUploadLoading } = useFrappeFileUpload();

  // Hook for executing the final PO adjustment logic
  const { execute, loading: executeLoading } = useExecuteAdjustment();

  // Combined loading state for the UI "Processing..." spinner
  const executing = fileUploadLoading || executeLoading;

  const remainingImpact = adjustment?.remaining_impact ?? 0;
  const isNegative = remainingImpact < 0;
  const absImpact = Math.abs(remainingImpact);

  const totalAllocated = useMemo(
    () => refundAdjustments.reduce((sum, a) => sum + (a.amount || 0), 0),
    [refundAdjustments]
  );

  const remainingToAdjust = useMemo(
    () => Math.max(0, absImpact - totalAllocated),
    [absImpact, totalAllocated]
  );

  const isPOSelected = refundAdjustments.some((a) => a.type === "Another PO");

  const addAdjustment = useCallback(
    (type: AdjustmentMethodType) => {
      if (type === "Another PO") {
        setAdjustmentMethod("Another PO");
      } else {
        const id = Math.random().toString();
        setRefundAdjustments((prev) => [
          ...prev,
          {
            id,
            type,
            amount: 0,
            adhoc_type: type === "Adhoc" ? "" : undefined,
            description:
              type === "Adhoc" ? `${poId} and ad-hoc : ` : undefined,
            date:
              type === "Refunded"
                ? new Date().toISOString().split("T")[0]
                : undefined,
          },
        ]);
      }
    },
    [absImpact, poId]
  );

  const removeAdjustment = useCallback((id: string) => {
    setRefundAdjustments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const updateAdjustment = useCallback(
    (id: string, updates: Partial<RefundAdjustment>) => {
      setRefundAdjustments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
      );
    },
    []
  );

  const resetForm = useCallback(() => {
    setAdjustmentMethod("Another PO");
    setRefundAdjustments([]);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!poId || refundAdjustments.length === 0) return;

    try {
      /**
       * STEP 1: Upload physical files first.
       * We iterate through the adjustments and upload any 'refund_attachment_file'
       * objects we find. This gives us the URL we need for the next step.
       */
      const adjustmentsWithUrls = await Promise.all(
        refundAdjustments.map(async (adj) => {
          if (adj.type === "Refunded" && adj.refund_attachment_file) {
            // This sends the file to Frappe's file system
            const uploadRes = await upload(adj.refund_attachment_file, {
              isPrivate: true,
            });
            // Update the record with the new URL returned from the server
            return { ...adj, refund_attachment: uploadRes.file_url };
          }
          return adj;
        })
      );

      /**
       * STEP 2: Map the adjustments into the format the Backend API expects.
       * We use the URLs obtained in Step 1 for any attachments.
       */
      const entries = adjustmentsWithUrls.map((adj) => {
        if (adj.type === "Another PO") {
          return {
            return_type: "Against-po" as const,
            amount: adj.amount,
            target_pos: [{ po_number: adj.po_id!, amount: adj.amount }],
          };
        }
        if (adj.type === "Adhoc") {
          return {
            return_type: "Ad-hoc" as const,
            amount: adj.amount,
            "ad-hoc_type": adj.adhoc_type,
            "ad-hoc_description": adj.description,
            comment: adj.comment,
          };
        }
        // Refunded (Vendor Refund)
        return {
          return_type: "Vendor-has-refund" as const,
          amount: adj.amount,
          refund_date: adj.date,
          refund_attachment: adj.refund_attachment, // This now contains a valid URL!
          utr: adj.transaction_ref,
        };
      });

      /**
       * STEP 3: Submit the final data to the backend.
       */
      await execute(poId, entries as Parameters<typeof execute>[1]);

      toast({
        title: "Adjustment applied",
        description: "Payment adjustment has been processed successfully.",
      });
      mutate();
      resetForm();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      toast({
        title: "Adjustment failed",
        description:
          err instanceof Error ? err.message : "An error occurred",
        variant: "destructive",
      });
    }
  }, [poId, refundAdjustments, execute, mutate, resetForm]);

  return {
    adjustmentMethod,
    setAdjustmentMethod,
    refundAdjustments,
    setRefundAdjustments,
    addAdjustment,
    removeAdjustment,
    updateAdjustment,
    resetForm,
    handleSubmit,
    adjustment,
    isLoading,
    remainingImpact,
    absImpact,
    isNegative,
    totalAllocated,
    remainingToAdjust,
    isPOSelected,
    candidatePOs,
    candidatesLoading,
    executing,
  };
}
