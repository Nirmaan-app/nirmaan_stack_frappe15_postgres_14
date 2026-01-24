/**
 * Service Requests tabs configuration
 * Used by ServiceRequestsTabs.tsx for consistent tab values and role-based access
 */

export const SR_TABS = {
  APPROVE_WO: 'approve-service-order',
  APPROVE_AMENDED: 'approve-amended-so',
  PENDING: 'choose-vendor',
  APPROVED: 'approved-sr',
  FINALIZED: 'finalized-sr',
} as const;

export type SRTabValue = typeof SR_TABS[keyof typeof SR_TABS];

export interface SRTabOption {
  label: string;
  value: SRTabValue;
  countKey: 'selected' | 'amended' | 'pending' | 'approved' | 'finalized';
}

export const SR_ADMIN_TAB_OPTIONS: SRTabOption[] = [
  { label: "Approve WO", value: SR_TABS.APPROVE_WO, countKey: 'selected' },
  { label: "Approve Amended WO", value: SR_TABS.APPROVE_AMENDED, countKey: 'amended' },
];

export const SR_COMMON_TAB_OPTIONS: SRTabOption[] = [
  { label: "Pending WO", value: SR_TABS.PENDING, countKey: 'pending' },
  { label: "Approved WO", value: SR_TABS.APPROVED, countKey: 'approved' },
  { label: "Finalized WO", value: SR_TABS.FINALIZED, countKey: 'finalized' },
];

export const SR_ADMIN_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Project Lead Profile",
];
