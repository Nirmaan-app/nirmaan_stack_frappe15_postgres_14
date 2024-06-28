import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
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
import { Input } from "@/components/ui/input"
import { useFrappeCreateDoc } from "frappe-react-sdk"
import { ButtonLoading } from "./button-loading"
import { Separator } from "./ui/separator"
import { DialogClose } from "@/components/ui/dialog"


const customerFormSchema = z.object({
    company_name: z
        .string({
            required_error: "Must provide company Name"
        })
        .min(3, {
            message: "Employee Name must be at least 3 characters.",
        }),

    company_address_line_1: z
        .string({
            required_error: "Address Required"
        }),
    company_address_line_2: z
        .string(),
    company_city: z
        .string({
            required_error: "Must provide city"
        }),
    company_state: z
        .string({
            required_error: "Must provide state"
        }),
    company_pin: z
        .number({
            required_error: "Must provide pincode"
        })
        .positive()
        .gte(100000)
        .lte(999999),

    company_contact_person: z
        .string({
            required_error: "Must provide contact person"
        }),
    email: z
        .string()
        .email(),
    phone: z
        .number({
            required_error: "Must provide contact"
        })
        .positive()
        .gte(1000000000)
        .lte(9999999999),
    company_gst: z
        .string()
})

type CustomerFormValues = z.infer<typeof customerFormSchema>

interface SelectOption {
    label: string;
    value: string;
}

export default function CustomerForm({ company_mutate }) {
    // 1.b Define your form.
    // Has handleSubmit, control functions
    const form = useForm<CustomerFormValues>({
        resolver: zodResolver(customerFormSchema),
        defaultValues: {
            name: ""
        },
        mode: "onChange",
    })

    // const { data: address, isLoading: address_isLoading, error: address_error } = useFrappeGetDocList('Address', {
    //     fields: ["name", "address_title"],
    //     filters: [["address_type", "=", "Office"]]
    // });

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof customerFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        createDoc('Address', {
            address_title: values.company_name,
            address_type: "Office",
            address_line1: values.company_address_line_1,
            address_line2: values.company_address_line_2,
            city: values.company_city,
            state: values.company_state,
            country: "India",
            pincode: values.company_pin,
            email_id: values.email,
            phone: values.phone
        }).then(doc => {
            createDoc('Customers', {
                company_name: values.company_name,
                company_address: doc.name,
                company_contact_person: values.company_contact_person,
                company_phone: values.phone,
                company_email: values.email,
                company_gst: values.company_gst
            }).then(() => {
                console.log(values)
            }).catch(() => {
                console.log(submit_error)
            })
        }).catch(() => console.log(submit_error))

    }

    // Transform data to select options
    // const options: SelectOption[] = address?.map(item => ({
    //     label: item.name, // Adjust based on your data structure
    //     value: item.name
    // })) || [];
    function closewindow() {
        var button = document.getElementById('dialogClose');
        company_mutate()
        button.click();
    }

    return (
        <Form {...form}>
            <form onSubmit={(event) => {
                event.stopPropagation();
                return form.handleSubmit(onSubmit)(event);

            }} className="space-y-8">
                <FormField
                    control={form.control}
                    name="company_name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Company Name:</FormLabel>
                            <FormControl>
                                <Input placeholder="Empty" {...field} />
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
                            <FormLabel>Company GST no.:</FormLabel>
                            <FormControl>
                                <Input placeholder="Empty" {...field} />
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
                            <FormLabel>Company Contact Person</FormLabel>
                            <FormControl>
                                <Input placeholder="Empty" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                                <Input type="number" placeholder="Empty" {...field} onChange={event => field.onChange(+event.target.value)} />
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
                                <Input placeholder="Empty" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <Separator />
                <div className="text-base font-bold">Company Address Details:</div>
                <FormField
                    control={form.control}
                    name="company_address_line_1"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Address Line 1:</FormLabel>
                            <FormControl>
                                <Input placeholder="Empty" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="company_address_line_2"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Address Line 2:</FormLabel>
                            <FormControl>
                                <Input placeholder="Empty" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="company_city"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                                <Input placeholder="Empty" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="company_state"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                                <Input placeholder="Empty" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="company_pin"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Pin Code</FormLabel>
                            <FormControl>
                                <Input type="number" placeholder="Empty" {...field} onChange={event => field.onChange(+event.target.value)} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />

                {/* <FormField
                    control={form.control}
                    name="company_address"
                    render={({ field }) => {
                        return (
                            <FormItem>
                                <FormLabel>Company Address Select</FormLabel>
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
                                        <Button variant="secondary"> + Add Project Address</Button>
                                    </DialogTrigger>

                                    <DialogContent className="sm:max-w-[425px]">
                                        <ScrollArea className="h-[600px] w-[350px]">
                                            <DialogHeader>
                                                <DialogTitle>Add New Project Address</DialogTitle>
                                                <DialogDescription>
                                                    Add new project address here.
                                                </DialogDescription>
                                            </DialogHeader>
                                            <Separator className="my-6" />

                                            <AddressForm type={"Office"} />

                                        </ScrollArea>
                                    </DialogContent>
                                </Dialog>
                                <FormMessage />
                            </FormItem>
                        )
                    }}
                /> */}

                {(loading) ? (<ButtonLoading />) : (<Button type="submit">Submit</Button>)}
                <DialogClose asChild><Button id="dialogClose" className="w-0 h-0 invisible"></Button></DialogClose>
                <div>
                    {submit_complete &&
                        <div>
                            <div className="font-semibold text-green-500">New Customer added</div>
                            {closewindow()}
                        </div>
                    }
                    {submit_error && <div>{submit_error}</div>}
                </div>
            </form>
        </Form>
    )
}