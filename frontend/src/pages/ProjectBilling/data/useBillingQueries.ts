// useSWRConfig MUST come from frappe-react-sdk: the sdk bundles its own SWR, so
// the one from "swr" holds a different cache and its mutate refreshes nothing.
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall, useSWRConfig } from "frappe-react-sdk";
import { useCallback } from "react";
import { BILLING_API, billingKeys } from "../billing.constants";
import { BILLING_PROFILES } from "@/constants/roles";
import type {
  BillingProjectsResponse,
  ManagerSummaryResponse,
  MyBillsResponse,
  ProjectBillingResponse,
} from "../types";

export const useProjectBilling = (project?: string) =>
  useFrappeGetCall<{ message: ProjectBillingResponse }>(
    BILLING_API.projectBilling,
    { project },
    project ? billingKeys.project(project) : null,
  );

export const useBillingProjects = () =>
  useFrappeGetCall<{ message: BillingProjectsResponse }>(BILLING_API.projects, {}, billingKeys.projects());

/** `deadline`: "week" / "overdue" / "none" counts only the pending bills in that ETA window. */
export const useManagerSummary = (deadline?: string) =>
  useFrappeGetCall<{ message: ManagerSummaryResponse }>(
    BILLING_API.managerSummary,
    deadline ? { deadline } : {},
    billingKeys.managerSummary(deadline),
    // Keep the grid on screen while a filter change refetches it.
    { keepPreviousData: true },
  );

export const useMyBills = () =>
  useFrappeGetCall<{ message: MyBillsResponse }>(BILLING_API.myBills, {}, billingKeys.myBills());

/** The billing package master list (Electrical, HVAC, …). */
export const useBillingPackages = () =>
  useFrappeGetDocList<{ name: string }>("Project Billing Packages", {
    fields: ["name"],
    orderBy: { field: "creation", order: "asc" },
    limit: 0,
  });

/** Users who can be a package's billing manager. */
export const useBillingManagers = () =>
  useFrappeGetDocList<{ email: string; full_name: string }>("Nirmaan Users", {
    fields: ["email", "full_name"],
    filters: [["role_profile", "in", [...BILLING_PROFILES]]],
    orderBy: { field: "full_name", order: "asc" },
    limit: 0,
  });

/** Refresh every billing read after a write. */
export const useRefreshBilling = () => {
  const { mutate } = useSWRConfig();
  return useCallback(
    () => mutate((key) => typeof key === "string" && key.startsWith("project-billing:")),
    [mutate],
  );
};

export const useBillingMutations = () => {
  const refresh = useRefreshBilling();
  const { call: setupCall, loading: setupLoading } = useFrappePostCall(BILLING_API.setup);
  const { call: saveCall, loading: saveLoading } = useFrappePostCall(BILLING_API.saveBill);
  const { call: deleteCall, loading: deleteLoading } = useFrappePostCall(BILLING_API.deleteBill);
  const { call: dcCall, loading: dcLoading } = useFrappePostCall(BILLING_API.addDc);

  const after = useCallback(
    async <T,>(p: Promise<T>) => {
      const result = await p;
      await refresh();
      return result;
    },
    [refresh],
  );

  return {
    setupBilling: (
      project: string,
      packages: { package: string; billing_managers: string[]; po_value: number }[],
    ) =>
      after(setupCall({ project, packages: JSON.stringify(packages) })),
    saveBill: (bill: Record<string, unknown>) => after(saveCall({ bill: JSON.stringify(bill) })),
    deleteBill: (name: string) => after(deleteCall({ name })),
    addDcEntry: (tracker: string, amount: number, dc_date?: string) => after(dcCall({ tracker, amount, dc_date })),
    loading: setupLoading || saveLoading || deleteLoading || dcLoading,
  };
};
