import {
  useFrappeCreateDoc,
  useFrappeDocumentEventListener,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappeGetDocCount,
  useFrappeGetDocList,
  useFrappePostCall,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { captureApiError } from "@/utils/sentry/captureApiError";
import { ProjectQueryKeys } from "@/pages/projects/queries";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Customers } from "@/types/NirmaanStack/Customers";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { ProjectEstimates as ProjectEstimatesType } from "@/types/NirmaanStack/ProjectEstimates";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProcurementOrder as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";


export interface ProjectPOItemDataItem {
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  creation: string;
  item_id: string;
  quote: number;
  quantity: number;
  received_quantity: number;
  category: string;
  tax: number;
  unit: string;
  item_name: string;
  work_package: string;
  is_dispatched?: number;
}

export const projectRootKeys = {
  allProjectsCount: () => ["project-root", "allProjectsCount"] as const,
  projectsListPOs: () => ["project-root", "projectsListPOs"] as const,
  projectsListSRs: () => ["project-root", "projectsListSRs"] as const,
  projectsListInflows: () => ["project-root", "projectsListInflows"] as const,
  projectsListPayments: () => ["project-root", "projectsListPayments"] as const,
  projectsListExpenses: () => ["project-root", "projectsListExpenses"] as const,
  poSummary: (projectId: string) => ["project-root", "poSummary", projectId] as const,
  designTrackerList: (projectId: string) => ["project-root", "designTrackerList", projectId] as const,
  commissionReportList: (projectId: string) => ["project-root", "commissionReportList", projectId] as const,
  commissionMasterData: () => ["project-root", "commissionMasterData"] as const,
  boqList: (projectId: string) => ["project-root", "boqList", projectId] as const,
  projectPayments: (projectId: string) => ["project-root", "projectPayments", projectId] as const,
  projectExpenses: (projectId: string) => ["project-root", "projectExpenses", projectId] as const,
  procurementRequests: (projectId: string) => ["project-root", "procurementRequests", projectId] as const,
  procurementOrders: (projectId: string) => ["project-root", "procurementOrders", projectId] as const,
  approvedServiceRequests: (projectId: string) => ["project-root", "approvedServiceRequests", projectId] as const,
  projectsListInvoices: () => ["project-root", "projectsListInvoices"] as const,
};

export const useProjectStatusCountCall = () => {
  const response = useFrappePostCall("frappe.client.get_count");
  useApiErrorLogger(response.error, {
    hook: "useProjectStatusCountCall",
    api: "frappe.client.get_count",
    feature: "project-root",
  });
  return response;
};

export const useAllProjectsCount = () => {
  const response = useFrappeGetDocCount(
    "Projects",
    undefined,
    false,
    projectRootKeys.allProjectsCount()
  );

  useApiErrorLogger(response.error, {
    hook: "useAllProjectsCount",
    api: "Projects Count",
    feature: "project-root",
  });

  return response;
};

export const useProjectsListPOData = () => {
  const response = useFrappeGetDocList<ProcurementOrder>(
    "Procurement Orders",
    {
      fields: [
        "name",
        "project",
        "status",
        "amount",
        "tax_amount",
        "total_amount",
        "invoice_data",
        "amount_paid",
        "po_amount_delivered",
      ],
      filters: [["status", "not in", ["Merged", "Inactive"]]],
      limit: 100000,
    },
    projectRootKeys.projectsListPOs()
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectsListPOData",
    api: "Procurement Orders List",
    feature: "project-root",
  });

  return response;
};

export const useProjectsListSRData = () => {
  const response = useFrappeGetDocList<ServiceRequests>(
    "Service Requests",
    {
      fields: ["name", "project", "status", "service_order_list", "gst"],
      filters: [["status", "=", "Approved"]],
      limit: 100000,
    },
    projectRootKeys.projectsListSRs()
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectsListSRData",
    api: "Service Requests List",
    feature: "project-root",
  });

  return response;
};

export const useProjectsListInflows = () => {
  const response = useFrappeGetDocList<ProjectInflows>(
    "Project Inflows",
    { fields: ["project", "amount"], limit: 100000 },
    projectRootKeys.projectsListInflows()
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectsListInflows",
    api: "Project Inflows List",
    feature: "project-root",
  });

  return response;
};

export const useProjectsListPayments = () => {
  const response = useFrappeGetDocList<ProjectPayments>(
    "Project Payments",
    {
      fields: ["project", "amount", "status"],
      filters: [["status", "=", "Paid"]],
      limit: 100000,
    },
    projectRootKeys.projectsListPayments()
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectsListPayments",
    api: "Project Payments List",
    feature: "project-root",
  });

  return response;
};
export const useProjectsListExpenses = () => {
  const response = useFrappeGetDocList<ProjectExpenses>(
    "Project Expenses",
    { fields: ["projects", "amount"], limit: 100000 },
    projectRootKeys.projectsListExpenses()
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectsListExpenses",
    api: "Project Expenses List",
    feature: "project-root",
  });

  return response;
};

