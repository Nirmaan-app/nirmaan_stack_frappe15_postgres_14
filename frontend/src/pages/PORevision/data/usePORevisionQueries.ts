import {
  useFrappeGetDocList,
  useFrappeGetDoc,
  useFrappePostCall,
  FrappeDoc,
  GetDocListArgs,
} from "frappe-react-sdk";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { Projects as Project } from "@/types/NirmaanStack/Projects";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { poRevisionKeys, PO_REVISION_DOCTYPE, PO_REVISION_APIS } from "./poRevision.constants";
import useSWR from "swr";

// ─── Revision Document ───────────────────────────────────────

export const useRevisionDoc = (revisionId?: string) => {
  const response = useFrappeGetDoc(
    PO_REVISION_DOCTYPE,
    revisionId || "",
    revisionId ? poRevisionKeys.revisionDoc(revisionId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useRevisionDoc",
    api: "PO Revisions GetDoc",
    feature: "po-revision",
    doctype: PO_REVISION_DOCTYPE,
    entity_id: revisionId,
  });
  return response;
};

// ─── Original PO (for approval context) ──────────────────────

export const useOriginalPO = (poId?: string) => {
  const response = useFrappeGetDoc<ProcurementOrder>(
    "Procurement Orders",
    poId || "",
    poId ? poRevisionKeys.originalPO(poId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useOriginalPO",
    api: "Procurement Orders GetDoc",
    feature: "po-revision",
    doctype: "Procurement Orders",
    entity_id: poId,
  });
  return response;
};

// ─── Procurement Request (for work package context) ──────────

export const useProcurementRequestForRevision = (prId?: string) => {
  const response = useFrappeGetDoc<ProcurementRequest>(
    "Procurement Requests",
    prId || "",
    prId ? poRevisionKeys.procurementRequest(prId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useProcurementRequestForRevision",
    api: "Procurement Requests GetDoc",
    feature: "po-revision",
    doctype: "Procurement Requests",
    entity_id: prId,
  });
  return response;
};

// ─── Project (for work package context) ──────────

export const useProjectForRevision = (projectId?: string) => {
  const response = useFrappeGetDoc<Project>(
    "Projects",
    projectId || "",
    projectId ? poRevisionKeys.project(projectId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useProjectForRevision",
    api: "Projects GetDoc",
    feature: "po-revision",
    doctype: "Projects",
    entity_id: projectId,
  });
  return response;
};

// ─── Vendor Invoices (for dialog context) ────────────────────

export const useRevisionVendorInvoices = (
  poId: string | undefined,
  enabled: boolean = true
) => {
  const response = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      fields: [
        "name",
        "invoice_no",
        "invoice_date",
        "invoice_amount",
        "status",
        "owner",
      ],
      filters: [
        ["document_type", "=", "Procurement Orders"],
        ["document_name", "=", poId || ""],
      ],
      limit: 100,
    } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
    enabled && poId ? poRevisionKeys.vendorInvoices(poId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useRevisionVendorInvoices",
    api: "Vendor Invoices List",
    feature: "po-revision",
    doctype: "Vendor Invoices",
    entity_id: poId,
  });
  return response;
};

// ─── Categories & Packages (for custom items) ───────────────

export const useProcurementPackages = () => {
  const response = useFrappeGetDocList("Procurement Packages", {
    fields: ["*"],
    filters: [["name", "!=", "Services"]],
    orderBy: { field: "name", order: "asc" },
    limit: 100,
  });
  useApiErrorLogger(response.error, {
    hook: "useProcurementPackages",
    api: "Procurement Packages List",
    feature: "po-revision",
    doctype: "Procurement Packages",
  });
  return response;
};

export const useCategories = () => {
  const response = useFrappeGetDocList("Category", {
    fields: ["*"],
    filters: [["work_package", "!=", "Services"]],
    orderBy: { field: "category_name", order: "asc" },
    limit: 10000,
  });
  useApiErrorLogger(response.error, {
    hook: "useCategories",
    api: "Category List",
    feature: "po-revision",
    doctype: "Category",
  });
  return response;
};

// ─── PO Lock Check ───────────────────────────────────────────

interface POLockCheckResult {
  is_locked: boolean;
  revision_name?: string;
  is_item_locked?: boolean;
  is_payment_locked?: boolean;
  payment_lock_source?: string; // "PO Revision" | "PO Adjustment"
  role?: string;
  revision_id?: string;
  [key: string]: any;
}

export const usePOLockCheck = (poId: string | undefined) => {
  const { call } = useFrappePostCall(PO_REVISION_APIS.checkLock);

  const { data, isLoading, error, mutate } = useSWR<POLockCheckResult | null>(
    poId ? poRevisionKeys.lockCheck(poId) : null,
    () => call({ po_id: poId }).then((res) => res.message || null)
  );

  useApiErrorLogger(error, {
    hook: "usePOLockCheck",
    api: "check_po_in_pending_revisions",
    feature: "po-revision",
    entity_id: poId,
  });

  return { data, isLoading, error, mutate };
};

// ─── Bulk PO Lock Check ──────────────────────────────────────

export const useAllLockedPOs = () => {
  const { call } = useFrappePostCall(PO_REVISION_APIS.getAllLocked);

  const { data, isLoading, error, mutate } = useSWR(
    poRevisionKeys.allLocked(),
    () => call({}).then((res) => res.message || [])
  );

  useApiErrorLogger(error, {
    hook: "useAllLockedPOs",
    api: "get_all_locked_po_names",
    feature: "po-revision",
  });

  return { data, isLoading, error, mutate };
};

// ─── Revision History ────────────────────────────────────────

export const useRevisionHistory = (poId: string) => {
  const { call } = useFrappePostCall(PO_REVISION_APIS.getHistory);

  const { data, isLoading, error, mutate } = useSWR(
    poId ? poRevisionKeys.revisionHistory(poId) : null,
    () => call({ po_id: poId }).then((res) => res.message || [])
  );

  useApiErrorLogger(error, {
    hook: "useRevisionHistory",
    api: "get_po_revision_history",
    feature: "po-revision",
    entity_id: poId,
  });

  return { data: data as any[] | undefined, isLoading, error, mutate };
};
