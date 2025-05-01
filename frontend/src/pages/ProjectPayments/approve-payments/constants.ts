// src/constants.ts
export const DOC_TYPES = {
  PROJECTS: "Projects" as const,
  VENDORS: "Vendors" as const,
  PROJECT_PAYMENTS: "Project Payments" as const,
  PROCUREMENT_ORDERS: "Procurement Orders" as const,
  SERVICE_REQUESTS: "Service Requests" as const,
};

export const PAYMENT_STATUS = {
  REQUESTED: "Requested" as const,
  APPROVED: "Approved" as const,
  REJECTED: "Rejected" as const,
  PAID: "Paid" as const,
};

export const DIALOG_ACTION_TYPES = {
  APPROVE: "approve" as const,
  REJECT: "reject" as const,
  EDIT: "edit" as const,
};

// You can define types based on these constants
export type DialogActionType = typeof DIALOG_ACTION_TYPES[keyof typeof DIALOG_ACTION_TYPES];