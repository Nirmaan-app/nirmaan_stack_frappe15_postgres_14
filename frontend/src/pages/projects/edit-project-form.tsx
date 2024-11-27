import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeDocTypeEventListener, useFrappeGetDocList, useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "../../components/ui/form"
import { Input } from "../../components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select"
import { Button } from "../../components/ui/button"
import { ButtonLoading } from "../../components/ui/button-loading"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog"
import ProjectTypeForm from "../../components/project-type-form"
import { Separator } from "../../components/ui/separator"
import { useNavigate, useParams } from "react-router-dom"
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover"
import { cn } from "@/lib/utils"
import { ArrowLeft, CalendarIcon, CirclePlus, GitCommitVertical, ListChecks, MessageCircleWarning } from "lucide-react"
import { Calendar } from "../../components/ui/calendar"
import { format } from "date-fns"
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects"
import { useCallback, useEffect, useState } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import NewCustomer from "../customers/add-new-customer"
import { formatToLocalDateTimeString } from "@/utils/FormatDate"
import { toast } from "@/components/ui/use-toast"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Checkbox } from "@/components/ui/checkbox"

// 1.a Create Form Schema accordingly
const projectFormSchema = z.object({
    project_name: z
        .string(
            {
                required_error: "Must Provide Project Name"
            })
        .min(6, {
            message: "Must Provide Project Name",
        }),
    customer: z
        .string({
            required_error: "Please select associated customer"
        }),
    project_type: z
        .string()
        .optional(),
    address_line_1: z
        .string({
            required_error: "Address Line 1 Required"
        })
        .min(1, {
            message: "Address Line 1 Required"
        }),
    address_line_2: z
        .string({
            required_error: "Address Line 2 Required"
        })
        .min(1, {
            message: "Address Line 2 Required"
        }),
    pin: z
        .string({
            required_error: "Must provide pincode"
        })
        .max(6, { message: "Pincode must be of 6 digits" })
        .min(6, { message: "Pincode must be of 6 digits" })
        .or(z.number()),
    email: z.string().email().optional().or(z.literal('')),
    phone: z
        .string()
        .max(10, { message: "Mobile number must be of 10 digits" })
        .min(10, { message: "Mobile number must be of 10 digits" })
        .optional()
        .or(z.literal('')),
    project_start_date: z
        .date({
            required_error: "A start date is required.",
        }),
    project_end_date: z
        .date({
            required_error: "An end date is required.",
        }),
    // project_lead: z
    //     .string({
    //         required_error: "Please select Project Lead"
    //     }),
    // project_manager: z
    //     .string({
    //         required_error: "Please select Project Manager"
    //     }),
    // design_lead: z
    //     .string({
    //         required_error: "Please select Design Lead"
    //     }),
    // procurement_lead: z
    //     .string({
    //         required_error: "Please select Procurement Lead"
    //     }),
    project_work_packages: z
        .object({
            work_packages: z.array(
                z.object({
                    work_package_name: z.string()
                })
            )
        }),
    project_scopes: z
        .object({
            scopes: z.array(
                z.object({
                    scope_of_work_name: z.string(),
                    work_package: z.string()
                })
            )
        })
})

type ProjectFormValues = z.infer<typeof projectFormSchema>

interface SelectOption {
    label: string;
    value: string;
}
// interface wpType {
//     work_package_name: string;
// }
// interface sowType {
//     scope_of_work_name: string;
//     work_package: string;
// }

