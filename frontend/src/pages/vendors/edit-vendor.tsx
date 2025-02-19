import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { ListChecks, ListRestart } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import ReactSelect from "react-select";
import * as z from "zod";

const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

const getVendorFormSchema = (service: boolean, isTaxGSTType: boolean) => {
    const vendorGstSchema = isTaxGSTType
        ? z
            .string({
              required_error: "Vendor GST is required",
            })
            .regex(GST_REGEX, {
              message: "Invalid GST format. Example: 22AAAAA0000A1Z5",
            })
        : z
            .string({
              required_error: "Vendor PAN is required",
            })
            .regex(PAN_REGEX, {
              message: "Invalid PAN format. Example: ABCDE1234F",
            });
  
    const finalVendorGstSchema = service ? vendorGstSchema.optional() : vendorGstSchema;
    return z.object({
        vendor_contact_person_name: z
            .string()
            .optional(),
        vendor_name: z
            .string({
                required_error: "Must provide Vendor Name"
            })
            .min(3, {
                message: "Must be at least 3 characters.",
            }),
        address_line_1: z
            .string({
                required_error: "Address Line 1 Required"
            }).min(1, {
                message: "Address Line 1 Required"
            }),
        address_line_2: z
            .string({
                required_error: "Address Line 2 Required"
            }).min(1, {
                message: "Address Line 2 Required"
            }),
        // vendor_city: z
        //     .string({
        //         required_error: "Must Provide City"
        //     })
        //     .min(1, {
        //         message: "Must Provide City"
        //     }),
        // vendor_state: z
        //     .string({
        //         required_error: "Must Provide State"
        //     })
        //     .min(1, {
        //         message: "Must Provide State"
        //     }),
        pin: z
            .string({
                required_error: "Must provide pincode"
            })
            .max(6, { message: "Pincode must be of 6 digits" })
            .min(6, { message: "Pincode must be of 6 digits" }),
        vendor_email: z
            .string()
            .email()
            .optional(),
        vendor_mobile: z
            .string({
                required_error: "Must provide contact"
            })
            .max(10, { message: "Mobile number must be of 10 digits" })
            .min(10, { message: "Mobile number must be of 10 digits" })
            .optional(),
        // vendor_gst: z
        //     .string({
        //         required_error: "Vendor GST Required"
        //     })
        //     .min(1, {
        //         message: "Vendor GST Required"
        //     })
        //     .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/, {
        //         message: "Invalid GST format. Example: 22AAAAA0000A1Z5"
        //     }),
        vendor_gst: finalVendorGstSchema,
        account_number: z.string().optional(),
        account_name: z.string().optional(),
        bank_name: z.string().optional(),
        bank_branch: z.string().optional(),
        ifsc: z.string().optional(),
    })
};

type VendorFormValues = z.infer<ReturnType<typeof getVendorFormSchema>>;

interface SelectOption {
  label: string;
  value: string;
}

