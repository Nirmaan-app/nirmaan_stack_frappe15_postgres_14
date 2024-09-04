import { zodResolver } from "@hookform/resolvers/zod"
import { useFrappeCreateDoc, useFrappeDocTypeEventListener, useFrappeGetDocList, useSWR } from "frappe-react-sdk"
import { useForm } from "react-hook-form"
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
import { ScrollArea } from "./ui/scroll-area"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { cn } from "@/lib/utils"
import { CalendarIcon, CirclePlus, GitCommitVertical } from "lucide-react"
import { Calendar } from "./ui/calendar"
import { format } from "date-fns"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion"
import { Checkbox } from "./ui/checkbox"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet"
import { useNavigate } from "react-router-dom"
import { useState } from "react"


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
    subdivisions: z
        .string({
            //required_error: "Please select Sub-Divisions"
        }),
    address_line_1: z
        .string({
            required_error: "Address Required"
        }),
    address_line_2: z
        .string(),
    project_city: z
        .string({
            required_error: "Must provide city"
        }),
    project_state: z
        .string({
            required_error: "Must provide state"
        }),
    pin: z
        .number({
            required_error: "Must provide pincode"
        })
        .positive()
        .gte(100000)
        .lte(999999),
    email: z
        .string()
        .email()
        .optional(),
    phone: z
        .number({
            required_error: "Must provide contact"
        })
        .positive()
        .gte(1000000000)
        .lte(9999999999)
        .optional(),
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
            fields: ['work_package_name']
        });
    const { data: scope_of_work_list, isLoading: sow_list_loading, error: sow_list_error } = useFrappeGetDocList("Scopes of Work",
        {
            fields: ['scope_of_work_name', 'work_package'],
            limit: 100,
        });

    // const valueChange = (e) => {
    //     console.log(e);
    // }

    const form = useForm<ProjectFormValues>({
        resolver: zodResolver(projectFormSchema),
        mode: "onBlur",
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
    const { data: company, isLoading: company_isLoading, error: company_error, mutate: company_mutate } = useFrappeGetDocList('Customers', {
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

    // const { data: project_address, isLoading: project_address_isLoading, error: project_address_error, mutate: project_address_mutate } = useFrappeGetDocList('Address', {
    //     fields: ["name", "address_title"],
    //     filters: [["address_type", "=", "Shipping"]]
    // });

    const { data: user, isLoading: user_isLoading, error: user_error } = useFrappeGetDocList('Nirmaan Users', {
        fields: ["name", "full_name", "role_profile"],
        filters: [["name", "!=", "Administrator"]]
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

    // const { data: mile_data, isLoading: mile_loading, error: mile_error } = useFrappeGetDocList("Milestones", {
    //     fields: ["name", "milestone_name", "scope_of_work"]
    // })


    // 2. Define a submit handler.
    const [areaNames, setAreaNames] = useState([]);


    function onSubmit(values: z.infer<typeof projectFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        // console.log("values", values)
        const formatted_start_date = values.project_start_date.toISOString().replace('T', ' ').slice(0, 19)
        const formatted_end_date = values.project_end_date.toISOString().replace('T', ' ').slice(0, 19)
        //const scopes = values.project_scopes.toString()
        //const formatted_project_milestone = values.project_work_milestones.
        createDoc('Address', {
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
        }).then(doc => {
            createDoc('Projects', {
                project_name: values.project_name,
                customer: values.customer,
                project_type: values.project_type,
                project_start_date: formatted_start_date,
                project_end_date: formatted_end_date,
                project_address: doc.name,
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
            }).then((doc) => console.log(doc)).catch((error) => console.log("projects error", error))
        }).catch((error) => {
            console.log("address error", error)
        })

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

    const handleRedirect = () => {
        navigate("/projects")
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
                                        {/* <Dialog>
                                            <DialogTrigger asChild>

                                                <Button variant="secondary">
                                                    <div className="flex">
                                                        <CirclePlus className="w-3.5 h-3.5 mt-0.5" />
                                                        <span className="pl-1">Add New Customer</span>
                                                    </div>
                                                </Button>

                                            </DialogTrigger>
                                            <DialogContent className="max-w-[300px] md:max-w-[1280px] ">

                                                <DialogHeader>
                                                    <DialogTitle>Create New Customer</DialogTitle>
                                                    <DialogDescription>
                                                        Fill the details to create a customer.
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <ScrollArea className="max-w-[280px] md:max-w-[800px] max-h-[400px] md:max-h-[720px] ">
                                                    <CustomerForm company_mutate={company_mutate} />

                                                </ScrollArea>
                                            </DialogContent>
                                        </Dialog> */}
                                        <Sheet>
                                            <SheetTrigger asChild>
                                                <Button variant="secondary">
                                                    <div className="flex">
                                                        <CirclePlus className="w-3.5 h-3.5 mt-0.5" />
                                                        <span className="pl-1">Add New Customer</span>
                                                    </div>
                                                </Button>
                                            </SheetTrigger>
                                            <SheetContent>
                                                <ScrollArea className="h-[90%] w-[600px]  p-4">
                                                    <SheetHeader>
                                                        <SheetTitle><div className="pb-4 text-2xl font-bold">Create New Customer</div></SheetTitle>
                                                        <SheetDescription>
                                                            <CustomerForm company_mutate={company_mutate} />
                                                        </SheetDescription>
                                                    </SheetHeader>
                                                </ScrollArea>
                                            </SheetContent>
                                        </Sheet>
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
                        name="subdivisions"
                        render={({ field }) => {
                            return (
                                <FormItem>
                                    <div className="md:flex md:flex-row pt-2 pb-2 ">
                                        <div className="md:basis-1/4">
                                            <FormLabel>Sub-Divisions</FormLabel>
                                        </div>
                                        <div className="md:basis-1/4">
                                            <Select 
                                                onValueChange={(e) => {
                                                    field.onChange(e);
                                                    handleSubdivisionChange(e);
                                                }}
                                                defaultValue={field.value}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select the number of Sub Divisions" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(item => (
                                                        <SelectItem key={item} value={`${item}`}>
                                                        {item}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="md:basis-1/4 pl-10 pt-2">
                                            <FormDescription>
                                                Select Total number of Area
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
                    {Array.from({ length: form.getValues().subdivisions }).map((_, index) => {
                        return <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2 ">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Area {index + 1}:</FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <Input 
                                            type="text" 
                                            onChange={(e) => handleAreaNameChange(index,e)}
                                            // placeholder={area}
                                            value={areaNames[index].name} 
                                        />
                                    </div>
                                </div>
                            </FormItem>
                    })}
                    <Separator className="my-6" />
                    <p className="text-sky-600 font-semibold pb-9">Project Address Details</p>
                    <FormField
                        control={form.control}
                        name="address_line_1"
                        render={({ field }) => (
                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Address Line 1: </FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <FormControl>
                                            <Input placeholder="Address Line 1" {...field} />
                                        </FormControl>
                                    </div>
                                    <div className="md:basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Example: Building name, Building no., Floor
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
                        name="address_line_2"
                        render={({ field }) => (
                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Address Line 2: </FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <FormControl>
                                            <Input placeholder="Address Line 2" {...field} />
                                        </FormControl>
                                    </div>
                                    <div className="md:basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Example: Road Name, Area name
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
                        name="project_city"
                        render={({ field }) => (
                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>City: </FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <FormControl>
                                            <Input placeholder="City Name" {...field} />
                                        </FormControl>
                                    </div>
                                    <div className="md:basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Example: City name
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
                        name="project_state"
                        render={({ field }) => (
                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>State: </FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <FormControl>
                                            <Input placeholder="State Name" {...field} />
                                        </FormControl>
                                    </div>
                                    <div className="md:basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Example: State name
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
                        name="pin"
                        render={({ field }) => (
                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Pin Code: </FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <FormControl>
                                            <Input type="number" placeholder="Pincode" {...field} onChange={event => field.onChange(+event.target.value)} />
                                        </FormControl>
                                    </div>
                                    <div className="md:basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Example: 100000
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
                        name="phone"
                        render={({ field }) => (
                            <FormItem>
                                <div className="md:flex md:flex-row pt-2 pb-2">
                                    <div className="md:basis-1/4">
                                        <FormLabel>Phone: </FormLabel>
                                    </div>
                                    <div className="md:basis-1/4">
                                        <FormControl>
                                            <Input type="number" placeholder="Phone" {...field} onChange={event => field.onChange(+event.target.value)} />
                                        </FormControl>
                                    </div>
                                    <div className="md:basis-1/2 pl-10 pt-2">
                                        <FormDescription>
                                            Example: 90000000000
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
                                            Example: abc@mail.com
                                        </FormDescription>
                                    </div>

                                </div>
                                <div className="pt-2 pb-2">
                                    <FormMessage />
                                </div>
                            </FormItem>

                        )}
                    />
                    {/* <FormField
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
                                                <Button variant="secondary">
                                                    <div className="flex">
                                                        <CirclePlus className="w-3.5 h-3.5 mt-0.5" />
                                                        <span className="pl-1">Add New Project Address</span>
                                                    </div>
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-[300px] md:max-w-[425px]">
                                                <ScrollArea className="max-h-[400px] md:max-h-[500px] ">
                                                    <DialogHeader>
                                                        <DialogTitle>Add New Project Address</DialogTitle>
                                                        <DialogDescription>
                                                            Add new project address here.
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <Separator className="my-6" />
                                                    <AddressForm type={"Shipping"} project_address_mutate={project_address_mutate} />
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
                    /> */}
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
                                                            "w-[50%] md:w-[100%] pl-3 text-left font-normal",
                                                            !field.value && "text-muted-foreground"
                                                        )}
                                                    >
                                                        {field.value ? (

                                                            format(field.value, "yyyy-MMM-dd")
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
                                                            "w-[50%] md:w-[100%] pl-3 text-left font-normal",
                                                            !field.value && "text-muted-foreground"
                                                        )}
                                                    >
                                                        {field.value ? (

                                                            format(field.value, "yyyy-MMM-dd")
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
                        <div className="flex flex-row pt-2 pb-2">
                            <div className="md:basis-1/4">
                                <FormLabel>Duration: </FormLabel>
                            </div>
                            <div className="md:basis-1/4 flex pl-5">
                                <h1>{
                                    (Math.round((form.getValues("project_end_date").getTime() - form.getValues("project_start_date").getTime()) / (1000 * 3600 * 24))) || "0"
                                }
                                </h1>
                                <h1 className="pl-3 mt-0.5 text-sm text-red-600">*(Days)</h1>
                            </div>
                        </div>
                    </div>
                    <Separator className="my-6" />
                    <div className="md:flex items-center justify-between">
                        <p className="text-sky-600 font-semibold pb-9">Project Asignees</p>
                        <div className="md:flex items-center">
                            {/* <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="secondary">
                                        <div className="flex">
                                            <CirclePlus className="w-3.5 h-3.5 mt-0.5" />
                                            <span className="pl-1">Add New Employee</span>
                                        </div>
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-[300px] md:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Add New Employee</DialogTitle>
                                        <DialogDescription>
                                            Add new employees here.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <EmployeeForm />
                                </DialogContent>
                            </Dialog> */}
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
                                                    {project_lead_options.map(option => (
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
                                                    {project_manager_options.map(option => (
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
                                                    {design_lead_options.map(option => (
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
                                                    {procurement_lead_options.map(option => (
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
                                        // console.log(form.getValues())
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
                    {/* <Separator className="my-6" />
                    <p className="text-sky-600 font-semibold pb-9">DEBUG Package Specification</p> */}
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
                        {(loading) ?
                            <ButtonLoading />
                            : (submit_complete) ?
                                <Button onClick={() => handleRedirect()}>Go Back</Button>
                                : <Button type="submit">Submit</Button>}
                    </div>
                    <div>
                        {submit_complete &&
                            <div>
                                <div className="font-semibold text-green-500"> Submitted successfully</div>
                            </div>
                        }
                    </div>
                </div>
            </form >
        </Form >
    )
}