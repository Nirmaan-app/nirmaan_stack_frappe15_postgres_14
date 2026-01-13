import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ButtonLoading } from "@/components/ui/button-loading"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useNavigate } from "react-router-dom"
import { UserPlus } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import ReactSelect from "react-select"

const UserFormSchema = z.object({
    first_name: z
        .string({
            required_error: "Must Provide First name"
        })
        .min(3, {
            message: "First name must be at least 3 characters.",
        }),
    last_name: z
        .string({
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
        .string({
            required_error: "Must Provide Email"
        })
        .email({ message: "Invalid email address" }),
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
                if (result.email_sent) {
                    toast({
                        title: "Success",
                        description: result.message,
                        variant: "success"
                    });
                } else {
                    toast({
                        title: "User Created (Email Not Sent)",
                        description: result.message,
                        variant: "default",
                        duration: 8000
                    });
                }

                form.reset({
                    first_name: "",
                    last_name: "",
                    mobile_no: "",
                    email: "",
                    role_profile_name: "",
                });
                navigate("/users");
            } else {
                toast({
                    title: "Error",
                    description: result?.message || "Failed to create user",
                    variant: "destructive"
                });
            }
        } catch (error: any) {
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
        <div className="flex-1 max-w-2xl mx-auto">
            <Card className="border shadow-sm">
                <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-t-lg border-b">
                    <CardTitle className="text-lg font-semibold">Create New User</CardTitle>
                    <CardDescription>Add a new team member to the system</CardDescription>
                </CardHeader>

                <Form {...form}>
                    <form onSubmit={(event) => {
                        event.stopPropagation();
                        return form.handleSubmit(onSubmit)(event);
                    }}>
                        <CardContent className="pt-6 space-y-6">
                            {/* Personal Information Section */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-gray-700">Personal Information</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="first_name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-medium text-gray-700">
                                                    First Name <span className="text-red-500">*</span>
                                                </FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g., John" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="last_name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-medium text-gray-700">
                                                    Last Name <span className="text-red-500">*</span>
                                                </FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g., Doe" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <FormField
                                    control={form.control}
                                    name="email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-medium text-gray-700">
                                                Email Address <span className="text-red-500">*</span>
                                            </FormLabel>
                                            <FormControl>
                                                <Input type="email" placeholder="e.g., john.doe@company.com" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Contact Section */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-gray-700">Contact</h3>
                                <FormField
                                    control={form.control}
                                    name="mobile_no"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-medium text-gray-700">
                                                Mobile Number <span className="text-red-500">*</span>
                                            </FormLabel>
                                            <FormControl>
                                                <Input placeholder="e.g., 9876543210" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Access & Permissions Section */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-gray-700">Access & Permissions</h3>
                                <FormField
                                    control={form.control}
                                    name="role_profile_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-medium text-gray-700">
                                                Role Profile <span className="text-red-500">*</span>
                                            </FormLabel>
                                            <FormControl>
                                                <ReactSelect
                                                    options={options}
                                                    value={options.find((option) => option.value === field.value) || null}
                                                    onChange={(val) => field.onChange(val ? val.value : "")}
                                                    isLoading={role_profile_list_loading}
                                                    isClearable={true}
                                                    placeholder="Select a role..."
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
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </CardContent>

                        <CardFooter className="border-t bg-gray-50/50 rounded-b-lg flex justify-end py-4">
                            {loading ? (
                                <ButtonLoading />
                            ) : (
                                <Button type="submit" className="gap-2">
                                    <UserPlus className="h-4 w-4" />
                                    Create User
                                </Button>
                            )}
                        </CardFooter>
                    </form>
                </Form>
            </Card>
        </div>
    )
}
