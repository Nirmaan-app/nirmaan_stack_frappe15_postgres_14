import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useEffect } from "react"
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
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { ButtonLoading } from "./button-loading"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { ScrollArea } from "./ui/scroll-area"
import { Separator } from "@radix-ui/react-dropdown-menu"
import { AddressForm } from "./address-form"
import {DialogClose} from "@/components/ui/dialog"


const customerFormSchema = z.object({
    company_name: z
        .string({
            required_error: "Must provide company Name"
        })
        .min(3, {
            message: "Employee Name must be at least 3 characters.",
        }),
    company_address: z
        .string({
            required_error: "Please select Project Address"
        }),
    company_contact_person: z
        .string({
            required_error: "Must provide contact person"
        })
})

type CustomerFormValues = z.infer<typeof customerFormSchema>

interface SelectOption {
    label: string;
    value: string;
}

export default function CustomerForm({company_mutate}) {
    // 1.b Define your form.
    // Has handleSubmit, control functions
    const form = useForm<CustomerFormValues>({
        resolver: zodResolver(customerFormSchema),
        defaultValues: {
        },
        mode: "onChange",
    })

    const { data: address, isLoading: address_isLoading, error: address_error } = useFrappeGetDocList('Address', {
        fields: ["name", "address_title"],
        filters: [["address_type", "=", "Office"]]
    });

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof customerFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        createDoc('Customers', values)
            .then(() => {
                console.log(values)
            }).catch(() => {
                console.log(submit_error)
            })
    }

    // Transform data to select options
    const options: SelectOption[] = address?.map(item => ({
        label: item.name, // Adjust based on your data structure
        value: item.name
    })) || [];
    function closewindow(){
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
                            <FormLabel>Company Name</FormLabel>
                            <FormControl>
                                <Input placeholder="Company Name" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
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
                />
                <FormField
                    control={form.control}
                    name="company_contact_person"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Company Contact Person</FormLabel>
                            <FormControl>
                                <Input placeholder="Person Name" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                {(loading) ? (<ButtonLoading />) : (<Button type="submit">Submit</Button>)}
                <DialogClose asChild><Button id="dialogClose" className="w-0 h-0 invisible"></Button></DialogClose>
                <div>
                    {submit_complete && 
                    <div>
                    <div className="font-semibold text-green-500"> Customer added</div>
                    {closewindow()}
                    </div>
                    }
                    {submit_error && <div>{submit_error}</div>}
                </div>
            </form>
        </Form>
    )
}