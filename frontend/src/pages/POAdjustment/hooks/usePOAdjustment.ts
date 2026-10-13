import { useState, useCallback, useMemo } from "react";
import { useSWRConfig } from "swr";
import { toast } from "@/components/ui/use-toast";
import {
  useExecuteAdjustment,
  useRecordWaitingRefund,
} from "../data/usePOAdjustmentMutations";
import { creditOnOffer } from "../adjustmentOffer";
import { poRevisionKeys } from "@/pages/PORevision/data/poRevision.constants";
import { vendorRefundsKey } from "@/components/vendor-refunds/useVendorRefunds";
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
  // "Vendor Refund" records a waiting Vendor Refund instead (#1400, ADR-0032)
  const { record, loading: recordLoading } = useRecordWaitingRefund();
  const { mutate: globalMutate } = useSWRConfig();

  // Combined loading state for the UI "Processing..." spinner
  const executing = fileUploadLoading || executeLoading || recordLoading;

  const remainingImpact = adjustment?.remaining_impact ?? 0;
  const isNegative = remainingImpact < 0;
  const absImpact = Math.abs(remainingImpact);
  // What may be resolved: the credit not capped away or held by a waiting refund.
  const offered = creditOnOffer(remainingImpact, adjustment?.usable_credit);
  const heldCredit = adjustment?.held_credit ?? 0;
  const waitingRefunds = adjustment?.waiting_refunds ?? [];

  const totalAllocated = useMemo(
    () => refundAdjustments.reduce((sum, a) => sum + (a.amount || 0), 0),
    [refundAdjustments]
  );

  const remainingToAdjust = useMemo(
    () => Math.max(0, offered - totalAllocated),
    [offered, totalAllocated]
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
       * A vendor refund is not an adjustment: it is recorded as a waiting Vendor Refund.
       */
      const refunds = adjustmentsWithUrls.filter((adj) => adj.type === "Refunded");
      const entries = adjustmentsWithUrls
        .filter((adj) => adj.type !== "Refunded")
        .map((adj) =>
          adj.type === "Another PO"
            ? {
                return_type: "Against-po" as const,
                amount: adj.amount,
                target_pos: [{ po_number: adj.po_id!, amount: adj.amount }],
              }
            : {
                return_type: "Ad-hoc" as const,
                amount: adj.amount,
                "ad-hoc_type": adj.adhoc_type,
                "ad-hoc_description": adj.description,
                comment: adj.comment,
              }
        );

      /**
       * STEP 3: Submit the final data to the backend.
       */
      if (entries.length > 0) await execute(poId, entries);
      const recorded: string[] = [];
      for (const refund of refunds) {
        const res = await record(poId, {
          amount: refund.amount,
          payment_date: refund.date,
          utr: refund.transaction_ref,
          refund_attachment: refund.refund_attachment,
        });
        if (res?.refund) recorded.push(res.refund);
      }

      toast(
        recorded.length > 0
          ? {
              title: "Waiting refund recorded",
              description: `${recorded.join(", ")} waits for its bank line. It counts once accounts match it; until then the PO stays locked.`,
            }
          : {
              title: "Adjustment applied",
              description: "Payment adjustment has been processed successfully.",
            }
      );
      if (recorded.length > 0) {
        await Promise.all([
          globalMutate(poRevisionKeys.lockCheck(poId)),
          globalMutate(vendorRefundsKey({ documentType: "Procurement Orders", documentName: poId })),
        ]);
      }
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
  }, [poId, refundAdjustments, upload, execute, record, globalMutate, mutate, resetForm, onSuccess]);

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
    offered,
    heldCredit,
    waitingRefunds,
    isNegative,
    totalAllocated,
    remainingToAdjust,
    isPOSelected,
    candidatePOs,
    candidatesLoading,
    executing,
  };
}
