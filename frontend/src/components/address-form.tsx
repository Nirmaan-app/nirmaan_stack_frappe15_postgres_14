import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useEffect } from "react"
import * as z from "zod"

import { Button } from "@/components/ui/button"
import {DialogClose} from "@/components/ui/dialog"
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



// 1.a Create Form Schema accordingly
const addressFormSchema = z.object({
    address_title: z
        .string({
            required_error: "Must provide an address identifier"
        })
        .min(3, {
            message: "Employee Name must be at least 3 characters.",
        }),
    address_type: z
        .string(),
    address_line1: z
        .string(),
    city: z
        .string({
            required_error: "City name is mandatory"
        }),
    state: z
        .string({
            required_error: "Must provide state name"
        }),
    country: z
        .string(),
    pincode: z
        .number({
            required_error: "Must provide pincode"
        })
        .positive()
        .gte(100000)
        .lte(999999),
    email_id: z
        .string()
        .email(),
    phone: z
        .number({
            required_error: "Must provide contact"
        })
        .positive()
        .gte(1000000000)
        .lte(9999999999)
})

type EmoloyeeFormValues = z.infer<typeof addressFormSchema>

interface AddressFormProps {
    type: string
}

export const AddressForm: React.FC<AddressFormProps> = ({ type , project_address_mutate}) => {
    // 1.b Define your form.
    // Has handleSubmit, control functions
    const form = useForm<EmoloyeeFormValues>({
        resolver: zodResolver(addressFormSchema),
        defaultValues: {
            address_type: type,
            country: "India",
            phone: +91
        },
        mode: "onChange",
    })

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof addressFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        createDoc('Address', values)
            .then(() => {
                console.log(values)
            }).catch(() => {
                console.log(submit_error)
            })
    }
    function closewindow(){
        var button = document.getElementById('dialogClose');
        project_address_mutate()
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
                    name="address_title"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Address Title</FormLabel>
                            <FormControl>
                                <Input placeholder="Some address identifier" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="address_type"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Address Type</FormLabel>
                            <FormControl>
                                <Input disabled {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="address_line1"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Build & Street Address</FormLabel>
                            <FormControl>
                                <Input placeholder="Enter street address" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                                <Input placeholder="Enter city name" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                                <Input placeholder="Enter state name" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Country</FormLabel>
                            <FormControl>
                                <Input disabled {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="pincode"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Pin Code</FormLabel>
                            <FormControl>
                                <Input
                                    type="number"
                                    placeholder="Pincode"
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
                    name="email_id"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                                <Input placeholder="Enter email" {...field} />
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
                                <Input
                                    type="number"
                                    {...field}
                                    onChange={event => field.onChange(+event.target.value)}
                                />
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