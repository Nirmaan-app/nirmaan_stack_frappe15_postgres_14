import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeDocTypeEventListener, useFrappeGetDocList, useFrappeGetDoc, useSWR } from "frappe-react-sdk"
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
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover"
import { cn } from "@/lib/utils"
import { ArrowLeft, BadgeIndianRupee, CalendarIcon, CirclePlus, GitCommitVertical, ListChecks, Undo2 } from "lucide-react"
import { Calendar } from "../../components/ui/calendar"
import { format } from "date-fns"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../components/ui/accordion"
import { Checkbox } from "../../components/ui/checkbox"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "../../components/ui/sheet"
import { useNavigate } from "react-router-dom"
import { useEffect, useState, useCallback } from "react"
import { formatToLocalDateTimeString } from "@/utils/FormatDate"
import { useToast } from "../../components/ui/use-toast"
import NewCustomer from "@/pages/customers/add-new-customer"
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogAction } from "../../components/ui/alert-dialog"
import { Steps } from "antd"
import { FormSkeleton } from "@/components/ui/skeleton"


const { Step } = Steps;

// 1.a Create Form Schema accordingly
const projectFormSchema = z.object({
    project_name: z
        .string(
            {
                required_error: "Must Provide Project name"
            })
        .min(6, {
            message: "Employee Name must be at least 6 characters",
        }),
    customer: z
        .string({
            required_error: "Please select associated customer"
        }),
    project_type: z
        .string()
        .optional(),
    subdivisions: z
        .string(),
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
    project_city: z
        .string({
            required_error: "Must provide city"
        })
        .min(1, {
            message: "Must Provide City"
        }),
    project_state: z
        .string({
            required_error: "Must provide state"
        })
        .min(1, {
            message: "Must Provide State"
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
            required_error: "Project must have a start date"
        }),
    project_end_date: z
        .date()
        .optional(),
    project_lead: z
        .string()
        .optional(),
    project_manager: z
        .string()
        .optional(),
    design_lead: z
        .string()
        .optional(),
    procurement_lead: z
        .string()
        .optional(),
    project_work_packages: z
        .object({
            work_packages: z.array(
                z.object({
                    work_package_name: z.string({
                        required_error: "Please select atleast one work package associated with this project"
                    })
                })
            )
            // scopes: z.array(z.string()).refine((value) => value.some((item) => item), {
            //     message: "Select at least one Work Package",
        }),
    project_scopes: z
        .object({
            scopes: z.array(
                z.object({
                    scope_of_work_name: z.string(),
                    work_package: z.string()
                })
            )
        }),
})
// project_work_milestones: z
//     .object({
//         name: z.string(),
//         isChecked: z.boolean(),
//         scopes: z.object({
//             name: z.string(),
//             scope_of_work_name: z.string(),
//             isSelected: z.boolean()
//         }).array()
//     })
//     .array()
//})

type ProjectFormValues = z.infer<typeof projectFormSchema>

interface SelectOption {
    label: string;
    value: string;
}
interface wpType {
    work_package_name: string;
}
interface sowType {
    scope_of_work_name: string;
    work_package: string;
}

// interface PWM {
//     name: string
//     scopes: string[]
// }

// interface WorkPackages {
//     name: string
//     isChecked: boolean
//     scopes: Scopes[]
// }

// interface Scopes {
//     name: string
//     scope_of_work_name: string
//     isSelected: boolean
// }

