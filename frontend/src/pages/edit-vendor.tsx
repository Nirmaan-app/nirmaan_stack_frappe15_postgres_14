import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
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
import { Navigate, useNavigate, useParams } from "react-router-dom"

const VendorFormSchema = z.object({
    vendor_contact_person_name: z
        .string({
        }),
    vendor_name: z
        .string({
        }),
    address_line_1: z
        .string({
        }),
    address_line_2: z
        .string({
        }),
    vendor_city: z
        .string({
        }),
    vendor_state: z
        .string({
        }),
    pin: z
        .number({
        }),
    vendor_email: z
        .string(),
    vendor_mobile: z
        .number({
        }),
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

export const EditVendor = () => {
    const navigate = useNavigate()
    const { id } = useParams<{ id: string }>()
    const { data, error, isValidating } = useFrappeGetDoc(
        'Vendors',
        `${id}`
    );
    const { data: vendor_category_list, isLoading: vendor_category_list_loading, error: vendor_category_list_error } = useFrappeGetDocList("Vendor Category",
        {
            fields: ['vendor', 'category'],
            filters:[["vendor","=",id]]
        });


    const form = useForm<VendorFormValues>({
        resolver: zodResolver(VendorFormSchema),
        defaultValues: {
            vendor_contact_person_name: "",
            vendor_name: "",
            address_line_1: "",
            address_line_2: "",
            vendor_city: "",
            vendor_state: "",
            pin: 0,
            vendor_email: data?.vendor_email,
            vendor_mobile: data?.vendor_mobile,
            vendor_gst: ""

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

    // const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()

    function onSubmit(values: z.infer<typeof VendorFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        let category_json = Object.values(categories).map((object) => { return object["value"] })
        console.log(category_json)

        updateDoc('Vendors',`${id}`, {
            vendor_category: { "categories": category_json }
        }).then((doc) => {
            console.log(doc)
            navigate("/vendors")
        }).catch(() => {
            console.log(submit_error)
        })

        // createDoc('Vendors', { ...values, vendor_category: { "categories": category_json } })
        //     .then((doc) => {

        //     })
        //     .catch(() => {
        //         console.log(submit_error)
        //     })

        // createDoc('Address', {
        //     address_title: values.vendor_name,
        //     address_type: "Shop",
        //     address_line1: values.address_line_1,
        //     address_line2: values.address_line_2,
        //     city: values.vendor_city,
        //     state: values.vendor_state,
        //     country: "India",
        //     pincode: values.pin,
        //     email_id: values.vendor_email,
        //     phone: values.vendor_mobile
        // }).then(doc => {
        //     createDoc('Vendors', {
        //         vendor_name: values.vendor_name,
        //         vendor_type: "Material",
        //         vendor_address: doc.name,
        //         vendor_city: doc.city,
        //         vendor_state: doc.state,
        //         vendor_contact_person_name: values.vendor_contact_person_name,
        //         vendor_mobile: values.vendor_mobile,
        //         vendor_email: values.vendor_email,
        //         vendor_gst: values.vendor_gst,
        //         vendor_category: { "categories": category_json }
        //     })
        //         .then(() => {
        //             navigate("/vendors")
        //         })
        //         .catch(() => {
        //             console.log(submit_error)
        //         })
        // })
        //     .catch(() => {
        //         console.log("address_error", submit_error)
        //     })

    }

    const options: SelectOption[] = address?.map(item => ({
        label: item.name,
        value: item.name
    })) || [];

    const category_options: SelectOption[] = category_list
        ?.map(item => ({
            label: `${item.category_name}-(${item.work_package})`,
            value: item.category_name
        })) || [];

    const default_options: SelectOption[] = vendor_category_list
    ?.map(item => ({
        label: item.category,
        value: item.category
    })) || [];
    console.log(default_options)

    const [categories, setCategories] = useState(default_options)
    const handleChange = (selectedOptions) => {
        setCategories(selectedOptions)
        console.log(categories)
    }

    return (
        <MainLayout>
            <div className="p-4">
                <div className="space-y-0.5">
                    <h2 className="text-2xl font-bold tracking-tight">Edit Vendor</h2>
                    <p className="text-muted-foreground">
                        Fill out this to edit vendor category details
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
                                        <Input disabled={true} placeholder={data?.vendor_name} {...field} />
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
                                        <Input disabled={true} placeholder={data?.vendor_contact_person_name} {...field} />
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
                                        <Input disabled={true} placeholder={data?.vendor_gst} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>

                            )}
                        />
                        <div>
                            <label>Add Category</label>
                            {(default_options.length>0 && category_options.length>0) && <ReactSelect options={category_options} defaultValue={default_options} onChange={handleChange} isMulti />}
                        </div>
                        <Separator className="my-3" />
                        <p className="text-sky-600 font-semibold pb-2">Vendor Address Details</p>
                        <FormField
                            control={form.control}
                            name="address"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Address Line 1: </FormLabel>
                                    <FormControl>
                                        <Input disabled={true} placeholder={data?.vendor_address} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        {/* <FormField
                            control={form.control}
                            name="address_line_2"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Address Line 2: </FormLabel>
                                    <FormControl>
                                        <Input placeholder={data?.address_line_2} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        /> */}
                        <FormField
                            control={form.control}
                            name="vendor_city"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>City: </FormLabel>
                                    <FormControl>
                                        <Input disabled={true} placeholder={data?.vendor_city} {...field} />
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
                                        <Input disabled={true} placeholder={data?.vendor_state}{...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>

                            )}
                        />
                        {/* <FormField
                            control={form.control}
                            name="pin"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Pin Code: </FormLabel>
                                    <FormControl>
                                        <Input type="number" placeholder={data?.pin} {...field} onChange={event => field.onChange(+event.target.value)} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        /> */}
                        <FormField
                            control={form.control}
                            name="vendor_mobile"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Phone: </FormLabel>
                                    <FormControl>
                                        <Input disabled={true} type="number" placeholder={data?.vendor_mobile} {...field} onChange={event => field.onChange(+event.target.value)} />
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
                                        <Input disabled={true} placeholder={data?.vendor_email} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        {(loading) ? (<ButtonLoading />) : (<Button type="submit">Update Vendor Category</Button>)}

                        <div>
                            {submit_complete &&
                                <div>
                                    <div className="font-semibold text-green-500">Vendor Updated</div>
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