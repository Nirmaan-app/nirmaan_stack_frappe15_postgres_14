import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

export interface InvoicesDataCallResponse {
  message: {
    invoice_entries: Array<{
      name: string;
      invoice_amount: number;
      invoice_no: string;
      invoice_date: string;
      uploaded_by: string;
      invoice_attachment_id: string;
      document_name: string;
      document_type: "Procurement Orders" | "Service Requests";
      vendor: string;
      vendor_name: string;
      amount?: number;
      date?: string;
      updated_by?: string;
      procurement_order?: string;
    }>;
    total_invoices: number;
    total_amount: number;
  };
  status: number;
}

const projectWiseInvoicesKeys = {
  invoices: (projectId: string) => ["project-tab", "project-wise-invoices", "invoices", projectId] as const,
  attachments: (projectId: string) => ["project-tab", "project-wise-invoices", "attachments", projectId] as const,
};

export const useProjectWiseInvoicesApi = (projectId?: string) => {
  const invoicesResponse = useFrappeGetCall<{ message: InvoicesDataCallResponse }>(
    "nirmaan_stack.api.projects.project_wise_invoice_data.generate_project_wise_invoice_data",
    { project_id: projectId },
    projectId ? projectWiseInvoicesKeys.invoices(projectId) : null
  );

  const attachmentsResponse = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "attachment"],
      filters: [["project", "=", projectId]],
      limit: 100,
    },
    projectId ? projectWiseInvoicesKeys.attachments(projectId) : null
  );

  useApiErrorLogger(invoicesResponse.error, {
    hook: "useProjectWiseInvoicesApi",
    api: "generate_project_wise_invoice_data",
    feature: "projects-tab-project-wise-invoices",
    entity_id: projectId,
  });

  useApiErrorLogger(attachmentsResponse.error, {
    hook: "useProjectWiseInvoicesApi",
    api: "Nirmaan Attachments",
    feature: "projects-tab-project-wise-invoices",
    entity_id: projectId,
  });

  return {
    invoicesResponse,
    attachmentsResponse,
  };
};
