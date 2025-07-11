// src/features/credits/CreditsPage.tsx

import { Radio } from "antd";
import { DataTable } from "@/components/data-table/new-data-table";
import { useCredits } from "./hooks/useCredits"; // Import our new hook
import { PoPaymentTermRow } from "@types/NirmaanStack/POPaymentTerms";

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
    TERM_SEARCHABLE_FIELDS,TERM_DATE_COLUMNS
  } = useCredits();


  
  console.log("totalCount", totalCount);

  // 2. Render the UI. The component is now declarative.
  return (
    <div className="flex-1 space-y-4 p-4 md:p-6">
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
        
        // This was the missing prop you identified. Now it's correctly passed.
        searchFieldOptions={TERM_SEARCHABLE_FIELDS} 
        
        dateFilterColumns={TERM_DATE_COLUMNS}
        showExportButton={true}
        onExport="default"
        exportFileName={`payment_terms_${currentStatus.toLowerCase()}`}
      />
    </div>
  );
};

export default CreditsPage;