export const EditVendor = ({ toggleEditSheet }) => {

  const { vendorId: id } = useParams<{ vendorId: string }>();
  const { data, mutate: vendorMutate } = useFrappeGetDoc(
    "Vendors",
    `${id}`,
    `Vendors ${id}`
  );

  const {
    data: vendorAddress,
    mutate: addressMutate,
  } = useFrappeGetDoc(
    "Address",
    data?.vendor_address,
    `Address ${data?.vendor_address}`,
    {
      revalidateIfStale: false,
    }
  );

  const [vendorChange, setVendorChange] = useState(false)
  const [taxationType, setTaxationType] = useState<string | null>("GST")

  const VendorFormSchema = getVendorFormSchema(data?.vendor_type === "Service" && !vendorChange, taxationType === "GST");

  const form = useForm<VendorFormValues>({
    resolver: zodResolver(VendorFormSchema),
    defaultValues: {
      vendor_contact_person_name: data?.vendor_contact_person_name,
      vendor_name: data?.vendor_name,
      address_line_1: vendorAddress?.address_line1,
      address_line_2: vendorAddress?.address_line2,
      pin: vendorAddress?.pincode,
      vendor_email: data?.vendor_email,
      vendor_mobile: data?.vendor_mobile,
      vendor_gst: data?.vendor_gst,
      account_number: data?.account_number,
      account_name: data?.account_name,
      bank_name: data?.bank_name,
      bank_branch: data?.bank_branch,
      ifsc: data?.ifsc,
    },
    mode: "onBlur",
  });

  useEffect(() => {
    if (data && vendorAddress) {
      form.reset({
        vendor_contact_person_name: data?.vendor_contact_person_name,
        vendor_name: data?.vendor_name,
        address_line_1: vendorAddress?.address_line1,
        address_line_2: vendorAddress?.address_line2,
        pin: vendorAddress?.pincode,
        vendor_email: data?.vendor_email,
        vendor_mobile: data?.vendor_mobile,
        vendor_gst: data?.vendor_gst,
        account_number: data?.account_number,
        account_name: data?.account_name,
        bank_name: data?.bank_name,
        bank_branch: data?.bank_branch,
        ifsc: data?.ifsc,
      });
      setPincode(vendorAddress?.pincode);
      if(data?.vendor_gst) {
        setTaxationType(data?.vendor_gst?.length === 10 ? "PAN" : "GST")
      }
    }
  }, [data, vendorAddress, form]);

  const { data: category_list } = useFrappeGetDocList("Category", {
    fields: ["*"],
    filters: [["work_package", "!=", "Services"]],
    limit: 10000,
  });

  const [city, setCity] = useState(vendorAddress?.city || "");
  const [state, setState] = useState(vendorAddress?.state || "");

  const { updateDoc, loading } = useFrappeUpdateDoc();
  const { toast } = useToast();

  const category_options: SelectOption[] =
    category_list?.map((item) => ({
      label: `${item.category_name}-(${item.work_package})`,
      value: item.category_name,
    })) || [];

    const service_categories = ["Electrical Services", "HVAC Services", "Data & Networking Services", "Fire Fighting Services", "FA Services", "PA Services", "Access Control Services", "CCTV Services", "Painting Services", "Carpentry Services", "POP Services"]

  const default_options: SelectOption[] =
    (data &&
      JSON.parse(data?.vendor_category)?.categories?.filter(i => !service_categories.includes(i))?.map((item) => ({
        label: item,
        value: item,
      }))) ||
    [];

  const [categories, setCategories] = useState(default_options || []);

  const handleChange = (selectedOptions: SelectOption[]) => {
    setCategories(selectedOptions);
  };

  const [pincode, setPincode] = useState("");

  const {
    data: pincode_data,
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

  const onSubmit = async (values: VendorFormValues) => {

    const categoriesSelected = categories.map((c) => c.value) || [];

    let category_json = categoriesSelected

    if(vendorChange || data?.vendor_type === "Service" || data?.vendor_type === "Material & Service") {
      category_json = [...categoriesSelected, ...service_categories]
    }

    try {
      if (city === "Not Found" || state === "Not Found") {
        throw new Error(
          'City and State are "Note Found", Please Enter a Valid Pincode'
        );
      }

      await updateDoc("Address", `${data?.vendor_address}`, {
        email_id: values.vendor_email,
        phone: values.vendor_mobile,
        address_line1: values.address_line_1,
        address_line2: values.address_line_2,
        city: city,
        state: state,
        pincode: values.pin,
      });

      await updateDoc("Vendors", id, {
        vendor_category: { categories: category_json },
        vendor_type: vendorChange ? "Material & Service" : data?.vendor_type,
        vendor_city: city,
        vendor_contact_person_name: values.vendor_contact_person_name,
        vendor_email: values.vendor_email,
        vendor_gst: values.vendor_gst,
        vendor_mobile: values.vendor_mobile,
        vendor_name: values.vendor_name,
        vendor_state: state,
        account_number: values.account_number,
        account_name: values.account_name,
        bank_name: values.bank_name,
        bank_branch: values.bank_branch,
        ifsc: values.ifsc,
      });

      await vendorMutate();
      await addressMutate();

      toast({
        title: "Success!",
        description: `Vendor: ${id} updated successfully!`,
        variant: "success",
      });
      // navigate(`/vendors/${id}`)

      toggleEditSheet();
    } catch (error) {
      toast({
        title: "Failed!",
        description: `${error}`,
        variant: "destructive",
      });
      console.log("Error while updating vendor", error);
    }
  };


  return (
    <div className="flex-1 space-y-4">
      {/* <div className="space-y-0.5">
                <div className="flex space-x-2 items-center ml-6">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate(`/vendors/${id}`)} />
                    <h2 className="text-2xl font-bold tracking-tight">Edit: <span className="text-red-700">{id}</span></h2>
                </div>
            </div>
            <Separator className="my-6 max-md:my-2" /> */}
            {data?.vendor_type !== "Material & Service" && (
              <>
            <div className="flex flex-col mt-2 px-6 max-md:px-2 space-y-2">
              <label className="block text-sm font-medium text-gray-700">Vendor_Type<sup className="text-sm text-red-600">*</sup></label>
              <div className="flex items-center space-x-2">
                <Label htmlFor="vendorType">Change to <span className="text-primary italic text-lg">Material & Service</span> type?</Label>
                <Switch value={vendorChange} onCheckedChange={(e) => setVendorChange(e)} id="vendorType" />
              </div>
            </div>
            <Separator className="my-6 max-md:my-2" />
            </>
            )}
      <Form {...form}>
        <form
          onSubmit={(event) => {
            event.preventDefault(); // Prevents page reload
            return form.handleSubmit(onSubmit)(event); // Calls your form submit logic
          }}
          className="space-y-4 px-6 max-md:px-2"
        >
          <FormField
            control={form.control}
            name="vendor_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Vendor Name<sup className="text-sm text-red-600">*</sup>
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
            name="vendor_contact_person_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Person Name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

            <div className="flex flex-col items-start space-y-2">
                <Label htmlFor="taxationType">Taxation Type</Label>
                <Select value={taxationType} onValueChange={(value) => {
                    setTaxationType(value)
                    form.trigger("vendor_gst", {
                        shouldFocus: true
                    })
                }} defaultValue={"GST"}>
                    <SelectTrigger className="">
                        <SelectValue className="text-gray-200" placeholder="Select Taxation Type" />
                    </SelectTrigger>
                    <SelectContent>
                            <SelectItem value="GST">GST</SelectItem>
                            <SelectItem value="PAN">PAN</SelectItem>
                    </SelectContent>
                </Select>
            </div>
          <FormField
            control={form.control}
            name="vendor_gst"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vendor {taxationType === "GST" ? "GST" : "PAN"} {vendorChange ? <sup className="text-sm text-red-600">*</sup> : ["Material", "Material & Service"].includes(data?.vendor_type) && <sup className="text-sm text-red-600">*</sup>}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address_line_1"
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
            name="address_line_2"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Address Line 2<sup className="text-sm text-red-600">*</sup>
                </FormLabel>
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
            name="pin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Pincode<sup className="text-sm text-red-600">*</sup>
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
          <FormField
            control={form.control}
            name="vendor_mobile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input type="number" {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendor_email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

        <Separator className="my-3" />
          <p className="text-sky-600 font-semibold pb-2">
            Change Vendor Bank Details
          </p>
          <FormField
                                    control={form.control}
                                    name="account_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Account Name</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Enter Account Name" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="account_number"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Account Number</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Enter Account Number" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="ifsc"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>IFSC Code</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Enter IFSC Code" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="bank_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Bank Name</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Enter Bank Name" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="bank_branch"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Bank Branch</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Enter Bank Branch" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
          {data?.vendor_type !== "Service" && (
            <>
            <Separator className="my-3" />
          <p className="text-sky-600 font-semibold pb-2">
            Change Vendor Category
          </p>
          <div>
            <label>
              Add Category<sup className="text-sm text-red-600">*</sup>
            </label>
            {category_options.length > 0 && (
              <ReactSelect
                options={category_options}
                defaultValue={default_options}
                onChange={handleChange}
                isMulti
              />
            )}
          </div>
          </>
          )}
          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="secondary"
              className="flex items-center gap-1"
              onClick={() => {
                form.reset();
                form.clearErrors();
              }}
            >
              <ListRestart className="h-4 w-4" />
              Reset
            </Button>
            <Button
              type="submit"
              disabled={loading}
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
