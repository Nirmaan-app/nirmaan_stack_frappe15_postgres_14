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
import { GST_REGEX, IFSC_REGEX, NAME_REGEX, PAN_REGEX } from "@/constants/vendorFormRegex";
import { SERVICECATEGORIES } from "@/lib/ServiceCategories";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { ListChecks, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import ReactSelect from "react-select";
import * as z from "zod";

const getVendorFormSchema = (service: boolean, isTaxGSTType: boolean, accountNumber: string | undefined, confirmAccountNumber: string | undefined, existingVendors: Vendors[] | undefined, bank_details: any, pincode_data: any) => {
    const vendorGstSchema = isTaxGSTType
        ? z
            .string({
              required_error: "Vendor GST is required",
            })
            .regex(GST_REGEX, {
              message: "Invalid GST format. Example: 22AAAAA0000A1Z5",
            }).refine((value) => {
              if (value && existingVendors?.some((vendor) => vendor.vendor_gst === value)) {
                return false;
              }
              return true;
            }, {
              message: "Vendor with this GST already exists.",
            })
        : z
            .string({
              required_error: "Vendor PAN is required",
            })
            .regex(PAN_REGEX, {
              message: "Invalid PAN format. Example: ABCDE1234F",
            }).refine((value) => {
              if (value && existingVendors?.some((vendor) => vendor.vendor_gst === value)) {
                return false;
              }
              return true;
            }, {
              message: "Vendor with this PAN already exists.",
            });
  
    const finalVendorGstSchema = service ? vendorGstSchema.optional() : vendorGstSchema;

    let accountNumberSchema = z.string().optional();
      let confirmAccountNumberSchema = accountNumber ? (confirmAccountNumber !== accountNumber ? z.string(
          {
              required_error: "Confirm account number is required",
          }
      ).refine((value) => value === accountNumber, {
          message: "Account numbers do not match.",
          // path: ["confirm_account_number"],
      }) : z.string().optional()) : z.string().optional();

    return z.object({
        vendor_contact_person_name: z
            .string({
              required_error: "Must provide Contact Person Name"
          }).min(3, {
              message: "Must be at least 3 characters.",
          }).regex(NAME_REGEX, {
              message: "Contact Person Name must not contain numbers.",
          }),
        vendor_name: z
            .string({
                required_error: "Must provide Vendor Name"
            })
            .min(3, {
                message: "Must be at least 3 characters.",
            }),
        vendor_nickname: z
            .string({
                required_error: "Must provide Vendor Nickname"
            })
            .min(2, {
                message: "Must be at least 2 characters.",
            })
            .max(30, {
                message: "Must not exceed 30 characters.",
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
            .min(6, { message: "Pincode must be of 6 digits" }).refine((pin) => {
              if (!pin || pin.length !== 6) {
                return true;
              }
              if (pincode_data) {
                return true;
              }
              return false;
            }, {
              message: "Invalid Pincode",
            }),
        vendor_email: z
            .string()
            .email()
            .optional(),
        vendor_mobile: z
            .string({
                required_error: "Must provide contact"
            })
            .max(10, { message: "Mobile number must be of 10 digits" })
            .min(10, { message: "Mobile number must be of 10 digits" }),
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
        account_number: accountNumberSchema,
        confirm_account_number:confirmAccountNumberSchema,
        account_name: z.string().optional(),
        ifsc: z
                .string()
                .regex(IFSC_REGEX, {
                  message: "Invalid IFSC code. Example: SBIN0005943"
                })
                .optional().refine((ifsc) => {
                  if (!ifsc || ifsc.length !== 11) {
                    return true;
                  }
            
                  if (bank_details && !bank_details.message.error) {
                    return true;
                  }
                  return false;
                }, {
                  message: "IFSC Code Not Found",
                }),
    })
};

type VendorFormValues = z.infer<ReturnType<typeof getVendorFormSchema>>;

interface SelectOption {
  label: string;
  value: string;
}

export const EditVendor: React.FC<{toggleEditSheet: () => void}> = ({ toggleEditSheet }) => {

  const { vendorId: id } = useParams<{ vendorId: string }>();
  const { data, mutate: vendorMutate } = useFrappeGetDoc("Vendors",id,`Vendors ${id}`);
  const { updateDoc, loading } = useFrappeUpdateDoc();
  const { toast } = useToast();

  const { data: vendorAddress, mutate: addressMutate } = useFrappeGetDoc("Address", data?.vendor_address,
    `Address ${data?.vendor_address}`,
    {
      revalidateIfStale: false,
    }
  );

  const [vendorChange, setVendorChange] = useState(false)
  const [taxationType, setTaxationType] = useState<string | null>("GST")
  const [bankAndBranch, setBankAndBranch] = useState({
    bank: "",
    branch: "",
  });

  const [city, setCity] = useState(vendorAddress?.city || "");
  const [state, setState] = useState(vendorAddress?.state || "");

  const [accountNumber, setAccountNumber] = useState<string>("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState<string>("");

  const [pincode, setPincode] = useState("");

  const { data: pincode_data } = useFrappeGetDoc("Pincodes", pincode, `Pincodes ${pincode}`);
  const[IFSC, setIFSC] = useState(data?.ifsc || "");
  
  const { data: bank_details } = useFrappeGetCall("nirmaan_stack.api.bank_details.generate_bank_details",
      { ifsc_code:  IFSC},
      IFSC && IFSC?.length === 11 ? undefined : null
    );
  
  const { data: existingVendors } = useFrappeGetDocList<Vendors>("Vendors", { 
    fields: ["vendor_gst"], 
    filters: [["name", "!=", id]],
    limit: 10000 }, "Vendors");

  const VendorFormSchema = getVendorFormSchema(data?.vendor_type === "Service" && !vendorChange, taxationType === "GST", accountNumber, confirmAccountNumber, existingVendors, bank_details, pincode_data);

  const form = useForm<VendorFormValues>({
    resolver: zodResolver(VendorFormSchema),
    // defaultValues: {
    //   vendor_contact_person_name: data?.vendor_contact_person_name,
    //   vendor_name: data?.vendor_name,
    //   address_line_1: vendorAddress?.address_line1,
    //   address_line_2: vendorAddress?.address_line2,
    //   pin: vendorAddress?.pincode,
    //   vendor_email: data?.vendor_email,
    //   vendor_mobile: data?.vendor_mobile,
    //   vendor_gst: data?.vendor_gst,
    //   account_number: data?.account_number,
    //   confirm_account_number: data?.confirm_account_number,
    //   account_name: data?.account_name,
    //   ifsc: data?.ifsc,
    // },
    defaultValues: {},
    mode: 'all',
    reValidateMode: 'onChange',
  });

  useEffect(() => {
    if (data && vendorAddress) {
      form.reset({
        vendor_contact_person_name: data?.vendor_contact_person_name,
        vendor_name: data?.vendor_name,
        vendor_nickname: data?.vendor_nickname,
        address_line_1: vendorAddress?.address_line1,
        address_line_2: vendorAddress?.address_line2,
        pin: vendorAddress?.pincode,
        vendor_email: data?.vendor_email,
        vendor_mobile: data?.vendor_mobile,
        vendor_gst: data?.vendor_gst,
        account_number: data?.account_number,
        confirm_account_number: data?.account_number,
        account_name: data?.account_name,
        ifsc: data?.ifsc,
      });

      setBankAndBranch({
        bank: data?.bank_name,
        branch: data?.bank_branch,
      });

      setAccountNumber(data?.account_number);
      setConfirmAccountNumber(data?.account_number);

      setPincode(vendorAddress?.pincode);
      if(data?.vendor_gst) {
        setTaxationType(data?.vendor_gst?.length === 10 ? "PAN" : "GST")
      }
    }
  }, [data, vendorAddress]);

  const { data: category_list } = useFrappeGetDocList("Category", {
    fields: ["*"],
    filters: [["work_package", "!=", "Services"]],
    limit: 10000,
  }, "Service Categories");

  const category_options: SelectOption[] = useMemo(
    () => category_list?.map((item) => ({
      label: `${item.category_name}-(${item.work_package})`,
      value: item.category_name,
    })) || [], [category_list]);

  const default_options: SelectOption[] = useMemo(
    () => (data &&
      JSON.parse(data?.vendor_category)?.categories?.filter(i => !SERVICECATEGORIES.includes(i))?.map((item) => ({
        label: item,
        value: item,
      }))) ||
    [], [data, SERVICECATEGORIES]);

  const [categories, setCategories] = useState(default_options || []);

  const handleChange = useCallback((selectedOptions: SelectOption[]) => {
    setCategories(selectedOptions);
  }, [setCategories]);

  const debouncedFetch = useCallback((value: string) => {
    if (value.length >= 6) {
      setPincode(value);
    } else {
      setPincode("");
    }
  }, []);

  useEffect(() => {
    if (pincode.length >= 6 && !pincode_data) {
      setCity("");
      setState("");
    } else {
      setCity(pincode_data?.city || "");
      setState(pincode_data?.state || "");
    }
  }, [pincode_data]);

  const handlePincodeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    debouncedFetch(value);
  }, [debouncedFetch]);

  useEffect(() => {
      if (bank_details && !bank_details.message.error) {
          setBankAndBranch({
            bank: bank_details.message.BANK,
            branch: bank_details.message.BRANCH,
          });
          return;
          }
      setBankAndBranch({
        bank: "",
        branch: "",
      });
  }, [bank_details, IFSC]) 

  const onSubmit = async (values: VendorFormValues) => {

    const categoriesSelected = categories.map((c) => c.value) || [];

    let category_json = categoriesSelected

    if(vendorChange || data?.vendor_type === "Service" || data?.vendor_type === "Material & Service") {
      category_json = [...categoriesSelected, ...SERVICECATEGORIES]
    }

    try {
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
        vendor_nickname: values.vendor_nickname,
        vendor_state: state,
        account_number: values.account_number,
        account_name: values.account_name,
        bank_name: bankAndBranch.bank,
        bank_branch: bankAndBranch.branch,
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
            {data?.vendor_type !== "Material & Service" && (
              <>
            <div className="flex flex-col mt-2 px-6 max-md:px-2 space-y-2">
              <label className="block text-sm font-medium text-gray-700">Vendor_Type<sup className="text-sm text-red-600">*</sup></label>
              <div className="flex items-center space-x-2">
                <Label htmlFor="vendorType">Change to <span className="text-primary italic text-lg">Material & Service</span> type?</Label>
                <Switch value={vendorChange} onCheckedChange={(e) => {
                  setVendorChange(e)
                  form.trigger("vendor_gst")
                }} id="vendorType" />
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
                  <Input id="vendorShopName" placeholder="enter shop name..." {...field}
                      value={field.value || ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                    />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendor_nickname"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Nickname<sup className="text-sm text-red-600">*</sup>
                </FormLabel>
                <FormControl>
                  <Input placeholder="Short, memorable name (e.g. Nirmaan, ABC Steel)" {...field}
                      value={field.value || ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                    />
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
                <FormLabel>Contact Person Name<sup className="text-sm text-red-600">*</sup></FormLabel>
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
                  <Input placeholder={taxationType === "GST" ? "enter gst..." : "enter pan..."}
                   {...field}
                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                   />
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
                  <Input placeholder="Building name, floor" {...field}
                       onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                    />
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
                  <Input placeholder="Street name, area, landmark" {...field}
                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                     />
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
                    placeholder="6 digit PIN"
                    {...field}
                    onChange={(e) => {
                      handlePincodeChange(e);
                      field.onChange(e.target.value === "" ? undefined : e)
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
                <FormLabel>Phone<sup className="text-sm text-red-600">*</sup></FormLabel>
                <FormControl>
                  <Input type="number" placeholder="Contact No" {...field}
                       onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                    />
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
                  <Input placeholder="Enter Email ID" {...field}
                  onChange={(e) => field.onChange(e.target.value === "" ? undefined : e)} 
                   />
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
                                                <Input 
                                                    placeholder="Enter Account Name" 
                                                    {...field}
                                                    autoComplete="new-password" 
                                                    autoCorrect="off"

                                                 />
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
                                                                                <Input
                                                                                  placeholder="Enter Account Number"
                                                                                  {...field}
                                                                                  type="password"
                                                                                  autoComplete="new-password" 
                                                                                  autoCorrect="off"
                                                                                  onChange={(e) => {
                                                                                    setAccountNumber(e.target.value);
                                                                                    field.onChange(e.target.value === "" ? undefined : e);
                                                                                    form.trigger("confirm_account_number")
                                                                                  }}
                                                                                />
                                                                            </FormControl>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                                <FormField
                                                                  control={form.control}
                                                                  name="confirm_account_number"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Confirm Account Number</FormLabel>
                                                                      <FormControl>
                                                                        <Input placeholder="Confirm Account Number" 
                                                                        {...field} 
                                                                        autoComplete="new-password" 
                                                                        autoCorrect="off"
                                                                        onChange={(e) => {
                                                                          setConfirmAccountNumber(e.target.value);
                                                                          field.onChange(e.target.value === "" ? undefined : e);
                                                                        }}
                                                                        />
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
                                                <Input placeholder="Enter IFSC Code" {...field} value={field.value || ""} 
                                                onChange={(e) => {
                                                  const value = e.target.value.toUpperCase()
                                                  setIFSC(value)
                                                  field.onChange(value === "" ? undefined :  value)
                                                }}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                        <FormItem>
                                            <FormLabel>Bank Name</FormLabel>
                                            <FormControl>
                                                <Input disabled={true}  placeholder="Enter Bank Name"  value={bankAndBranch.bank} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                        <FormItem>
                                            <FormLabel>Bank Branch</FormLabel>
                                            <FormControl>
                                                <Input disabled={true} placeholder="Enter Bank Branch" value={bankAndBranch.branch} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
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
              onClick={toggleEditSheet}
            >
              <X className="h-4 w-4" />
              Cancel
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
