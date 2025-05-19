// src/constants.ts (or a relevant config/constants folder)

import { PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";

export const ROUTE_PATHS = {
  PROCUREMENT_REQUEST_DETAILS: (prId: string) => `/prs&milestones/procurement-requests/${prId}`,
  PROCUREMENT_ORDER_DETAILS: (prId: string, poIdEncoded: string) => `/prs&milestones/procurement-requests/${prId}/${poIdEncoded}`,
  // Add other relevant paths if needed
};

export const DOCUMENT_PREFIX = {
  DELIVERY_NOTE: "DN",
  PURCHASE_ORDER: "PO",
};

// Badge variants mapping - makes the template cleaner
export const STATUS_BADGE_VARIANT: { [key: string]: 'default' | 'secondary' | 'destructive' | 'outline' | 'green' | 'orange' } = {
  'Dispatched': 'orange',
  'Delivered': 'green', // Example, add others as needed
  'Received': 'green',
  'Pending': 'secondary',
  // Default or fallback
  'default': 'outline',
};

// Potentially move addresses here or fetch from backend config
export const COMPANY_ADDRESS_BY_GST: { [key: string]: string } = {
  "29ABFCS9095N1Z9": "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka",
  "06ABFCS9095N1ZH": "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002",
  "default": "Company Address Not Configured for this GSTIN",
};

// Helper for safe JSON parsing
export const safeJsonParse = <T>(jsonString: string | T | undefined, defaultValue: T): T => {
  if (!jsonString) {
    return defaultValue;
  }
  try {
    if(typeof jsonString === "string") {
      return JSON.parse(jsonString) as T;
    } else {
      return jsonString as T
    }
  } catch (error) {
    console.error("Failed to parse JSON:", error, "String was:", jsonString);
    return defaultValue;
  }
};

// Helper for ID manipulation (more descriptive)
export const decodeFrappeId = (encodedId: string): string => encodedId.replaceAll("&=", "/");
export const encodeFrappeId = (decodedId: string): string => decodedId.replaceAll("/", "&=");

export const derivePoIdFromDnId = (dnId: string): string => dnId.replace(DOCUMENT_PREFIX.DELIVERY_NOTE, DOCUMENT_PREFIX.PURCHASE_ORDER);
export const deriveDnIdFromPoId = (poId: string): string => poId.replace(DOCUMENT_PREFIX.PURCHASE_ORDER, DOCUMENT_PREFIX.DELIVERY_NOTE);
export const formatDisplayId = (id: string | undefined, prefix: string): string => {
    if (!id) return `Invalid ID`;
    // Assumes format like PREFIX/NUMBER
    const parts = id.split('/');
    return parts.length > 1 ? `${prefix}-${parts[1]}` : id;
}