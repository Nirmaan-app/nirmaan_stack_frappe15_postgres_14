import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeCreateDoc, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
// import React from "react"
import * as z from "zod"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "./ui/form"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Button } from "./ui/button"
import { ButtonLoading } from "./button-loading"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import ProjectTypeForm from "./project-type-form"
import CustomerForm from "./customer-form"
import { Separator } from "./ui/separator"
import { AddressForm } from "./address-form"
import { ScrollArea } from "./ui/scroll-area"
import { Link, useNavigate } from "react-router-dom"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { cn } from "@/lib/utils"
import { CalendarIcon } from "lucide-react"
import { Calendar } from "./ui/calendar"
import { format } from "date-fns"
// import EmployeeForm from "./employee-form"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion"
import { Checkbox } from "./ui/checkbox"

// const workPackages = [
//     {
//         name: "Electrical",
//         isChecked: false,
//         scopes: [
//             {
//                 name: "SOW-001",
//                 scope_of_work_name: "Raceway/ Cable Tray work",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-002",
//                 scope_of_work_name: "Conduiting",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-003",
//                 scope_of_work_name: "LT Panel",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-004",
//                 scope_of_work_name: "Wiring",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-005",
//                 scope_of_work_name: "HVAC  - VRF system",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-006 ",
//                 scope_of_work_name: "IOT/ Sensor work",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-007",
//                 scope_of_work_name: "Main Power Line",
//                 isSelected: false,
//                 work_package: "Electrical "
//             },
//             {
//                 name: "SOW-008",
//                 scope_of_work_name: "HVAC - Non VRF/ AHU",
//                 isSelected: false,
//                 work_package: "Electrical "
//             },
//             {
//                 name: "SOW-009",
//                 scope_of_work_name: "DB Work",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-010",
//                 scope_of_work_name: "Switch Socket",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-011",
//                 scope_of_work_name: "UPS Supply",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-012",
//                 scope_of_work_name: "Lights Supply",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-013",
//                 scope_of_work_name: "Earthing",
//                 isSelected: false,
//                 work_package: "Electrical"
//             },
//             {
//                 name: "SOW-014",
//                 scope_of_work_name: "Lights Installation",
//                 isSelected: false,
//                 work_package: "Electrical"
//             }
//         ]
//     },
//     {
//         name: "Access Control & Security System",
//         isChecked: false,
//         scopes: [
//             {
//                 name: "SOW-015",
//                 scope_of_work_name: "CCTV Installation",
//                 isSelected: false,
//                 work_package: "Access Control & Security System"
//             },
//             {
//                 name: "SOW-016",
//                 scope_of_work_name: "Access Control Installation",
//                 isSelected: false,
//                 work_package: "Access Control & Security System"
//             },
//             {
//                 name: "SOW-017",
//                 scope_of_work_name: "Static IP Configuration",
//                 isSelected: false,
//                 work_package: "Access Control & Security System"
//             }
//         ]
//     },
//     {
//         name: "Data & Networking",
//         isChecked: false,
//         scopes: [
//             {
//                 name: "SOW-018",
//                 scope_of_work_name: "Cabling",
//                 isSelected: false,
//                 work_package: "Data & Networking"
//             },
//             {
//                 name: "SOW-019",
//                 scope_of_work_name: "User Side Termination",
//                 isSelected: false,
//                 work_package: "Data & Networking"
//             },
//             {
//                 name: "SOW-020",
//                 scope_of_work_name: "Rack side termination",
//                 isSelected: false,
//                 work_package: "Data & Networking"
//             },
//             {
//                 name: "SOW-021",
//                 scope_of_work_name: "Active side work",
//                 isSelected: false,
//                 work_package: "Data & Networking"
//             },
//             {
//                 name: "SOW-022",
//                 scope_of_work_name: "Fluke Test",
//                 isSelected: false,
//                 work_package: "Data & Networking"
//             }
//         ]
//     },
//     {
//         name: "Fire Fighting",
//         isChecked: false,
//         scopes: [
//             {
//                 name: "SOW-023",
//                 scope_of_work_name: "Addressable System",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             },
//             {
//                 name: "SOW-024",
//                 scope_of_work_name: "Conventional System",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             },
//             {
//                 name: "SOW-025",
//                 scope_of_work_name: "PA System Installation",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             },
//             {
//                 name: "SOW-026",
//                 scope_of_work_name: "Integration with PA System",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             },
//             {
//                 name: "SOW-027",
//                 scope_of_work_name: "Integration Access Control Systems",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             },
//             {
//                 name: "SOW-028",
//                 scope_of_work_name: "Integration with HVAC System",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             },
//             {
//                 name: "SOW-029",
//                 scope_of_work_name: "Integration with Electrical Panel",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             },
//             {
//                 name: "SOW-030",
//                 scope_of_work_name: "New fire line creation",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             },
//             {
//                 name: "SOW-031",
//                 scope_of_work_name: "Modification of existing fire line",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             },
//             {
//                 name: "SOW-032",
//                 scope_of_work_name: "Supply of Fire extinguisher",
//                 isSelected: false,
//                 work_package: "Fire Fighting"
//             }
//         ]
//     }
// ] as const

