import { FormSkeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import NewCustomer from "@/pages/customers/add-new-customer"
import { zodResolver } from "@hookform/resolvers/zod"
import { Steps } from "antd"
import { format } from "date-fns"
import { useFrappeDocTypeEventListener, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk"
import { BadgeIndianRupee, CalendarIcon, CirclePlus, Info, ListChecks, Pencil, Undo2 } from "lucide-react"
import React, { useCallback, useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import ReactSelect from "react-select"
import * as z from "zod"
import ProjectTypeForm from "../../components/project-type-form"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../components/ui/accordion"
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../../components/ui/alert-dialog"
import { Button } from "../../components/ui/button"
import { ButtonLoading } from "../../components/ui/button-loading"
import { Calendar } from "../../components/ui/calendar"
import { Checkbox } from "../../components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "../../components/ui/form"
import { Input } from "../../components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select"
import { Separator } from "../../components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "../../components/ui/sheet"
import { useToast } from "../../components/ui/use-toast"
import useSectionContext, { SectionProvider } from "./SectionContext"
import { Category } from "@/types/NirmaanStack/Category"
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist"
import { WorkPackage } from "@/types/NirmaanStack/Projects"
import { Customers } from "@/types/NirmaanStack/Customers"
import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes"
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"

import {MultiSelect} from "./components/multi-select"


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
        })
        .min(1, {
            message: "Please select associated customer"
        }),
    project_type: z
        .string()
        .optional(),
    project_value: z
        .string()
        .optional(),
    project_value_gst: z
        .string()
        .optional(),
    // subdivisions: z
    //     .string(),
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
    estimates_exec: z
        .string()
        .optional(),
    accountant: z
        .string()
        .optional(),
    project_work_packages: z
        .object({
            work_packages: z.array(
                z.object({
                    work_package_name: z.string(),
                    category_list: z
                        .object({
                            list: z.array(
                                z.object({
                                    name: z.string(),
                                    makes: z.array(z.object({
                                        label: z.string(),
                                        value: z.string()
                                    }))
                                })
                            )
                        })
                })
            )
            // scopes: z.array(z.string()).refine((value) => value.some((item) => item), {
            //     message: "Select at least one Work Package",
        }),
    // project_category_list: z
    //     .object({
    //         list: z.array(
    //             z.object({
    //                 category: z.string(),
    //                 work_package: z.string(),
    //                 makes: z.array(z.string())
    //             })
    //         )
    //     }),
    project_scopes: z
        .object({
            scopes: z.array(
                z.object({
                    scope_of_work_name: z.string(),
                    work_package: z.string()
                })
            )
        }),
    project_gst_number: z.object({
        list: z.array(z.object({
            location: z.string(),
            gst: z.string(),
        })),
    }),
    carpet_area: z.coerce.number().nonnegative().optional(),

   
});

type ProjectFormValues = z.infer<typeof projectFormSchema>

interface SelectOption {
    label: string;
    value: string;
}
interface wpType {
    work_package_name: string;
}
// interface sowType {
//     scope_of_work_name: string;
//     work_package: string;
// }


const allGstOptions = [
  { location: "Bengaluru", gst: "29ABFCS9095N1Z9" },
  { location: "Gurugram", gst: "06ABFCS9095N1ZH" },
  { location: "Noida", gst: "09ABFCS9095N1ZB" }, // Added Noida as it was in your logic
];

// Prepare options for the MultiSelect component
const multiSelectGstOptions = allGstOptions.map(option => ({
  label: `${option.location} (${option.gst})`,
  value: option.location,
}));