export const useProjectsListProjectInvoices = () => {
  const response = useFrappeGetDocList<ProjectInvoice>(
    "Project Invoices",
    {
      fields: ["name", "project", "amount", "creation", "invoice_date"],
      limit: 100000,
    },
    projectRootKeys.projectsListInvoices()
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectsListProjectInvoices",
    api: "Project Invoice List",
    feature: "project-root",
  });

  return response;
};

export const useProjectDocRealtime = (
  projectId: string,
  onUpdated?: (event: any) => void
) => {
  const response = useFrappeGetDoc<Projects>(
    "Projects",
    projectId,
    projectId ? ProjectQueryKeys.project(projectId) : null
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectDocRealtime",
    api: "Projects Doc",
    feature: "project-root",
    entity_id: projectId,
  });

  useFrappeDocumentEventListener(
    "Projects",
    projectId,
    (event) => {
      onUpdated?.(event);
      response.mutate();
    },
    true
  );

  return response;
};

export const useProjectCustomerRealtime = (
  customerId?: string,
  onUpdated?: (event: any) => void
) => {
  const response = useFrappeGetDoc<Customers>(
    "Customers",
    customerId,
    customerId ? ProjectQueryKeys.customer(customerId) : null
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectCustomerRealtime",
    api: "Customers Doc",
    feature: "project-root",
    entity_id: customerId,
  });

  useFrappeDocumentEventListener(
    "Customers",
    customerId || "",
    (event) => {
      if (!customerId) return;
      onUpdated?.(event);
      response.mutate();
    },
    true
  );

  return response;
};

export const useProjectPOSummaryCall = (projectId: string) => {
  const response = useFrappeGetCall<{
    message: {
      po_items: ProjectPOItemDataItem[];
      custom_items: ProjectPOItemDataItem[];
    };
  }>(
    "nirmaan_stack.api.procurement_orders.generate_po_summary",
    { project_id: projectId },
    projectId ? projectRootKeys.poSummary(projectId) : null
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectPOSummaryCall",
    api: "generate_po_summary",
    feature: "project-root",
    entity_id: projectId,
  });

  return response;
};

export const useProjectViewMeta = (projectId: string) => {
  const designTrackerResponse = useFrappeGetDocList(
    "Project Design Tracker",
    {
      fields: ["name"],
      filters: [["project", "=", projectId]],
      limit: 1,
    },
    projectId ? projectRootKeys.designTrackerList(projectId) : null
  );

  const commissionReportResponse = useFrappeGetDocList(
    "Project Commission Report",
    {
      fields: ["name"],
      filters: [["project", "=", projectId]],
      limit: 1,
    },
    projectId ? projectRootKeys.commissionReportList(projectId) : null
  );

  const commissionMasterDataResponse = useFrappeGetCall<any>(
    "nirmaan_stack.api.commission_report.tracker_options.get_all_master_data",
    {},
    projectRootKeys.commissionMasterData()
  );

  const boqListResponse = useFrappeGetDocList(
    "BOQ",
    {
      fields: ["name"],
      filters: [["project", "=", projectId]],
      limit: 100,
    },
    projectId ? projectRootKeys.boqList(projectId) : null
  );

  useApiErrorLogger(designTrackerResponse.error, {
    hook: "useProjectViewMeta",
    api: "Project Design Tracker List",
    feature: "project-root",
    entity_id: projectId,
  });

  useApiErrorLogger(commissionReportResponse.error, {
    hook: "useProjectViewMeta",
    api: "Project Commission Report List",
    feature: "project-root",
    entity_id: projectId,
  });

  useApiErrorLogger(commissionMasterDataResponse.error, {
    hook: "useProjectViewMeta",
    api: "Commission Master Data",
    feature: "project-root",
  });

  useApiErrorLogger(boqListResponse.error, {
    hook: "useProjectViewMeta",
    api: "BOQ List",
    feature: "project-root",
    entity_id: projectId,
  });

  return {
    designTrackerResponse,
    commissionReportResponse,
    commissionMasterDataResponse,
    boqListResponse,
  };
};

