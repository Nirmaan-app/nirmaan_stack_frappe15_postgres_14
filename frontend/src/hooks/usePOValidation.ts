import { VALIDATION_CONFIG, ValidationError } from "@/components/validations/ValidationTypes";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { useMemo } from "react";

export const usePOValidation = (po: ProcurementOrder | null) => {
  const errors: ValidationError[] = [];

  const {data: vendorData} = useFrappeGetDoc<Vendors>("Vendors", po?.vendor, po ? undefined : null);
    
  const vendorDependency = useMemo(() => !vendorData?.vendor_contact_person_name || !vendorData?.vendor_mobile, [vendorData]);
  
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
    hasVendorIssues: errors.some(e => e.code === 'INCOMPLETE_VENDOR')
  };
};