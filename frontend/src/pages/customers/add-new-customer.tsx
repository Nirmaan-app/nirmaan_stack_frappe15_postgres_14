import { useState, useEffect, useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
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
import { useFrappeCreateDoc, useFrappeDeleteDoc, useSWRConfig } from "frappe-react-sdk";
import { Separator } from "@/components/ui/separator"
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
// import { useQueryClient } from "@tanstack/react-query";
import useCustomFetchHook from "@/reactQuery/customFunctions";
import { SheetClose } from "@/components/ui/sheet";
// import { exampleFunction } from "@/reactQuery/customFunctions";
import { usePincode } from "@/hooks/usePincode"

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
            required_error: "Address line 1 Required"
        })
        .min(1, {
            message: "Address line 1 Required"
        })
        ,
    company_address_line_2: z.string({
        required_error: "Address line 2 Required"
    })
    .min(1, {
        message: "Address line 2 Required"
    }),
    company_city: z
        .string({
            required_error: "Must provide city"
        })
        .min(1, {
            message: "Must Provide City"
        }),
    company_state: z
        .string({
            required_error: "Must provide state"
        })
        .min(1, {
            message: "Musti Provide State"
        }),
    company_pin: z
        .string({
            required_error: "Must provide pincode"
        })
        .max(6, { message: "Pincode must be of 6 digits" })
        .min(6, { message: "Pincode must be of 6 digits" }),

    company_contact_person: z
        .string()
        .optional(),
    email: z.string().email().optional().or(z.literal('')),
    phone: z
        .string()
        .max(10, { message: "Mobile number must be of 10 digits" })
        .min(10, { message: "Mobile number must be of 10 digits" })
        .optional(),
    company_gst: z.string({
        required_error: "Must provide customer GST Details"
    }).min(1, {
        message: "Must Provide Customer GST Details"
    }),
});

type CustomerFormValues = z.infer<typeof customerFormSchema>;

