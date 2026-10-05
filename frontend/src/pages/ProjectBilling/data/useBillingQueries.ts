// useSWRConfig MUST come from frappe-react-sdk: the sdk bundles its own SWR, so
// the one from "swr" holds a different cache and its mutate refreshes nothing.
import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeGetCall,
  useFrappeGetDocList,
  useFrappePostCall,
  useSWRConfig,
} from "frappe-react-sdk";
import { useCallback } from "react";
import { BILLING_API, billingKeys } from "../billing.constants";
import { BILLING_PROFILES } from "@/constants/roles";
import type {
  BillingProjectsResponse,
  ManagerSummaryResponse,
  MyBillsResponse,
  PackageRemovalSummary,
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

/** The billing package master list (Electrical, HVAC, …): the pickers and the Billing Packages tab. */
export const useBillingPackages = () =>
  useFrappeGetDocList<{ name: string }>(
    "Project Billing Packages",
    {
      fields: ["name"],
      orderBy: { field: "creation", order: "asc" },
      limit: 0,
    },
    billingKeys.packages(),
  );

/** What removing a package from its project would delete; fetched only while the warning is open. */
export const usePackageRemovalSummary = (tracker: string | null) =>
  useFrappeGetCall<{ message: PackageRemovalSummary }>(
    BILLING_API.packageRemovalSummary,
    { tracker },
    tracker ? billingKeys.removalSummary(tracker) : null,
  );

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
  const { call: dcCall, loading: dcLoading } = useFrappePostCall(BILLING_API.addDc);
  // Adding and deleting a package is a single document, so the standard document API does it;
  // the `Project Billing Packages` hooks check who may, duplicates and packages in use.
  const { createDoc, loading: addPackageLoading } = useFrappeCreateDoc();
  const { deleteDoc, loading: deletePackageLoading } = useFrappeDeleteDoc();
  const { call: renamePackageCall, loading: renamePackageLoading } = useFrappePostCall(BILLING_API.renamePackage);
  const { call: removePackageCall, loading: removePackageLoading } = useFrappePostCall(BILLING_API.removeProjectPackage);

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
    addDcEntry: (tracker: string, amount: number, dc_date?: string) => after(dcCall({ tracker, amount, dc_date })),
    addPackage: (package_name: string) => after(createDoc("Project Billing Packages", { package_name })),
    deletePackage: (name: string) => after(deleteDoc("Project Billing Packages", name)),
    renamePackage: (name: string, new_name: string) => after(renamePackageCall({ name, new_name })),
    /** Admin: remove a package and all its bills from its project; `confirm_name` is the typed package name. */
    removeProjectPackage: (tracker: string, confirm_name: string) => after(removePackageCall({ tracker, confirm_name })),
    loading:
      setupLoading ||
      saveLoading ||
      dcLoading ||
      addPackageLoading ||
      deletePackageLoading ||
      renamePackageLoading ||
      removePackageLoading,
  };
};
