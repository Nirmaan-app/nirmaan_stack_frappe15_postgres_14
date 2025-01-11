import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { ButtonLoading } from "@/components/ui/button-loading"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ListChecks } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

const UserFormSchema = z.object({
    first_name: z
        .string(
            {
                required_error: "Must Provide First name"
            })
        .min(3, {
            message: "Employee Name must be at least 3 characters.",
        }),
    last_name: z
        .string(
            {
                required_error: "Must Provide Last name"
            }),
    mobile_no: z
        .string({
            required_error: "Must provide Unique Mobile Number"
        })
        .max(10, { message: "Mobile number must be of 10 digits" })
        .min(10, { message: "Mobile number must be of 10 digits" })
        .or(z.number()),
    email: z
        .string(
            {
                required_error: "Must Provide Email"
            })
        .email(
            { message: "Invalid email address" }
        ),
    role_profile_name: z
        .string({
            required_error: "Please select associated Role Profile."
        }),
})

type UserFormValues = z.infer<typeof UserFormSchema>

interface SelectOption {
    label: string;
    value: string;
}

export const UserForm = () => {
    const navigate = useNavigate();

    const { data: role_profile_list, isLoading: role_profile_list_loading, error: role_profile_list_error } = useFrappeGetDocList("Role Profile",
        {
            fields: ["*"],
        },
        "Role Profile"
    );
    const options: SelectOption[] = role_profile_list?.map(item => ({
        label: item?.role_profile
            .split(' ')
            .filter((word) => word !== 'Nirmaan' && word !== 'Profile')
            .join(' '),
        value: item.name
    })) || [];

    const form = useForm<UserFormValues>({
        resolver: zodResolver(UserFormSchema),
        mode: "onBlur",
    })

    const { createDoc: createDoc, loading: loading } = useFrappeCreateDoc()

    const { toast } = useToast()

    const onSubmit = async (values: UserFormValues) => {
        try {
            const userDoc = await createDoc("User", values);
            toast({
                title: "Success",
                description: `${userDoc.full_name} created successfully!`,
                variant: "success"
            })
            form.reset({
                first_name: "",
                last_name: "",
                mobile_no: "",
                email: "",
                role_profile_name: "Select the Role",
            });
            navigate("/users")
        } catch (error: any) {
            toast({
                title: "Error",
                description: `${error?._debug_messages}`,
                variant: "destructive"
            })

            console.log("error", error)
        }
    }

    return (
        <div className="flex-1">
            <div className="flex gap-2">
                {/* <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/users")} /> */}
                <div className="flex flex-col">
                    <h2 className="text-xl md:text-3xl font-bold tracking-tight">Add New User</h2>
                    <p className="text-muted-foreground">
                        Fill all the marked details to create a new User
                    </p>
                </div>
            </div>

            <Separator className="my-4 max-md:my-2" />
            <Form {...form}>
                <form onSubmit={(event) => {
                    event.stopPropagation();
                    return form.handleSubmit(onSubmit)(event);
                }} className="px-6 max-md:px-2 flex flex-col gap-4">
                    <p className="text-sky-600 font-semibold">User Details</p>
                    <FormField
                        control={form.control}
                        name="first_name"
                        render={({ field }) => (
                            <FormItem className="lg:flex lg:items-center gap-4">
                                <FormLabel className="md:basis-2/12">First Name<sup>*</sup></FormLabel>
                                <div className="flex flex-col items-start md:basis-2/4">
                                    <FormControl className="">
                                        <Input placeholder="First Name" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </div>
                                <FormDescription>
                                    Example: John
                                </FormDescription>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="last_name"
                        render={({ field }) => (
                            <FormItem className="lg:flex lg:items-center gap-4">
                                <FormLabel className="md:basis-2/12">Last Name<sup>*</sup></FormLabel>
                                <div className="flex flex-col items-start md:basis-2/4">
                                    <FormControl className="">
                                        <Input placeholder="Last Name" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </div>
                                <FormDescription>
                                    Example: Doe
                                </FormDescription>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="mobile_no"
                        render={({ field }) => (
                            <FormItem className="lg:flex lg:items-center gap-4">
                                <FormLabel className="md:basis-2/12">Mobile Number<sup>*</sup></FormLabel>
                                <div className="flex flex-col items-start md:basis-2/4">
                                    <FormControl className="">
                                        <Input placeholder="Mobile Number" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </div>
                                <FormDescription>
                                    Example: 9999999999
                                </FormDescription>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                            <FormItem className="lg:flex lg:items-center gap-4">
                                <FormLabel className="md:basis-2/12">Email<sup>*</sup></FormLabel>
                                <div className="flex flex-col items-start md:basis-2/4">
                                    <FormControl className="">
                                        <Input placeholder="Email" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </div>
                                <FormDescription>
                                    Example: john@doe.in
                                </FormDescription>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="role_profile_name"
                        render={({ field }) => (
                            <FormItem className="lg:flex lg:items-center gap-4">
                                <FormLabel className="md:basis-2/12">Role Profile<sup>*</sup></FormLabel>
                                <div className="md:basis-2/4">
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <div className="flex flex-col items-start">
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select the Role" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <FormMessage />
                                        </div>
                                        <SelectContent>
                                            {role_profile_list_loading && <div>Loading...</div>}
                                            {role_profile_list_error && <div>Error: {role_profile_list_error.message}</div>}
                                            {options.map(option => (
                                                <SelectItem value={option.value}>{option.label}</SelectItem>
                                            ))}

                                        </SelectContent>
                                    </Select>
                                </div>
                                <FormDescription>
                                    Role associated with this User
                                </FormDescription>
                            </FormItem>
                        )}
                    />
                    <div className="flex items-center justify-end lg:justify-center">
                        {loading ? (
                            <ButtonLoading />
                        ) : (
                            <Button className="flex items-center gap-1" type="submit">
                                <ListChecks className="h-4 w-4" />
                                Submit</Button>
                        )}
                    </div>
                </form>
            </Form>
        </div>
    )
}