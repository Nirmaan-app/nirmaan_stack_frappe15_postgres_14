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
import { useFrappeCreateDoc } from "frappe-react-sdk";
import { Separator } from "@/components/ui/separator"
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { useQueryClient } from "@tanstack/react-query";

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
    company_address_line_2: z.string(),
    company_city: z
        .string({
            required_error: "Must provide city"
        }),
    company_state: z
        .string({
            required_error: "Must provide state"
        }),
    company_pin: z
        .string({
            required_error: "Must provide pincode"
        }),

    company_contact_person: z
        .string({
            required_error: "Must provide contact person"
        }),
    email: z.string().email(),
    phone: z
        .string({
            required_error: "Must provide contact"
        }),
    company_gst: z.string(),
});

type CustomerFormValues = z.infer<typeof customerFormSchema>;

export default function NewCustomer() {

    const form = useForm<CustomerFormValues>({
        resolver: zodResolver(customerFormSchema),
        defaultValues: {
            company_name: "",
            email: "",
            phone:  "",
            company_contact_person: "",
            company_gst: "",
            company_address_line_1: "",
            company_address_line_2: "",
            company_city: "",
            company_state: "",
            company_pin: "",
        },
        mode: "all",
    });

    const {
        createDoc,
        loading,
        error: submitError,
    } = useFrappeCreateDoc();
    const {toast} = useToast()
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    function onSubmit(values: CustomerFormValues) {
        createDoc("Address", {
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
        })
            .then((doc) => {
                createDoc("Customers", {
                    company_name: values.company_name,
                    company_address: doc.name,
                    company_contact_person: values.company_contact_person,
                    company_phone: values.phone,
                    company_email: values.email,
                    company_gst: values.company_gst,
                }).then(() => {
                    toast({
                        title: "Success",
                        description: `${values.company_name} Customer Created Successfully!`,
                        variant: "success"
                    })
                    queryClient.invalidateQueries({ queryKey: ["docList", "Customers"], refetchType: "active" })
                });
                    form.reset()
                    navigate("/customers")
            })
            .catch((err) => console.log("error while creating new customer", err, submitError));
    }

    return (
        <div className="p-4">
            <div className="space-y-0.5">
            <div className="flex space-x-2 items-center">
                <ArrowLeft className="cursor-pointer" onClick={() => navigate("/customers")} />
                <h2 className="text-2xl font-bold tracking-tight">Add Customer</h2>
            </div>
                <p className="text-muted-foreground pl-8">
                    Fill out to create a new Customer
                </p>
            </div>
            <Separator className="my-6" />
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
                            <FormLabel>Company Name:</FormLabel>
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
                            <FormLabel>Company GST no.:</FormLabel>
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
                            <FormLabel>Address Line 1:</FormLabel>
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
                            <FormLabel>Address Line 2:</FormLabel>
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
                            <FormLabel>City:</FormLabel>
                            <FormControl>
                                <Input placeholder="City" {...field} />
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
                            <FormLabel>State:</FormLabel>
                            <FormControl>
                                <Input placeholder="State" {...field} />
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
                            <FormLabel>Pin Code:</FormLabel>
                            <FormControl>
                                <Input
                                    type="number"
                                    placeholder="Pin Code"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="flex justify-end  space-x-2">
                        <Button type="button" variant="outline" onClick={() => form.reset()}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? "Submitting..." : "Submit"}
                        </Button>
                    </div>
                <div>
                    {/* {submitComplete && (
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
                    )} */}
                </div>
            </form>
        </Form>
        </div>
    );
}
