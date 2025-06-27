// src/pages/ProcurementRequests/VendorQuotesSelection/types/paymentTerms.ts

// This interface is required for the 'Term' type
export interface PaymentTermMilestone {
  id: string; // For unique key in React
  name: string;
  amount: number;
  percentage: number;
  due_date?: string; // Optional due date
}

export interface VendorPaymentTerm {
  // --- CHANGE: Added 'Term' back to the type options ---
  type:'Credit' | 'Delivery against payment';
  total_po_amount: number;
  // --- CHANGE: 'terms' is optional, as it only applies when type is 'Term' ---
  terms?: PaymentTermMilestone[];
}

// This remains the best structure for UI state
export interface PaymentTermsData {
  [vendorId: string]: VendorPaymentTerm;
}