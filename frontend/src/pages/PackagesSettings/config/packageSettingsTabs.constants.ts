import React from "react";


const WorkHeaderMilestones = React.lazy(() =>
  import("@/components/workHeaderMilestones").then((module) => ({
    default: module.WorkHeaderMilestones,
  }))
);

const ProcurementPackages = React.lazy(() =>
  import("@/components/procurement-packages").then((module) => ({
    default: module.ProcurementPackages,
  }))
);

const DesignPackages = React.lazy(() =>
  import("@/components/design-packages").then((module) => ({
    default: module.DesignPackages,
  }))
);

const CommissionPackages = React.lazy(() =>
  import("@/components/commission-packages").then((module) => ({
    default: module.CommissionPackages,
  }))
);

const PRHeaderPackages = React.lazy(() =>
  import("@/components/PRHeaderTagMaster").then((module) => ({
    default: module.PRHeaderTagMaster,
  }))
);

const PMOPackages = React.lazy(() =>
  import("@/components/pmo-packages").then((module) => ({
    default: module.PMOPackages,
  }))
);

const CriticalPOCategories = React.lazy(() =>
  import("@/components/layout/critical-po-categories").then((module) => ({
    default: module.CriticalPOCategories,
  }))
);

export const PACKAGE_SETTINGS_TABS = {
  MILESTONE_PACKAGES: "milestone-packages",
  PRODUCT_PACKAGES: "product-packages",
  DESIGN_PACKAGES: "design-packages",
  COMMISSION_PACKAGES: "commission-packages",
  PR_HEADER_PACKAGES: "pr-header-packages",
  PMO_PACKAGES: "pmo-packages",
  CRITICAL_PO_CATEGORIES: "critical-po-categories",
} as const;

export type PackageSettingsTabValue =
  (typeof PACKAGE_SETTINGS_TABS)[keyof typeof PACKAGE_SETTINGS_TABS];

export interface PackageSettingsTabOption {
  label: string;
  value: PackageSettingsTabValue;
  component: React.LazyExoticComponent<React.ComponentType>;
}

export const PACKAGE_SETTINGS_TAB_OPTIONS: PackageSettingsTabOption[] = [
  {
    label: "DPR Packages",
    value: PACKAGE_SETTINGS_TABS.MILESTONE_PACKAGES,
    component: WorkHeaderMilestones,
  },
  {
    label: "Product Packages",
    value: PACKAGE_SETTINGS_TABS.PRODUCT_PACKAGES,
    component: ProcurementPackages,
  },
  {
    label: "Design Packages",
    value: PACKAGE_SETTINGS_TABS.DESIGN_PACKAGES,
    component: DesignPackages,
  },
  {
    label: "Commission Packages",
    value: PACKAGE_SETTINGS_TABS.COMMISSION_PACKAGES,
    component: CommissionPackages,
  },
  {
    label: "PR Header Packages",
    value: PACKAGE_SETTINGS_TABS.PR_HEADER_PACKAGES,
    component: PRHeaderPackages,
  },
  {
    label: "PMO Packages",
    value: PACKAGE_SETTINGS_TABS.PMO_PACKAGES,
    component: PMOPackages,
  },
  {
    label: "Critical PO Categories",
    value: PACKAGE_SETTINGS_TABS.CRITICAL_PO_CATEGORIES,
    component: CriticalPOCategories,
  },
];

export const PACKAGE_SETTINGS_TAB_VALUES = new Set(
  PACKAGE_SETTINGS_TAB_OPTIONS.map((option) => option.value)
);
