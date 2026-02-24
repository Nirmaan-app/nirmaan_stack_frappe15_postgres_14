import { useCallback, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { toast } from "@/components/ui/use-toast";
import { EligibleItem } from "./useEligibleItems";

export interface FormEntry {
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  dn_quantity: number;
  remaining_quantity: number | null;
}

export function useRemainingItemsForm(
  projectId: string,
  eligibleItems: EligibleItem[],
  existingReport?: { exists: boolean; items?: any[] },
  onSuccess?: () => void
) {
  // Build initial entries: merge eligible items with existing report data if editing
  const initialEntries = useMemo((): FormEntry[] => {
    const existingMap = new Map<string, any>();
    if (existingReport?.exists && existingReport.items) {
      for (const item of existingReport.items) {
        const key = `${item.category}_${item.item_id}`;
        existingMap.set(key, item);
      }
    }

    return eligibleItems.map((item) => {
      const key = `${item.category}_${item.itemId}`;
      const existing = existingMap.get(key);
      return {
        item_id: item.itemId,
        item_name: item.itemName,
        unit: item.unit,
        category: item.category,
        dn_quantity: item.dnQuantity,
        // -1 is the backend sentinel for "not filled" — convert to null for display
        remaining_quantity: existing
          ? (existing.remaining_quantity === -1 ? null : existing.remaining_quantity)
          : null,
      };
    });
  }, [eligibleItems, existingReport?.exists]);

  const [entries, setEntries] = useState<FormEntry[]>(initialEntries);
  const [validationErrors, setValidationErrors] = useState<Map<string, string>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { call: submitReport } = useFrappePostCall(
    "nirmaan_stack.api.remaining_items_report.submit_remaining_items_report"
  );

  const handleQuantityChange = useCallback((index: number, value: string) => {
    setEntries((prev) => {
      const updated = [...prev];
      const entry = { ...updated[index] };

      if (value === "" || value === null || value === undefined) {
        entry.remaining_quantity = null;
      } else {
        const numValue = parseFloat(value);
        entry.remaining_quantity = isNaN(numValue) ? null : numValue;
      }
      updated[index] = entry;
      return updated;
    });

    // Clear validation error for this field
    setValidationErrors((prev) => {
      const next = new Map(prev);
      next.delete(`${index}`);
      return next;
    });
  }, []);

  const filledCount = entries.filter(e => e.remaining_quantity !== null).length;
  const totalCount = entries.length;

  const handleSubmit = useCallback(async () => {
    // Validate: all items must be filled
    const unfilled = entries.filter(e => e.remaining_quantity === null);
    if (unfilled.length > 0) {
      toast({ title: "Incomplete", description: "All items must have a remaining quantity.", variant: "destructive" });
      return;
    }

    // Validate: non-negative check
    const errors = new Map<string, string>();
    entries.forEach((entry, idx) => {
      if (entry.remaining_quantity !== null && entry.remaining_quantity < 0) {
        errors.set(`${idx}`, "Cannot be negative");
      }
    });

    if (errors.size > 0) {
      setValidationErrors(errors);
      toast({ title: "Validation Error", description: "Please fix the highlighted errors.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      // Convert null → -1 sentinel before sending to backend (Frappe Float fields coerce null to 0)
      const itemsForSubmit = entries.map((entry) => ({
        ...entry,
        remaining_quantity: entry.remaining_quantity === null ? -1 : entry.remaining_quantity,
      }));
      await submitReport({
        project: projectId,
        report_date: todayStr,
        items: JSON.stringify(itemsForSubmit),
      });
      toast({
        title: "Report Submitted",
        description: `Remaining items report ${existingReport?.exists ? "updated" : "created"} successfully.`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err: any) {
      toast({
        title: "Submission Failed",
        description: err?.message || "An error occurred while submitting the report.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [entries, projectId, submitReport, existingReport?.exists, onSuccess]);

  return {
    entries,
    handleQuantityChange,
    handleSubmit,
    isSubmitting,
    validationErrors,
    filledCount,
    totalCount,
  };
}
