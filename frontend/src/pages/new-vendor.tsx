import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MainLayout } from "@/components/layout/main-layout"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { ButtonLoading } from "@/components/button-loading"
import ReactSelect from 'react-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { AddressForm } from "../components/address-form"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"

const VendorFormSchema = z.object({
    vendor_contact_person_name: z
        .string({
            required_error: "Must provide type Name"
        })
        .min(3, {
            message: "Type Name must be at least 3 characters.",
        }),
    vendor_name: z
        .string({
            required_error: "Must provide type vendor_name"
        })
        .min(3, {
            message: "Type Name must be at least 3 characters.",
        }),
    address_line_1: z
        .string({
            required_error: "Address Required"
        }),
    address_line_2: z
        .string({
            required_error: "Address Required"
        }),
    vendor_city: z
        .string({
            required_error: "Must provide city"
        }),
    vendor_state: z
        .string({
            required_error: "Must provide state"
        }),
    pin: z
        .number({
            required_error: "Must provide pincode"
        })
        .positive()
        .gte(100000)
        .lte(999999),
    vendor_email: z
        .string()
        .email(),
    vendor_mobile: z
        .number({
            required_error: "Must provide contact"
        })
        .positive()
        .gte(1000000000)
        .lte(9999999999),
    vendor_gst: z
        .string({
        }),
    // vendor_categories: z
    //     .array(z.string())
})

type VendorFormValues = z.infer<typeof VendorFormSchema>

interface SelectOption {
    label: string;
    value: string;
}

export const NewVendor = () => {
    const navigate = useNavigate()
    const form = useForm<VendorFormValues>({
        resolver: zodResolver(VendorFormSchema),
        defaultValues: {
            name: ""
        },
        mode: "onChange",
    })
    const { data: address, isLoading: address_isLoading, error: address_error, mutate: project_address_mutate } = useFrappeGetDocList('Address', {
        fields: ["name", "address_title"],
        filters: [["address_type", "=", "Shop"]],
        limit: 1000
    });
    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package']
        });

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()

    function onSubmit(values: z.infer<typeof VendorFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        let category_json = Object.values(categories).map((object) => { return object["value"] })
        console.log(category_json)
        // createDoc('Vendors', { ...values, vendor_category: { "categories": category_json } })
        //     .then((doc) => {

        //     })
        //     .catch(() => {
        //         console.log(submit_error)
        //     })

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
                vendor_category: { "categories": category_json }
            })
                .then(() => {
                    navigate("/vendors")
                })
                .catch(() => {
                    console.log(submit_error)
                })
        })
            .catch(() => {
                console.log("address_error", submit_error)
            })

    }

    const options: SelectOption[] = address?.map(item => ({
        label: item.name,
        value: item.name
    })) || [];

    const category_options: SelectOption[] = category_list
        ?.map(item => ({
            label: item.category_name,
            value: item.category_name
        })) || [];
    const [categories, setCategories] = useState()
    const handleChange = (selectedOptions) => {
        setCategories(selectedOptions)
        console.log(categories)
    }

    return (
        <MainLayout>
            <div className="p-4">
                <div className="space-y-0.5">
                    <h2 className="text-2xl font-bold tracking-tight">Add Vendor</h2>
                    <p className="text-muted-foreground">
                        Fill out this to create a new Vendor
                    </p>
                </div>
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
                                    <FormLabel>Vendor Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Vendor Name" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>

                            )}
                        />
                        {/* <FormField
                    control={form.control}
                    name="vendor_address"
                    render={({ field }) => {
                        return (
                            <FormItem>
                                <FormLabel>Vendor Address Select</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select an address" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {address_isLoading && <div>Loading...</div>}
                                        {address_error && <div>Error: {address_error.message}</div>}
                                        {options.map(option => (
                                            <SelectItem value={option.value}>{option.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button variant="secondary"> + Add Vendor Address</Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-[425px]">
                                        <ScrollArea className="h-[600px] w-[350px]">
                                            <DialogHeader>
                                                <DialogTitle>Add New Vendor Address</DialogTitle>
                                                <DialogDescription>
                                                    Add new vendor address here.
                                                </DialogDescription>
                                            </DialogHeader>
                                            <Separator className="my-6" />

                                            <AddressForm type={"Shop"} project_address_mutate={project_address_mutate} />

                                        </ScrollArea>
                                    </DialogContent>
                                </Dialog>
                                <FormMessage />
                            </FormItem>
                        )
                    }}
                /> */}
                        <FormField
                            control={form.control}
                            name="vendor_contact_person_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Name" {...field} />
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
                                    <FormLabel>GST Number</FormLabel>
                                    <FormControl>
                                        <Input placeholder="GST Number" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>

                            )}
                        />
                        <div>
                            <label>Add Category</label>
                            <ReactSelect options={category_options} onChange={handleChange} isMulti />
                        </div>
                        <Separator className="my-3" />
                        <p className="text-sky-600 font-semibold pb-2">Vendor Address Details</p>
                        <FormField
                            control={form.control}
                            name="address_line_1"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Address Line 1: </FormLabel>
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
                                    <FormLabel>Address Line 2: </FormLabel>
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
                                    <FormLabel>City: </FormLabel>
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
                                    <FormLabel>State: </FormLabel>
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
                                    <FormLabel>Pin Code: </FormLabel>
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
                                    <FormLabel>Phone: </FormLabel>
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
                        {(loading) ? (<ButtonLoading />) : (<Button type="submit">Submit</Button>)}

                        <div>
                            {submit_complete &&
                                <div>
                                    <div className="font-semibold text-green-500">New Vendor added</div>
                                </div>

                            }
                            {submit_error && <div>{submit_error}</div>}
                        </div>
                    </form>
                </Form>
            </div>
        </MainLayout>
    )
}