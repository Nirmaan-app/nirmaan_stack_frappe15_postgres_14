import { useFrappeGetDoc } from 'frappe-react-sdk';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { Address } from '@/types/NirmaanStack/Address'; // Ensure this type is defined

export interface VendorDataHookResponse {
    vendor?: Vendors;
    vendorAddress?: Address;
    isLoading: boolean;
    error?: Error | null;
    mutateVendor: () => Promise<any>;
    mutateVendorAddress: () => Promise<any>;
}

export const useVendorData = (vendorId: string): VendorDataHookResponse => {
    const {
        data: vendor,
        error: vendorError,
        isLoading: vendorLoading,
        mutate: mutateVendor,
    } = useFrappeGetDoc<Vendors>("Vendors", vendorId, vendorId ? `Vendors ${vendorId}` : null, {
      revalidateOnFocus: false
      });

    const {
        data: vendorAddress,
        error: addressError,
        isLoading: addressLoading,
        mutate: mutateVendorAddress,
    } = useFrappeGetDoc<Address>("Address", vendor?.vendor_address || '', vendor?.vendor_address ? `Address ${vendor?.vendor_address}` : null, {
        revalidateOnFocus: false
    });

    return {
        vendor,
        vendorAddress,
        isLoading: vendorLoading || (!!vendor?.vendor_address && addressLoading),
        error: vendorError || addressError || null,
        mutateVendor,
        mutateVendorAddress,
    };
};