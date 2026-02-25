import { useFrappeUpdateDoc, useFrappePostCall, useFrappeAuth } from 'frappe-react-sdk';
import { useSWRConfig } from "swr";
import { vendorKeys } from './useVendorQueries';
import { captureApiError } from '@/utils/sentry/captureApiError';


export const useUpdateVendorDoc = () => {
  const { updateDoc, loading } = useFrappeUpdateDoc();
  const { mutate } = useSWRConfig();
  const { currentUser } = useFrappeAuth();

  const wrappedUpdateDoc = async (
    doctype: string,
    name: string,
    data: any
  ) => {
    try {
      const result = await updateDoc(doctype, name, data);

      try {
    if (doctype === "Vendors") {
      await Promise.all([
        mutate(vendorKeys.vendorDoc(name)),
      ]);
    }
    if (doctype === "Address") {
      await mutate(vendorKeys.vendorAddress(name));
    }
      } catch (invalidateError) {
        captureApiError({
          hook: "useUpdateVendorDoc",
          api: "SWR Invalidation",
          feature: "vendor",
          doctype,
          entity_id: name,
          error: invalidateError,
          user: currentUser ?? undefined,
        });
     }

    return result;
    } catch (error) {
      captureApiError({
        hook: "useUpdateVendorDoc",
        api: "Update Doc",
        feature: "vendor",
        doctype,
        entity_id: name,
        error,
        user: currentUser ?? undefined,
      });

      throw error;
    }
  };

  return { updateDoc: wrappedUpdateDoc, loading };
};




export const useCreateVendorAndAddress = () => {
  const { mutate } = useSWRConfig();
  const { currentUser } = useFrappeAuth();
  const { call, loading } = useFrappePostCall(
    "nirmaan_stack.api.create_vendor_and_address.create_vendor_and_address"
  );

  const createVendor = async (payload: any) => {
    try {
      const result = await call(payload);
      try {
        await Promise.all([
          mutate(vendorKeys.docCount()),
          mutate(vendorKeys.existingVendors()),
        ]);
      } catch (invalidateError) {
        captureApiError({
          hook: "useCreateVendorAndAddress",
          api: "SWR Invalidation",
          feature: "vendor",
          error: invalidateError,
          user: currentUser ?? undefined,
        });
      }

      return result;
    } catch (error) {
      captureApiError({
        hook: "useCreateVendorAndAddress",
        api: "Create Vendor And Address",
        feature: "vendor",
        error,
        user: currentUser ?? undefined,
      });

      throw error;
    }
  };

  return {
    call: createVendor,
    createVendor,
    loading,
  };
};

