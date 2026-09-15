import { VALIDATION_CONFIG, ValidationError } from "@/components/validations/ValidationTypes";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { useMemo } from "react";

export const usePOValidation = (po: ProcurementOrder | null) => {
  const errors: ValidationError[] = [];

  const {data: vendorData} = useFrappeGetDoc<Vendors>("Vendors", po?.vendor, po ? undefined : null);
    
  const vendorDependency = useMemo(() => !vendorData?.vendor_contact_person_name || !vendorData?.vendor_mobile, [vendorData]);

  // ⚠️ DELIBERATELY NOT PUSHED INTO `errors`.
  // `errors` / `isValid` gate send-for-approval, dispatch and the GST+notes editor on four
  // other screens. A vendor with no bank row is still a perfectly dispatchable PO, so folding
  // this in would block work that has nothing to do with money leaving the account.
  // It gates exactly ONE action — requesting a payment — because the bank transfer file is
  // built from account_number + ifsc, and a row missing either is rejected by ICICI and
  // Cashfree only AFTER upload.
  //
  // BOTH halves are required: an account number on its own still exports a blank IFSC.
  //
  // Gated on `vendorData` being present, so a vendor doc that is still loading (or failed to
  // load) reads as "not missing" and the request goes through as it does today. Blocking on
  // an absent fetch would turn a slow network into a hard stop with a misleading reason.
  const missingVendorBankDetails = useMemo(() => {
    if (!vendorData) return false;
    const account = String(vendorData.account_number ?? "").trim();
    const ifsc = String(vendorData.ifsc ?? "").trim();
    return !account || !ifsc;
  }, [vendorData]);
  
  if (!po?.project_gst) {
    errors.push(VALIDATION_CONFIG.MISSING_GST);
  }
  
  if (vendorDependency) { // Implement vendor check logic
    errors.push({...VALIDATION_CONFIG.INCOMPLETE_VENDOR, link: `/vendors/${po?.vendor}`});
  }

  return {
    errors,
    isValid: errors.length === 0,
    hasMissingGST: errors.some(e => e.code === 'MISSING_GST'),
    hasVendorIssues: errors.some(e => e.code === 'INCOMPLETE_VENDOR'),
    missingVendorBankDetails,
  };
};