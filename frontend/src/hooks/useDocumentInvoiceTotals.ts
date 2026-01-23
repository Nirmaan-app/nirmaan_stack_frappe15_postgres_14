/**
 * Hook for fetching aggregated invoice totals from Vendor Invoices doctype.
 *
 * Replaces inline parsing of invoice_data JSON field with efficient
 * server-side aggregation queries.
 *
 * @module hooks/useDocumentInvoiceTotals
 */

import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { useMemo } from "react";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

type DocumentType = "Procurement Orders" | "Service Requests";

/**
 * Fetches aggregated invoice totals for multiple documents.
 * Uses useFrappeGetDocList to fetch approved Vendor Invoices and calculates totals.
 *
 * @param documentType - "Procurement Orders" or "Service Requests"
 * @param documentNames - Array of document names to fetch totals for
 * @returns Object with totals map, loading state, error, and mutate function
 *
 * @example
 * const { totalsMap, getTotal, isLoading } = useDocumentInvoiceTotals(
 *   "Procurement Orders",
 *   poNames
 * );
 * // getTotal("PO-2024-00001") => 50000
 */
export const useDocumentInvoiceTotals = (
  documentType: DocumentType,
  documentNames: string[]
) => {
  // Only call API if we have document names
  const shouldFetch = documentNames && documentNames.length > 0;

  const filters: [string, string, string | string[]][] = useMemo(() => {
    if (!shouldFetch) return [];
    return [
      ["document_type", "=", documentType],
      ["document_name", "in", documentNames],
      ["status", "=", "Approved"],
    ];
  }, [documentType, documentNames, shouldFetch]);

  const { data, error, isLoading, mutate } = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      filters: filters,
      fields: ["name", "document_name", "invoice_amount"],
      limit: 0,
    } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
    shouldFetch ? `VendorInvoiceTotals-${documentType}-${documentNames.length}` : null
  );

  // Group by document and calculate totals
  const totalsMap = useMemo(() => {
    if (!data) return new Map<string, number>();

    const map = new Map<string, number>();
    data.forEach((inv) => {
      const current = map.get(inv.document_name) ?? 0;
      map.set(inv.document_name, current + (inv.invoice_amount ?? 0));
    });
    return map;
  }, [data]);

  /**
   * Get invoice total for a specific document.
   * Returns 0 if not found.
   */
  const getTotal = (documentName: string): number => {
    return totalsMap.get(documentName) ?? 0;
  };

  return {
    invoices: data ?? [],
    totalsMap,
    getTotal,
    isLoading: shouldFetch ? isLoading : false,
    error,
    mutate,
  };
};

/**
 * Fetches invoice totals for a single project.
 *
 * @param projectId - Project ID
 * @returns Object with PO/SR/total amounts, loading state, error
 *
 * @example
 * const { poTotal, srTotal, total, isLoading } = useProjectInvoiceTotals("PROJ-001");
 */
export const useProjectInvoiceTotals = (projectId: string | undefined) => {
  const shouldFetch = !!projectId;

  const filters: [string, string, string][] = useMemo(() => {
    if (!shouldFetch) return [];
    return [
      ["project", "=", projectId],
      ["status", "=", "Approved"],
    ];
  }, [projectId, shouldFetch]);

  const { data, error, isLoading, mutate } = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      filters: filters,
      fields: ["name", "document_type", "invoice_amount"],
      limit: 0,
    } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
    shouldFetch ? `VendorInvoiceTotals-Project-${projectId}` : null
  );

  // Calculate totals by document type
  const totals = useMemo(() => {
    if (!data) return { poTotal: 0, srTotal: 0, total: 0 };

    let poTotal = 0;
    let srTotal = 0;

    data.forEach((inv) => {
      const amount = inv.invoice_amount ?? 0;
      if (inv.document_type === "Procurement Orders") {
        poTotal += amount;
      } else {
        srTotal += amount;
      }
    });

    return {
      poTotal,
      srTotal,
      total: poTotal + srTotal,
    };
  }, [data]);

  return {
    poTotal: totals.poTotal,
    srTotal: totals.srTotal,
    total: totals.total,
    isLoading: shouldFetch ? isLoading : false,
    error,
    mutate,
  };
};

