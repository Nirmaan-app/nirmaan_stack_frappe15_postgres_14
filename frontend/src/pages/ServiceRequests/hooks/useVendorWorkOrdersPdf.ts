import { useCallback, useState } from "react";
import { ColumnFiltersState, SortingState, Table } from "@tanstack/react-table";

import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { toast } from "@/components/ui/use-toast";
import { convertTanstackFiltersToFrappe } from "@/lib/frappeTypeUtils";
import { downloadPrintFormatPdf } from "@/utils/downloadPrintFormatPdf";

/** The Desk print format on Vendors (reference copy: pages/vendors/print/vendor-work-orders-printformat.html). */
export const VENDOR_WORK_ORDERS_PRINT_FORMAT = "Vendor Work Orders";

/** The Vendor page's Work Orders sub-tab; the format adds that list's status filters itself. */
export type VendorWorkOrdersView = "all" | "approved" | "finalized";

const VIEW_LABEL: Record<VendorWorkOrdersView, string> = {
  all: "All",
  approved: "Approved",
  finalized: "Finalized",
};

/**
 * The Service Requests fields the WO lists filter or sort on. Columns that are not stored
 * fields (Pending Invoices, Remarks) are unfilterable and unsortable on screen, but a stale
 * `_filters` / `_sort` URL param could still carry one: it would fail the format's query, so
 * it is dropped here.
 */
const SR_FIELDS = new Set([
  "name", "creation", "modified", "project", "vendor", "status", "is_finalized", "gst",
  "total_amount", "amount_paid", "amount_due", "amount_invoiced", "owner",
]);

export interface VendorWorkOrdersPdfState {
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
  searchTerm?: string;
  selectedSearchField?: string;
  searchableFields: SearchFieldOption[];
  view: VendorWorkOrdersView;
}

/** The query-string params the "Vendor Work Orders" format reads from `frappe.form_dict`. */
export const buildVendorWorkOrdersPdfParams = ({
  columnFilters,
  sorting,
  searchTerm,
  selectedSearchField,
  searchableFields,
  view,
}: VendorWorkOrdersPdfState): Record<string, string | undefined> => {
  const filters = columnFilters.filter((f) => SR_FIELDS.has(f.id));
  const sort = sorting.find((s) => SR_FIELDS.has(s.id));
  const search = searchTerm?.trim();
  const searchField = searchableFields.find((f) => f.value === selectedSearchField);
  return {
    wo_view: view,
    wo_filters: filters.length ? JSON.stringify(convertTanstackFiltersToFrappe(filters)) : undefined,
    order_by: sort ? `${sort.id} ${sort.desc ? "desc" : "asc"}` : undefined,
    search_term: search || undefined,
    search_field: search ? selectedSearchField : undefined,
    item_search: search && searchField?.is_json ? "1" : undefined,
  };
};

export const vendorWorkOrdersPdfFileName = (
  vendorName: string | undefined,
  vendorId: string,
  view: VendorWorkOrdersView,
  date: Date = new Date()
) => `${vendorName || vendorId}_${VIEW_LABEL[view]}_WO_${date.toISOString().slice(0, 10)}.pdf`;

interface UseVendorWorkOrdersPdfArgs<T> {
  table: Table<T>;
  vendorId?: string;
  vendorName?: string;
  view: VendorWorkOrdersView;
  searchTerm?: string;
  selectedSearchField?: string;
  searchableFields: SearchFieldOption[];
}

/**
 * "Download PDF" for the Vendor page's Work Orders tab: the "Vendor Work Orders" print format
 * lists what the table shows (same filters, search and sort), like Material Orders' button.
 */
export function useVendorWorkOrdersPdf<T>({
  table,
  vendorId,
  vendorName,
  view,
  searchTerm,
  selectedSearchField,
  searchableFields,
}: UseVendorWorkOrdersPdfArgs<T>) {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const downloadPdf = useCallback(async () => {
    if (!vendorId) return;
    const { columnFilters, sorting } = table.getState();
    setIsDownloadingPdf(true);
    try {
      await downloadPrintFormatPdf({
        doctype: "Vendors",
        name: vendorId,
        format: VENDOR_WORK_ORDERS_PRINT_FORMAT,
        fileName: vendorWorkOrdersPdfFileName(vendorName, vendorId, view),
        params: buildVendorWorkOrdersPdfParams({
          columnFilters,
          sorting,
          searchTerm,
          selectedSearchField,
          searchableFields,
          view,
        }),
      });
    } catch (err) {
      toast({ variant: "destructive", title: "PDF download failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [table, vendorId, vendorName, view, searchTerm, selectedSearchField, searchableFields]);

  return { downloadPdf, isDownloadingPdf };
}
