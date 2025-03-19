import { Button } from "@/components/ui/button"
import { ButtonLoading } from "@/components/ui/button-loading"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { SheetClose } from "@/components/ui/sheet"
import { useToast } from "@/components/ui/use-toast"
import { SERVICECATEGORIES } from "@/lib/ServiceCategories"
import { Vendors } from "@/types/NirmaanStack/Vendors"
import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeGetCall, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall, useSWRConfig } from "frappe-react-sdk"
import { ListChecks, ListRestart } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import ReactSelect from 'react-select'
import * as z from "zod"

const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

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
        vendor_city: z
            .string({
                required_error: "Must Provide City"
            })
            .min(1, {
                message: "Must Provide City"
            }),
        vendor_state: z
            .string({
                required_error: "Must Provide State"
            })
            .min(1, {
                message: "Must Provide State"
            }),
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
        ifsc: z
        .string()
        .regex(IFSC_REGEX, {
          message: "Invalid IFSC code. Example: SBIN0005943"
        })
        .optional(),
    })
};

type VendorFormValues = z.infer<ReturnType<typeof getVendorFormSchema>>;

interface SelectOption {
    label: string;
    value: string;
}

interface NewVendorProps {
  dynamicCategories?: {category_name : string, work_package : string}[];
  navigation?: boolean;
  renderCategorySelection?: boolean;
  service?: boolean;
}

