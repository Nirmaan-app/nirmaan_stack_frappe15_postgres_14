import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

const financialsTabKeys = {
  inflows: (projectName: string) => ["project-tab", "financials", "inflows", projectName] as const,
  invoices: (projectName: string) => ["project-tab", "financials", "invoices", projectName] as const,
  money: (projectName: string) => ["project-tab", "financials", "money", projectName] as const,
};

/**
 * A project's money, worked out on the server (`services/project_money`, ADR-0034): the figures CEO
 * Hold and the Projects list also read. `outflow` is cash (Paid payments less Received Vendor Refunds,
 * plus Paid expenses) and is the sum of its three parts.
 */
export interface ProjectMoney {
  po_outflow: number;
  wo_outflow: number;
  expense_outflow: number;
  outflow: number;
  liabilities: number;
  inflow: number;
  cashflow_gap: number;
}

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
