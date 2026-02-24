import { useFrappeUpdateDoc, useFrappePostCall } from 'frappe-react-sdk';
import { useSWRConfig } from "swr";
import { vendorKeys } from './useVendorQueries';


export const useUpdateVendorDoc = () => {
  const { updateDoc, loading } = useFrappeUpdateDoc();
  const { mutate } = useSWRConfig();

  const wrappedUpdateDoc = async (
    doctype: string,
    name: string,
    data: any
  ) => {
    const result = await updateDoc(doctype, name, data);

    if (doctype === "Vendors") {
      await Promise.all([
        mutate(vendorKeys.vendorDoc(name)),
      ]);
    }
    if (doctype === "Address") {
      await mutate(vendorKeys.vendorAddress(name));
    }

    return result;
  };

  return { updateDoc: wrappedUpdateDoc, loading };
};




export const useCreateVendorAndAddress = () => {
  const { mutate } = useSWRConfig();
  const { call, loading } = useFrappePostCall(
    "nirmaan_stack.api.create_vendor_and_address.create_vendor_and_address"
  );

  const createVendor = async (payload: any) => {
    const result = await call(payload);

    // Refetch vendor list & doc count
    await Promise.all([
      mutate(vendorKeys.docCount()),
      mutate(vendorKeys.existingVendors()),
    ]);

    return result;
  };

  return {
    call: createVendor,
    createVendor,
    loading,
  };
};

