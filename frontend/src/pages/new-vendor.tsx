import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { ButtonLoading } from "@/components/button-loading"
import ReactSelect from 'react-select';
import { useState } from "react"
import {  Link, useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { SheetClose } from "@/components/ui/sheet"

const VendorFormSchema = z.object({
    vendor_contact_person_name: z
        .string()
        .min(3, {
            message: "Must be at least 3 characters.",
        })
        .optional()
        .default(''),
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
        }),
    address_line_2: z
        .string()
        .optional()
        .default(''),
    vendor_city: z
        .string({
            required_error: "Must provide city"
        }),
    vendor_state: z
        .string({
            required_error: "Must provide state"
        }),
    pin: z
        .number()
        .positive()
        .gte(100000)
        .lte(999999)
        .or(z.string())
        .optional(),
    vendor_email: z
        .string()
        .email()
        .optional()
        .default(''),
    vendor_mobile: z
        .number({
            required_error: "Must provide contact"
        })
        .positive()
        .gte(1000000000)
        .lte(9999999999)
        .or(z.string())
        ,
    vendor_gst: z
        .string({
            required_error: "Vendor GST Required"
        }),
    // vendor_categories: z
    //     .array(z.string())
})

type VendorFormValues = z.infer<typeof VendorFormSchema>

interface SelectOption {
    label: string;
    value: string;
}

export const NewVendor = ({dynamicCategories = [], navigation = true, renderCategorySelection = true}) => {
    const navigate = useNavigate()
    const form = useForm<VendorFormValues>({
        resolver: zodResolver(VendorFormSchema),
        defaultValues: {
            vendor_contact_person_name: "",
            vendor_city: "",
            vendor_email: "",
            vendor_gst: "",
            vendor_mobile: "",
            vendor_name: "",
            vendor_state: "",
            pin: "",
            address_line_1: "",
            address_line_2: ""
        }
        ,
        mode: "onBlur",
    })
    
    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package'],
            orderBy: { field: 'work_package', order: 'asc' },
            limit: 1000
        });

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()

    function onSubmit(values: z.infer<typeof VendorFormSchema>) {
    
        let category_json = categories.map((cat) => cat["value"])
        
        createDoc('Address', {
            address_title: values.vendor_name,
            address_type: "Shop",
            address_line1: values.address_line_1,
            address_line2: values.address_line_2,
            city: values.vendor_city,
            state: values.vendor_state,
            country: "India",
            pincode: values.pin,
            email_id: values.vendor_email,
            phone: values.vendor_mobile
        }).then(doc => {
            createDoc('Vendors', {
                vendor_name: values.vendor_name,
                vendor_type: "Material",
                vendor_address: doc.name,
                vendor_city: doc.city,
                vendor_state: doc.state,
                vendor_contact_person_name: values.vendor_contact_person_name,
                vendor_mobile: values.vendor_mobile,
                vendor_email: values.vendor_email,
                vendor_gst: values.vendor_gst,
                vendor_category: { "categories": (!renderCategorySelection && dynamicCategories.length) ? dynamicCategories : category_json }
            })
                .then(() => {
                    if(navigation) {
                        navigate("/vendors")
                    } else {
                        closewindow()
                    }
                })
                .catch(() => {
                    console.log(submit_error)
                })
        })
            .catch(() => {
                console.log("address_error", submit_error)
            })
    }

    const [categories, setCategories] = useState<SelectOption[]>([])

    const category_options: SelectOption[] = (dynamicCategories.length ? dynamicCategories : category_list)
        ?.map(item => ({
            label: `${!dynamicCategories.length ? `${item.category_name}-(${item.work_package})` : item.category_name}`,
            value: item.category_name
        })) || [];
        
    const handleChange = (selectedOptions : SelectOption[]) => {
        setCategories(selectedOptions)
    }

    const closewindow = () => {
        const button = document.getElementById('sheetClose');
        button?.click();
    };

    return (
        <div className={`flex-1 space-x-2 ${navigation ? " md:space-y-4 p-4 md:p-8 pt-6" : ""} `}>
            {navigation && (
                <div className="flex gap-1">
                <Link to="/vendors"><ArrowLeft className="mt-1.5" /></Link>
                <div>
                <h2 className="text-2xl font-bold tracking-tight">Add Vendor</h2>
                <p className="text-muted-foreground">
                    Fill out to create a new Vendor
                </p>
                </div>
            </div>
            )}
            
            <Separator className="my-6" />
            <Form {...form}>
                <form onSubmit={(event) => {
                    event.stopPropagation();
                    return form.handleSubmit(onSubmit)(event);
                }} className="space-y-8">
                    <FormField
                        control={form.control}
                        name="vendor_name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="flex">Vendor Shop Name<sup className="text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input placeholder="enter shop name..." {...field} />
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

                    <FormField
                        control={form.control}
                        name="vendor_gst"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="flex">GST Number<sup className="text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input placeholder="enter gst..." {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>

                        )}
                    />
                    {renderCategorySelection &&  (
                    <div>
                        <label className="flex items-center">Add Category<sup className="text-sm text-red-600">*</sup></label>
                        <ReactSelect options={category_options} onChange={handleChange} isMulti />
                    </div>
                    )}
                    <Separator className="my-3" />
                    <p className="text-sky-600 font-semibold pb-2">Vendor Address Details</p>
                    <FormField
                        control={form.control}
                        name="address_line_1"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="flex">Address Line 1: <sup className="text-sm text-red-600">*</sup></FormLabel>
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
                                <FormLabel className="flex">Address Line 2:</FormLabel>
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
                                <FormLabel className="flex">City: <sup className="text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input placeholder="City Name" {...field} />
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
                                <FormLabel className="flex">State: <sup className="text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input placeholder="State Name" {...field} />
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
                                <FormLabel className="flex">Pin Code:</FormLabel>
                                <FormControl>
                                    <Input type="number" placeholder="Pincode" {...field} onChange={event => field.onChange(+event.target.value)} />
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
                                <FormLabel className="flex">Phone: <sup className="text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input type="number" placeholder="Phone" {...field} onChange={event => field.onChange(+event.target.value)} />
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
                                <FormLabel>Email: </FormLabel>
                                <FormControl>
                                    <Input placeholder="Email" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {(loading) ? (<ButtonLoading />) : (
                        
                        <div className="flex space-x-2 items-center justify-end">
                            <Button variant="outline" onClick={() => form.reset()}>Cancel</Button>
                            <Button type="submit">Submit</Button>
                        </div>
                        
                        )}
                        {!navigation && (
                        <SheetClose asChild><Button id="sheetClose" className="w-0 h-0 invisible"></Button></SheetClose>
                        )}
                </form>
            </Form>
        </div>
    )
}