export default function NewCustomer({ company_mutate, navigation = true }) {

    const form = useForm<CustomerFormValues>({
        resolver: zodResolver(customerFormSchema),
        defaultValues: {},
        mode: "onBlur",
    });

    const {createDoc, loading, error: submitError} = useFrappeCreateDoc();
    const {deleteDoc} = useFrappeDeleteDoc()
    const { toast } = useToast()
    const navigate = useNavigate()
    // const queryClient = useQueryClient()
    const { mutate } = useSWRConfig()

    const { fetchDocList } = useCustomFetchHook()

    // const onSubmit = async (values: CustomerFormValues) => {
    //     try {

    //         const addressDoc = await createDoc("Address", {
    //             address_title: values.company_name,
    //             address_type: "Office",
    //             address_line1: values.company_address_line_1,
    //             address_line2: values.company_address_line_2,
    //             city: values.company_city,
    //             state: values.company_state,
    //             country: "India",
    //             pincode: values.company_pin,
    //             email_id: values.email,
    //             phone: values.phone,
    //         });

    //         await createDoc("Customers", {
    //             company_name: values.company_name,
    //             company_address: addressDoc.name,
    //             company_contact_person: values.company_contact_person,
    //             company_phone: values.phone,
    //             company_email: values.email,
    //             company_gst: values.company_gst,
    //         });

    //         await mutate("Customers", async () => {
    //             const data = await fetchDocList("Customers")
    //             return data
    //         }, {
    //             rollbackOnError: true,
    //             populateCache: (newData, currentData) => newData || currentData,
    //             revalidate: true,
    //             throwOnError: true,
    //         })
    //         if (!navigation) {
    //             company_mutate()
    //         }
    //         toast({
    //             title: "Success",
    //             description: (
    //                 <>
    //                     Customer: <strong className="text-[14px]">{values.company_name}</strong> Created Successfully!
    //                 </>
    //             ),
    //             variant: "success",
    //         });
    //         // await queryClient.invalidateQueries({ queryKey: ["docList", "Customers"], refetchType: "active" });
    //         form.reset();
    //         if (navigation) {
    //             navigate("/customers");
    //         } else {
    //             closewindow()
    //         }
    //     } catch (err) {
    //         console.log("Error while creating new customer:", err, submitError);
    //     }
    // }

    const onSubmit = async (values: CustomerFormValues) => {
        try {
            // Create the address document
            const addressDoc = await createDoc("Address", {
                address_title: values.company_name,
                address_type: "Office",
                address_line1: values.company_address_line_1,
                address_line2: values.company_address_line_2,
                city: values.company_city,
                state: values.company_state,
                country: "India",
                pincode: values.company_pin,
                email_id: values.email,
                phone: values.phone,
            });
    
            try {
                // Create the customer document using the address document reference
                await createDoc("Customers", {
                    company_name: values.company_name,
                    company_address: addressDoc.name,
                    company_contact_person: values.company_contact_person,
                    company_phone: values.phone,
                    company_email: values.email,
                    company_gst: values.company_gst,
                });
    
                // Mutate customer data after successful creation
                await mutate("Customers", async () => {
                    const data = await fetchDocList("Customers");
                    return data;
                }, {
                    rollbackOnError: true,
                    populateCache: (newData, currentData) => newData || currentData,
                    revalidate: true,
                    throwOnError: true,
                });
    
                if (!navigation) {
                    company_mutate();
                }
    
                // Success toast notification
                toast({
                    title: "Success",
                    description: (
                        <>
                            Customer: <strong className="text-[14px]">{values.company_name}</strong> Created Successfully!
                        </>
                    ),
                    variant: "success",
                });
    
                // Reset form and handle navigation
                form.reset();
                if (navigation) {
                    navigate("/customers");
                } else {
                    closewindow();
                }
    
            } catch (customerError) {
                // Delete the address document if customer creation fails
                await deleteDoc('Address', addressDoc.name);
                throw customerError;
            }
        } catch (err) {
            // Error handling for address creation or customer creation failure
            toast({
                title: "Failed!",
                description: `${err?.message}`,
                variant: "destructive",
            });
            console.log("Error while creating new customer:", err);
        }
    };
    

    const closewindow = () => {
        const button = document.getElementById('sheetClose');
        button?.click();
    };

    const resetForm = () => {
        form.reset({
            company_name: "",
            email: "",
            phone: "",
            company_contact_person: "",
            company_gst: "",
            company_address_line_1: "",
            company_address_line_2: "",
            company_city: "",
            company_state: "",
            company_pin: "",
        });
        form.clearErrors();
    }

    const [pincode, setPincode] = useState("")
    const { city, state } = usePincode(pincode)

    const debouncedFetch = useCallback(
        (value: string) => {
            if (value.length === 6) {
                setPincode(value)
            }
        }, []
    )

    const handlePincodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        debouncedFetch(value)
    }

    useEffect(() => {
        if (pincode.length === 6) {
            form.setValue("company_city", city || "")
            form.setValue("company_state", state || "")
        }
    }, [city, state, form])


    console.log("values", form.getValues())

    return (
        <div className={`${navigation && "p-4"}`}>
            {
                navigation && (<div className="space-y-0.5">
                    <div className="flex space-x-2 items-center">
                        <ArrowLeft className="cursor-pointer" onClick={() => navigate("/customers")} />
                        <h2 className="text-2xl font-bold tracking-tight">Add Customer</h2>
                    </div>
                    <p className="text-muted-foreground pl-8">
                        Fill out to create a new Customer
                    </p>
                </div>)
            }
            <Separator className="my-6 max-md:my-2" />
            <Form {...form}>
                <form
                    onSubmit={(event) => {
                        event.stopPropagation();
                        return form.handleSubmit(onSubmit)(event);
                    }}
                    className="space-y-8"
                >
                    <FormField
                        control={form.control}
                        name="company_name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="flex">Company Name:<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input placeholder="Company Name" {...field} />
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
                                <FormLabel className="flex">Company GST no.:<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input placeholder="GST Number" {...field} />
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
                                <FormLabel>Company Contact Person:</FormLabel>
                                <FormControl>
                                    <Input placeholder="Contact Person" {...field} />
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
                                <FormLabel>Phone:</FormLabel>
                                <FormControl>
                                    <Input
                                        type="number"
                                        placeholder="Phone Number"
                                        {...field}
                                    />
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
                                <FormLabel>Email:</FormLabel>
                                <FormControl>
                                    <Input type="email" placeholder="Email" {...field} />
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
                                <FormLabel className="flex">Address Line 1:<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input placeholder="Address Line 1" {...field} />
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
                                <FormLabel className="flex">Address Line 2:<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                <FormControl>
                                    <Input placeholder="Address Line 2" {...field} />
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
                                <FormLabel className="flex">City:</FormLabel>
                                <FormControl>
                                    <Input placeholder={city || "City"} disabled={true} {...field} />
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
                                <FormLabel className="flex">State:</FormLabel>
                                <FormControl>
                                    <Input placeholder={state || "State"} disabled={true} {...field} />
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
                                <FormLabel className="flex">Pin Code:<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
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
                    <div className="flex justify-end  space-x-2">
                        <Button type="button" variant="outline" onClick={() => resetForm()}>
                            Reset
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? "Submitting..." : "Submit"}
                        </Button>
                    </div>
                    {!navigation && (
                        <SheetClose asChild><Button id="sheetClose" className="w-0 h-0 invisible"></Button></SheetClose>
                    )}
                    {/* <div>
                    {submitComplete && (
                            <div className="font-semibold text-green-500">
                                New Customer added
                            </div>
                    )}
                    {submitError && (
                        <div className="flex-1">
                            <div className="font-semibold text-red-500">
                                {submitError.message}
                            </div>
                            <div className="font-slim text-red-500">
                                {submitError.exception}
                            </div>
                        </div>
                    )}
                </div> */}
                </form>
            </Form>
        </div>
    );
}
