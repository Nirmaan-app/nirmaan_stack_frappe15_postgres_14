

import { Radio } from "antd";
import { DataTable } from "@/components/data-table/new-data-table";
import { useCredits } from "./hooks/useCredits"; // Import our new hook
// import { PoPaymentTermRow } from "@types/NirmaanStack/POPaymentTerms";

import { RequestPaymentDialog } from "@/components/dialogs/RequestPaymentDialog";
import {EditTermsDialog} from "../ProcurementOrders/purchase-order/components/POPaymentTermsCard";

const CreditsPage = () => {
  // 1. Get all state, props, and handlers from our custom hook.
  const {
    table,
    isLoading,
    error,
    totalCount,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    currentStatus,
    handleStatusChange,
    PAYMENT_TERM_STATUS_OPTIONS,
    facetFilterOptions,
    TERM_SEARCHABLE_FIELDS,TERM_DATE_COLUMNS,
        // --- MODIFICATION: Destructure the new props from the hook ---
    termToRequest,
    setTermToRequest,
    handleConfirmRequestPayment,
    isRequestingPayment,
   

  
  } = useCredits();



  
  // console.log("totalCount", totalCount);

  // 2. Render the UI. The component is now declarative.
  return (
    <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'max-h-[calc(100vh-80px)] overflow-hidden' : ''}`}>
      {/* <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Credits</h2>
      </div> */}

      <div className="pb-4">
        <Radio.Group
          options={PAYMENT_TERM_STATUS_OPTIONS}
          value={currentStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          optionType="button"
          buttonStyle="solid"
        />
      </div>

      <DataTable<PoPaymentTermRow>
        // Pass all the props returned by the hook
        table={table}
        columns={table.options.columns} // Get columns directly from the table instance
        isLoading={isLoading}
        error={error}
        totalCount={totalCount}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        selectedSearchField={selectedSearchField}
        onSelectedSearchFieldChange={setSelectedSearchField}
        facetFilterOptions={facetFilterOptions}
        
        // This was the missing prop you identified. Now it's correctly passed.
        searchFieldOptions={TERM_SEARCHABLE_FIELDS} 
        
        dateFilterColumns={TERM_DATE_COLUMNS}
        showExportButton={true}
        onExport="default"
        exportFileName={`Credit_payment_terms_${currentStatus.toLowerCase()}`}
      />
       {/* --- MODIFICATION: Render the dialog here --- */}
      <RequestPaymentDialog
        isOpen={!!termToRequest}
        onClose={() => setTermToRequest(null)}
        term={termToRequest}
        onConfirm={handleConfirmRequestPayment}
        isLoading={isRequestingPayment}
      />


    </div>
  );
};

export default CreditsPage;
