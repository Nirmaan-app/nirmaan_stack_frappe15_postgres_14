import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/new-data-table";
import { useCredits } from "./hooks/useCredits";
import { PoPaymentTermRow } from "@/types/NirmaanStack/POPaymentTerms";
import { RequestPaymentDialog } from "@/components/dialogs/RequestPaymentDialog";

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
    TERM_SEARCHABLE_FIELDS,
    TERM_DATE_COLUMNS,
    // --- MODIFICATION: Destructure the new props from the hook ---
    termToRequest,
    setTermToRequest,
    handleConfirmRequestPayment,
    isRequestingPayment,
  } = useCredits();

  // console.log("totalCount", totalCount);

  // 2. Render the UI. The component is now declarative.
  return (
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        totalCount > 10
          ? "max-h-[calc(100vh-80px)]"
          : totalCount > 0
          ? "h-auto"
          : ""
      )}
    >
      {/* <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Credits</h2>
      </div> */}

      {/* Status Filter Tabs - matching Work Plan Zone pattern */}
      <div className="pb-4">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
          <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
            {PAYMENT_TERM_STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleStatusChange(option.value)}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                  transition-colors flex items-center gap-1.5 whitespace-nowrap
                  ${currentStatus === option.value
                    ? "bg-sky-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
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
