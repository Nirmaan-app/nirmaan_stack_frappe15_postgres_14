import {  FrappeConfig, FrappeContext, useFrappeGetCall, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import useCustomFetchHook from "@/reactQuery/customFunctions";
import { useToast } from "@/components/ui/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import {  useEffect } from "react";
const CustomerFormSchema = z.object({
    company_name: z.string().min(1, "Company Name is required"),
    company_email: z.string().email("Invalid email address").min(1, "Company Email is required"),
    company_phone: z.string().min(1, "Company Phone is required"), 
    company_contact_person: z.string().min(1, "Contact Person is required"),
    company_gst: z.string(),
    address_line1: z.string().min(1, "Address Line 1 is required"),
    address_line2: z.string(),
    city: z.string().min(1, "City is required"),
    state: z.string(),
    pin_code: z.string().min(1, "Pin Code is required"),
});


type CustomerFormValues = z.infer<typeof CustomerFormSchema>;

 const EditCustomer = () => {

    const navigate = useNavigate();

    const { id } = useParams<{ id: string }>();

    // const { data, refetch } = useQuery({
    //     queryKey: ["doc", "Customers", id],
    //     queryFn: () => fetchDoc({doctype: "Customers", name: id}),
    //     staleTime: 1000 * 60 * 5,
    // });

    const {data, mutate : customerMutate} = useFrappeGetDoc("Customers", id, `Customers ${id}`, {
        revalidateIfStale: false
    })

    const companyAddress = data?.company_address;

    // const { data: addressData, refetch: addressRefetch } = useQuery({
    //     queryKey: ["doc","Address", companyAddress],
    //     queryFn: () => fetchDoc({doctype: "Address", name: companyAddress}),
    //     enabled: !!companyAddress,
    //     staleTime: 1000 * 60 * 5,
    // });

    const {data: addressData, mutate: addressMutate} = useFrappeGetDoc("Address", companyAddress, `Address ${companyAddress}`, {
        revalidateIfStale: false
    })

    // const queryClient = useQueryClient()
    const { updateDoc, loading, error: submit_error } = useFrappeUpdateDoc();
    const {toast} = useToast()
    const {mutate} = useSWRConfig()


    const form = useForm<CustomerFormValues>({
        resolver: zodResolver(CustomerFormSchema),
        defaultValues: {
            company_name: data?.company_name || "",
            company_email: data?.company_email || "",
            company_phone: data?.company_phone || 0,
            company_contact_person: data?.company_contact_person || "",
            company_gst: data?.company_gst || "",
            address_line1: addressData?.address_line1 || "",
            address_line2: addressData?.address_line2 || "",
            city: addressData?.city || "",
            state: addressData?.state || "",
            pin_code: addressData?.pincode || 0,
        },
        mode: "onBlur",
    });

    useEffect(() => {
        if (data && addressData) {
            form.reset({
                company_name: data.company_name,
                company_email: data.company_email,
                company_phone: data.company_phone,
                company_contact_person: data.company_contact_person,
                company_gst: data.company_gst,
                address_line1: addressData.address_line1,
                address_line2: addressData.address_line2,
                city: addressData.city,
                state: addressData.state,
                pin_code: addressData.pincode,
            });
        }
    }, [data, addressData, form]);

    const hasChanges = () => {
        const values = form.getValues();
        const originalValues = {
            company_name: data?.company_name || "",
            company_email: data?.company_email || "",
            company_phone: data?.company_phone || "",
            company_contact_person: data?.company_contact_person || "",
            company_gst: data?.company_gst || "",
            address_line1: addressData?.address_line1 || "",
            address_line2: addressData?.address_line2 || "",
            city: addressData?.city || "",
            state: addressData?.state || "",
            pin_code: addressData?.pincode || "",
        };
        return JSON.stringify(values) !== JSON.stringify(originalValues);
    };

    const updateCustomerDetails = async (values: CustomerFormValues) => {
        const hasCustomerChanged = (
            data?.company_name !== values.company_name ||
            data?.company_email !== values.company_email ||
            data?.company_phone !== values.company_phone ||
            data?.company_contact_person !== values.company_contact_person ||
            data?.company_gst !== values.company_gst
        );

        if (hasCustomerChanged) {
            await updateDoc('Customers', id, {
                company_name: values.company_name,
                company_email: values.company_email,
                company_phone: values.company_phone,
                company_contact_person: values.company_contact_person,
                company_gst: values.company_gst
            });
            customerMutate()
        }
    };

    const updateAddressDetails = async (values: CustomerFormValues) => {
        const hasAddressChanged = (
            addressData?.address_line1 !== values.address_line1 ||
            addressData?.address_line2 !== values.address_line2 ||
            addressData?.city !== values.city ||
            addressData?.state !== values.state ||
            addressData?.pincode !== values.pin_code
        );

        if (hasAddressChanged) {
            await updateDoc("Address", companyAddress, {
                address_title: values.company_name,
                address_line1: values.address_line1,
                address_line2: values.address_line2,
                city: values.city,
                state: values.state,
                pincode: values.pin_code,
                email_id: values.company_email,
                phone: values.company_phone
            });
            addressMutate()
        }
    };

    const {fetchDocList} = useCustomFetchHook()

    const onSubmit = async (values: CustomerFormValues) => {
        try {
            await updateCustomerDetails(values);
            await updateAddressDetails(values);

            await mutate("Customers", async () => {
                const data = await fetchDocList("Customers")
                return data
            }, {
                rollbackOnError: true, 
                populateCache: (newData, currentData) => newData || currentData,
                revalidate: true,
                throwOnError: true,
            })

            toast({
                title: "Success",
                description: `${values.company_name} details updated successfully!`,
                variant: "success"
            });
            navigate(`/customers/${id}`);
            
        } catch (error) {
            console.error("Error updating customer:", submit_error, error);
        }
    };

    return (
        <div className="p-4">
            <div className="space-y-0.5">
                <div className="flex space-x-2 items-center">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate(`/customers/${id}`)} />
                    <h2 className="text-2xl font-bold tracking-tight">Edit Customer</h2>
                </div>
            </div>
            <Separator className="my-6" />
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
                        name="company_email"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Company Email</FormLabel>
                                <FormControl>
                                    <Input type="email" placeholder="Company Email" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="company_phone"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Company Phone</FormLabel>
                                <FormControl>
                                    <Input type="number" placeholder="Company Phone" {...field} />
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
                                    <Input placeholder="Company Contact Person" {...field} />
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
                                <FormLabel>Company GST number</FormLabel>
                                <FormControl>
                                    <Input placeholder="Company GST number" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <Separator className="my-3" />
                    <p className="text-sky-600 font-semibold pb-2">Customer Address Details</p>
                    <FormField
                        control={form.control}
                        name="address_line1"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Address Line 1</FormLabel>
                                <FormControl>
                                    <Input placeholder="Address Line 1" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="address_line2"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Address Line 2</FormLabel>
                                <FormControl>
                                    <Input placeholder="Address Line 2" {...field} />
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
                                    <Input placeholder="City" {...field} />
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
                                    <Input placeholder="State" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="pin_code"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Pin Code</FormLabel>
                                <FormControl>
                                    <Input type="number" placeholder="Pin Code" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="flex justify-end space-x-2">
                        <Button type="button" variant="outline" onClick={() => form.reset()}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!hasChanges() || loading}>
                            {loading ? "Saving..." : "Save Changes"}
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    );
};

export default EditCustomer