export const NewVendor : React.FC<NewVendorProps> = ({ dynamicCategories = [], navigation = true, renderCategorySelection = true, service = false }) => {

    const navigate = useNavigate()
    const [vendorType, setVendorType] = useState<string | null>(null)
    const [taxationType, setTaxationType] = useState<string | null>("GST")
    const VendorFormSchema = getVendorFormSchema(vendorType === "Service", taxationType === "GST");
    const form = useForm<VendorFormValues>({
        resolver: zodResolver(VendorFormSchema),
        defaultValues: {},
        mode: "onBlur",
    })

    const { data: category_list } = useFrappeGetDocList("Category",
        {
            fields: ["*"],
            filters: [["work_package", "!=", "Services"]],
            orderBy: { field: 'work_package', order: 'asc' },
            limit: 10000
        },
        "Category"
    );

    const { data: existingVendors } = useFrappeGetDocList<Vendors>("Vendors", { fields: ["vendor_gst"], limit: 10000 }, "Vendors");

    const { mutate } = useSWRConfig()
    const { toast } = useToast()

    const {call : createVendorAndAddress, loading: createVendorAndAddressLoading } = useFrappePostCall("nirmaan_stack.api.create_vendor_and_address.create_vendor_and_address")

    const [categories, setCategories] = useState<SelectOption[]>([])

    const category_options: SelectOption[] = useMemo(() => (dynamicCategories.length ? dynamicCategories : category_list)
        ?.map(item => ({
            label: `${!dynamicCategories.length ? `${item.category_name}-(${item.work_package})` : item.category_name}`,
            value: item.category_name
        })) || [], [dynamicCategories, category_list]);

    const handleChange = (selectedOptions: SelectOption[]) => {
        setCategories(selectedOptions)
    }

    const closewindow = () => {
        const button = document.getElementById('sheetClose');
        button?.click();
    };

    const resetForm = () => {
        form.reset({
            vendor_contact_person_name: undefined,
            vendor_name: undefined,
            address_line_1: undefined,
            address_line_2: undefined,
            vendor_city: undefined,
            vendor_state: undefined,
            pin: undefined,
            vendor_email: undefined,
            vendor_mobile: undefined,
            vendor_gst: undefined,
            account_number: undefined,
            account_name: undefined,
            bank_name: undefined,
            bank_branch: undefined,
            ifsc: undefined,
        });
        setCategories([]);
        form.clearErrors();
        document.getElementById("vendorShopName")?.focus()
    }

    const IFSC = form.watch("ifsc")

    const { data: bank_details } = useFrappeGetCall(
        "nirmaan_stack.api.bank_details.generate_bank_details",
        { ifsc_code:  IFSC},
        IFSC && IFSC?.length === 11 ? undefined : null
      );

    const [gstError, setGstError] = useState<string | null>(null);

    const gst = form.watch("vendor_gst")
    const validateGst = useCallback(
        (gst: string | undefined) => {
          if (taxationType !== "GST" || !gst || gst?.length !== 15) {
            setGstError(null);
            form.clearErrors("vendor_gst")
            return true;
          }
    
        //   if (!GST_REGEX.test(gst)) {
        //     setGstError('Invalid GST format. Example: 22AAAAA0000A1Z5');
        //     return false;
        //   }
    
          if (existingVendors?.some((vendor) => vendor.vendor_gst === gst)) {
            setGstError('Vendor with this GST already exists.');
            // form.setError("vendor_gst", 
            //     {
            //     type: "manual",
            //     message: "Vendor with this GST already exists.",
            //     },
            // );
            return false;
          }
    
          setGstError(null);
          return true;
        },
        [existingVendors, vendorType, taxationType]
      );

    useEffect(() => {
        validateGst(gst)
    }, [gst, vendorType, taxationType])

    useEffect(() => {
        if (bank_details && !bank_details.message.error) {
            form.setValue("bank_branch", bank_details.message.BRANCH);
            form.setValue("bank_name", bank_details.message.BANK);
            return;
            }
        if (bank_details && bank_details.message.error) {
            form.setError("ifsc", 
                {
                type: "manual",
                message: "IFSC Code Not Found"
            }); 
        }
        form.setValue("bank_branch", undefined);
        form.setValue("bank_name", undefined);

    }, [bank_details, IFSC]) 

    const onSubmit = useCallback(
        async (values: VendorFormValues) => {

        try {
            if (values.vendor_city === "Not Found" || values.vendor_state === "Not Found") {
                toast({
                    title: "Error!",
                    description: "City and State are 'Note Found', Please Enter a Valid Pincode",
                    variant: "destructive"
                });
                return
            }

            if(gstError) {
                form.trigger("vendor_gst", {
                    shouldFocus: true
                })
                toast({
                    title: "Error!",
                    description: "Duplicate GST Number!",
                    variant: "destructive"
                });
                return
            }

            let category_json = categories.map((cat) => cat["value"]);

            const formattedDynamicCategories = dynamicCategories?.map((item) => item?.category_name);

            const response = await createVendorAndAddress({
                values: {...values, ifsc : bank_details && bank_details.message.error ? null : values.ifsc},
                vendorType: vendorType,
                category_json: category_json,
                service_categories: SERVICECATEGORIES,
                dynamicCategories: formattedDynamicCategories,
                renderCategorySelection: renderCategorySelection,
                service: service,
              });

              if (response.message.status === 200) {
                if (service) {
                  await mutate('Service Vendors');
                } else {
                  await mutate('Material Vendors');
                }
      
                toast({
                  title: 'Success!',
                  description: response.message.message,
                  variant: 'success',
                });
      
                if (navigation) {
                  navigate('/vendors');
                } else if (closewindow) {
                  closewindow();
                }
              } else if (response.message.status === 400) {
                toast({
                  title: 'Failed!',
                  description: response.message.error,
                  variant: 'destructive',
                });
              }
      
            // Create the address document
            // const addressDoc = await createDoc('Address', {
            //     address_title: values.vendor_name,
            //     address_type: "Shop",
            //     address_line1: values.address_line_1,
            //     address_line2: values.address_line_2,
            //     city: values.vendor_city,
            //     state: values.vendor_state,
            //     country: "India",
            //     pincode: values.pin,
            //     email_id: values.vendor_email,
            //     phone: values.vendor_mobile,
            // });

            // try {
            //     // Create the vendor document using the address document reference
            //     await createDoc('Vendors', {
            //         vendor_name: values.vendor_name,
            //         vendor_type: vendorType,
            //         vendor_address: addressDoc.name,
            //         vendor_city: addressDoc.city,
            //         vendor_state: addressDoc.state,
            //         vendor_contact_person_name: values.vendor_contact_person_name,
            //         vendor_mobile: values.vendor_mobile,
            //         vendor_email: values.vendor_email,
            //         vendor_gst: values.vendor_gst,
            //         account_number: values.account_number,
            //         account_name: values.account_name,
            //         bank_name: values.bank_name,
            //         bank_branch: values.bank_branch,
            //         ifsc: bank_details && bank_details.message.error ? null : values.ifsc,
            //         vendor_category: vendorType === "Service" ? { categories: SERVICECATEGORIES }
            //             :
            //             vendorType === "Material" ?
            //             {
            //                 categories: (!renderCategorySelection && dynamicCategories.length)
            //                     ? dynamicCategories
            //                     : category_json
            //             } :
            //             {
            //                 categories : (!renderCategorySelection && dynamicCategories.length)
            //                     ? [...dynamicCategories, ...SERVICECATEGORIES]
            //                     : [...category_json, ...SERVICECATEGORIES]
            //             }
            //     });

            //     // Create quotation requests
            //     // const promises = [];
            //     // if (sentBackData) {
            //     //     sentBackData?.item_list?.list.forEach((item) => {
            //     //         const makes = sentBackData?.category_list?.list?.find(i => i?.name === item?.category)?.makes?.map(j => ({ make: j, enabled: "false" })) || [];
            //     //         const newItem = {
            //     //             procurement_task: sentBackData.procurement_request,
            //     //             category: item.category,
            //     //             item: item.name,
            //     //             vendor: vendorDoc.name,
            //     //             quantity: item.quantity,
            //     //             makes: { list: makes || [] }
            //     //         };
            //     //         promises.push(createDoc("Quotation Requests", newItem));
            //     //     });
            //     // } else if (prData) {
            //     //     prData?.procurement_list?.list.forEach((item) => {
            //     //         const makes = prData?.category_list?.list?.find(i => i?.name === item?.category)?.makes?.map(j => ({ make: j, enabled: "false" })) || [];
            //     //         const newItem = {
            //     //             procurement_task: prData.name,
            //     //             category: item.category,
            //     //             item: item.name,
            //     //             vendor: vendorDoc.name,
            //     //             quantity: item.quantity,
            //     //             makes: { list: makes || [] }
            //     //         };
            //     //         promises.push(createDoc("Quotation Requests", newItem));
            //     //     });
            //     // }

            //     // await Promise.all(promises);

            //     // Mutate the vendor-related data
            //     if (service) {
            //         await mutate("Service Vendors");
            //     } else {
            //         await mutate("Material Vendors");
            //     }
            //     // await mutate("Quotation Requests");
            //     // if (prData) {
            //     //     await mutate(`Quotations Requests,Procurement_task=${prData?.name}`)
            //     // }
            //     // await mutate("Vendor Category");

            //     toast({
            //         title: "Success!",
            //         description: "Vendor Created Successfully!",
            //         variant: "success"
            //     });

            //     // Navigate or close window
            //     if (navigation) {
            //         navigate("/vendors");
            //     } else {
            //         closewindow();
            //     }
            // } catch (vendorError) {
            //     // Delete the address document if vendor creation fails
            //     await deleteDoc('Address', addressDoc.name);
            //     throw vendorError;
            // }
        } catch (error) {
            // if (error?.exc_type === "VendorGSTExistError") {
            //     toast({
            //         title: "Duplicate Value Error!",
            //         description: `Vendor with this GST already exists!`,
            //         variant: "destructive"
            //     });
            // } else {
            //     toast({
            //         title: "Failed!",
            //         description: `${error?.exception}`,
            //         variant: "destructive"
            //     });
            // }

            toast({
                 title: "Failed!",
                 description: "Failed to Create a New Vendor",
                 variant: "destructive"
             });

            console.error("Submit Error", error);
        }
    }, [createVendorAndAddress, navigation, mutate, vendorType, categories, dynamicCategories,renderCategorySelection, service, validateGst ]);


    const [pincode, setPincode] = useState("")

    const { data: pincode_data } = useFrappeGetDoc("Pincodes", pincode)

    const debouncedFetch = useCallback(
        (value: string) => {
            if (value.length >= 6) {
                setPincode(value)
            } else {
                setPincode("")
            }
        }, []
    )

    useEffect(() => {
        if (service) {
            setVendorType("Service")
        } else {
            setVendorType("Material")
        }
    }, [service])

    useEffect(() => {
        if (pincode.length >= 6 && !pincode_data) {
            form.setValue("vendor_city", "Not Found")
            form.setValue("vendor_state", "Not Found")
        } else {
            form.setValue("vendor_city", pincode_data?.city || "")
            form.setValue("vendor_state", pincode_data?.state || "")
        }
    }, [pincode, pincode_data])


    const handlePincodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        debouncedFetch(value)
    }

    return (
        <>
            <div className={`flex-1 space-x-2 ${navigation ? "flex-1 md:space-y-4" : ""} `}>
                {navigation && (
                    <p className="text-muted-foreground max-md:ml-4 ml-8">
                        Fill all the marked fields to create a new Vendor
                    </p>
                )}

                <div className="flex flex-col items-start mt-2 px-6 max-md:px-2 space-y-2">
                    <Label htmlFor="vendorType">Vendor_Type<sup className="text-sm text-red-600">*</sup></Label>
                    <Select value={vendorType} onValueChange={(value) => setVendorType(value)} defaultValue={service ? "Service" : "Material"}>
                        <SelectTrigger className="">
                            <SelectValue className="text-gray-200" placeholder="Select Vendor Type" />
                        </SelectTrigger>
                        <SelectContent>
                            {!service && (
                                <SelectItem value="Material">Material</SelectItem>
                            )}
                            {dynamicCategories.length === 0 && (
                                <SelectItem value="Service">Service</SelectItem>
                            )}
                            <SelectItem value="Material & Service">Material & Service</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {vendorType && (
                    <>
                        <Separator className="my-6 max-md:my-2" />
                        <Form {...form}>
                            <form onSubmit={(event) => {
                                event.stopPropagation();
                                return form.handleSubmit(onSubmit)(event);
                            }} className="space-y-8 px-6 max-md:px-2">
                                <FormField
                                    control={form.control}
                                    name="vendor_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex">Vendor Shop Name<sup className="text-sm text-red-600">*</sup></FormLabel>
                                            <FormControl>
                                                <Input id="vendorShopName" placeholder="enter shop name..." {...field} />
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
                                            <FormLabel>Vendor Contact Person Name</FormLabel>
                                            <FormControl>
                                                <Input placeholder="enter person name..." {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>

                                    )}
                                />

                                <div className="flex flex-col items-start space-y-2">
                                    <Label htmlFor="taxationType" >Taxation Type</Label>
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
                                            <FormLabel className="flex">{taxationType === "GST" ? "GST Number" : "PAN Number"} {vendorType !== "Service" && <sup className="text-sm text-red-600">*</sup>}</FormLabel>
                                            <FormControl>
                                                <Input placeholder={taxationType === "GST" ? "enter gst..." : "enter pan..."}
                                                 {...field}
                                                onChange={(e) => {
                                                    field.onChange(e)
                                                }}
                                                 />
                                            </FormControl>
                                            <FormMessage />
                                            {gstError && <FormMessage>{gstError}</FormMessage>}
                                        </FormItem>

                                    )}
                                />
                                {(renderCategorySelection && vendorType !== "Service") && (
                                    <>
                                        <div>
                                            <label className="flex items-center">Add Category<sup className="text-sm text-red-600">*</sup></label>
                                            <ReactSelect options={category_options} onChange={handleChange} isMulti />
                                        </div>
                                        <Separator className="my-3" />
                                    </>
                                )}
                                <p className="text-sky-600 font-semibold pb-2">Vendor Address Details</p>
                                <FormField
                                    control={form.control}
                                    name="address_line_1"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex">Address Line 1<sup className="text-sm text-red-600">*</sup></FormLabel>
                                            <FormControl>
                                                <Input placeholder="Building name, floor" {...field} />
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

                                            <FormLabel className="flex">Address Line 2<sup className="text-sm text-red-600">*</sup></FormLabel>

                                            <FormControl>
                                                <Input placeholder="Street name, area, landmark" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="vendor_city"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex">City<sup className="text-sm text-red-600">*</sup></FormLabel>
                                            <FormControl>
                                                <Input placeholder={pincode_data?.city ? pincode_data?.city : "City"} disabled={true} {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="vendor_state"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex">State<sup className="text-sm text-red-600">*</sup></FormLabel>
                                            <FormControl>
                                                <Input placeholder={pincode_data?.state ? pincode_data?.state : "State"} disabled={true} {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>

                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="pin"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex">Pin Code<sup className="text-sm text-red-600">*</sup></FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    placeholder="6 digit PIN"
                                                    {...field}
                                                    onChange={(e) => {
                                                        field.onChange(e)
                                                        handlePincodeChange(e)
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
                                            <FormLabel className="flex">Phone</FormLabel>
                                            <FormControl>
                                                <Input type="number" placeholder="Contact No" {...field} />
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
                                                <Input placeholder="Enter Email ID" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <p className="text-sky-600 font-semibold pb-2">Vendor Bank Details</p>
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
                                        <Input 
                                          placeholder="Enter IFSC Code" 
                                          {...field} 
                                          onChange={(e) => {
                                            const value = e.target.value.toUpperCase();
                                            field.onChange(value);
                                          }}
                                        />
                                      </FormControl>
                                      {(bank_details && bank_details.message.error) ? <FormMessage>IFSC Code Not Found</FormMessage> : <FormMessage />}
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
                                                <Input disabled={true} placeholder="Enter Bank Name" {...field} value={field.value || ""} />
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
                                                <Input disabled={true} placeholder="Enter Bank Branch" {...field} value={field.value || ""} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <div className="flex space-x-2 items-center justify-end">
                                    {(createVendorAndAddressLoading) ? (<ButtonLoading />) : (
                                        <>
                                            <Button type="button" variant="secondary" className="flex items-center gap-1" onClick={() => resetForm()}>
                                                <ListRestart className="h-4 w-4" />
                                                Reset</Button>
                                            <Button type="submit" className="flex items-center gap-1">
                                                <ListChecks className="h-4 w-4" />
                                                Submit</Button>
                                        </>
                                    )}
                                </div>
                                {!navigation && (
                                    <SheetClose asChild><Button id="sheetClose" className="w-0 h-0 invisible"></Button></SheetClose>
                                )}
                            </form>
                        </Form>
                    </>
                )}
            </div>
        </>
    )
}