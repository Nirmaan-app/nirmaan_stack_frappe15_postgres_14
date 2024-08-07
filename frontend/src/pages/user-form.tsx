import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeCreateDoc, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MainLayout } from "@/components/layout/main-layout"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { ButtonLoading } from "@/components/button-loading"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

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
        .string(
            {
                required_error: "Must Provide Mobile Number"
            }),
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
            fields: ['name', 'role_profile'],
        });
    const options: SelectOption[] = role_profile_list?.map(item => ({
        label: item.role_profile,
        value: item.name
    })) || [];

    const form = useForm<UserFormValues>({
        resolver: zodResolver(UserFormSchema),
        mode: "onChange",
        defaultValues: {},
    })

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()

    function onSubmit(values: z.infer<typeof UserFormSchema>) {
        createDoc('User', {
            ...values,
        }).then(() => {
            console.log(values)
        }).catch(() => {
            console.log(submit_error)
        })
    }

    const handleRedirect = () => {
        navigate("/users")
    }

    const handleRefresh = () => {
        window.location.reload()
    }


    return (
        // <MainLayout>
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between mb-2 space-y-2">
                    <div className="flex">
                        <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/users")} />
                        <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">Add User</h2>
                    </div>
                </div>
                <p className=" pl-7 text-muted-foreground">
                    Fill out to create a new User
                </p>
                <Separator className="my-6" />
                <Form {...form}>
                    <form onSubmit={(event) => {
                        event.stopPropagation();
                        return form.handleSubmit(onSubmit)(event);
                    }} className="flex flex-col space-y-8">
                        <div className="flex flex-col">
                            <p className="text-sky-600 font-semibold pb-9">User Details</p>
                            <FormField
                                control={form.control}
                                name="first_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="md:flex md:flex-row pt-2 pb-2">
                                            <div className="md:basis-1/4">
                                                <FormLabel>First Name: </FormLabel>
                                            </div>
                                            <div className="md:basis-1/4">
                                                <FormControl>
                                                    <Input placeholder="First Name" {...field} />
                                                </FormControl>
                                            </div>
                                            <div className="md:basis-1/2 pl-10 pt-2">
                                                <FormDescription>
                                                    Example: Michael
                                                </FormDescription>
                                            </div>

                                        </div>
                                        <div className="pt-2 pb-2">
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="last_name"
                                render={({ field }) => (

                                    <FormItem>
                                        <div className="md:flex md:flex-row pt-2 pb-2">
                                            <div className="md:basis-1/4">
                                                <FormLabel>Last Name: </FormLabel>
                                            </div>
                                            <div className="md:basis-1/4">
                                                <FormControl>
                                                    <Input placeholder="Last Name" {...field} />
                                                </FormControl>
                                            </div>
                                            <div className="md:basis-1/2 pl-10 pt-2">
                                                <FormDescription>
                                                    Example: Johnson
                                                </FormDescription>
                                            </div>

                                        </div>
                                        <div className="pt-2 pb-2">
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="mobile_no"
                                render={({ field }) => (

                                    <FormItem>
                                        <div className="md:flex md:flex-row pt-2 pb-2">
                                            <div className="md:basis-1/4">
                                                <FormLabel>Mobile Number: </FormLabel>
                                            </div>
                                            <div className="md:basis-1/4">
                                                <FormControl>
                                                    <Input type="number" placeholder="Mobile Number" {...field} />
                                                </FormControl>
                                            </div>
                                            <div className="md:basis-1/2 pl-10 pt-2">
                                                <FormDescription>
                                                    Example: 9999999999
                                                </FormDescription>
                                            </div>
                                        </div>
                                        <div className="pt-2 pb-2">
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (

                                    <FormItem>
                                        <div className="md:flex md:flex-row pt-2 pb-2">
                                            <div className="md:basis-1/4">
                                                <FormLabel>Email: </FormLabel>
                                            </div>
                                            <div className="md:basis-1/4">
                                                <FormControl>
                                                    <Input placeholder="Email" {...field} />
                                                </FormControl>
                                            </div>
                                            <div className="md:basis-1/2 pl-10 pt-2">
                                                <FormDescription>
                                                    Example: john@john.john
                                                </FormDescription>
                                            </div>
                                        </div>
                                        <div className="pt-2 pb-2">
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="role_profile_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="md:flex md:flex-row pt-2 pb-2">
                                            <div className="md:basis-1/4">
                                                <FormLabel>Role Profile</FormLabel>
                                            </div>
                                            <div className="md:basis-1/4">
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select the Role" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {role_profile_list_loading && <div>Loading...</div>}
                                                        {role_profile_list_error && <div>Error: {role_profile_list_error.message}</div>}
                                                        {options.map(option => (
                                                            <SelectItem value={option.value}>{option.label}</SelectItem>
                                                        ))}

                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="md:basis-1/4 pl-10 pt-2">
                                                <FormDescription>
                                                    Role associated with this User
                                                </FormDescription>
                                            </div>
                                        </div>
                                        <div className="pt-2 pb-2">
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />
                            <div className="pt-2 pb-2 ">
                                {(loading) ? (<ButtonLoading />)
                                    : (submit_complete) ? (<div className="flex"><Button onClick={() => handleRedirect()}>Go Back</Button><div className="pl-3"><Button onClick={() => handleRefresh()} >Add new</Button></div></div>)
                                        : (<Button type="submit">Submit</Button>)}
                            </div>
                            <div>
                                {submit_complete &&
                                    <div>
                                        <div className="font-semibold text-green-500"> User Added successfully</div>
                                    </div>
                                }
                                {submit_error &&
                                    <div className="flex-1">
                                        <div className="font-semibold text-red-500">{submit_error.message}</div>
                                        <div className="font-slim text-red-500">{submit_error.exception}</div>
                                    </div>
                                }
                            </div>
                        </div>
                    </form>
                </Form>
            </div>
        // </MainLayout>
    )
}