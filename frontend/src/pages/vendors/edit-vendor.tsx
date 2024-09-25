import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import ReactSelect from 'react-select';
import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { zodResolver } from "@hookform/resolvers/zod"

const VendorFormSchema = z.object({
    vendor_contact_person_name: z.string().optional(),
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
        required_error: "Address Line 1 Required"
    }).min(1, {
        message: "Address Line 1 Required"
    }),
    pin: z
    .string({
        required_error: "Must provide Pincode"
    })
    .max(6, { message: "Pincode must be of 6 digits" })
    .min(6, { message: "Pincode must be of 6 digits" }),
    email: z.string().email().optional().or(z.literal('')),
    vendor_mobile: z
    .string({
        required_error: "Must Provide Vendor Contact"
    })
    .max(10, { message: "Mobile number must be of 10 digits" })
    .min(10, { message: "Mobile number must be of 10 digits" })
    .optional(),
    vendor_gst: z
    .string({
        required_error: "Vendor GST Required"
    })
    .min(1, {
        message: "Vendor GST Required"
    })
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/, {
        message: "Invalid GST format. Example: 22AAAAA0000A1Z5"
    }),
})

type VendorFormValues = z.infer<typeof VendorFormSchema>

interface SelectOption {
    label: string;
    value: string;
}