// 1.a Create Form Schema accordingly
const projectFormSchema = z.object({
    project_name: z
        .string(
            {
                required_error: "Must Provide Project name"
            })
        .min(6, {
            message: "Employee Name must be at least 6 characters.",
        }),
    customer: z
        .string({
            //required_error: "Please select associated customer."
        }),
    project_type: z
        .string({
            //required_error: "Please select Project Type"
        }),
    project_address: z
        .string({
            //required_error: "Please select Project Address"
        }),
    project_start_date: z
        .date({
            //required_error: "A start date is required.",
        }),
    project_end_date: z
        .date({
            //required_error: "An end date is required.",
        }),
    project_lead: z
        .string({
            //required_error: "Please select Project Lead"
        }),
    project_manager: z
        .string({
            //required_error: "Please select Project Manager"
        }),
    design_lead: z
        .string({
            //required_error: "Please select Design Lead"
        }),
    procurement_lead: z
        .string({
            //required_error: "Please select Procurement Lead"
        }),
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
                    name: z.string(),
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
    // 1.b Define your form.
    // Has handleSubmit, control functions
    const { data: work_package_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Work Packages",
        {
            fields: ['work_package_name']
        });
    const { data: scope_of_work_list, isLoading: sow_list_loading, error: sow_list_error } = useFrappeGetDocList("Scopes of Work",
        {
            fields: ['scope_of_work_name', 'work_package']
        });

    const form = useForm<ProjectFormValues>({
        resolver: zodResolver(projectFormSchema),
        mode: "onChange",
        defaultValues: {
            project_name: "",
            project_start_date: new Date(),
            project_end_date: new Date(),
            project_work_milestones: {
                work_packages: []
            },
            project_scopes: {
                scopes: []
            },
        },
    })
    const { data: company, isLoading: company_isLoading, error: company_error } = useFrappeGetDocList('Customers', {
        fields: ["name", "company_name"]
    });

    const { data: project_types, isLoading: project_types_isLoading, error: project_types_error, mutate: project_types_mutate } = useFrappeGetDocList('Project Types', {
        fields: ["name", "project_type_name"]
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

    const { data: project_address, isLoading: project_address_isLoading, error: project_address_error } = useFrappeGetDocList('Address', {
        fields: ["name", "address_title"],
        filters: [["address_type", "=", "Project"]]
    });

    const { data: user, isLoading: user_isLoading, error: user_error } = useFrappeGetDocList('Nirmaan Users', {
        fields: ["name", "full_name"],
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

    // const handleCheckboxChange = (item: WorkPackages) => {
    //     item.isChecked = !item.isChecked
    //     setWorkPackages([...workPackages.filter(wp => wp.name !== item.name), item])

    // }

    // const { scopes: d } = useWorkPackageGenerate()

    // if (d) console.log(d)

    const { data: mile_data, isLoading: mile_loading, error: mile_error } = useFrappeGetDocList("Milestones", {
        fields: ["name", "milestone_name", "scope_of_work"]
    })


    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof projectFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        const formatted_start_date = values.project_start_date.toISOString().replace('T', ' ').slice(0, 19)
        const formatted_end_date = values.project_end_date.toISOString().replace('T', ' ').slice(0, 19)
        //const scopes = values.project_scopes.toString()
        //const formatted_project_milestone = values.project_work_milestones.
        createDoc('Projects', {
            ...values,
            project_start_date: formatted_start_date,
            project_end_date: formatted_end_date
        }).then(() => {
            console.log(values)
        }).catch(() => {
            console.log(submit_error)
        })

        if (!mile_loading && !mile_error) {
            console.log("scopes", values.project_scopes.scopes)
            values.project_scopes.scopes.forEach(scope => {
                const miles = mile_data?.filter(mile => mile.scope_of_work === scope.name)
                miles?.forEach(mile => {
                    createDoc("Project Work Milestones", {
                        project: values.project_name,
                        work_package: scope.work_package,
                        scope_of_work: scope.scope_of_work_name,
                        milestone: mile.milestone_name
                    })
                    console.log(mile.milestone_name, scope.scope_of_work_name, scope.work_package)
                })
            })
        }


        console.log(values)
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

    const address_options: SelectOption[] = project_address?.map(item => ({
        label: item.address_title, // Adjust based on your data structure
        value: item.name
    })) || [];

    const user_options: SelectOption[] = user?.map(item => ({
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
    console.log(wp_list, sow_list)

    return (
        <Form {...form}>
            <form onSubmit={(event) => {
                event.stopPropagation();
                return form.handleSubmit(onSubmit)(event);
            }} className="flex flex-col space-y-8">
                <div className="flex flex-col">
                    <p className="text-sky-600 font-semibold pb-9">Project Details</p>
                    <FormField
                        control={form.control}
                        name="project_name"
                        render={({ field }) => (

                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Project Name: </FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <FormControl>
                                            <Input placeholder="Project Name" {...field} />
                                        </FormControl>
                                    </div>
                                    <div className="md:basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Example: CUSTOMER+LOACTION
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
                        name="customer"
                        render={({ field }) => (
                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Customer</FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select the customer" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {company_isLoading && <div>Loading...</div>}
                                                {company_error && <div>Error: {company_error.message}</div>}
                                                {options.map(option => (
                                                    <SelectItem value={option.value}>{option.label}</SelectItem>
                                                ))}

                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="md:basis-1/4 pl-10 pt-2">
                                        <FormDescription>
                                            Customer associated with this project
                                        </FormDescription>
                                    </div>
                                    <div className="md:basis-1/4 pl-10 pt-2">
                                        {/* <Button variant="secondary" asChild>
                                            <Link to="../../customers/edit" relative="path">+ Add Customer</Link>
                                        </Button> */}
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button variant="secondary"> + Add Customer</Button>
                                            </DialogTrigger>
                                            <DialogContent className="sm:max-w-[425px]">
                                                <DialogHeader>
                                                    <DialogTitle>Add New Customer</DialogTitle>
                                                    <DialogDescription>
                                                        Add new Customers here.
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <CustomerForm />
                                            </DialogContent>
                                        </Dialog>
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
                        name="project_type"
                        render={({ field }) => {
                            return (
                                <FormItem>
                                    <div className="md:flex md:flex-row pt-2 pb-2 ">
                                        <div className="md:basis-1/4">
                                            <FormLabel>Project Type</FormLabel>
                                        </div>
                                        <div className="md:basis-1/4">
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select a project type" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {project_types_isLoading && <div>Loading...</div>}
                                                    {project_types_error && <div>Error: {project_types_error.message}</div>}
                                                    {type_options.map(option => (
                                                        <SelectItem value={option.value}>{option.label}</SelectItem>
                                                    ))}

                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="md:basis-1/4 pl-10 pt-2">
                                            <FormDescription>
                                                Select Type of Project
                                            </FormDescription>
                                        </div>
                                        <div className="md:basis-1/4 pl-10 pt-2">
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <Button variant="secondary"> + Add Project Type</Button>
                                                </DialogTrigger>
                                                <DialogContent className="sm:max-w-[425px]">
                                                    <DialogHeader>
                                                        <DialogTitle>Add New Project Type</DialogTitle>
                                                        <DialogDescription>
                                                            Add new project types here.
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <ProjectTypeForm />
                                                </DialogContent>
                                            </Dialog>
                                        </div>
                                    </div>
                                    <div className="pt-2 pb-2">
                                        <FormMessage />
                                    </div>
                                </FormItem>
                            )
                        }}
                    />
                    <FormField
                        control={form.control}
                        name="project_address"
                        render={({ field }) => (
                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2 ">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Project Address</FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select an address" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {project_address_isLoading && <div>Loading...</div>}
                                                {project_address_error && <div>Error: {project_address_error.message}</div>}
                                                {address_options.map(option => (
                                                    <SelectItem value={option.value}>{option.label}</SelectItem>
                                                ))}

                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="md:basis-1/4 pl-10 pt-2">
                                        <FormDescription>
                                            Select Project Address
                                        </FormDescription>
                                    </div>
                                    <div className="md:basis-1/4 pl-10 pt-2">
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button variant="secondary"> + Add Project Address</Button>
                                            </DialogTrigger>

                                            <DialogContent className="sm:max-w-[425px]">
                                                <ScrollArea className="h-[600px] w-[350px]">
                                                    <DialogHeader>
                                                        <DialogTitle>Add New Project Address</DialogTitle>
                                                        <DialogDescription>
                                                            Add new project address here.
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <Separator className="my-6" />

                                                    <AddressForm type={"Project"} />

                                                </ScrollArea>
                                            </DialogContent>
                                        </Dialog>
                                    </div>
                                </div>

                                <div className="pt-2 pb-2">
                                    <FormMessage />
                                </div>
                            </FormItem>
                        )}
                    />
                    <Separator className="my-6" />
                    <p className="text-sky-600 font-semibold pb-9">Project Timeline</p>
                    <FormField
                        control={form.control}
                        name="project_start_date"
                        render={({ field }) => (

                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Project Start Date: </FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button
                                                        variant={"outline"}
                                                        className={cn(
                                                            "w-[240px] pl-3 text-left font-normal",
                                                            !field.value && "text-muted-foreground"
                                                        )}
                                                    >
                                                        {field.value ? (

                                                            format(field.value, "yyyy-MM-dd")
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
                                                    selected={String(field.value)}
                                                    onSelect={field.onChange}

                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                    <div className="md:basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Select project start date
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
                        name="project_end_date"
                        render={({ field }) => (

                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Project End Date: </FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button
                                                        variant={"outline"}
                                                        className={cn(
                                                            "w-[240px] pl-3 text-left font-normal",
                                                            !field.value && "text-muted-foreground"
                                                        )}
                                                    >
                                                        {field.value ? (

                                                            format(field.value, "yyyy-MM-dd")
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
                                                    selected={String(field.value)}
                                                    onSelect={field.onChange}
                                                    disabled={(date) =>
                                                        date < form.getValues("project_start_date")
                                                    }
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                    <div className="md:basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Select Project End date
                                        </FormDescription>
                                    </div>

                                </div>
                                <div className="pt-2 pb-2">
                                    <FormMessage />
                                </div>
                            </FormItem>


                        )}
                    />
                    <div className="pt-2 pb-2">
                        <div className="md:flex md:flex-row pt-2 pb-2">
                            <div className="md:basis-1/4">
                                <h1>Duration: </h1>
                            </div>
                            <div className="md:basis-1/4">
                                <h1>{
                                    (Math.round(form.getValues("project_end_date").getTime() - form.getValues("project_start_date").getTime()) / (1000 * 3600 * 24)) || "0"
                                }Days
                                </h1>
                            </div>
                        </div>
                    </div>
                    <Separator className="my-6" />
                    <div className="md:flex items-center justify-between">
                        <p className="text-sky-600 font-semibold pb-9">Project Asignees</p>
                        <div className="md:flex items-center">
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="secondary"> + Add Employee</Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Add New Employee</DialogTitle>
                                        <DialogDescription>
                                            Add new employees here.
                                        </DialogDescription>
                                    </DialogHeader>
                                    {/* <EmployeeForm /> */}
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                    <FormField
                        control={form.control}
                        name="project_lead"
                        render={({ field }) => {
                            return (
                                <FormItem>
                                    <div className="md:flex md:flex-row pt-2 pb-2 ">
                                        <div className="md:basis-1/4">
                                            <FormLabel>Project Lead:</FormLabel>
                                        </div>
                                        <div className="md:basis-1/4">
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select project lead" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {user_isLoading && <div>Loading...</div>}
                                                    {user_error && <div>Error: {user_error.message}</div>}
                                                    {user_options.map(option => (
                                                        <SelectItem value={option.value}>{option.label}</SelectItem>
                                                    ))}

                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="md:basis-1/4 pl-10 pt-2">
                                            <FormDescription>
                                                Select Project Lead
                                            </FormDescription>
                                        </div>
                                    </div>
                                    <div className="pt-2 pb-2">
                                        <FormMessage />
                                    </div>
                                </FormItem>
                            )
                        }}
                    />
                    <FormField
                        control={form.control}
                        name="project_manager"
                        render={({ field }) => {
                            return (
                                <FormItem>
                                    <div className="md:flex md:flex-row pt-2 pb-2 ">
                                        <div className="md:basis-1/4">
                                            <FormLabel>Project Manager:</FormLabel>
                                        </div>
                                        <div className="md:basis-1/4">
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select project manager" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {user_isLoading && <div>Loading...</div>}
                                                    {user_error && <div>Error: {user_error.message}</div>}
                                                    {user_options.map(option => (
                                                        <SelectItem value={option.value}>{option.label}</SelectItem>
                                                    ))}

                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="md:basis-1/4 pl-10 pt-2">
                                            <FormDescription>
                                                Select Project Manager
                                            </FormDescription>
                                        </div>
                                    </div>
                                    <div className="pt-2 pb-2">
                                        <FormMessage />
                                    </div>
                                </FormItem>
                            )
                        }}
                    />
                    <FormField
                        control={form.control}
                        name="design_lead"
                        render={({ field }) => {
                            return (
                                <FormItem>
                                    <div className="md:flex md:flex-row pt-2 pb-2 ">
                                        <div className="md:basis-1/4">
                                            <FormLabel>Design Lead:</FormLabel>
                                        </div>
                                        <div className="md:basis-1/4">
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select design lead" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {user_isLoading && <div>Loading...</div>}
                                                    {user_error && <div>Error: {user_error.message}</div>}
                                                    {user_options.map(option => (
                                                        <SelectItem value={option.value}>{option.label}</SelectItem>
                                                    ))}

                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="md:basis-1/4 pl-10 pt-2">
                                            <FormDescription>
                                                Select Design Lead
                                            </FormDescription>
                                        </div>
                                    </div>
                                    <div className="pt-2 pb-2">
                                        <FormMessage />
                                    </div>
                                </FormItem>
                            )
                        }}
                    />
                    <FormField
                        control={form.control}
                        name="procurement_lead"
                        render={({ field }) => {
                            return (
                                <FormItem>
                                    <div className="md:flex md:flex-row pt-2 pb-2 ">
                                        <div className="md:basis-1/4">
                                            <FormLabel>Procurement Lead:</FormLabel>
                                        </div>
                                        <div className="md:basis-1/4">
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select procurement lead" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {user_isLoading && <div>Loading...</div>}
                                                    {user_error && <div>Error: {user_error.message}</div>}
                                                    {user_options.map(option => (
                                                        <SelectItem value={option.value}>{option.label}</SelectItem>
                                                    ))}

                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="md:basis-1/4 pl-10 pt-2">
                                            <FormDescription>
                                                Select Procurement Lead
                                            </FormDescription>
                                        </div>
                                    </div>
                                    <div className="pt-2 pb-2">
                                        <FormMessage />
                                    </div>
                                </FormItem>
                            )
                        }}
                    />
                    <Separator className="my-6" />
                    <p className="text-sky-600 font-semibold pb-9">Package Specification</p>
                    <FormField
                        control={form.control}
                        name="project_work_milestones"
                        render={() => (
                            <FormItem>
                                <div className="mb-4">
                                    <FormLabel className="text-base">Sidebar</FormLabel>
                                    <FormDescription>
                                        Select the work packages.
                                    </FormDescription>
                                </div>
                                {wp_list.map((item) => (
                                    <Accordion type="single" collapsible className="w-full">
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
                                                            <FormField
                                                                key={scope.scope_of_work_name}
                                                                control={form.control}
                                                                name="project_scopes.scopes"
                                                                render={({ field }) => (
                                                                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                                                        <FormControl>
                                                                            <Checkbox
                                                                                checked={field.value?.some((i) => i.scope_of_work_name === scope.scope_of_work_name)}
                                                                                onCheckedChange={(checked) => {
                                                                                    return checked
                                                                                        ? field.onChange([...field.value, {
                                                                                            name: scope.scope_of_work_name,
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
                                                                        <FormLabel className="text-sm font-normal">
                                                                            {scope.scope_of_work_name}
                                                                        </FormLabel>
                                                                    </FormItem>
                                                                )}
                                                            />
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
                    {/* {wp_isLoading && <div>Loading...</div>}
                    {wp_error && <div>Error: {wp_error.message}</div>} */}
                    {/* {workPackages.map((option, index) => ( */}
                    {/* <FormField
                            control={form.control}
                            name={"project_work_milestones"}
                            render={() => (
                                <FormItem>
                                    <div className="flex flex-row pt-2 pb-2 ">

                                        {workPackages.map((wp, index) => (
                                            <FormField
                                            key={wp.name}
                                            control={form.control}
                                            name={`project_work_milestones`}
                                            render={({field}) => {
                                                return(
<Accordion type="single" collapsible className="w-full">
                                            <AccordionItem value="item-1">
                                                <AccordionTrigger>
                                                    <div className="space-y-1 leading-none">
                                                        <FormControl>
                                                            <Checkbox
                                                                checked={field.value.isChecked}
                                                                onCheckedChange={(checked) => {
                                                                    return checked
                                                                    ? field.onChange([...field.value, wp])
                                                                    : 
                                                                }}
                                                            />
                                                        </FormControl>
                                                        <FormLabel>
                                                            {option.name}
                                                        </FormLabel>
                                                    </div>
                                                </AccordionTrigger>
                                                <AccordionContent>
                                                    {option.scopes.map((scope) => (

                                                        <div className="flex items-center space-x-2">
                                                            <Switch id={scope.name} />
                                                            <Label htmlFor={scope.name}>{scope.scope_of_work_name}</Label>
                                                        </div>


                                                    ))}
                                                </AccordionContent>

                                            </AccordionItem>
                                        </Accordion>
                                                )
                                            }}

                                            />
                                        ))}
                                        
                                    </div>
                                </FormItem>
                            )}
                        /> */}
                    {/* ))} */}
                    <Separator className="my-6" />
                    <p className="text-sky-600 font-semibold pb-9">DEBUG Package Specification</p>
                    {/* <div>
                        {.map(wp => (
                            <h3>{wp.name}</h3>
                            {}
                        ))}
                    </div> */}

                    {/* <FormField
                        control={form.control}
                        name="project_name"
                        render={({ field }) => (

                            <FormItem>
                                <div className="flex flex-row pt-2 pb-2">
                                    <div className="basis-1/4">
                                        <FormLabel>Project Name: </FormLabel>
                                    </div>
                                    <div className="basis-1/4">
                                        <FormControl>
                                            <Input placeholder="Project Name" {...field} />
                                        </FormControl>
                                    </div>
                                    <div className="basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Example: CUSTOMER+LOACTION
                                        </FormDescription>
                                    </div>

                                </div>
                                <div className="pt-2 pb-2">
                                    <FormMessage />
                                </div>
                            </FormItem>


                        )}
                    /> */}

                    <div className="pt-2 pb-2 ">
                        {(loading) ? (<ButtonLoading />) : (<Button type="submit">Submit</Button>)}
                    </div>
                    <div>
                        {submit_complete && <div className="font-semibold text-green-500"> Submitted successfully</div>}
                        {/* {
                            const navigate = useNavigate();
                        submit_complete && navigate("/");
                        } */}
                    </div>
                </div>
            </form>
        </Form>
    )
}