/**
 * Fetches invoice totals for multiple projects in batch.
 *
 * @param projectIds - Array of project IDs
 * @returns Object with totals map, loading state, error
 *
 * @example
 * const { totalsMap, getTotal, isLoading } = useProjectsInvoiceTotals(["PROJ-001", "PROJ-002"]);
 * // getTotal("PROJ-001") => 60000
 */
export const useProjectsInvoiceTotals = (projectIds: string[]) => {
  const shouldFetch = projectIds && projectIds.length > 0;

  const filters: [string, string, string | string[]][] = useMemo(() => {
    if (!shouldFetch) return [];
    return [
      ["project", "in", projectIds],
      ["status", "=", "Approved"],
    ];
  }, [projectIds, shouldFetch]);

  const { data, error, isLoading, mutate } = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      filters: filters,
      fields: ["name", "project", "document_type", "invoice_amount"],
      limit: 0,
    } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
    shouldFetch ? `VendorInvoiceTotals-Projects-${projectIds.length}` : null
  );

  // Group by project and calculate totals
  const totalsMap = useMemo(() => {
    if (!data) return new Map<string, { po_total: number; sr_total: number; total: number }>();

    const map = new Map<string, { po_total: number; sr_total: number; total: number }>();

    data.forEach((inv) => {
      const project = inv.project;
      if (!project) return;

      if (!map.has(project)) {
        map.set(project, { po_total: 0, sr_total: 0, total: 0 });
      }

      const current = map.get(project)!;
      const amount = inv.invoice_amount ?? 0;

      if (inv.document_type === "Procurement Orders") {
        current.po_total += amount;
      } else {
        current.sr_total += amount;
      }
      current.total = current.po_total + current.sr_total;
    });

    return map;
  }, [data]);

  /**
   * Get total PO+SR invoice amount for a project.
   */
  const getTotal = (projectId: string): number => {
    return totalsMap.get(projectId)?.total ?? 0;
  };

  /**
   * Get invoice totals breakdown for a project.
   */
  const getTotals = (projectId: string) => {
    return totalsMap.get(projectId) ?? { po_total: 0, sr_total: 0, total: 0 };
  };

  return {
    totalsMap,
    getTotal,
    getTotals,
    isLoading: shouldFetch ? isLoading : false,
    error,
    mutate,
  };
};

/**
 * Fetches all approved Vendor Invoices for given documents with full details.
 * Use this when you need the full invoice list, not just totals.
 */
export const useVendorInvoicesForDocuments = (
  documentType: DocumentType,
  documentNames: string[]
) => {
  const shouldFetch = documentNames && documentNames.length > 0;

  const filters: [string, string, string | string[]][] = useMemo(() => {
    if (!shouldFetch) return [];
    return [
      ["document_type", "=", documentType],
      ["document_name", "in", documentNames],
      ["status", "=", "Approved"],
    ];
  }, [documentType, documentNames, shouldFetch]);

  const { data, error, isLoading, mutate } = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      filters: filters,
      fields: [
        "name",
        "document_name",
        "invoice_amount",
        "invoice_no",
        "invoice_date",
        "invoice_attachment",
        "uploaded_by",
        "vendor",
        "project",
        "reconciliation_status",
        "reconciled_amount",
      ],
      limit: 0,
      orderBy: { field: "invoice_date", order: "desc" },
    } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
    shouldFetch ? `VendorInvoices-${documentType}-${documentNames.join(",")}` : null
  );

  // Group by document and calculate totals
  const totalsMap = useMemo(() => {
    if (!data) return new Map<string, number>();

    const map = new Map<string, number>();
    data.forEach((inv) => {
      const current = map.get(inv.document_name) ?? 0;
      map.set(inv.document_name, current + (inv.invoice_amount ?? 0));
    });
    return map;
  }, [data]);

  // Group invoices by document
  const invoicesByDocument = useMemo(() => {
    if (!data) return new Map<string, VendorInvoice[]>();

    const map = new Map<string, VendorInvoice[]>();
    data.forEach((inv) => {
      if (!map.has(inv.document_name)) {
        map.set(inv.document_name, []);
      }
      map.get(inv.document_name)!.push(inv);
    });
    return map;
  }, [data]);

  return {
    invoices: data ?? [],
    invoicesByDocument,
    totalsMap,
    getTotal: (docName: string) => totalsMap.get(docName) ?? 0,
    getInvoices: (docName: string) => invoicesByDocument.get(docName) ?? [],
    isLoading,
    error,
    mutate,
  };
};
