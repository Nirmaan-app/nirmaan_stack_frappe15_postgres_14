
import { useState, useEffect, useMemo, useCallback } from "react";
// ✅ 1. Import ColumnFiltersState type from TanStack Table
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useNavigate } from "react-router-dom"; // <-- 1. IMPORT useNavig
import { PoPaymentTermRow } from "@/types/NirmaanStack/POPaymentTerms";
import { getCreditsColumns } from "../components/CreditsTableColumns.tsx";
import { toast } from "@/components/ui/use-toast";
import { ApiResponse } from "@/types/NirmaanStack/ApiResponse";
import {
  PO_PAYMENT_TERM_DOCTYPE,
  TERM_LIST_FIELDS_TO_FETCH,
  TERM_SEARCHABLE_FIELDS,
  TERM_DATE_COLUMNS,
  PAYMENT_TERM_STATUS_OPTIONS,
  CREDIT_FACET_FILTER_OPTIONS,

} from "../credits.constant";

// --- (2) NEW: Import types for Projects and Vendors ---
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { useFrappeGetDocList,useFrappePostCall } from "frappe-react-sdk";



export const useCredits = () => {
  const creditsCounts = useDocCountStore(state => state.counts.credits);
  const navigate = useNavigate();
  const [currentStatus, setCurrentStatus] = useState<string>(
    () => urlStateManager.getParam("status") || "All"
  );


  // console.log("creditsCounts", creditsCounts);
    const [termToRequest, setTermToRequest] = useState<PoPaymentTermRow | null>(null);
      
    const {
    call: requestPaymentApi,
    loading: isRequestingPayment, 
  } = useFrappePostCall<ApiResponse>(
    "nirmaan_stack.api.payments.project_payments.create_project_payment"
  );

  const handleOpenRequestDialog = useCallback((term: PoPaymentTermRow) => {
    console.log("DEBUG: handleOpenRequestDialog", term);
    setTermToRequest(term);
  }, []);
      
   



  useEffect(() => {
    const handleUrlChange = (_key: string, value: string | null) => setCurrentStatus(value || "All");
    urlStateManager.subscribe("status", handleUrlChange);
    return () => urlStateManager.unsubscribe("status", handleUrlChange);
  }, []);

  const handleStatusChange = useCallback((newStatus: string) => {
    urlStateManager.updateParam("status", newStatus === "All" ? null : newStatus);
  }, []);

  const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
    "Projects", { fields: ["name", "project_name"], limit: 0 }
  );
  const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>(
    "Vendors", { fields: ["name", "vendor_name"], limit: 0 }
  );

  // ✅ 2. Create state to hold the column filters from the data table

  const additionalFilters = useMemo(() => {

    const filters = [['status', 'not in', ["Merged","Inactive", "PO Amendment"]], ['PO Payment Terms', 'payment_type', '=', 'Credit']
    ];

    if (currentStatus !== "All") {
      filters.push(['status', 'not in', ["Merged","Inactive", "PO Amendment"]], ['PO Payment Terms', 'term_status', '=', currentStatus],);
    }
    // --- NEW LOGIC ---
    // Translate TanStack column filters into Frappe API filters
    // console.log()
    return filters;
  }, [currentStatus]);

  const { table, data, ...tableProps } = useServerDataTable<PoPaymentTermRow>({
    doctype: PO_PAYMENT_TERM_DOCTYPE,
    columns: useMemo(() => getCreditsColumns(navigate,handleOpenRequestDialog,currentStatus), [navigate,handleOpenRequestDialog,currentStatus]),
    fetchFields: TERM_LIST_FIELDS_TO_FETCH,
    searchableFields: TERM_SEARCHABLE_FIELDS,
    dateFilterColumns: TERM_DATE_COLUMNS,
    defaultSort: '`tabPO Payment Terms`.due_date asc',
    urlSyncKey: "credits_terms_list",
    additionalFilters: additionalFilters,
  });


  // console.log("CreditsTable",data)
  const handleConfirmRequestPayment = useCallback(async () => {
    if (!termToRequest) return;

    try {
      const result = await requestPaymentApi({
        doctype: PO_PAYMENT_TERM_DOCTYPE,
        docname: termToRequest.name, // The PO document name
        project: termToRequest.project,
        vendor: termToRequest.vendor, // API expects vendor name, not ID
        amount: termToRequest.amount,
        ptname: termToRequest.ptname, // This is the unique name of the child table row
      });

      if (result && result.message && result.message.status === 200) {
        toast({
          title: "Success!",
          description: result.message.message,
          variant: "success",
        });
        tableProps.refetch(); // Refetch the table data to show the status change
      } else {
        // Handle cases where API returns a non-200 status in its message
        throw new Error(result?.message?.message || "An unknown error occurred.");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Could not request payment: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setTermToRequest(null); // Close the dialog
    }
  }, [termToRequest, requestPaymentApi, toast,table]); // Dependency array for useCallback



  const paymentTermStatusOptionsWithCounts = useMemo(() => {
    return PAYMENT_TERM_STATUS_OPTIONS.map(option => {
      const count = creditsCounts[option.value.toLowerCase() as keyof typeof creditsCounts] || 0;
      return {
        ...option,
        label: `${option.label} (${count})`
      };
    });
  }, [creditsCounts]);

  const facetFilterOptions = useMemo(() => {
    const dynamicOptions = { ...CREDIT_FACET_FILTER_OPTIONS };

    // Populate project options
    dynamicOptions.project_name.options = projects?.map(p => ({
      label: p.project_name,
      value: p.project_name // Filtering by name directly
    })) || [];

    // Populate vendor options
    dynamicOptions.vendor_name.options = vendors?.map(v => ({
      label: v.vendor_name,
      value: v.vendor_name // Filtering by name directly
    })) || [];

    return dynamicOptions;
  }, [projects, vendors]);

  // console.log("paymentTermStatusOptionsWithCounts", data);

  return {
    table,
    data,
    currentStatus,
    handleStatusChange,
    TERM_SEARCHABLE_FIELDS,
    TERM_DATE_COLUMNS,
    PAYMENT_TERM_STATUS_OPTIONS: paymentTermStatusOptionsWithCounts,
    facetFilterOptions: facetFilterOptions,
      termToRequest,
    setTermToRequest, // Needed for the onClose handler in CreditsPage
    handleConfirmRequestPayment,
    isRequestingPayment,
    ...tableProps,
  };
};

