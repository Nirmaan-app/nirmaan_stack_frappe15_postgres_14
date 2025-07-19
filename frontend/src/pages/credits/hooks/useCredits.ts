
import { useState, useEffect, useMemo, useCallback } from "react";
// ✅ 1. Import ColumnFiltersState type from TanStack Table
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
  CREDIT_FACET_FILTER_OPTIONS,

} from "../credits.constant";



export const useCredits = () => {
  const creditsCounts = useDocCountStore(state => state.counts.credits);
  const navigate = useNavigate();
  const [currentStatus, setCurrentStatus] = useState<string>(
    () => urlStateManager.getParam("status") || "All"
  );

  // console.log("creditsCounts", creditsCounts);

  useEffect(() => {
    const handleUrlChange = (_key: string, value: string | null) => setCurrentStatus(value || "All");
    urlStateManager.subscribe("status", handleUrlChange);
    return () => urlStateManager.unsubscribe("status", handleUrlChange);
  }, []);

  const handleStatusChange = useCallback((newStatus: string) => {
    urlStateManager.updateParam("status", newStatus === "All" ? null : newStatus);
  }, []);

   // ✅ 2. Create state to hold the column filters from the data table

  const additionalFilters = useMemo(() => {

    const filters = [['status', '!=', 'Merged'],['PO Payment Terms', 'payment_type', '=', 'Credit']
    ];

    if (currentStatus !== "All") {
      filters.push(['status', '!=', 'Merged'],['PO Payment Terms', 'status', '=', currentStatus],);
    }
     // --- NEW LOGIC ---
    // Translate TanStack column filters into Frappe API filters
// console.log()
    return filters;
  }, [currentStatus]);

  const { table,data,...tableProps } = useServerDataTable<PoPaymentTermRow>({
    doctype: PO_PAYMENT_TERM_DOCTYPE,
  columns: useMemo(() => getCreditsColumns(navigate), [navigate]), 
    fetchFields: TERM_LIST_FIELDS_TO_FETCH,
    searchableFields: TERM_SEARCHABLE_FIELDS,
    dateFilterColumns: TERM_DATE_COLUMNS,
    defaultSort: "due_date asc",
    urlSyncKey: "credits_terms_list",
    additionalFilters: additionalFilters,
  });

  // console.log("CreditsTable",tableProps)

const paymentTermStatusOptionsWithCounts = useMemo(() => {
    return PAYMENT_TERM_STATUS_OPTIONS.map(option => {
      const count = creditsCounts[option.value.toLowerCase() as keyof typeof creditsCounts] || 0;
      return {
        ...option,
        label: `${option.label} (${count})`
      };
    });
  }, [creditsCounts]);

  // console.log("paymentTermStatusOptionsWithCounts", data);

  return {
    table,
    data,
    currentStatus,
    handleStatusChange,
    TERM_SEARCHABLE_FIELDS,
    TERM_DATE_COLUMNS,
    PAYMENT_TERM_STATUS_OPTIONS: paymentTermStatusOptionsWithCounts,
    facetFilterOptions: CREDIT_FACET_FILTER_OPTIONS,
    ...tableProps,
  };
};

