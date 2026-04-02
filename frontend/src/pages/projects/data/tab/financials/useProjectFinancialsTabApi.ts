import { useFrappeGetDocList } from "frappe-react-sdk";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

const financialsTabKeys = {
  inflows: (projectName: string) => ["project-tab", "financials", "inflows", projectName] as const,
  invoices: (projectName: string) => ["project-tab", "financials", "invoices", projectName] as const,
};

export const useProjectFinancialsTabData = (projectName?: string) => {
  const inflowsResponse = useFrappeGetDocList<ProjectInflows>(
    "Project Inflows",
    {
      fields: ["*"],
      filters: [["project", "=", projectName]],
      limit: 1000,
    },
    projectName ? financialsTabKeys.inflows(projectName) : null
  );

  const invoicesResponse = useFrappeGetDocList<ProjectInvoice>(
    "Project Invoices",
    {
      fields: ["*"],
      filters: [["project", "=", projectName]],
      limit: 1000,
    },
    projectName ? financialsTabKeys.invoices(projectName) : null
  );

  useApiErrorLogger(inflowsResponse.error, {
    hook: "useProjectFinancialsTabData",
    api: "Project Inflows List",
    feature: "projects-tab-financials",
    entity_id: projectName,
  });

  useApiErrorLogger(invoicesResponse.error, {
    hook: "useProjectFinancialsTabData",
    api: "Project Invoices List",
    feature: "projects-tab-financials",
    entity_id: projectName,
  });

  return { inflowsResponse, invoicesResponse };
};
