import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeDocTypeEventListener, useFrappeGetDocList, useSWR } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "./ui/form"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Button } from "./ui/button"
import { ButtonLoading } from "./button-loading"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import ProjectTypeForm from "./project-type-form"
import { Separator } from "./ui/separator"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { cn } from "@/lib/utils"
import { CalendarIcon, CirclePlus, GitCommitVertical } from "lucide-react"
import { Calendar } from "./ui/calendar"
import { format } from "date-fns"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion"
import { Checkbox } from "./ui/checkbox"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet"
import { useNavigate } from "react-router-dom"
import { useEffect, useState, useCallback } from "react"
import { formatToLocalDateTimeString } from "@/utils/FormatDate"
import { useToast } from "./ui/use-toast"
import NewCustomer from "@/pages/customers/add-new-customer"
import { usePincode } from "@/hooks/usePincode"

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
            required_error: "Address Required"
        }),
    address_line_2: z
        .string({
            required_error: "Address Required"
        }),
    project_city: z
        .string({
            required_error: "Must provide city"
        }),
    project_state: z
        .string({
            required_error: "Must provide state"
        }),
    pin: z
        .number()
        .positive()
        .gte(100000)
        .lte(999999)
        .or(z.string()),
    email: z
        .string()
        .email()
        .or(z.string())
        .optional(),
    phone: z
        .number()
        .positive()
        .gte(1000000000)
        .lte(9999999999)
        .or(z.string())
        .optional(),
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
    project_work_milestones: z
        .object({
            work_packages: z.array(
                z.object({
                    work_package_name: z.string()
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
    // 1.b Define your form.
    // Has handleSubmit, control functions
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

    // const valueChange = (e) => {
    //     console.log(e);
    // }

    const defaultValues: ProjectFormValues = {
        project_name: "",
        project_start_date: new Date(),
        project_end_date: new Date(),
        project_work_milestones: {
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
        fields: ["name", "company_name"],
        limit: 1000
    });

    const { data: project_types, isLoading: project_types_isLoading, error: project_types_error, mutate: project_types_mutate } = useFrappeGetDocList('Project Types', {
        fields: ["name", "project_type_name"],
        limit: 100
    });



    // const { data: wp, isLoading: wp_isLoading, error: wp_error } = useFrappeGetDocList('Work Packages', {
    //     fields: ["name"]
    // });


    // const { data: sow, isLoading: sow_isLoading, error: sow_error } = useFrappeGetDocList('Scopes of Work', {
    //     fields: ["name", "scope_of_work_name", "work_package"]
    // });

    // const wpa = wp?.map(wp => ({
    //     name: wp.name,
    //     scopes: sow?.filter(sow => sow.work_package === wp.name)
    //     .map(sow => {
    //         if (sow.work_package === wp.name) return ({
    //             name: sow.name,
    //             scope_of_work_name: sow.scope_of_work_name,
    //             work_package: sow.work_package,
    //             isRequired: false
    //         })

    //     })
    // }))
    // const [workPackage, setWorkPackage] = useState<PWM[]>()

    // console.log(workPackage);




    useFrappeDocTypeEventListener("Project Types", (d) => {
        if (d.doctype === "Project Types") {
            project_types_mutate()
        }
    })

    // const { data: project_address, isLoading: project_address_isLoading, error: project_address_error, mutate: project_address_mutate } = useFrappeGetDocList('Address', {
    //     fields: ["name", "address_title"],
    //     filters: [["address_type", "=", "Shipping"]]
    // });

    const { data: user, isLoading: user_isLoading, error: user_error } = useFrappeGetDocList('Nirmaan Users', {
        fields: ["name", "full_name", "role_profile"],
        filters: [["name", "!=", "Administrator"]],
        limit: 1000
    });

    // const { data: project_lead, isLoading: project_lead_isLoading, error: project_lead_error } = useFrappeGetDocList('Empployees', {
    //     fields: ["name", "employee_name"],
    //     filters: [["employee_role", "=", "Project Lead"]]
    // });

    // const { data: project_manager, isLoading: project_manager_isLoading, error: project_manager_error } = useFrappeGetDocList('Employees', {
    //     fields: ["name", "employee_name"],
    //     filters: [["employee_role", "=", "Project Manager"]]
    // });

    // const { data: design_lead, isLoading: design_lead_isLoading, error: design_lead_error } = useFrappeGetDocList('Employees', {
    //     fields: ["name", "employee_name"],
    //     filters: [["employee_role", "=", "Design Lead"]]
    // });

    // const { data: procurement_lead, isLoading: procurement_lead_isLoading, error: procurement_lead_error } = useFrappeGetDocList('Employees', {
    //     fields: ["name", "employee_name"],
    //     filters: [["employee_role", "=", "Procurement Lead"]]
    // });

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { deleteDoc } = useFrappeDeleteDoc()


    // const handleCheckboxChange = (item: WorkPackages) => {
    //     item.isChecked = !item.isChecked
    //     setWorkPackages([...workPackages.filter(wp => wp.name !== item.name), item])

    // }

    // const { scopes: d } = useWorkPackageGenerate()

    // if (d) console.log(d)

    // const { data: mile_data, isLoading: mile_loading, error: mile_error } = useFrappeGetDocList("Milestones", {
    //     fields: ["name", "milestone_name", "scope_of_work"]
    // })


    // 2. Define a submit handler.
    const [areaNames, setAreaNames] = useState([]);

    const [pincode, setPincode] = useState("")
    const { city, state } = usePincode(pincode)

    const debouncedFetch = useCallback(
        (value: string) => {
            if (value.length === 6) {
                setPincode(value)
            }
        }, []
    )

    useEffect(() => {
        if (pincode.length === 6) {
            form.setValue("project_city", city || "")
            form.setValue("project_state", state || "")
        }
    }, [city, state, form])


    // function onSubmit(values: z.infer<typeof projectFormSchema>) {
    //     // Do something with the form values.
    //     // ✅ This will be type-safe and validated.
    //     // console.log("values", values)
    //     const formatted_start_date = formatToLocalDateTimeString(values.project_start_date)
    //     const formatted_end_date = formatToLocalDateTimeString(values.project_end_date)

    //     // console.log("formatedd dtes", formatted_start_date, formatted_end_date)
    //     //const scopes = values.project_scopes.toString()
    //     //const formatted_project_milestone = values.project_work_milestones.
    //     createDoc('Address', {
    //         address_title: values.project_name,
    //         address_type: "Shipping",
    //         address_line1: values.address_line_1,
    //         address_line2: values.address_line_2,
    //         city: values.project_city,
    //         state: values.project_state,
    //         country: "India",
    //         pincode: values.pin,
    //         email_id: values.email,
    //         phone: values.phone
    //     }).then(doc => {
    //         createDoc('Projects', {
    //             project_name: values.project_name,
    //             customer: values.customer,
    //             project_type: values.project_type,
    //             project_start_date: formatted_start_date,
    //             project_end_date: formatted_end_date,
    //             project_address: doc.name,
    //             project_city: values.project_city,
    //             project_state: values.project_state,
    //             project_lead: values.project_lead,
    //             procurement_lead: values.procurement_lead,
    //             design_lead: values.design_lead,
    //             project_manager: values.project_manager,
    //             project_work_milestones: values.project_work_milestones,
    //             project_scopes: values.project_scopes,
    //             subdivisions: values.subdivisions,
    //             subdivision_list: {
    //                 list: areaNames
    //             }
    //         }).then((doc) => console.log(doc)).catch((error) => console.log("projects error", error))
    //     }).catch((error) => {
    //         console.log("address error", error)
    //     })


    const handleOpenDialog = () => {
        const button = document.getElementById("dialogOpenProject")
        button?.click()
    };

    const handleCloseDialog = () => {
        const button = document.getElementById("dialogCloseProject")
        button?.click()
    };

    const { toast } = useToast()
    async function onSubmit(values: z.infer<typeof projectFormSchema>) {
        try {
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
                    project_work_milestones: values.project_work_milestones,
                    project_scopes: values.project_scopes,
                    subdivisions: values.subdivisions,
                    subdivision_list: {
                        list: areaNames
                    }
                });

                console.log("project", projectDoc)
                toast({
                    title: "Success!",
                    description: `Project ${projectDoc.project_name} created successfully!`,
                    variant: "success"
                })
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

        // if (!mile_loading && !mile_error) {
        //     console.log("scopes", values.project_scopes.scopes)
        //     values.project_scopes.scopes.forEach(scope => {
        //         const miles = mile_data?.filter(mile => mile.scope_of_work === scope.name)
        //         miles?.forEach(mile => {
        //             createDoc("Project Work Milestones", {
        //                 project: values.project_name,
        //                 work_package: scope.work_package,
        //                 scope_of_work: scope.scope_of_work_name,
        //                 milestone: mile.milestone_name
        //             })
        //             console.log(mile.milestone_name, scope.scope_of_work_name, scope.work_package)
        //         })
        //     })
        // }


        // console.log(values)
    }

    console.log("project dates", form.getValues("project_start_date"), form.getValues("project_end_date"))
    const [duration, setDuration] = useState(0)
    useEffect(() => {
        setDuration((Math.round((form.getValues("project_end_date").getTime() - form.getValues("project_start_date").getTime()) / (1000 * 3600 * 24))))
    }, [form.getValues("project_start_date"), form.getValues("project_end_date")])

    // Transform data to select options
    const options: SelectOption[] = company?.map(item => ({
        label: item.company_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const type_options: SelectOption[] = project_types?.map(item => ({
        label: item.project_type_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    // const address_options: SelectOption[] = project_address?.map(item => ({
    //     label: item.address_title, // Adjust based on your data structure
    //     value: item.name
    // })) || [];

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

    // const project_lead_options: SelectOption[] = project_lead?.map(item => ({
    //     label: item.employee_name, // Adjust based on your data structure
    //     value: item.name
    // })) || [];

    // const project_manager_options: SelectOption[] = project_manager?.map(item => ({
    //     label: item.employee_name, // Adjust based on your data structure
    //     value: item.name
    // })) || [];

    // const design_lead_options: SelectOption[] = design_lead?.map(item => ({
    //     label: item.employee_name, // Adjust based on your data structure
    //     value: item.name
    // })) || [];

    // const procurement_lead_options: SelectOption[] = procurement_lead?.map(item => ({
    //     label: item.employee_name, // Adjust based on your data structure
    //     value: item.name
    // })) || [];
    const wp_list: wpType[] = work_package_list?.map(item => ({
        work_package_name: item.work_package_name, // Adjust based on your data structure
    })) || [];
    const sow_list: sowType[] = scope_of_work_list?.map(item => ({
        scope_of_work_name: item.scope_of_work_name, // Adjust based on your data structure
        work_package: item.work_package
    })) || [];

    if (wp_list_loading || sow_list_loading) return <div>Loading...</div>
    if (wp_list_error || sow_list_error) {
        let error = wp_list_error ? wp_list_error : sow_list_error;
        return <div>{error?.message}</div>;
    }

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

    return (
        <Form {...form}>
            <form onSubmit={(event) => {
                event.stopPropagation();
                return form.handleSubmit(onSubmit)(event);
            }} className="ml-8">
                <div className="flex flex-col gap-4">
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
                                        <SheetHeader>
                                            <SheetTitle><div className=" text-2xl font-bold">Create New Customer</div></SheetTitle>
                                            <SheetDescription>
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
                    <Separator className="my-6" />
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
                                <FormLabel className="md:basis-2/12">City</FormLabel>
                                <div className="md:basis-2/4">
                                    <FormControl>
                                        <Input placeholder={city || "City"} disabled={true} {...field} />
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
                                <FormLabel className="md:basis-2/12">State</FormLabel>
                                <div className="md:basis-2/4">
                                    <FormControl>
                                        <Input placeholder={state || "State"} disabled={true} {...field} />
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
                                                field.onChange(+e.target.value)
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
                                            onChange={(event) => field.onChange(+event.target.value)}
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

                    <Separator className="my-6" />
                    <p className="text-sky-600 font-semibold">Project Timeline</p>
                    <FormField
                        control={form.control}
                        name="project_start_date"
                        render={({ field }) => (
                            <FormItem className="lg:flex lg:items-center gap-4">
                                <FormLabel className="md:basis-2/12">Project Start Date<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
                                <div className="md:basis-1/4">
                                    <Popover>
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
                                                onSelect={field.onChange}
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
                                    <Popover>
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
                                                onSelect={field.onChange}
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
                            <h1>{duration}
                            </h1>
                            <h1 className="text-sm text-red-600"><sup>*</sup>(Days)</h1>
                        </div>
                    </div>
                    <Separator className="my-6" />
                    <p className="text-sky-600 font-semibold">Project Asignees(Optional)</p>
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

                    <Separator className="my-6" />
                    <p className="text-sky-600 font-semibold">Package Specification</p>
                    <FormField
                        control={form.control}
                        name="project_work_milestones"
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
                                            form.setValue(("project_work_milestones.work_packages"), wp_list)
                                        }
                                        else {
                                            form.setValue(("project_scopes.scopes"), [])
                                            form.setValue(("project_work_milestones.work_packages"), [])
                                        }
                                    }}

                                /> <span className="text-sm text-red-600 font-bold">Select All</span>
                                <Separator />
                                <Separator />
                                {wp_list.map((item) => (
                                    <Accordion type="single" collapsible value={form.getValues().project_work_milestones.work_packages.find(d => d.work_package_name === item.work_package_name)?.work_package_name} className="w-full">
                                        <AccordionItem value={item.work_package_name}>
                                            <AccordionTrigger>
                                                <FormField
                                                    key={item.work_package_name}
                                                    control={form.control}
                                                    name="project_work_milestones.work_packages"
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
                    <div className="pt-5 pb-2 ">
                        {(loading) ?
                            <ButtonLoading />
                            : <Button type="submit">Submit</Button>
                        }
                    </div>
                    <Dialog>
                        <DialogTrigger asChild>
                            <button className="hidden" id="dialogOpenProject" >Trigger Dialog</button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader className="flex items-center justify-center">
                                <div className="font-semibold text-green-500"> Submitted successfully</div>
                                <div className="flex gap-2">
                                    <Button onClick={() => navigate("/projects")}>Go Back</Button>
                                    <Button onClick={() => {
                                        form.reset();
                                        handleCloseDialog();
                                    }}>
                                        Create New
                                    </Button>
                                </div>
                            </DialogHeader>
                            <DialogClose asChild>
                                <button className="hidden" id="dialogCloseProject">close</button>
                            </DialogClose>
                        </DialogContent>
                    </Dialog>
                </div>
            </form >
        </Form >
    )
}