export const ProjectForm = () => {

    const navigate = useNavigate()
    const { data: work_package_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Work Packages",
        {
            fields: ['work_package_name'],
             filters: [["work_package_name", "not in", ["Tool & Equipments", "Services","Additional Charges"]]],
            limit: 1000
        });


    const defaultValues: ProjectFormValues = {
        project_name: "",
        project_value: "",
        project_value_gst: "",
        project_start_date: new Date(),
        project_end_date: undefined,
        project_work_packages: {
            work_packages: []
        },
        project_gst_number: {
            list: [
                {
                    location: "Bengaluru",
                    gst: "29ABFCS9095N1Z9",
                }
            ]
        },
        carpet_area: 0,
        project_scopes: {
            scopes: []
        },
        // project_category_list: {
        //     list: []
        // },
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
        estimates_exec: "",
        design_lead: "",
        project_manager: "",
        accountant: "",
        // subdivisions: "",
        // subdivisions: "",
        /* // NEW FIELDS FOR MILESTONE TRACKING
        enable_project_milestone_tracking: false, // Default to false
        project_work_header_entries: [], // Empty array by default */

    };

    const form = useForm<ProjectFormValues>({
        resolver: zodResolver(projectFormSchema),
        mode: "onBlur",
        defaultValues
    })
    const { data: company, isLoading: company_isLoading, error: company_error, mutate: company_mutate } = useFrappeGetDocList<Customers>('Customers', {
        fields: ["name", "company_name", "creation"],
        limit: 0,
        orderBy: { field: "creation", order: "desc" }
    });

    const { data: project_types, isLoading: project_types_isLoading, error: project_types_error, mutate: project_types_mutate } = useFrappeGetDocList<ProjectTypes>('Project Types', {
        fields: ["name", "project_type_name", "creation"],
        limit: 0,
        orderBy: { field: "creation", order: "desc" }
    });


    useFrappeDocTypeEventListener("Project Types", async (d) => {
        await project_types_mutate()
    })

    const { data: user, isLoading: user_isLoading, error: user_error } = useFrappeGetDocList<NirmaanUsers>('Nirmaan Users', {
        fields: ["name", "full_name", "role_profile"],
        filters: [["name", "!=", "Administrator"]],
        limit: 0
    });

    const { call: createProjectAndAddress, loading: createProjectAndAddressLoading } = useFrappePostCall("nirmaan_stack.api.projects.new_project.create_project_with_address")

    // const { createDoc: createDoc, loading: loading } = useFrappeCreateDoc()
    // const { deleteDoc } = useFrappeDeleteDoc()
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [popoverOpen2, setPopoverOpen2] = useState(false);
    const [duration, setDuration] = useState(0)
    const [areaNames, setAreaNames] = useState<{ name: string; status: string; }[]>([]);
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
        "reviewDetails"
    ];

    const sectionTitles = {
        projectDetails: "Project Details",
        projectAddressDetails: "Project Address Details",
        projectTimeline: "Project Timeline",
        projectAssignees: "Project Assignees",
        packageSelection: "Package Selection",
        reviewDetails: "Review Details"
    };

    const [pincode, setPincode] = useState("")
    const { data: pincode_data } = useFrappeGetDoc("Pincodes", pincode)

    const debouncedFetch = useCallback(
        (value: string) => {
            if (value.length >= 6) {
                setPincode(value)
            } else {
                setPincode("")
            }
        }, [pincode, setPincode]
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

    async function onSubmit(values: ProjectFormValues) {
        try {

            if (values.project_city === "Not Found" || values.project_state === "Not Found") {
                throw new Error('City and State are "Not Found", Please Enter a Valid Pincode!')
            }
            if (!values.project_end_date) {
                throw new Error('Project_End_Date Must not be empty!')
            }
            if (!values.project_work_packages.work_packages.length) {
                throw new Error('Please select atleast one work package associated with this project!')
            }
            // console.log("Final Data", ...values, areaNames )
            const response = await createProjectAndAddress({
                values: { ...values, areaNames },
            });

            if (response.message.status === 200) {
                toast({
                    title: "Success!",
                    description: `Project ${response.message.project_name} created successfully!`,
                    variant: "success"
                })
                setNewProjectId(response.message.project_name)
                handleOpenDialog()

            } else if (response.message.status === 400) {
                toast({
                    title: 'Failed!',
                    description: response.message.error,
                    variant: 'destructive',
                });
            }
        } catch (error: any) {
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



      // Watch the enable_project_milestone_tracking field
    // const enableMilestoneTracking = form.watch("enable_project_milestone_tracking");

    // Effect to reset/initialize project_work_header_entries when the checkbox changes
    // useEffect(() => {
    //     if (enableMilestoneTracking && work_header_list) {
    //         // Initialize with all work headers, default to unchecked
    //         const initialEntries = work_header_list.map(header => ({
    //             work_header_name: header.work_header_name,
    //            enabled: true // Changed to true for "select all by default"
    //         }));
    //         form.setValue("project_work_header_entries", initialEntries, { shouldValidate: false });
    //     } else if (!enableMilestoneTracking) {
    //         // Clear the array if tracking is disabled
    //         form.setValue("project_work_header_entries", [], { shouldValidate: false });
    //     }
    // }, [enableMilestoneTracking, work_header_list]); // Depend on both checkbox state and fetched list

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

    // const estimates_exec_options: SelectOption[] = user?.filter(item => item.role_profile === "Nirmaan Estimates Executive Profile").map(item => ({
    //     label: item.full_name, // Adjust based on your data structure
    //     value: item.name
    // })) || [];

    const accountant_options: SelectOption[] = user?.filter(item => item.role_profile === "Nirmaan Accountant Profile").map(item => ({
        label: item.full_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const wp_list: wpType[] = work_package_list?.map(item => ({
        work_package_name: item.work_package_name, // Adjust based on your data structure
    })) || [];

    const handleSubdivisionChange = (e: number) => {
        let n = e;
        setAreaNames(Array.from({ length: Number(n) }, (_, i) => ({
            name: `Area ${i + 1}`,
            status: "Pending",
        })));
    }

    const handleAreaNameChange = (index: number, event: React.ChangeEvent<HTMLInputElement>) => {
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

       
        const gstList = form.getValues("project_gst_number.list");
        if (!gstList || gstList.length === 0) {
            toast({
                title: "Failed!",
                description: "At least one Project GST location must be selected.",
                variant: "destructive"
            });
            return; // Stop further execution if this validation fails
       
        }         // For project_end_date, if it's conditionally required for this section, this is fine.
          // --- NEW: Check for selected Work Headers if milestone tracking is enabled ---
      
       
        if (section === "projectTimeline" && !form.getValues("project_end_date")) {
            toast({
                title: "Failed!",
                description: "Project_End_Date Must not be empty",
                variant: "destructive"
            })
            return
        }

        if (section === "packageSelection" && !form.getValues("project_work_packages.work_packages").length) {
            toast({
                title: "Failed!",
                description: "Non Procurement Package Selected!",
                variant: "destructive"
            })
            return
        }
        


        const nextSec = nextSection(section)
        const nextIndex = currentStep + 1

        if (isValid) {
            setSection(nextSec);
            if (sections[nextIndex] === nextSec) {
                setCurrentStep(nextIndex)
            }
        }
    };

    const getFieldsForSection = (sectionName: string) => {
        switch (sectionName) {
            case "projectDetails":
                return ["project_name", "customer", "project_type", "subdivisions", "project_value", "project_value_gst", "carpet_area"];
            case "projectAddressDetails":
                return ["address_line_1", "address_line_2", "project_city", "project_state", "pin", 'email', 'phone'];
            case "projectTimeline":
                return ["project_start_date", "project_end_date"];
            // case "projectTimeline":
            // // Add enable_project_milestone_tracking and its dependent fields to validation
            //     const fields = ["project_start_date", "project_end_date", "enable_project_milestone_tracking"];
            //     if (form.getValues("enable_project_milestone_tracking")) {
            //         // You might add a custom refinement or validation message if no work headers are selected
            //         // For now, Zod's optional() on project_work_header_entries handles if it's empty
            //         // If you need to *enforce* selection, you'd add a custom validation here or to the schema.
            //         // Example: fields.push("project_work_header_entries");
            //     }
            //     return fields;
            case "projectAssignees":
                return ["project_lead", "project_manager", "design_lead", "procurement_lead", "estimates_exec"];
            case "packageSelection":
                return ["project_work_packages", "project_scopes"];
            default:
                return [];
        }
    };

    const nextSection = (currentSection: string) => {
        switch (currentSection) {
            case "projectDetails":
                return "projectAddressDetails";
            case "projectAddressDetails":
                return "projectTimeline";
            case "projectTimeline":
                return "projectAssignees";
            case "projectAssignees":
                return "packageSelection";
            case "packageSelection":
                return "reviewDetails"
            default:
                return "projectDetails";
        }
    };
    if (wp_list_loading) return <FormSkeleton />
    if (wp_list_error) {
        let error = wp_list_error;
        return <div>{error?.message}</div>;
    }


    // console.log("catOptions", form.getValues().project_category_list.list)
    // console.log("workPackageOptions", form.getValues().project_work_packages.work_packages)

    return (

        <div className="flex-1 space-y-4">
            {/* <div className="space-y-0.5">
                <div className="flex">
                    <ArrowLeft className="mt-1 cursor-pointer" onClick={() => navigate("/projects")} />
                    <h2 className="pl-8 text-2xl font-bold tracking-tight">Add New Project</h2>
                </div>
            </div> */}

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
                                    name="project_value"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Project Value (excl. GST)</FormLabel>
                                            <div className="flex flex-col items-start md:basis-2/4">
                                                <FormControl className="">
                                                    <Input placeholder="Auto-calculated" disabled={true} {...field} />
                                                </FormControl>
                                                <FormMessage />
                                                <FormDescription className="text-amber-600 flex items-center gap-1">
                                                    <Info className="h-3 w-3" />
                                                    Auto-calculated. Update Customer PO after project creation.
                                                </FormDescription>
                                            </div>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="project_value_gst"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Project Value (incl. GST)</FormLabel>
                                            <div className="flex flex-col items-start md:basis-2/4">
                                                <FormControl className="">
                                                    <Input placeholder="Auto-calculated" disabled={true} {...field} />
                                                </FormControl>
                                                <FormMessage />
                                                <FormDescription className="text-amber-600 flex items-center gap-1">
                                                    <Info className="h-3 w-3" />
                                                    Auto-calculated. Update Customer PO after project creation.
                                                </FormDescription>
                                            </div>
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
  name="project_gst_number" // Form expects { list: [{ location, gst }] }
  render={({ field }) => {
    // 1. Extract the currently selected location's name (the single value we need)
    const currentValue = field.value?.list?.[0]?.location || "";

    return (
      <FormItem className="lg:flex lg:items-center gap-4">
        <FormLabel className="md:basis-2/12">Project GST<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
        <div className="md:basis-2/4">
          <Select
            onValueChange={(selectedLocationName: string) => {
              // 2. Find the full GST object for the selected location name
              const foundOption = allGstOptions.find(opt => opt.location === selectedLocationName);

              // 3. Update the form field with the new list containing only the selected item
              if (foundOption) {
                  // Ensure the form field value remains in the expected { list: [...] } format
                  field.onChange({ list: [foundOption] });
              } else {
                  // If the user selects the "placeholder" value (or if the value is empty)
                  field.onChange({ list: [] });
              }
            }}
            value={currentValue}
            disabled={field.disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Project GST" />
            </SelectTrigger>
            <SelectContent>
              {/* Map options to SelectItem */}
              {allGstOptions.map((option) => (
                <SelectItem key={option.location} value={option.location}>
                  {option.location} - {option.gst}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </div>
      </FormItem>
    );
  }}
/>

<FormField
    control={form.control}
    name="carpet_area"
    render={({ field }) => (
        <FormItem className="lg:flex lg:items-center gap-4">
            <FormLabel className="md:basis-2/12">
                Carpet Area (Sqft)
            </FormLabel>
            <div className="md:basis-2/4">
                <FormControl>
                    <Input
                        type="number"
                        placeholder="Enter Area"
                       
                        min={0} // 1. hint to browser
                        {...field}
                        // 2. Prevent typing negative signs
                        onKeyDown={(e) => {
                            if (e.key === "-" || e.key === "e") {
                                e.preventDefault();
                            }
                        }}
                    />
                </FormControl>
                <FormMessage />
            </div>
            <FormDescription>
                Area in Sqft
            </FormDescription>
        </FormItem>
    )}
/>
                               
{/* <FormField
  control={form.control}
  name="project_gst_number" // Ensure this matches your form's schema for an array of objects
  render={({ field }) => {
    // Extract currently selected location names from the form field's value
    // field.value is expected to be { list: [{ location: string, gst: string }, ...] }
    const currentSelectedLocations = field.value?.list?.map((item: { location: string }) => item.location) || [];

    return (
      <FormItem className="lg:flex lg:items-center gap-4">
        <FormLabel className="md:basis-2/12">Project GST<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
        <div className="md:basis-2/4">
          <MultiSelect
            options={multiSelectGstOptions}
            selected={currentSelectedLocations}
            onSelectedChange={(selectedLocationValues: string[]) => {
              // When the MultiSelect's selection changes, map the selected location names
              // back to the full { location, gst } objects required by your form's schema.
              const updatedGstList = selectedLocationValues.map(locationName => {
                const foundOption = allGstOptions.find(opt => opt.location === locationName);
                // Return the full GST object. If for some reason not found,
                // handle gracefully (e.g., return a default or log error).
                return foundOption || { location: locationName, gst: "" };
              });
              field.onChange({ list: updatedGstList }); // Update the form field with the new list
            }}
            placeholder="Select Project GST(s)"
            className="w-full"
            disabled={field.disabled} // Inherit disabled state from form field
          />
          <FormMessage />
        </div>
      </FormItem>
    );
  }}
/> */}

                                
                                {/* <FormField
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
                                /> */}
                                {/* {Array.from({ length: Number(form.getValues().subdivisions) }).map((_, index) => {
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
                                })} */}
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
                                        setCurrentStep(prevStep => prevStep - 1)
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
        {/* END NEW MILESTONE TRACKING SECTION */}
                                <div className="flex items-center justify-end gap-2">
                                    <Button variant={"outline"} onClick={() => {
                                        setSection("projectAddressDetails")
                                        setCurrentStep(prevStep => prevStep - 1)
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

                                {/* <FormField
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
                                /> */}

                                <FormField
                                    control={form.control}
                                    name="accountant"
                                    render={({ field }) => (
                                        <FormItem className="lg:flex lg:items-center gap-4">
                                            <FormLabel className="md:basis-2/12">Accountant</FormLabel>
                                            <div className="md:basis-2/4">
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <div className="flex flex-col items-start">
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select Accountant" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </div>
                                                    <SelectContent>
                                                        {user_isLoading && <div>Loading...</div>}
                                                        {user_error && <div>Error: {user_error.message}</div>}
                                                        {accountant_options.map(option => (
                                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <FormDescription>
                                                Select Accountant
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />

                                <div className="flex items-center justify-end gap-2">
                                    <Button variant={"outline"} onClick={() => {
                                        setSection("projectTimeline")
                                        setCurrentStep(prevStep => prevStep - 1)
                                    }}>Previous</Button>
                                    <Button onClick={goToNextSection}>Next</Button>
                                </div>
                            </>
                        )}

                        {section === "packageSelection" && (
                            <>
                                {wp_list?.length > 0 && (<WorkPackageSelection form={form} wp_list={wp_list} />)}
                                <div className="flex items-center justify-end gap-2">
                                    <Button variant={"outline"} onClick={() => {
                                        setSection("projectAssignees")
                                        setCurrentStep(prevStep => prevStep - 1)
                                    }}>Previous</Button>
                                    <Button onClick={goToNextSection}>Next</Button>
                                </div>
                            </>)}

                        {section === "reviewDetails" && (
                            <>

                                <ReviewDetails company={company} user={user} form={form} duration={duration} setSection={setSection} sections={sections} setCurrentStep={setCurrentStep} sectionTitles={sectionTitles} />

                                <div className="pt-2 flex items-center justify-end gap-2">
                                    <Button variant={"outline"} onClick={() => {
                                        setSection("packageSelection")
                                        setCurrentStep(prevStep => prevStep - 1)
                                    }}>Previous</Button>
                                    {(createProjectAndAddressLoading) ?
                                        <ButtonLoading />
                                        : <Button onClick={() => onSubmit(form.getValues())} className="flex items-center gap-1">
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
                                                <AlertDialogAction onClick={() => {
                                                    form.reset()
                                                    form.clearErrors()
                                                }}
                                                    className="flex items-center gap-1"
                                                >
                                                    <CirclePlus className="h-4 w-4" />
                                                    Create New</AlertDialogAction>
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


interface WorkPackageSelection {
    form: any;
    wp_list: wpType[];
}
const WorkPackageSelection: React.FC<WorkPackageSelection> = ({ form, wp_list }) => {

    const [openValue, setOpenValue] = useState(null);
    const { data: categoriesList, isLoading: categoriesListLoading } = useFrappeGetDocList<Category>("Category", {
        fields: ["category_name", "work_package", "name"],
        filters: [["work_package", "not in", ["Tool & Equipments", "Services"]]],
        limit: 0,
    });

    const { data: categoryMakeList, isLoading: categoryMakeListLoading } = useFrappeGetDocList<CategoryMakelist>("Category Makelist", {
        fields: ["make", "category"],
        limit: 0,
    });

    const workPackages: WorkPackage[] = form.watch("project_work_packages.work_packages");

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            const allWorkPackages = categoriesList?.reduce((acc: WorkPackage[], category) => {
                const existingPackage = acc.find((wp) => wp?.work_package_name === category.work_package);
                if (existingPackage) {
                    existingPackage.category_list.list.push({
                        name: category.category_name,
                        makes: [],
                    });
                } else {
                    acc.push({
                        work_package_name: category.work_package,
                        category_list: {
                            list: [
                                {
                                    name: category.category_name,
                                    makes: [],
                                },
                            ],
                        },
                    });
                }
                return acc;
            }, []);

            form.setValue("project_work_packages.work_packages", allWorkPackages);
        } else {
            form.setValue("project_work_packages.work_packages", []);
        }
    };

    const handleSelectMake = (workPackageName: string, categoryName: string, selectedMakes: string[]) => {
        const updatedWorkPackages = [...workPackages];

        let workPackage = updatedWorkPackages.find((wp) => wp.work_package_name === workPackageName);

        if (!workPackage) {
            const associatedCategories = categoriesList
                ?.filter((cat) => cat.work_package === workPackageName)
                .map((cat) => ({
                    name: cat.category_name,
                    makes: [],
                })) || [];

            workPackage = {
                work_package_name: workPackageName,
                category_list: {
                    list: associatedCategories,
                },
            };

            updatedWorkPackages.push(workPackage);
        }

        const category = workPackage.category_list.list.find((cat) => cat.name === categoryName);

        if (!category) {
            workPackage.category_list.list.push({
                name: categoryName,
                makes: selectedMakes,
            });
        } else {
            category.makes = selectedMakes;
        }

        form.setValue("project_work_packages.work_packages", updatedWorkPackages);
    };


    if (categoriesListLoading || categoryMakeListLoading) return <div>loading..</div>

    return (
        <div>
            <p className="text-sky-600 font-semibold">Package Specification</p>
            <FormField
                control={form.control}
                name="project_work_packages"
                render={() => (
                    <FormItem>
                        <div className="mb-4">
                            <FormLabel className="text-base flex">
                                Work Package Selection<sup className="pl-1 text-sm text-red-600">*</sup>
                            </FormLabel>
                        </div>
                        <Checkbox
                            className="mr-3"
                            onCheckedChange={handleSelectAll}
                        /> <span className="text-sm text-red-600 font-bold">Select All</span>
                        <Separator />
                        <Separator />

                        {wp_list?.map((item) => (
                            <Accordion
                                key={item.work_package_name}
                                type="single"
                                collapsible
                                value={openValue}
                                onValueChange={setOpenValue}
                                className="w-full"
                            >
                                <AccordionItem value={item.work_package_name}>
                                    <AccordionTrigger>
                                        <FormField
                                            control={form.control}
                                            name="project_work_packages.work_packages"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                    <FormControl>
                                                        <Checkbox
                                                            checked={field.value?.some((i) => i.work_package_name === item.work_package_name)}
                                                            onCheckedChange={(checked) => {
                                                                const updatedCategories = categoriesList
                                                                    ?.filter((cat) => cat.work_package === item.work_package_name)
                                                                    .map((cat) => ({
                                                                        name: cat.category_name,
                                                                        makes: [],
                                                                    }));

                                                                const updatedWorkPackages = checked
                                                                    ? [
                                                                        ...field.value,
                                                                        { work_package_name: item.work_package_name, category_list: { list: updatedCategories } },
                                                                    ]
                                                                    : field.value.filter((wp) => wp.work_package_name !== item.work_package_name);

                                                                field.onChange(updatedWorkPackages);
                                                            }}
                                                        />
                                                    </FormControl>
                                                    <FormLabel>{item.work_package_name}</FormLabel>
                                                </FormItem>
                                            )}
                                        />
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        {categoriesList
                                            ?.filter((cat) => cat.work_package === item.work_package_name)
                                            ?.map((cat) => {
                                                const categoryMakeOptions = categoryMakeList?.filter((make) => make.category === cat.name);
                                                const makeOptions = categoryMakeOptions?.map((make) => ({
                                                    label: make.make,
                                                    value: make.make,
                                                }));

                                                const selectedMakes =
                                                    workPackages
                                                        .find((wp) => wp.work_package_name === item.work_package_name)
                                                        ?.category_list.list.find((c) => c.name === cat.category_name)?.makes || [];

                                                return (
                                                    <div key={cat.name}>
                                                        <Separator />
                                                        <FormItem className="flex gap-4 items-center p-3">
                                                            <FormLabel className="w-[30%]">{cat.category_name}</FormLabel>
                                                            <Controller
                                                                control={form.control}
                                                                name="project_work_packages.work_packages"
                                                                render={() => (
                                                                    <ReactSelect
                                                                        className="w-full"
                                                                        placeholder="Select Makes..."
                                                                        isMulti
                                                                        options={makeOptions}
                                                                        value={selectedMakes}
                                                                        onChange={(selected) =>
                                                                            handleSelectMake(item.work_package_name, cat.category_name, selected)
                                                                        }
                                                                    />
                                                                )}
                                                            />
                                                        </FormItem>
                                                    </div>
                                                );
                                            })}
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        ))}
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
};

interface ReviewDetailsProps {
    company?: Customers[];
    user?: NirmaanUsers[];
    form: any;
    duration: number;
    setSection: React.Dispatch<React.SetStateAction<string>>
    sections: string[]
    setCurrentStep: React.Dispatch<React.SetStateAction<number>>
    sectionTitles: {
        projectDetails: string;
        projectAddressDetails: string;
        projectTimeline: string;
        projectAssignees: string;
        packageSelection: string;
        reviewDetails: string;
    }
}

const ReviewDetails: React.FC<ReviewDetailsProps> = ({ form, duration, company, user, ...sectionProps }) => {

    const { setSection, setCurrentStep } = sectionProps
    // console.log("gsts",form.getValues("project_gst_number").list.map(item => item.location).join(', '))
    return (
        <SectionProvider value={sectionProps}>
            <div className="p-6 bg-white shadow rounded-lg">
                <Section sectionKey="projectDetails">
                    <Detail label="Project Name" value={form.getValues("project_name")} />
                    <Detail label="Project Type" value={form.getValues("project_type")} />
                    <Detail label="Customer" value={form.getValues("customer") ? company?.find(c => c.name === form.getValues("customer"))?.company_name : ""} />
                    <Detail label="Carpet Area(Sqft)" value={form.getValues("carpet_area")} />
                    <Detail label="Selected GST List" value={form.getValues("project_gst_number").list.map(item => item.location).join(', ')} />
                </Section>

                <Section sectionKey="projectAddressDetails">
                    <Detail label="Address Line 1" value={form.getValues("address_line_1")} />
                    <Detail label="City" value={form.getValues("project_city")} />
                    <Detail label="Address Line 2" value={form.getValues("address_line_2")} />
                    <Detail label="State" value={form.getValues("project_state")} />
                    <Detail label="Pincode" value={form.getValues("pin")} />
                    <Detail label="Phone" value={form.getValues("phone")} />
                    <Detail label="Email" value={form.getValues("email")} />
                </Section>

                <Section sectionKey="projectTimeline">
                    <Detail
                        label="Start Date"
                        value={form.getValues("project_start_date")?.toLocaleDateString()}
                    />
                    <Detail
                        label="End Date"
                        value={form.getValues("project_end_date")?.toLocaleDateString()}
                    />
                    <Detail
                        label="Duration"
                        value={`${duration} days`}
                    />
                        {/* <Detail
                            label="Milestone Tracking Enabled"
                            value={form.getValues("enable_project_milestone_tracking") ? "Yes" : "No"}
                        />
                        {form.getValues("enable_project_milestone_tracking") && form.getValues("project_work_header_entries")?.some(entry => entry.enabled) && (
                            <div className="flex justify-between items-start border-b pb-2 mb-2">
                                <p className="text-sm text-gray-600 font-semibold">Tracked Work Headers</p>
                                <ul className="text-sm text-gray-800 italic list-disc pl-4">
                                    {form.getValues("project_work_header_entries")
                                        .filter(entry => entry.enabled)
                                        .map((entry, idx) => (
                                            <li key={idx}>{entry.work_header_name}</li>
                                        ))}
                                </ul>
                            </div>
                        )} */}
                </Section>

                <Section sectionKey={"projectAssignees"}>
                    <Detail label="Project Lead" value={form.getValues("project_lead") ? user?.find(u => u.name === form.getValues("project_lead"))?.full_name : ""} />
                    <Detail label="Procurement Lead" value={form.getValues("procurement_lead") ? user?.find(u => u.name === form.getValues("procurement_lead"))?.full_name : ""} />
                    <Detail label="Project Manager" value={form.getValues("project_manager") ? user?.find(u => u.name === form.getValues("project_manager"))?.full_name : ""} />
                    {/* <Detail label="Estimates Executive" value={form.getValues("estimates_exec") ? user?.find(u => u.name === form.getValues("estimates_exec"))?.full_name : ""} /> */}
                    <Detail label="Accountant" value={form.getValues("accountant") ? user?.find(u => u.name === form.getValues("accountant"))?.full_name : ""} />
                    {/* <Detail label="Design Lead" value={form.getValues("design_lead") ? user?.find(u => u.name === form.getValues("design_lead"))?.full_name : ""} /> */}
                </Section>

                <div>
                    <div className="flex gap-1 items-center mb-4">
                        <h2 className="text-lg font-semibold text-sky-600">Selected Packages</h2>
                        <Pencil className="w-4 h-4 text-sky-600 cursor-pointer hover:text-sky-800 focus:ring-2 focus:ring-sky-600" onClick={() => {
                            setSection("packageSelection")
                            setCurrentStep(4)
                        }} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {form
                            .getValues("project_work_packages")?.work_packages?.map((workPackage: WorkPackage, index: number) => (
                                <div key={index} className={`${index % 2 !== 0 ? "sm:border-l sm:border-gray-300 sm:pl-4" : ""} border-b pb-4`}>
                                    <p className="text-md font-medium text-gray-700">
                                        {workPackage.work_package_name}
                                    </p>
                                    <ul className="pl-4 mt-2 space-y-2">
                                        {workPackage.category_list?.list.map((category, idx) => (
                                            <li key={idx} className="text-sm text-gray-600">
                                                <span className="font-semibold">- {category.name}:</span>{" "}
                                                {category.makes.length > 0
                                                    ? category.makes.map((make) => make?.label).join(", ")
                                                    : "N/A"}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )) || (
                                <p className="text-sm text-gray-600">No packages selected</p>
                            )}
                    </div>
                </div>
            </div>
        </SectionProvider>
    );
};

interface SectionProps {
    sectionKey: string;
    children: React.ReactNode[];
}
const Section: React.FC<SectionProps> = ({ sectionKey, children }) => {
    const { setSection, sections, setCurrentStep, sectionTitles } = useSectionContext();

    // Flatten children to handle fragments and arrays of elements
    // const flattenedChildren = React.Children.toArray(children).flat();

    const handleClick = () => {
        setSection(sectionKey);
        const index = sections.findIndex((val) => val === sectionKey);
        setCurrentStep(index);
    };

    return (
        <div className="mb-8">
            <div className="flex gap-1 items-center mb-4">
                <h2 className="text-lg font-semibold text-sky-600">{sectionTitles[sectionKey]}</h2>
                <Pencil
                    className="w-4 h-4 text-sky-600 cursor-pointer hover:text-sky-800 focus:ring-2 focus:ring-sky-600"
                    onClick={handleClick}
                />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {children.map((child, index) => (
                    <div key={index} className={`${index % 2 !== 0 ? "sm:border-l sm:border-gray-300 sm:pl-4" : ""} h-full`}>
                        {child}
                    </div>
                ))}
            </div>
        </div>
    );
};



const Detail = ({ label, value }: { label: string; value: string | undefined | null }) => (
    <div className="flex justify-between items-start border-b pb-2 mb-2">
        <p className="text-sm text-gray-600 font-semibold">{label}</p>
        <p className="text-sm text-gray-800 italic">{value || "N/A"}</p>
    </div>
);