export const ProjectForm = () => {

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
        });

    const defaultValues: ProjectFormValues = {
        project_name: "",
        project_start_date: new Date(),
        project_end_date: undefined,
        project_work_packages: {
            work_packages: []
        },
        project_scopes: {
            scopes: []
        },
        address_line_1: "",
        address_line_2: "",
        project_city: "",
        project_state: "",
        pin: "",
        email: "",
        phone: "",
        customer: "",
        project_type: "",
        project_lead: "",
        procurement_lead: "",
        design_lead: "",
        project_manager: "",
        subdivisions: "",
    };

    const form = useForm<ProjectFormValues>({
        resolver: zodResolver(projectFormSchema),
        mode: "onBlur",
        defaultValues
    })
    const { data: company, isLoading: company_isLoading, error: company_error, mutate: company_mutate } = useFrappeGetDocList('Customers', {
        fields: ["name", "company_name", "creation"],
        limit: 1000,
        orderBy: { field: "creation", order: "desc" }
    });

    const { data: project_types, isLoading: project_types_isLoading, error: project_types_error, mutate: project_types_mutate } = useFrappeGetDocList('Project Types', {
        fields: ["name", "project_type_name", "creation"],
        limit: 100,
        orderBy: { field: "creation", order: "desc" }
    });


    useFrappeDocTypeEventListener("Project Types", async (d) => {
        await project_types_mutate()
    })

    const { data: user, isLoading: user_isLoading, error: user_error } = useFrappeGetDocList('Nirmaan Users', {
        fields: ["name", "full_name", "role_profile"],
        filters: [["name", "!=", "Administrator"]],
        limit: 1000
    });

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { deleteDoc } = useFrappeDeleteDoc()
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [popoverOpen2, setPopoverOpen2] = useState(false);
    const [duration, setDuration] = useState(0)
    const [areaNames, setAreaNames] = useState([]);
    const [newProjectId, setNewProjectId] = useState();
    const { toast } = useToast()
    const [section, setSection] = useState("projectDetails")
    const [currentStep, setCurrentStep] = useState(0);

    // List of sections and their order in the form
    const sections = [
        "projectDetails",
        "projectAddressDetails",
        "projectTimeline",
        "projectAssignees",
        "packageSelection",
    ];

    const sectionTitles = {
        projectDetails: "Project Details",
        projectAddressDetails: "Project Address Details",
        projectTimeline: "Project Timeline",
        projectAssignees: "Project Assignees",
        packageSelection: "Package Selection",
    };

    const [pincode, setPincode] = useState("")
    const { data: pincode_data, isLoading: pincode_loading, error: pincode_error } = useFrappeGetDoc("Pincodes", pincode)

    const debouncedFetch = useCallback(
        (value: string) => {
            if (value.length >= 6) {
                setPincode(value)
            } else {
                setPincode("")
            }
        }, []
    )

    useEffect(() => {
        if (pincode.length >= 6 && !pincode_data) {
            form.setValue("project_city", "Not Found")
            form.setValue("project_state", "Not Found")
        }
        else {
            form.setValue("project_city", pincode_data?.city || "")
            form.setValue("project_state", pincode_data?.state || "")
        }
    }, [pincode, pincode_data])

    const handleOpenDialog = () => {
        const button = document.getElementById("alertOpenProject")
        button?.click()
    };

    async function onSubmit(values: z.infer<typeof projectFormSchema>) {
        try {
            if (values.project_city === "Not Found" || values.project_state === "Not Found") {
                throw new Error('City and State are "Not Found", Please Enter a Valid Pincode')
            }
            if (!values.project_end_date) {
                throw new Error('Project_End_Date Must not be empty')
            }
            if (!values.project_work_packages.work_packages.length) {
                throw new Error('Please select atleast one work package associated with this project')
            }
            // Format the dates
            const formatted_start_date = formatToLocalDateTimeString(values.project_start_date);
            const formatted_end_date = formatToLocalDateTimeString(values.project_end_date);

            // Create the address document
            const addressDoc = await createDoc('Address', {
                address_title: values.project_name,
                address_type: "Shipping",
                address_line1: values.address_line_1,
                address_line2: values.address_line_2,
                city: values.project_city,
                state: values.project_state,
                country: "India",
                pincode: values.pin,
                email_id: values.email,
                phone: values.phone
            });

            try {
                // Create the project document using the address document reference
                const projectDoc = await createDoc('Projects', {
                    project_name: values.project_name,
                    customer: values.customer,
                    project_type: values.project_type,
                    project_start_date: formatted_start_date,
                    project_end_date: formatted_end_date,
                    project_address: addressDoc.name,
                    project_city: values.project_city,
                    project_state: values.project_state,
                    project_lead: values.project_lead,
                    procurement_lead: values.procurement_lead,
                    design_lead: values.design_lead,
                    project_manager: values.project_manager,
                    project_work_packages: values.project_work_packages,
                    project_scopes: values.project_scopes,
                    subdivisions: values.subdivisions,
                    subdivision_list: {
                        list: areaNames
                    },
                    status: "Created"
                })

                // console.log("project", projectDoc)
                toast({
                    title: "Success!",
                    description: `Project ${projectDoc.project_name} created successfully!`,
                    variant: "success"
                })
                setNewProjectId(projectDoc.name)
                handleOpenDialog()

            }
            catch (projectError) {
                await deleteDoc('Address', addressDoc.name);
                throw projectError;
            }
        } catch (error) {
            toast({
                title: "Failed!",
                description: `${error?.message}`,
                variant: "destructive"
            })
            console.log("Error:", error);
        }
    }
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

    // Transform data to select options
    const options: SelectOption[] = company?.map(item => ({
        label: item.company_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const type_options: SelectOption[] = project_types?.map(item => ({
        label: item.project_type_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const project_lead_options: SelectOption[] = user?.filter(item => item.role_profile === "Nirmaan Project Lead Profile").map(item => ({
        label: item.full_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const project_manager_options: SelectOption[] = user?.filter(item => item.role_profile === "Nirmaan Project Manager Profile").map(item => ({
        label: item.full_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const design_lead_options: SelectOption[] = user?.filter(item => item.role_profile === "Nirmaan Design Executive Profile").map(item => ({
        label: item.full_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const procurement_lead_options: SelectOption[] = user?.filter(item => item.role_profile === "Nirmaan Procurement Executive Profile").map(item => ({
        label: item.full_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const wp_list: wpType[] = work_package_list?.map(item => ({
        work_package_name: item.work_package_name, // Adjust based on your data structure
    })) || [];
    const sow_list: sowType[] = scope_of_work_list?.map(item => ({
        scope_of_work_name: item.scope_of_work_name, // Adjust based on your data structure
        work_package: item.work_package
    })) || [];



    const handleSubdivisionChange = (e) => {
        let n = e;
        setAreaNames(Array.from({ length: Number(n) }, (_, i) => ({
            name: `Area ${i + 1}`,
            status: "Pending",
        })));
    }

    const handleAreaNameChange = (index, event) => {
        const newAreaNames = [...areaNames];
        newAreaNames[index].name = event.target.value;
        setAreaNames(newAreaNames);
    }
    const handlePincodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        debouncedFetch(value)
    }

    const goToNextSection = async () => {
        const fieldsToValidate = getFieldsForSection(section);
        const isValid = await form.trigger(fieldsToValidate);

        if(section === "projectTimeline" && !form.getValues("project_end_date")) {
            toast({
                title: "Failed!",
                description: "Project_End_Date Must not be empty",
                variant: "destructive"
            })
            return
        }

        // console.log("isValid", isValid)
        const nextSec = nextSection(section)
        const nextIndex = currentStep + 1

        if (isValid) {
            setSection(nextSec);
            if (sections[nextIndex] === nextSec) {
                setCurrentStep(nextIndex)
            }
        }
    };

    const getFieldsForSection = (sectionName) => {
        switch (sectionName) {
            case "projectDetails":
                return ["project_name", "customer", "project_type", "subdivisions"];
            case "projectAddressDetails":
                return ["address_line_1", "address_line_2", "project_city", "project_state", "pin", 'email', 'phone'];
            case "projectTimeline":
                return ["project_start_date", "project_end_date"];
            case "projectAssignees":
                return ["project_lead", "project_manager", "design_lead", "procurement_lead"];
            case "packageSelection":
                return ["project_work_packages", "project_scopes"];
            default:
                return [];
        }
    };

    const nextSection = (currentSection) => {
        switch (currentSection) {
            case "projectDetails":
                return "projectAddressDetails";
            case "projectAddressDetails":
                return "projectTimeline";
            case "projectTimeline":
                return "projectAssignees";
            case "projectAssignees":
                return "packageSelection";
            default:
                return "projectDetails";
        }
    };
    if (wp_list_loading || sow_list_loading) return <FormSkeleton />
    if (wp_list_error || sow_list_error) {
        let error = wp_list_error ? wp_list_error : sow_list_error;
        return <div>{error?.message}</div>;
    }

    return (

        <div className="flex-1 md:space-y-4">
            <div className="space-y-0.5">
                <div className="flex">
                    {/* <ArrowLeft className="mt-1 cursor-pointer" onClick={() => navigate("/projects")} /> */}
                    <h2 className="pl-8 text-2xl font-bold tracking-tight">Add New Project</h2>
                </div>
            </div>

            <Steps current={currentStep} className="py-6 px-10">
                {sections.map((sec) => (
                    <Step className="cursor-pointer" key={sec} onClick={() => {
                        const secIndex = sections.findIndex((val) => val === sec)
                        if (currentStep >= secIndex) {
                            setSection(sec)
                            setCurrentStep(secIndex)
                        }
                    }} title={sectionTitles[sec]} />
                ))}
            </Steps>
            <Form {...form}>
                <form onSubmit={(event) => {
                    event.stopPropagation();
                    return form.handleSubmit(onSubmit)(event);
                }} className="max-sm:px-4 px-8">
                    <div className="flex flex-col gap-4">
                        {section === "projectDetails" && (
                            <>
                                <p className="text-sky-600 font-semibold">Project Details</p>
                                <FormField
                                    control={form.control}
                                    name="project_name"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Project Name<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                            <div className="flex flex-col items-start md:basis-2/4">
                                                <FormControl className="">
                                                    <Input placeholder="Project Name" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </div>
                                            <FormDescription>
                                                Example: CUSTOMER+LOCATION
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="customer"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Customer<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                            <div className="md:basis-2/4">
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                                                        {options.map(option => (
                                                            <SelectItem value={option.value}>{option.label}</SelectItem>
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
                                                        <SheetTitle><div className=" text-2xl font-bold">Create New Customer</div></SheetTitle>
                                                        <SheetDescription >
                                                            <NewCustomer company_mutate={company_mutate} navigation={false} />
                                                        </SheetDescription>
                                                    </SheetHeader>
                                                </SheetContent>
                                            </Sheet>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="project_type"
                                    render={({ field }) => {
                                        return (
                                            <FormItem className="lg:flex lg:items-center gap-4">
                                                <FormLabel className="md:basis-2/12">Project Type<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                                <div className="md:basis-2/4">
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                                                            {type_options.map(option => (
                                                                <SelectItem value={option.value}>{option.label}</SelectItem>
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
                                        )
                                    }}
                                />
                                <FormField
                                    control={form.control}
                                    name="subdivisions"
                                    render={({ field }) => {
                                        return (
                                            <FormItem className="lg:flex lg:items-center gap-4">
                                                <FormLabel className="md:basis-2/12">Sub-Divisions<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                                <div className="md:basis-2/4">
                                                    <Select
                                                        onValueChange={(e) => {
                                                            field.onChange(e);
                                                            handleSubdivisionChange(e);
                                                        }}
                                                        defaultValue={field.value}
                                                    >
                                                        <div className="flex flex-col items-start">
                                                            <FormControl>
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select the number of Sub Divisions" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </div>
                                                        <SelectContent>
                                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(item => (
                                                                <SelectItem key={item} value={`${item}`}>
                                                                    {item}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <FormDescription>
                                                    Select Total number of Areas
                                                </FormDescription>
                                            </FormItem>
                                        )
                                    }}
                                />
                                {Array.from({ length: form.getValues().subdivisions }).map((_, index) => {
                                    return <FormItem className="lg:flex lg:items-center gap-4">
                                        <FormLabel className="md:basis-2/12">Area {index + 1}:</FormLabel>
                                        <div className="md:basis-2/4">
                                            <Input
                                                type="text"
                                                onChange={(e) => handleAreaNameChange(index, e)}
                                                // placeholder={area}
                                                value={areaNames[index].name}
                                            />
                                        </div>
                                    </FormItem>
                                })}
                                <div className="flex items-center justify-end">
                                    <Button onClick={goToNextSection}>Next</Button>
                                </div>
                            </>
                        )}
                        {/* <Separator className="my-6" /> */}
                        {section === "projectAddressDetails" && (
                            <>
                                <p className="text-sky-600 font-semibold">Project Address Details</p>
                                <FormField
                                    control={form.control}
                                    name="address_line_1"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Address Line 1<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                            <div className="md:basis-2/4">
                                                <FormControl>
                                                    <Input placeholder="Address Line 1" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </div>
                                            <FormDescription>
                                                Example: Building name, Building no., Floor
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="address_line_2"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Address Line 2<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                            <div className="md:basis-2/4">
                                                <FormControl>
                                                    <Input placeholder="Address Line 2" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </div>
                                            <FormDescription>
                                                Example: Road Name, Area name
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="project_city"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">City<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                            <div className="md:basis-2/4">
                                                <FormControl>
                                                    <Input placeholder={pincode_data?.city ? pincode_data?.city : "City"} disabled={true} {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </div>
                                            <FormDescription>
                                                Example: City name
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="project_state"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">State<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                            <div className="md:basis-2/4">
                                                <FormControl>
                                                    <Input placeholder={pincode_data?.state ? pincode_data?.state : "State"} disabled={true} {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </div>
                                            <FormDescription>
                                                Example: State name
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="pin"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Pin Code<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                            <div className="md:basis-2/4">
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
                                            <FormDescription>
                                                Example: 100000
                                            </FormDescription>
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
                                            <FormDescription>
                                                Example: 90000000000
                                            </FormDescription>
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
                                            <FormDescription>
                                                Example: abc@mail.com
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />
                                <div className="flex items-center justify-end gap-2">
                                    <Button variant={"outline"} onClick={() => {
                                        setSection("projectDetails")
                                        setCurrentStep(prevStep => prevStep-1)
                                    }}>Previous</Button>
                                    <Button onClick={goToNextSection}>Next</Button>
                                </div>
                            </>
                        )}

                        {/* <Separator className="my-6" /> */}
                        {section === "projectTimeline" && (
                            <>
                                <p className="text-sky-600 font-semibold">Project Timeline</p>
                                <FormField
                                    control={form.control}
                                    name="project_start_date"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Project Start Date<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
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
                                                Select project start date
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="project_end_date"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Project End Date<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
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
                                                Select project end date
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
                                <div className="flex items-center justify-end gap-2">
                                    <Button variant={"outline"} onClick={() => {
                                        setSection("projectAddressDetails")
                                        setCurrentStep(prevStep => prevStep-1)
                                    }}>Previous</Button>
                                    <Button onClick={goToNextSection}>Next</Button>
                                </div>
                            </>
                        )}
                        {/* <Separator className="my-6" /> */}
                        {section === "projectAssignees" && (
                            <>
                                <p className="text-sky-600 font-semibold">Project Assignees(Optional)</p>
                                <FormField
                                    control={form.control}
                                    name="project_lead"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Project Lead</FormLabel>
                                            <div className="md:basis-2/4">
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <div className="flex flex-col items-start">
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select project lead" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </div>
                                                    <SelectContent>
                                                        {user_isLoading && <div>Loading...</div>}
                                                        {user_error && <div>Error: {user_error.message}</div>}
                                                        {project_lead_options.map(option => (
                                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <FormDescription>
                                                Select Project Lead
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="project_manager"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Project Manager</FormLabel>
                                            <div className="md:basis-2/4">
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <div className="flex flex-col items-start">
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select project manager" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </div>
                                                    <SelectContent>
                                                        {user_isLoading && <div>Loading...</div>}
                                                        {user_error && <div>Error: {user_error.message}</div>}
                                                        {project_manager_options.map(option => (
                                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <FormDescription>
                                                Select Project Manager
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="design_lead"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Design Lead</FormLabel>
                                            <div className="md:basis-2/4">
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <div className="flex flex-col items-start">
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select design lead" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </div>
                                                    <SelectContent>
                                                        {user_isLoading && <div>Loading...</div>}
                                                        {user_error && <div>Error: {user_error.message}</div>}
                                                        {design_lead_options.map(option => (
                                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <FormDescription>
                                                Select Design Lead
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="procurement_lead"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Procurement Lead</FormLabel>
                                            <div className="md:basis-2/4">
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <div className="flex flex-col items-start">
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select procurement lead" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </div>
                                                    <SelectContent>
                                                        {user_isLoading && <div>Loading...</div>}
                                                        {user_error && <div>Error: {user_error.message}</div>}
                                                        {procurement_lead_options.map(option => (
                                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <FormDescription>
                                                Select Procurement Lead
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />
                                <div className="flex items-center justify-end gap-2">
                                    <Button variant={"outline"} onClick={() => {
                                        setSection("projectTimeline")
                                        setCurrentStep(prevStep => prevStep-1)
                                    }}>Previous</Button>
                                    <Button onClick={goToNextSection}>Next</Button>
                                </div>
                            </>
                        )}

                        {/* <Separator className="my-6" /> */}
                        {section === "packageSelection" && (
                            <>
                                <p className="text-sky-600 font-semibold">Package Specification</p>
                                <FormField
                                    control={form.control}
                                    name="project_work_packages"
                                    render={() => (
                                        <FormItem>
                                            <div className="mb-4">
                                                <FormLabel className="text-base flex">Work Package selection<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>

                                                <FormDescription>
                                                    Select the work packages.
                                                </FormDescription>
                                            </div>
                                            <Checkbox
                                                className="mr-3"
                                                onCheckedChange={(checked) => {
                                                    if (checked) {
                                                        form.setValue(("project_scopes.scopes"), sow_list)
                                                        form.setValue(("project_work_packages.work_packages"), wp_list)
                                                    }
                                                    else {
                                                        form.setValue(("project_scopes.scopes"), [])
                                                        form.setValue(("project_work_packages.work_packages"), [])
                                                    }
                                                }}

                                            /> <span className="text-sm text-red-600 font-bold">Select All</span>
                                            <Separator />
                                            <Separator />
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
                                                                                        // console.log(form.getValues());
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
                                <div className="pt-2 flex items-center justify-end gap-2">
                                    <Button variant={"outline"} onClick={() => {
                                        setSection("projectAssignees")
                                        setCurrentStep(prevStep => prevStep-1)
                                    }}>Previous</Button>
                                    {(loading) ?
                                        <ButtonLoading />
                                        : <Button type="submit" className="flex items-center gap-1">
                                            <ListChecks className="h-4 w-4" />
                                            Submit</Button>
                                    }
                                </div>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <button className="hidden" id="alertOpenProject" >Trigger Dialog</button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader className="flex items-center justify-center">
                                            <AlertDialogTitle className="text-green-500">
                                                Project Created Successfully! You can start adding project estimates.
                                            </AlertDialogTitle>
                                            <div className="flex gap-2">
                                                <AlertDialogAction onClick={() => navigate("/projects")} className="flex items-center gap-1 bg-gray-100 text-black">
                                                    <Undo2 className="h-4 w-4" />
                                                    Go Back
                                                </AlertDialogAction>
                                                {/* <AlertDialogAction onClick={() => {
                                            form.reset()
                                            form.clearErrors()
                                        }}
                                            className="flex items-center gap-1"
                                        >
                                            <CirclePlus className="h-4 w-4" />
                                            Create New</AlertDialogAction> */}
                                                <AlertDialogAction onClick={() => navigate(`/projects/${newProjectId}/add-estimates`)} className="flex items-center gap-1 bg-gray-100 text-black">
                                                    <BadgeIndianRupee className="h-4 w-4" />
                                                    Next: Fill Estimates
                                                </AlertDialogAction>
                                            </div>
                                        </AlertDialogHeader>

                                    </AlertDialogContent>
                                </AlertDialog>
                            </>
                        )}
                    </div>
                </form >
            </Form >
        </div>
    )
}