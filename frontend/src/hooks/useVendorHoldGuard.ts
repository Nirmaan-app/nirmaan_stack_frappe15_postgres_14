import { useFrappeGetDoc } from "frappe-react-sdk";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { useToast } from "@/components/ui/use-toast";
import { useCallback } from "react";
import formatToIndianRupee from "@/utils/FormatPrice";

interface VendorHoldGuardResult {
  isOnHold: boolean;
  isLoading: boolean;
  vendorStatus: string | undefined;
  availableCredit: number | undefined;
  creditLimit: number | undefined;
  showBlockedToast: () => void;
}

export function useVendorHoldGuard(vendorId: string | undefined): VendorHoldGuardResult {
  const { toast } = useToast();

  const { data: vendor, isLoading } = useFrappeGetDoc<Vendors>(
    "Vendors",
    vendorId,
    vendorId ? undefined : null
  );

  const isOnHold = vendor?.vendor_status === "On-Hold";
  const availableCredit = vendor?.available_credit;
  const creditLimit = vendor?.credit_limit;

  const showBlockedToast = useCallback(() => {
    const formatted = formatToIndianRupee(availableCredit);
    toast({
      title: "Vendor On Hold",
      description: `This vendor has exceeded their credit limit. Available credit: ${formatted}. Contact Admin/PMO to adjust credit limit.`,
      variant: "destructive",
    });
  }, [toast, availableCredit]);

  return {
    isOnHold,
    isLoading,
    vendorStatus: vendor?.vendor_status,
    availableCredit,
    creditLimit,
    showBlockedToast,
  };
}