export const EditVendor = () => {
    const navigate = useNavigate()
    const { id } = useParams<{ id: string }>()
    const { data, mutate: vendorMutate } = useFrappeGetDoc(
        'Vendors',
        `${id}`,
        `Vendors ${id}`
    );

    const {data: vendorAddress, isLoading: vendorAddressLoading, error: vendorAddressError, mutate: addressMutate} = useFrappeGetDoc(
        "Address", 
        data?.vendor_address, 
        `Address ${data?.vendor_address}`, 
        {
        revalidateIfStale: false
        }
    )

    const form = useForm<VendorFormValues>({
        resolver: zodResolver(VendorFormSchema),
        defaultValues: {
            vendor_contact_person_name: data?.vendor_contact_person_name || "",
            vendor_name: data?.vendor_name || "",
            address_line_1: vendorAddress?.address_line1 || "",
            address_line_2: vendorAddress?.address_line2 || "",
            pin: vendorAddress?.pincode || "",
            email: data?.vendor_email || "",
            vendor_mobile: data?.vendor_mobile || "",
            vendor_gst: data?.vendor_gst || "",
        },
        mode: "onBlur",
    })

    useEffect(() => {
        if (data && vendorAddress) {
            form.reset({
                vendor_contact_person_name: data?.vendor_contact_person_name || "",
                vendor_name: data?.vendor_name || "",
                address_line_1: vendorAddress?.address_line1 || "",
                address_line_2: vendorAddress?.address_line2 || "",
                pin: vendorAddress?.pincode || "",
                email: data?.vendor_email || "",
                vendor_mobile: data?.vendor_mobile || "",
                vendor_gst: data?.vendor_gst || "",
            });
            setPincode(vendorAddress?.pincode)
        }
    }, [data, vendorAddress, form]);

    const { data: category_list } = useFrappeGetDocList("Category", {
        fields: ["*"],
        limit: 1000,
    });

    const [city, setCity] = useState(vendorAddress?.city || "")
    const [state, setState] = useState(vendorAddress?.state || "")

    const { updateDoc, loading } = useFrappeUpdateDoc()
    const { toast } = useToast()
    
    const category_options: SelectOption[] = category_list
    ?.map(item => ({
        label: `${item.category_name}-(${item.work_package})`,
        value: item.category_name
    })) || [];

    const default_options: SelectOption[] = data && JSON.parse(data?.vendor_category)?.categories?.map(item => ({
        label: item,
        value: item,
    })) || [];

    const [categories, setCategories] = useState(default_options)

    const handleChange = (selectedOptions: SelectOption[]) => {
        setCategories(selectedOptions)
    }

    const [pincode, setPincode] = useState("")

    const { data: pincode_data, isLoading: pincode_loading, error: pincode_error } = useFrappeGetDoc("Pincodes", pincode, `Pincodes ${pincode}`)

    const debouncedFetch = useCallback(
        (value: string) => {
            if (value.length >= 6) {
                setPincode(value)
            } else {
                setPincode("")
            }
        }, [])

    useEffect(() => {
        if (pincode.length >= 6 && !pincode_data) {
            setCity("Not Found")
            setState("Not Found")
        } else {
            setCity(pincode_data?.city || "")
            setState(pincode_data?.state || "")
        }
    }, [pincode_data])


    const handlePincodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        debouncedFetch(value)
    }

    const onSubmit = async (values: VendorFormValues) => {
        let category_json = categories.map(c => c.value)
        try {
            if(city === "Not Found" || state === "Not Found") {
                throw new Error('City and State are "Note Found", Please Enter a Valid Pincode')
            }

            await updateDoc('Address', `${data?.vendor_address}`, {
                email_id: values.email,
                phone: values.vendor_mobile,
                address_line1: values.address_line_1,
                address_line2: values.address_line_2,
                city: city,
                state: state,
                pincode: values.pin
            })

            await updateDoc("Vendors", id, {
                vendor_category : {categories : category_json},
                vendor_city: city,
                vendor_contact_person_name : values.vendor_contact_person_name,
                vendor_email: values.email,
                vendor_gst: values.vendor_gst,
                vendor_mobile: values.vendor_mobile,
                vendor_name: values.vendor_name,
                vendor_state: state
            })

                await vendorMutate()
                await addressMutate()

                toast({
                    title: "Success!",
                    description: `Vendor: ${id} updated successfully!`,
                    variant: "success",
                })
                navigate(`/vendors/${id}`)
                
        } catch (error) {
            toast({
                title: "Failed!",
                description: `${error}`,
                variant: "destructive",
            })
            console.log("Error while updating vendor", error)
        }
    }

    return (
        <div className="flex-1 md:space-y-4 p-4">
            <div className="space-y-0.5">
                <div className="flex space-x-2 items-center">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate(`/vendors/${id}`)} />
                    <h2 className="text-2xl font-bold tracking-tight">Edit Vendor</h2>
                </div>
            </div>
            <Separator className="my-6 max-md:my-2" />
            <Form {...form}>
            <form
                    onSubmit={(event) => {
                        event.preventDefault(); // Prevents page reload
                        return form.handleSubmit(onSubmit)(event); // Calls your form submit logic
                    }}
                    className="space-y-8 px-6 max-md:px-2"
                >
                    <FormField
                        control={form.control}
                        name="vendor_name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Vendor Name<sup className="text-sm text-red-600">*</sup></FormLabel>
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
                    <FormField
                        control={form.control}
                        name="address_line_1"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Address Line 1<sup className="text-sm text-red-600">*</sup></FormLabel>
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
                                <FormLabel>Address Line 2<sup className="text-sm text-red-600">*</sup></FormLabel>
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
                        <Input
                            disabled 
                          type="text" 
                          value={city}
                        />
                      </FormControl>
                    </FormItem>
                    <FormItem>
                      <FormLabel>
                        State<sup className="text-sm text-red-600">*</sup>
                      </FormLabel>
                      <FormControl>
                        <Input
                            disabled
                          type="text" 
                          value={state}
                        />
                      </FormControl>
                    </FormItem>
                    <FormField
                        control={form.control}
                        name="pin"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Pincode<sup className="text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} onChange={(e) => {
                                        field.onChange(e)
                                        handlePincodeChange(e)
                                    }} />
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
                                    <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Email</FormLabel>
                                <FormControl>
                                    <Input {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="vendor_gst"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Vendor GST</FormLabel>
                                <FormControl>
                                    <Input {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <Separator className="my-3" />
                    <p className="text-sky-600 font-semibold pb-2">Change Vendor Category</p>
                    <div>
                        <label>Add Category<sup className="text-sm text-red-600">*</sup></label>
                        {(category_options.length > 0) && (
                            <ReactSelect
                                options={category_options}
                                defaultValue={default_options}
                                onChange={handleChange}
                                isMulti
                            />
                        )}
                    </div>
                    <div className="flex justify-end space-x-2">
                        <Button type="button" variant="outline" onClick={() => {
                            form.reset()
                            form.clearErrors()
                        }}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? "Updating..." : "Update Vendor"}
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    )
}
