

import { useState, useEffect, useMemo, useCallback } from "react";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useNavigate } from "react-router-dom"; // <-- 1. IMPORT useNavig
import { PoPaymentTermRow } from "@/types/NirmaanStack/POPaymentTerms";
import { getCreditsColumns } from "../components/CreditsTableColumns.tsx";
import {
  PO_PAYMENT_TERM_DOCTYPE,
  TERM_LIST_FIELDS_TO_FETCH,
  TERM_SEARCHABLE_FIELDS,
  TERM_DATE_COLUMNS,
  PAYMENT_TERM_STATUS_OPTIONS,
} from "../credits.constant";

export const useCredits = () => {
  const creditsCounts = useDocCountStore(state => state.counts.credits);
  const navigate = useNavigate();
  const [currentStatus, setCurrentStatus] = useState<string>(
    () => urlStateManager.getParam("status") || "All"
  );

  console.log("creditsCounts", creditsCounts);

  useEffect(() => {
    const handleUrlChange = (_key: string, value: string | null) => setCurrentStatus(value || "All");
    urlStateManager.subscribe("status", handleUrlChange);
    return () => urlStateManager.unsubscribe("status", handleUrlChange);
  }, []);

  const handleStatusChange = useCallback((newStatus: string) => {
    urlStateManager.updateParam("status", newStatus === "All" ? null : newStatus);
  }, []);

  const additionalFilters = useMemo(() => {

    const filters = [['PO Payment Terms', 'payment_type', '=', 'Credit']];

    if (currentStatus !== "All") {
      filters.push(['PO Payment Terms', 'status', '=', currentStatus]);
    }

    return filters;
  }, [currentStatus]);

  const { table, ...tableProps } = useServerDataTable<PoPaymentTermRow>({
    doctype: PO_PAYMENT_TERM_DOCTYPE,
  columns: useMemo(() => getCreditsColumns(navigate), [navigate]), 
    fetchFields: TERM_LIST_FIELDS_TO_FETCH,
    searchableFields: TERM_SEARCHABLE_FIELDS,
    dateFilterColumns: TERM_DATE_COLUMNS,
    defaultSort: "`tabPO Payment Terms`.due_date asc",
    urlSyncKey: "credits_terms_list",
    additionalFilters: additionalFilters,
  });

  const paymentTermStatusOptionsWithCounts = useMemo(() => {
    return PAYMENT_TERM_STATUS_OPTIONS.map(option => {
      const count = creditsCounts[option.value.toLowerCase() as keyof typeof creditsCounts] || 0;
      return {
        ...option,
        label: `${option.label} (${count})`
      };
    });
  }, [creditsCounts]);

  return {
    table,
    currentStatus,
    handleStatusChange,
    TERM_SEARCHABLE_FIELDS,
    TERM_DATE_COLUMNS,
    PAYMENT_TERM_STATUS_OPTIONS: paymentTermStatusOptionsWithCounts,
    ...tableProps,
  };
};