export const EditProjectForm = () => {

    const { projectId } = useParams<{ projectId: string }>()

    const { data, mutate: projectMutate } = useFrappeGetDoc<ProjectsType>(
        'Projects',
        `${projectId}`
    );

    console.log("projectData", data)

    const navigate = useNavigate()

    const { data: work_package_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Work Packages",
        {
            fields: ['work_package_name'],
            limit: 100
        });
    const { data: scope_of_work_list, isLoading: sow_list_loading, error: sow_list_error } = useFrappeGetDocList("Scopes of Work",
        {
            fields: ['scope_of_work_name', 'work_package'],
            limit: 1000,
        }
    );

    const { data: company, isLoading: company_isLoading, error: company_error, mutate: company_mutate } = useFrappeGetDocList('Customers', {
        fields: ["name", "company_name"],
        limit: 1000
    });

    const { data: project_types, isLoading: project_types_isLoading, error: project_types_error, mutate: project_types_mutate } = useFrappeGetDocList('Project Types', {
        fields: ["name", "project_type_name"],
        limit: 100
    });

    const { data: project_address, isLoading: project_address_isLoading, error: project_address_error, mutate: project_address_mutate } = useFrappeGetDoc("Address", data?.project_address)

    // const { data: user, isLoading: user_isLoading, error: user_error } = useFrappeGetDocList('Nirmaan Users', {
    //     fields: ["*"],
    //     limit: 1000
    // });

    useFrappeDocTypeEventListener("Project Types",async (d) => {
           await project_types_mutate()
    })

    const form = useForm<ProjectFormValues>({
        resolver: zodResolver(projectFormSchema),
        mode: "onChange",
        defaultValues: {
            project_name: data?.project_name || "",
            customer: data?.customer || "",
            project_type: data?.project_type || "",
            address_line_1: project_address?.address_line1 || "",
            address_line_2: project_address?.address_line1 || "",
            pin: project_address?.pincode || "",
            email: project_address?.email_id || "",
            phone: project_address?.phone || "",
            project_start_date: data?.project_start_date ? new Date(data?.project_start_date) : new Date(),
            project_end_date: data?.project_end_date ? new Date(data?.project_end_date) : new Date(),
            project_work_packages: data?.project_work_packages ? JSON.parse(data?.project_work_packages) : {
                work_packages : []
            },
            project_scopes: data?.project_scopes ? (JSON.parse(data?.project_scopes)) : {
                scopes: []
            }
        },
    })

    console.log("formValues", form.getValues())

    useEffect(() => {
        if (data && project_address) {
            form.reset({
                project_name: data?.project_name || "",
                customer: data?.customer || "",
                project_type: data?.project_type || "",
                address_line_1: project_address?.address_line1 || "",
                address_line_2: project_address?.address_line1 || "",
                pin: project_address?.pincode || "",
                email: project_address?.email_id || "",
                phone: project_address?.phone || "",
                project_start_date: data?.project_start_date ? new Date(data?.project_start_date) : new Date(),
                project_end_date: data?.project_end_date ? new Date(data?.project_end_date) : new Date(),
                project_work_packages: data?.project_work_packages ? JSON.parse(data?.project_work_packages) : {
                    work_packages : []
                },
                project_scopes: data?.project_scopes ? (JSON.parse(data?.project_scopes)) : {
                    scopes: []
                }
            })

            setPincode(project_address.pincode)
        }
    }, [data, project_address, company, project_types])

    // const getCompanyName = (id) => {
    //     console.log("running")
    //     return company?.find((com) => com.name === id)?.name
    // }

    // const getProjectTypeName = (id) => {
    //     return project_types?.find((pt) => pt.name === id)?.project_type_name
    // }

    // useEffect(() => {

    // })

    const { updateDoc: updateDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()

    const [city, setCity] = useState(project_address?.city || "")
    const [state, setState] = useState(project_address?.state || "")
    const [pincode, setPincode] = useState("")
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [popoverOpen2, setPopoverOpen2] = useState(false);
    const [duration, setDuration] = useState(0)

    const startDate = form.watch("project_start_date");
    const endDate = form.watch("project_end_date");

    useEffect(() => {
        if (startDate && endDate) {
            const durationInDays = Math.round(
                (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)
            );
            setDuration(durationInDays);
        }
    }, [startDate, endDate]);

    const { data: pincode_data, isLoading: pincode_loading, error: pincode_error } = useFrappeGetDoc("Pincodes", pincode, `Pincodes ${pincode}`)

    const debouncedFetch = useCallback(
        (value: string) => {
            if (value.length >= 6) {
                setPincode(value)
            } else {
                setPincode("")
            }
        }, [])

    useEffect(() => {
        if (pincode.length >= 6 && !pincode_data) {
            setCity("Not Found")
            setState("Not Found")
        } else {
            setCity(pincode_data?.city || "")
            setState(pincode_data?.state || "")
        }
    }, [pincode_data])


    const handlePincodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        debouncedFetch(value)
    }

    // 2. Define a submit handler.
    async function onSubmit(values: z.infer<typeof projectFormSchema>) {
        try {
            if (city === "Not Found" || state === "Not Found") {
                throw new Error('City and State are "Not Found", Please Enter a Valid Pincode')
                return
            }
            const formatted_start_date = formatToLocalDateTimeString(values.project_start_date);
            const formatted_end_date = formatToLocalDateTimeString(values.project_end_date);

            const changedValues = {}

            if (values.project_name !== data?.project_name) changedValues["address_title"] = values.project_name
            if (values.address_line_1 !== project_address?.address_line1) changedValues["address_line1"] = values.address_line_1
            if (values.address_line_2 !== project_address?.address_line2) changedValues["address_line2"] = values.address_line_2
            if (city !== project_address?.city) changedValues["city"] = city
            if (state !== project_address?.state) changedValues["state"] = state
            if (values.pin !== project_address?.pincode) changedValues["pincode"] = values.pin
            if (values.email !== project_address?.email_id) changedValues["email_id"] = values.email
            if (values.phone !== project_address?.phone) changedValues["phone"] = values.phone

            if (Object.keys(changedValues).length) {
                await updateDoc('Address', data?.project_address, changedValues);
            }

            await updateDoc("Projects", projectId, {
                project_name: values.project_name,
                customer: values.customer,
                project_type: values.project_type,
                project_start_date: formatted_start_date,
                project_end_date: formatted_end_date,
                project_city: city,
                project_state: state,
                project_work_packages: values.project_work_packages,
                project_scopes: values.project_scopes
            })

            await projectMutate()
            await project_address_mutate()

            toast({
                title: "Success!",
                description: `Project: ${data?.project_name} updated successfully!`,
                variant: "success"
            })

            navigate(`/projects/${projectId}`)
        } catch (error) {
            console.log("error while updating project", error)
            toast({
                title: "Failed!",
                description: `${error?.message}`,
                variant: "destructive"
            })
        }
    }

    // Transform data to select options
    const options: SelectOption[] = company?.map(item => ({
        label: item.company_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const type_options: SelectOption[] = project_types?.map(item => ({
        label: item.project_type_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const wp_list = work_package_list?.map(item => ({
        work_package_name: item.work_package_name, // Adjust based on your data structure
    })) || [];

    const sow_list = scope_of_work_list?.map(item => ({
        scope_of_work_name: item.scope_of_work_name, // Adjust based on your data structure
        work_package: item.work_package
    })) || [];

    // console.log("projectData", data)
    // console.log("projectvalues", form.getValues())

    return (
        <Form {...form}>
            <form onSubmit={(event) => {
                event.stopPropagation();
                return form.handleSubmit(onSubmit)(event);
            }} className="flex-1 md:space-y-4">

                <div className="flex flex-col">
                    {/* <div className="flex items-center gap-1 ml-6">
                        <ArrowLeft className="cursor-pointer" onClick={() => navigate(`/projects/${projectId}`)} />
                        <p className="text-black font-semibold text-2xl max-md:text-xl">Edit: <span className="text-red-700">{projectId}</span></p>
                        <sup className="text-red-700">*(beta)</sup>
                    </div> */}
                    {/* <Separator className="mt-6 max-md:mt-4 mb-4" /> */}
                    <div className="px-6 flex flex-col py-4">
                        <p className="text-sky-600 font-semibold pb-2">Project Details</p>
                        <div className="flex flex-col gap-4">
                            <FormField
                                control={form.control}
                                name="project_name"
                                render={({ field }) => {
                                    return (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Project Name<sup className="text-sm text-red-600">*</sup></FormLabel>
                                            <div className="flex flex-col items-start md:basis-2/4">
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </div>
                                        </FormItem>)

                                }}
                            />
                            <FormField
                                control={form.control}
                                name="customer"
                                render={({ field }) => (
                                    <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">
                                            Customer<sup className="text-sm text-red-600">*</sup>
                                        </FormLabel>
                                        <div className="md:basis-2/4">
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <div className="flex flex-col items-start">
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select the customer" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <FormMessage />
                                                </div>
                                                <SelectContent>
                                                    {company_isLoading && <div>Loading...</div>}
                                                    {company_error && <div>Error: {company_error.message}</div>}
                                                    {options.map((option) => (
                                                        <SelectItem key={option.value} value={option.value}>
                                                            {option.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Sheet>
                                            <SheetTrigger asChild>
                                                <Button variant="secondary">
                                                    <div className="flex">
                                                        <CirclePlus className="w-3.5 h-3.5 mt-0.5" />
                                                        <span className="pl-1">Add New Customer</span>
                                                    </div>
                                                </Button>
                                            </SheetTrigger>
                                            <SheetContent className="overflow-y-auto">
                                                <SheetHeader className="text-start">
                                                    <SheetTitle>
                                                        <div className=" text-2xl font-bold">Create New Customer</div>
                                                    </SheetTitle>
                                                    <SheetDescription>
                                                        <NewCustomer company_mutate={company_mutate} navigation={false} />
                                                    </SheetDescription>
                                                </SheetHeader>
                                            </SheetContent>
                                        </Sheet>
                                    </FormItem>
                                )}
                            />

                            {/* // For `project_type` SelectField */}
                            <FormField
                                control={form.control}
                                name="project_type"
                                render={({ field }) => (
                                    <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">
                                            Project Type<sup className="text-sm text-red-600">*</sup>
                                        </FormLabel>
                                        <div className="md:basis-2/4">
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <div className="flex flex-col items-start">
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select a project type" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <FormMessage />
                                                </div>
                                                <SelectContent>
                                                    {project_types_isLoading && <div>Loading...</div>}
                                                    {project_types_error && <div>Error: {project_types_error.message}</div>}
                                                    {type_options.map((option) => (
                                                        <SelectItem key={option.value} value={option.value}>
                                                            {option.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button variant="secondary">
                                                    <div className="flex">
                                                        <CirclePlus className="w-3.5 h-3.5 mt-0.5" />
                                                        <span className="pl-1">Add New Project Type</span>
                                                    </div>
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-[300px] md:max-w-[425px]">
                                                <DialogHeader>
                                                    <DialogTitle>Add New Project Type</DialogTitle>
                                                    <DialogDescription>
                                                        Add new project types here.
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <ProjectTypeForm project_types_mutate={project_types_mutate} />
                                            </DialogContent>
                                        </Dialog>
                                    </FormItem>
                                )}
                            />
                        </div>
                        <Separator className="my-6" />
                        <p className="text-sky-600 font-semibold pb-2">Project Address Details</p>
                        <div className="flex flex-col gap-4">
                            <FormField
                                control={form.control}
                                name="address_line_1"
                                render={({ field }) => (
                                    <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">Address Line 1<sup className="text-sm text-red-600">*</sup></FormLabel>
                                        <div className="md:basis-2/4">
                                            <FormControl>
                                                <Input placeholder="Address Line 1" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="address_line_2"
                                render={({ field }) => (
                                    <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">Address Line 2<sup className="text-sm text-red-600">*</sup></FormLabel>
                                        <div className="md:basis-2/4">
                                            <FormControl>
                                                <Input placeholder="Address Line 2" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />

                            <FormItem className="lg:flex lg:items-center gap-4">
                                <FormLabel className="md:basis-2/12">City<sup className="text-sm text-red-600">*</sup></FormLabel>
                                <div className="md:basis-2/4">
                                    <FormControl>
                                        <Input placeholder={city || "City"} disabled={true} />
                                    </FormControl>
                                    <FormMessage />
                                </div>
                            </FormItem>
                            <FormItem className="lg:flex lg:items-center gap-4">
                                <FormLabel className="md:basis-2/12">State<sup className="text-sm text-red-600">*</sup></FormLabel>
                                <div className="md:basis-2/4">
                                    <FormControl>
                                        <Input placeholder={state || "State"} disabled={true} />
                                    </FormControl>
                                    <FormMessage />
                                </div>
                            </FormItem>

                            <FormField
                                control={form.control}
                                name="pin"
                                render={({ field }) => (
                                    <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">Pin Code<sup className="text-sm text-red-600">*</sup></FormLabel>
                                        <div className="flex flex-col items-start md:basis-2/4">
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
                                        </div>
                                        <Alert variant="warning" className="md:basis-[30%]">
                                            <MessageCircleWarning className="h-4 w-4" />
                                            <AlertTitle className="text-sm">Heads Up</AlertTitle>
                                            <AlertDescription className="text-xs">
                                                Changing the Pincode will not change the project id
                                            </AlertDescription>
                                        </Alert>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="phone"
                                render={({ field }) => (
                                    <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">Phone</FormLabel>
                                        <div className="md:basis-2/4">
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    placeholder="Phone"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">Email</FormLabel>
                                        <div className="md:basis-2/4">
                                            <FormControl>
                                                <Input placeholder="Email" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </div>
                                    </FormItem>
                                )}
                            />
                        </div>
                        <Separator className="my-6" />
                        <p className="text-sky-600 font-semibold pb-2">Project Timeline</p>
                        <div className="flex flex-col gap-4">
                            <FormField
                                control={form.control}
                                name="project_start_date"
                                render={({ field }) => (
                                    <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">Project Start Date<sup className="text-sm text-red-600">*</sup></FormLabel>
                                        <div className="md:basis-1/4">
                                            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                                <PopoverTrigger asChild>
                                                    <FormControl>
                                                        <Button
                                                            variant={"outline"}
                                                            className={cn(
                                                                "w-full pl-3 text-left font-normal",
                                                                !field.value && "text-muted-foreground"
                                                            )}
                                                        >
                                                            {field.value ? (
                                                                format(field.value, "dd-MM-yyyy")
                                                            ) : (
                                                                <span>Pick a date</span>
                                                            )}
                                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                        </Button>
                                                    </FormControl>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0" align="start">
                                                    <Calendar
                                                        mode="single"
                                                        selected={field.value}
                                                        onSelect={(date) => {
                                                            field.onChange(date)
                                                            setPopoverOpen(false)
                                                        }}
                                                        initialFocus
                                                    />
                                                </PopoverContent>
                                            </Popover>
                                            <FormMessage />
                                        </div>
                                        <FormDescription>
                                            Edit project start date
                                        </FormDescription>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="project_end_date"
                                render={({ field }) => (
                                    <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">Project End Date<sup className="text-sm text-red-600">*</sup></FormLabel>
                                        <div className="md:basis-1/4">
                                            <Popover open={popoverOpen2} onOpenChange={setPopoverOpen2}>
                                                <PopoverTrigger asChild>
                                                    <FormControl>
                                                        <Button
                                                            variant={"outline"}
                                                            className={cn(
                                                                "w-full pl-3 text-left font-normal",
                                                                !field.value && "text-muted-foreground"
                                                            )}
                                                        >
                                                            {field.value ? (
                                                                format(field.value, "dd-MM-yyyy")
                                                            ) : (
                                                                <span>Pick a date</span>
                                                            )}
                                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                        </Button>
                                                    </FormControl>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0" align="start">
                                                    <Calendar
                                                        mode="single"
                                                        selected={field.value}
                                                        onSelect={(date) => {
                                                            field.onChange(date)
                                                            setPopoverOpen2(false)
                                                        }}
                                                        disabled={(date) =>
                                                            date < form.getValues("project_start_date")
                                                        }
                                                        initialFocus
                                                    />
                                                </PopoverContent>
                                            </Popover>
                                            <FormMessage />
                                        </div>
                                        <FormDescription>
                                            Edit project end date
                                        </FormDescription>
                                    </FormItem>
                                )}
                            />
                            <div className="flex items-center">
                                <FormLabel className="md:basis-2/12">Duration: </FormLabel>
                                <div className=" pl-4 flex items-center gap-2">
                                    <h1>{duration}</h1>
                                    <h1 className="text-sm text-red-600"><sup>*</sup>(Days)</h1>
                                </div>
                            </div>

                        </div>

                         <Separator className="my-6" />
                        <p className="text-sky-600 font-semibold pb-6">Package Specification</p>
                        <FormField
                            control={form.control}
                            name="project_work_packages"
                            render={() => (
                                <FormItem>
                                    <div className="mb-4">
                                        <div className="font-semibold">
                                            Edit work packages.
                                        </div>
                                    </div>
                                    {wp_list.map((item) => (
                                        <Accordion type="single" collapsible value={form.getValues().project_work_packages.work_packages.find(d => d.work_package_name === item.work_package_name)?.work_package_name} className="w-full">
                                            <AccordionItem value={item.work_package_name}>
                                                <AccordionTrigger>
                                                    <FormField
                                                        key={item.work_package_name}
                                                        control={form.control}
                                                        name="project_work_packages.work_packages"
                                                        render={({ field }) => {
                                                            return (
                                                                <FormItem
                                                                    key={item.work_package_name}
                                                                    className="flex flex-row items-start space-x-3 space-y-0"
                                                                >
                                                                    <FormControl>
                                                                        <Checkbox
                                                                            disabled={field.value.length === 1 && field.value?.[0].work_package_name === item.work_package_name}
                                                                            checked={field.value?.some((i) => i.work_package_name === item.work_package_name)}
                                                                            onCheckedChange={(checked) => {
                                                                                if (!checked) {
                                                                                    const filteredSow = form.getValues().project_scopes.scopes.filter(sow => sow.work_package != item.work_package_name)
                                                                                    form.setValue(("project_scopes.scopes"), filteredSow)
                                                                                }
                                                                                else {
                                                                                    const filteredSow = form.getValues().project_scopes.scopes.filter(sow => sow.work_package != item.work_package_name)

                                                                                    sow_list?.forEach((sow) => {
                                                                                        if (sow.work_package === item.work_package_name) {
                                                                                            filteredSow.push(sow);
                                                                                        }
                                                                                    })
                                                                                    form.setValue(("project_scopes.scopes"), filteredSow)

                                                                                }
                                                                                return checked
                                                                                    ? field.onChange([...field.value, { work_package_name: item.work_package_name }])
                                                                                    : field.onChange(
                                                                                        field.value?.filter(
                                                                                            (value) => value.work_package_name !== item.work_package_name
                                                                                        )
                                                                                    )
                                                                            }}
                                                                        />
                                                                    </FormControl>
                                                                    <FormLabel className="text-sm font-normal">
                                                                        {item.work_package_name}
                                                                    </FormLabel>
                                                                </FormItem>
                                                            )
                                                        }}
                                                    />
                                                </AccordionTrigger>
                                                <AccordionContent>
                                                    {sow_list.map((scope) => {
                                                        if (scope.work_package === item.work_package_name) {
                                                            return (
                                                                <div className="md:w-[35%]">
                                                                     <Separator />
                                                                <FormField
                                                                    key={scope.scope_of_work_name}
                                                                    control={form.control}
                                                                    name="project_scopes.scopes"
                                                                    render={({ field }) => (
                                                                        <FormItem className="flex flex-row items-center justify-between p-3">
                                                                            <FormLabel className="text-sm font-normal">
                                                                                            <div className="flex">
                                                                                                <GitCommitVertical className="w-6" />
                                                                                                <span className="text-sm mt-0.5">{scope.scope_of_work_name}</span>
                                                                                            </div>
                                                                            </FormLabel>
                                                                            <FormControl>
                                                                                <Checkbox
                                                                                    checked={field.value?.some((i) => i.scope_of_work_name === scope.scope_of_work_name)}
                                                                                    onCheckedChange={(checked) => {
                                                                                        return checked
                                                                                            ? field.onChange([...field.value, {
                                                                                                scope_of_work_name: scope.scope_of_work_name,
                                                                                                work_package: scope.work_package
                                                                                            }])
                                                                                            : field.onChange(
                                                                                                field.value?.filter(
                                                                                                    (value) => value.scope_of_work_name !== scope.scope_of_work_name
                                                                                                )
                                                                                            )
                                                                                    }}
                                                                                />
                                                                            </FormControl>
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                                </div>
                                                            );
                                                        }
                                                    })}
                                                </AccordionContent>
                                            </AccordionItem>

                                        </Accordion>
                                    ))}
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        {/* <Separator className="my-6" /> */}
                        {/* <p className="text-sky-600 font-semibold pb-9">DEBUG Package Specification</p> */}
                        <div className="my-6">
                            {(loading) ? (<ButtonLoading />) : (<Button type="submit" className="flex items-center gap-1">
                                <ListChecks className="h-4 w-4" />
                                Submit</Button>)}
                        </div>
                    </div>
                </div>
            </form>
        </Form>
    )
}