export const useProjectViewMutations = () => {
  const updateDocResponse = useFrappeUpdateDoc();
  const createDocResponse = useFrappeCreateDoc();
  const handoverTasksResponse = useFrappePostCall<{
    message: { status: string; tasks_created?: number; task_count?: number; message: string };
  }>("nirmaan_stack.api.design_tracker.generate_handover_tasks.generate_handover_tasks");

  const wrappedUpdateDoc = async (doctype: string, name: string, data: Record<string, any>) => {
    try {
      return await updateDocResponse.updateDoc(doctype, name, data);
    } catch (error) {
      captureApiError({
        hook: "useProjectViewMutations",
        api: "Update Doc",
        feature: "project-root",
        doctype,
        entity_id: name,
        error,
      });
      throw error;
    }
  };

  const wrappedCreateDoc = async (doctype: string, data: Record<string, any>) => {
    try {
      return await createDocResponse.createDoc(doctype, data);
    } catch (error) {
      captureApiError({
        hook: "useProjectViewMutations",
        api: "Create Doc",
        feature: "project-root",
        doctype,
        error,
      });
      throw error;
    }
  };

  const wrappedGenerateHandoverTasks = async (payload: { project_id: string }) => {
    try {
      return await handoverTasksResponse.call(payload);
    } catch (error) {
      captureApiError({
        hook: "useProjectViewMutations",
        api: "generate_handover_tasks",
        feature: "project-root",
        entity_id: payload.project_id,
        error,
      });
      throw error;
    }
  };

  useApiErrorLogger(handoverTasksResponse.error, {
    hook: "useProjectViewMutations",
    api: "generate_handover_tasks",
    feature: "project-root",
  });

  return {
    updateDoc: wrappedUpdateDoc,
    updateDocLoading: updateDocResponse.loading,
    createDoc: wrappedCreateDoc,
    createDocLoading: createDocResponse.loading,
    generateHandoverTasks: wrappedGenerateHandoverTasks,
    handoverTasksLoading: handoverTasksResponse.loading,
  };
};

export const useProjectViewFinancialData = (projectId: string) => {
  const projectEstimatesResponse = useFrappeGetDocList<ProjectEstimatesType>(
    "Project Estimates",
    {
      fields: ["work_package", "quantity_estimate", "rate_estimate", "name"],
      filters: [["project", "=", projectId]],
      limit: 0,
    },
    projectId
      ? ProjectQueryKeys.estimates({
        fields: ["work_package", "quantity_estimate", "rate_estimate", "name"],
        filters: [["project", "=", projectId]],
        limit: 0,
      })
      : null
  );

  const projectPaymentsResponse = useFrappeGetDocList<ProjectPayments>(
    "Project Payments",
    {
      fields: ["document_type", "amount", "document_name", "status", "name"],
      filters: [["project", "=", projectId], ["status", "=", "Paid"]],
      limit: 0,
    },
    projectId ? projectRootKeys.projectPayments(projectId) : null
  );

  const projectExpensesResponse = useFrappeGetDocList<ProjectExpenses>(
    "Project Expenses",
    {
      fields: ["name", "amount"],
      filters: [["projects", "=", projectId]],
      limit: 0,
    },
    projectId ? projectRootKeys.projectExpenses(projectId) : null
  );

  const procurementRequestsResponse = useFrappeGetDocList<ProcurementRequest>(
    "Procurement Requests",
    {
      fields: ["name", "work_package"],
      filters: [["project", "=", `${projectId}`]],
      limit: 0,
    },
    projectId ? projectRootKeys.procurementRequests(projectId) : null
  );

  const procurementOrdersResponse = useFrappeGetDocList<ProcurementOrdersType>(
    "Procurement Orders",
    {
      fields: [
        "name",
        "procurement_request",
        "status",
        "amount",
        "tax_amount",
        "total_amount",
        "invoice_data",
        "po_amount_delivered",
        "amount_paid",
      ] as const,
      filters: [
        ["project", "=", projectId],
        ["status", "not in", ["Merged", "Inactive"]],
      ],
      limit: 0,
      orderBy: { field: "creation", order: "desc" },
    },
    projectId ? projectRootKeys.procurementOrders(projectId) : null
  );

  const approvedServiceRequestsResponse = useFrappeGetDocList<ServiceRequests>(
    "Service Requests",
    {
      fields: ["gst", "name", "service_order_list"],
      filters: [
        ["status", "=", "Approved"],
        ["project", "=", projectId],
      ],
      limit: 0,
    },
    projectId ? projectRootKeys.approvedServiceRequests(projectId) : null
  );

  useApiErrorLogger(projectEstimatesResponse.error, {
    hook: "useProjectViewFinancialData",
    api: "Project Estimates List",
    feature: "project-root",
    entity_id: projectId,
  });

  useApiErrorLogger(projectPaymentsResponse.error, {
    hook: "useProjectViewFinancialData",
    api: "Project Payments List",
    feature: "project-root",
    entity_id: projectId,
  });

  useApiErrorLogger(projectExpensesResponse.error, {
    hook: "useProjectViewFinancialData",
    api: "Project Expenses List",
    feature: "project-root",
    entity_id: projectId,
  });

  useApiErrorLogger(procurementRequestsResponse.error, {
    hook: "useProjectViewFinancialData",
    api: "Procurement Requests List",
    feature: "project-root",
    entity_id: projectId,
  });

  useApiErrorLogger(procurementOrdersResponse.error, {
    hook: "useProjectViewFinancialData",
    api: "Procurement Orders List",
    feature: "project-root",
    entity_id: projectId,
  });

  useApiErrorLogger(approvedServiceRequestsResponse.error, {
    hook: "useProjectViewFinancialData",
    api: "Approved Service Requests List",
    feature: "project-root",
    entity_id: projectId,
  });

  return {
    projectEstimatesResponse,
    projectPaymentsResponse,
    projectExpensesResponse,
    procurementRequestsResponse,
    procurementOrdersResponse,
    approvedServiceRequestsResponse,
  };
};
