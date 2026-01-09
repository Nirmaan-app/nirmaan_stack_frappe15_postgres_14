import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { ButtonLoading } from "@/components/ui/button-loading"
import { useNavigate } from "react-router-dom"
import { ListChecks } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import ReactSelect from "react-select"

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

    const { call: createUser, loading } = useFrappePostCall("nirmaan_stack.api.users.create_user")

    const { toast } = useToast()

    const onSubmit = async (values: UserFormValues) => {
        try {
            const response = await createUser(values);
            const result = response.message;

            if (result?.success) {
                // Show appropriate toast based on email status
                if (result.email_sent) {
                    toast({
                        title: "Success",
                        description: result.message,
                        variant: "success"
                    });
                } else {
                    // User created but email failed - show warning with longer duration
                    toast({
                        title: "User Created (Email Not Sent)",
                        description: result.message,
                        variant: "default",
                        duration: 8000  // Show longer for important warning
                    });
                }

                form.reset({
                    first_name: "",
                    last_name: "",
                    mobile_no: "",
                    email: "",
                    role_profile_name: "Select the Role",
                });
                navigate("/users");
            } else {
                // API returned success: false
                toast({
                    title: "Error",
                    description: result?.message || "Failed to create user",
                    variant: "destructive"
                });
            }
        } catch (error: any) {
            // Parse Frappe error format
            let errorMessage = "Failed to create user";
            if (error?.message) {
                errorMessage = error.message;
            } else if (error?._server_messages) {
                try {
                    const serverMessages = JSON.parse(error._server_messages);
                    if (Array.isArray(serverMessages) && serverMessages.length > 0) {
                        const firstMessage = JSON.parse(serverMessages[0]);
                        errorMessage = firstMessage?.message || errorMessage;
                    }
                } catch {
                    // If parsing fails, use default message
                }
            } else if (error?.exc_type) {
                errorMessage = `${error.exc_type}: ${error.message || "Unknown error"}`;
            }

            toast({
                title: "Error",
                description: errorMessage,
                variant: "destructive"
            });
            console.error("User creation error:", error);
        }
    }

    return (
        <div className="flex-1">
            <p className="text-muted-foreground ml-2 md:ml-6">
                Fill all the marked details to create a new User
            </p>

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
                                    <FormControl>
                                        <ReactSelect
                                            options={options}
                                            value={options.find((option) => option.value === field.value) || null}
                                            onChange={(val) => field.onChange(val ? val.value : "")}
                                            isLoading={role_profile_list_loading}
                                            isClearable={true}
                                            placeholder="Select the Role"
                                            noOptionsMessage={() => role_profile_list_error ? "Error loading roles" : "No roles available"}
                                            styles={{
                                                control: (base, state) => ({
                                                    ...base,
                                                    borderColor: state.isFocused ? "hsl(var(--ring))" : "hsl(var(--border))",
                                                    boxShadow: state.isFocused ? "0 0 0 1px hsl(var(--ring))" : "none",
                                                    "&:hover": { borderColor: "hsl(var(--border))" },
                                                    minHeight: "40px",
                                                }),
                                                menu: (base) => ({
                                                    ...base,
                                                    zIndex: 50,
                                                }),
                                            }}
                                        />
                                    </FormControl>
                                    <FormMessage />
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