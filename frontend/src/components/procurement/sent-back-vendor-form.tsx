import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useState } from "react"

import * as z from "zod"

import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import ReactSelect from 'react-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DialogClose } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { ButtonLoading } from "../button-loading"
import { AddressForm } from "../address-form"
import { Separator } from "@radix-ui/react-dropdown-menu"


// 1.a Create Form Schema accordingly
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
    vendor_address: z
        .string({
            required_error: "Must provide type company_address"
        })
        .min(3, {
            message: "Type Name must be at least 3 characters.",
        }),
    vendor_email: z
        .string({
            required_error: "Must provide type company_address"
        })
        .min(3, {
            message: "Type Name must be at least 3 characters.",
        }),
    vendor_mobile: z
        .number({
            required_error: "Enter standard number"
        })
        .nonnegative(),
    vendor_gst: z
        .string({
        }),
    // vendor_categories: z
    //     .array(z.string())
})

interface SelectOption {
    label: string;
    value: string;
}

type VendorFormValues = z.infer<typeof VendorFormSchema>

export default function SentBackVendorForm({ sent_back_data, quotation_request_list_mutate, vendor_list_mutate }) {
    // 1.b Define your form.
    // Has handleSubmit, control functions
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
    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof VendorFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        // let category_json = Object.values(categories).map((object) => { return object["value"] })
        let category_json = [`${sent_back_data.category}`]
        console.log(category_json)
        createDoc('Vendors', { ...values, vendor_category: { "categories": category_json } })
            // .then((doc) => {
            //     console.log("values", values)
            //     console.log("doc", doc)
            //     categories.map((cat) => {
            //         const vendor_category = {
            //             vendor: doc.name,
            //             category: cat.value,
            //             vendor_name: doc.vendor_name
            //         }
            //         createDoc('Vendor Category', vendor_category)
            //             .then(() => {
            //                 console.log(vendor_category)
            //                 vendor_category_mutate()
            //                 vendor_list_mutate()
            //             })
            //             .catch(() => {
            //                 console.log(submit_error)
            //             })
            //     })
            // })
            .then((doc)=>{
                sent_back_data.item_list?.list.map((value) => {
                    const newItem = {
                        procurement_task: sent_back_data.procurement_request,
                        project: sent_back_data.project_name,
                        category: sent_back_data.category,
                        item: value.name,
                        vendor: doc.name,
                        quantity: value.quantity
                    }
                    createDoc("Quotation Requests", newItem)
                    .then(()=>{
                        quotation_request_list_mutate()
                        vendor_list_mutate()
                        console.log(newItem)
                    })
                    .catch(()=>{
                        console.log(submit_error)
                    })

                })
            })
            .catch(() => {
                console.log(submit_error)
            })

            


    }
    const options: SelectOption[] = address?.map(item => ({
        label: item.name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const category_options: SelectOption[] = category_list?.map(item => ({
            label: item.category_name,
            value: item.category_name
        })) || [];
    const [categories, setCategories] = useState()
    const handleChange = (selectedOptions) => {
        setCategories(selectedOptions)
        console.log(categories)
    }

    return (
        // <ScrollArea className="h-[450px] w-[600px] rounded-md border p-4">
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
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Vendor Address</FormLabel>
                            <FormControl>
                                <Input placeholder="Company Address" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                /> */}
                <FormField
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
                />
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
                    name="vendor_mobile"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                                <Input
                                    type="number"
                                    placeholder="Phone Number"
                                    {...field}
                                    onChange={event => field.onChange(+event.target.value)}
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
                                <Input placeholder="Email" {...field} />
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
                {/* <div>
                    <label>Add Category</label>
                    <ReactSelect options={category_options} onChange={handleChange} isMulti />
                </div> */}
                {(loading) ? (<ButtonLoading />) : (<Button type="submit">Submit</Button>)}
                <DialogClose asChild><Button id="dialogClose" className="w-0 h-0 invisible"></Button></DialogClose>
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
        // </ScrollArea>
    )
}