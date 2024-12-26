import {
  useFrappeGetDoc,
  useFrappeUpdateDoc,
  useSWRConfig,
} from "frappe-react-sdk";
import { useForm } from "react-hook-form";
import * as z from "zod";
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
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ListChecks, ListRestart } from "lucide-react";
import useCustomFetchHook from "@/reactQuery/customFunctions";
import { useToast } from "@/components/ui/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
const CustomerFormSchema = z.object({
  company_name: z
    .string({
      required_error: "Company Name is Required",
    })
    .min(3, {
      message: "Must be at least 3 characters.",
    }),
  company_email: z.string().email().optional().or(z.literal("")),
  company_phone: z
    .string({
      required_error: "Must Provide Customer Contact",
    })
    .max(10, { message: "Mobile number must be of 10 digits" })
    .min(10, { message: "Mobile number must be of 10 digits" }),
  company_contact_person: z
    .string({
      required_error: "Contact Person is required",
    })
    .min(3, "Must be at least 3 characters."),
  company_gst: z
    .string({
      required_error: "Customer GST Required",
    })
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/, {
      message: "Invalid GST format. Example: 22AAAAA0000A1Z5",
    })
    .optional(),
  address_line1: z
    .string({
      required_error: "Address Line 1 Required",
    })
    .min(1, {
      message: "Address Line 1 Required",
    }),
  address_line2: z.string().optional(),
  pin_code: z
    .string({
      required_error: "Must provide Pincode",
    })
    .max(6, { message: "Pincode must be of 6 digits" })
    .min(6, { message: "Pincode must be of 6 digits" }),
});

type CustomerFormValues = z.infer<typeof CustomerFormSchema>;

const EditCustomer = ({ toggleEditSheet }) => {
  const navigate = useNavigate();

  const { customerId: id } = useParams<{ customerId: string }>();

  const { data, mutate: customerMutate } = useFrappeGetDoc(
    "Customers",
    id,
    `Customers ${id}`,
    {
      revalidateIfStale: false,
    }
  );

  const companyAddress = data?.company_address;

  const { data: addressData, mutate: addressMutate } = useFrappeGetDoc(
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

  const {
    data: pincode_data,
    isLoading: pincode_loading,
    error: pincode_error,
  } = useFrappeGetDoc("Pincodes", pincode, `Pincodes ${pincode}`);

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
    defaultValues: {
      company_name: data?.company_name || "",
      company_email: data?.company_email || "",
      company_phone: data?.company_phone || "",
      company_contact_person: data?.company_contact_person || "",
      company_gst: data?.company_gst || "",
      address_line1: addressData?.address_line1 || "",
      address_line2: addressData?.address_line2 || "",
      pin_code: addressData?.pincode || "",
    },
    mode: "onBlur",
  });

  useEffect(() => {
    if (data && addressData) {
      form.reset({
        company_name: data?.company_name,
        company_email: data?.company_email,
        company_phone: data?.company_phone,
        company_contact_person: data?.company_contact_person,
        company_gst: data?.company_gst,
        address_line1: addressData?.address_line1,
        address_line2: addressData?.address_line2,
        pin_code: addressData?.pincode,
      });
    }

    setPincode(addressData?.pincode);
  }, [data, addressData, form]);

  const hasChanges = () => {
    const values = form.getValues();
    const originalValues = {
      company_name: data?.company_name || "",
      company_email: data?.company_email || "",
      company_phone: data?.company_phone || "",
      company_contact_person: data?.company_contact_person || "",
      company_gst: data?.company_gst || "",
      address_line1: addressData?.address_line1 || "",
      address_line2: addressData?.address_line2 || "",
      pin_code: addressData?.pincode || "",
    };
    return JSON.stringify(values) !== JSON.stringify(originalValues);
  };

  const updateCustomerDetails = async (values: CustomerFormValues) => {
    const hasCustomerChanged =
      data?.company_name !== values.company_name ||
      data?.company_email !== values.company_email ||
      data?.company_phone !== values.company_phone ||
      data?.company_contact_person !== values.company_contact_person ||
      data?.company_gst !== values.company_gst;

    if (hasCustomerChanged) {
      await updateDoc("Customers", id, {
        company_name: values.company_name,
        company_email: values.company_email,
        company_phone: values.company_phone,
        company_contact_person: values.company_contact_person,
        company_gst: values.company_gst,
      });
      customerMutate();
    }
  };

  const updateAddressDetails = async (values: CustomerFormValues) => {
    const hasAddressChanged =
      addressData?.address_line1 !== values.address_line1 ||
      addressData?.address_line2 !== values.address_line2 ||
      addressData?.city !== city ||
      addressData?.state !== state ||
      addressData?.pincode !== values.pin_code;

    if (hasAddressChanged) {
      await updateDoc("Address", companyAddress, {
        address_title: values.company_name,
        address_line1: values.address_line1,
        address_line2: values.address_line2,
        city: city,
        state: state,
        pincode: values.pin_code,
        email_id: values.company_email,
        phone: values.company_phone,
      });
      addressMutate();
    }
  };

  const { fetchDocList } = useCustomFetchHook();

  const onSubmit = async (values: CustomerFormValues) => {
    try {
      if (city === "Not Found" || state === "Not Found") {
        throw new Error(
          'City and State are "Note Found", Please Enter a Valid Pincode'
        );
      }
      await updateCustomerDetails(values);
      await updateAddressDetails(values);

      await mutate(
        "Customers",
        async () => {
          const data = await fetchDocList("Customers");
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
                  Company Phone<sup className="text-sm text-red-600">*</sup>
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
                  <sup className="text-sm text-red-600">*</sup>
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
