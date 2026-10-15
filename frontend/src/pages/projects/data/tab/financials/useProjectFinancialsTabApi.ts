import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { ProjectMoney } from "@/types/NirmaanStack/ProjectMoney";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

const financialsTabKeys = {
  inflows: (projectName: string) => ["project-tab", "financials", "inflows", projectName] as const,
  invoices: (projectName: string) => ["project-tab", "financials", "invoices", projectName] as const,
  money: (projectName: string) => ["project-tab", "financials", "money", projectName] as const,
};

export const useProjectMoney = (projectName?: string) => {
  const response = useFrappeGetCall<{ message: ProjectMoney }>(
    "nirmaan_stack.api.projects.project_money.get_project_money",
    { project: projectName },
    projectName ? financialsTabKeys.money(projectName) : null
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectMoney",
    api: "get_project_money",
    feature: "projects-tab-financials",
    entity_id: projectName,
  });

  return response;
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
