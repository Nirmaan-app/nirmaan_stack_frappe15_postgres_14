import { useFrappeGetCall } from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { CustomerLedgerTransaction } from "@/pages/customers/data/useCustomerLedger";

export const projectLedgerKey = (projectId: string) =>
  ["project", "ledgerData", projectId] as const;

/** Same rows the customer ledger shows, narrowed to one project. */
export const useProjectLedgerData = (projectId: string) => {
  const response = useFrappeGetCall<{ message: CustomerLedgerTransaction[] }>(
    "nirmaan_stack.api.projects.project_ledger.get_project_ledger_data",
    { project_id: projectId },
    projectId ? projectLedgerKey(projectId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useProjectLedgerData",
    api: "get_project_ledger_data",
    feature: "project",
    entity_id: projectId,
  });
  return response;
};
