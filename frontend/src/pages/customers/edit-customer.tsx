import {
  useFrappeGetDoc,
  useFrappeUpdateDoc,
  useSWRConfig,
} from "@/lib/frappe";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useParams } from "react-router-dom";
import { ListChecks, ListRestart } from "lucide-react";
import useCustomFetchHook from "@/reactQuery/customFunctions";
import { useToast } from "@/components/ui/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { CustomersDocType } from "@/types/doctypes/Customers";
import { PincodesDocType } from "@/types/doctypes/Pincodes";
import { Address } from "@/types/NirmaanStack/Address";
import { sendCustomerSave } from "@/utils/customers/customerSaveUpdates";
import { CustomerFormSchema, customerFormChanged, customerFormValues, type CustomerFormValues } from "@/utils/customers/customerForm";

const EditCustomer = ({ toggleEditSheet }: { toggleEditSheet: () => void }) => {

  const { customerId: id } = useParams<{ customerId: string }>();

  const { data, mutate: customerMutate } = useFrappeGetDoc<CustomersDocType>(
    "Customers",
    id,
    `Customers ${id}`,
    {
      revalidateIfStale: false,
    }
  );

  const companyAddress = data?.company_address ?? undefined;

  const { data: addressData, mutate: addressMutate } = useFrappeGetDoc<Address>(
    "Address",
    companyAddress,
    `Address ${companyAddress}`,
    {
      revalidateIfStale: false,
    }
  );

  const { updateDoc, loading, error: submit_error } = useFrappeUpdateDoc();
  const { toast } = useToast();
  const { mutate } = useSWRConfig();
  const [city, setCity] = useState(addressData?.city || "");
  const [state, setState] = useState(addressData?.state || "");
  const [pincode, setPincode] = useState("");

  const { data: pincode_data } = useFrappeGetDoc<PincodesDocType>(
    "Pincodes",
    pincode,
    `Pincodes ${pincode}`
  );

  const debouncedFetch = useCallback((value: string) => {
    if (value.length >= 6) {
      setPincode(value);
    } else {
      setPincode("");
    }
  }, []);

  useEffect(() => {
    if (pincode.length >= 6 && !pincode_data) {
      setCity("Not Found");
      setState("Not Found");
    } else {
      setCity(pincode_data?.city || "");
      setState(pincode_data?.state || "");
    }
  }, [pincode_data]);

  const handlePincodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    debouncedFetch(value);
  };

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(CustomerFormSchema),
    defaultValues: customerFormValues(data, addressData),
    mode: "onBlur",
  });

  useEffect(() => {
    if (data && addressData) {
      form.reset(customerFormValues(data, addressData));
    }

    setPincode(addressData?.pincode ?? "");
  }, [data, addressData, form]);

  const hasChanges = () => customerFormChanged(form.getValues(), data, addressData);

  const { fetchDocList } = useCustomFetchHook();

  const onSubmit = async (values: CustomerFormValues) => {
    try {
      if (city === "Not Found" || state === "Not Found") {
        throw new Error(
          'City and State are "Note Found", Please Enter a Valid Pincode'
        );
      }
      await sendCustomerSave(
        { customerId: id, addressId: companyAddress, customer: data, address: addressData, values, city, state },
        async (update) => {
          await updateDoc(update.doctype, update.name, update.fields);
          if (update.doctype === "Customers") customerMutate();
          else addressMutate();
        }
      );

      await mutate<unknown[]>(
        "Customers",
        async () => {
          const data: unknown[] = await fetchDocList("Customers");
          return data;
        },
        {
          rollbackOnError: true,
          populateCache: (newData, currentData) => newData || currentData,
          revalidate: true,
          throwOnError: true,
        }
      );

      toast({
        title: "Success",
        description: `${values.company_name} details updated successfully!`,
        variant: "success",
      });

      toggleEditSheet();
    } catch (error) {
      toast({
        title: "Failed!",
        description: `${error}`,
        variant: "destructive",
      });
      console.error("Error updating customer:", submit_error, error);
    }
  };

  return (
    <div className="flex-1">
      <Form {...form}>
        <form
          onSubmit={(event) => {
            event.stopPropagation();
            return form.handleSubmit(onSubmit)(event);
          }}
          className="space-y-4 px-6 max-md:px-2"
        >
          <FormField
            control={form.control}
            name="company_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Company Name<sup className="text-sm text-red-600">*</sup>
                </FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="customer_nickname"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Nickname<sup className="text-sm text-red-600">*</sup>
                </FormLabel>
                <FormControl>
                  <Input placeholder="Short, memorable name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="company_email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Company Email</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="company_phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Company Phone
                </FormLabel>
                <FormControl>
                  <Input type="number" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="company_contact_person"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Company Contact Person
                </FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="company_gst"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Company GST number</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Separator className="my-3" />
          <p className="text-sky-600 font-semibold pb-2">
            Customer Address Details
          </p>
          <FormField
            control={form.control}
            name="address_line1"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Address Line 1<sup className="text-sm text-red-600">*</sup>
                </FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address_line2"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Address Line 2</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormItem>
            <FormLabel>
              City<sup className="text-sm text-red-600">*</sup>
            </FormLabel>
            <FormControl>
              <Input disabled type="text" value={city} />
            </FormControl>
          </FormItem>
          <FormItem>
            <FormLabel>
              State<sup className="text-sm text-red-600">*</sup>
            </FormLabel>
            <FormControl>
              <Input disabled type="text" value={state} />
            </FormControl>
          </FormItem>
          <FormField
            control={form.control}
            name="pin_code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Pin Code<sup className="text-sm text-red-600">*</sup>
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    {...field}
                    onChange={(e) => {
                      field.onChange(e);
                      handlePincodeChange(e);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                form.reset();
                form.clearErrors();
              }}
              className="flex items-center gap-1"
            >
              <ListRestart className="h-4 w-4" />
              Reset
            </Button>
            <Button
              type="submit"
              disabled={!hasChanges() || loading}
              className="flex items-center gap-1"
            >
              <ListChecks className="h-4 w-4" />
              {loading ? "Updating..." : "Update"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default EditCustomer;
