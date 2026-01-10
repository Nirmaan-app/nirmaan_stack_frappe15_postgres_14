import { UseFormReturn } from "react-hook-form";
import { CirclePlus, Info, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import NewCustomer from "@/pages/customers/add-new-customer";
import ProjectTypeForm from "@/components/project-type-form";
import { ProjectFormValues } from "../schema";
import { gstOptions } from "../constants";
import { ProjectFormData } from "../hooks/useProjectFormData";

interface ProjectDetailsStepProps {
    form: UseFormReturn<ProjectFormValues>;
    formData: ProjectFormData;
    onNext: () => void;
}

export const ProjectDetailsStep: React.FC<ProjectDetailsStepProps> = ({
    form,
    formData,
    onNext,
}) => {
    const {
        customerOptions,
        projectTypeOptions,
        customersMutate,
        projectTypesMutate,
        customersLoading,
        customersError,
        projectTypesLoading,
        projectTypesError,
    } = formData;

    // Watch customer field to show conditional message
    const customerValue = form.watch("customer");

    return (
        <>
            <p className="text-sky-600 font-semibold">Project Details</p>

            {/* Project Name */}
            <FormField
                control={form.control}
                name="project_name"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Project Name<sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
                        <div className="flex flex-col items-start md:basis-2/4">
                            <FormControl>
                                <Input placeholder="Project Name" {...field} />
                            </FormControl>
                            <FormMessage />
                        </div>
                        <FormDescription>Example: CUSTOMER+LOCATION</FormDescription>
                    </FormItem>
                )}
            />

            {/* Customer */}
            <FormField
                control={form.control}
                name="customer"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-start gap-4">
                        <FormLabel className="md:basis-2/12 pt-2">Customer</FormLabel>
                        <div className="md:basis-2/4 space-y-2">
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
                                    {customersLoading && <div>Loading...</div>}
                                    {customersError && <div>Error: {customersError.message}</div>}
                                    {customerOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {/* Conditional message about customer requirement for invoices */}
                            {customerValue ? (
                                <div className="flex items-start gap-2 p-2.5 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50">
                                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                                    <p className="text-xs text-green-700 dark:text-green-300">
                                        Now Invoices and Inflows can be added.
                                    </p>
                                </div>
                            ) : (
                                <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
                                    <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                    <p className="text-xs text-amber-700 dark:text-amber-300">
                                        Project Invoice and Inflow Upload will not work if customer
                                        remains unselected.
                                    </p>
                                </div>
                            )}
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
                                        <div className="text-2xl font-bold">Create New Customer</div>
                                    </SheetTitle>
                                    <SheetDescription>
                                        <NewCustomer
                                            company_mutate={customersMutate}
                                            navigation={false}
                                        />
                                    </SheetDescription>
                                </SheetHeader>
                            </SheetContent>
                        </Sheet>
                    </FormItem>
                )}
            />

            {/* Project Value (excl. GST) */}
            <FormField
                control={form.control}
                name="project_value"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Project Value (excl. GST)
                        </FormLabel>
                        <div className="flex flex-col items-start md:basis-2/4">
                            <FormControl>
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

            {/* Project Value (incl. GST) */}
            <FormField
                control={form.control}
                name="project_value_gst"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Project Value (incl. GST)
                        </FormLabel>
                        <div className="flex flex-col items-start md:basis-2/4">
                            <FormControl>
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

            {/* Project Type */}
            <FormField
                control={form.control}
                name="project_type"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Project Type<sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
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
                                    {projectTypesLoading && <div>Loading...</div>}
                                    {projectTypesError && (
                                        <div>Error: {projectTypesError.message}</div>
                                    )}
                                    {projectTypeOptions.map((option) => (
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
                                <ProjectTypeForm project_types_mutate={projectTypesMutate} />
                            </DialogContent>
                        </Dialog>
                    </FormItem>
                )}
            />

            {/* Project GST */}
            <FormField
                control={form.control}
                name="project_gst_number"
                render={({ field }) => {
                    const currentValue = field.value?.list?.[0]?.location || "";

                    return (
                        <FormItem className="lg:flex lg:items-center gap-4">
                            <FormLabel className="md:basis-2/12">
                                Project GST<sup className="pl-1 text-sm text-red-600">*</sup>
                            </FormLabel>
                            <div className="md:basis-2/4">
                                <Select
                                    onValueChange={(selectedLocation: string) => {
                                        const foundOption = gstOptions.find(
                                            (opt) => opt.location === selectedLocation
                                        );
                                        if (foundOption) {
                                            field.onChange({ list: [foundOption] });
                                        } else {
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
                                        {gstOptions.map((option) => (
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

            {/* Carpet Area */}
            <FormField
                control={form.control}
                name="carpet_area"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Carpet Area (Sqft)<sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
                        <div className="md:basis-2/4">
                            <FormControl>
                                <Input
                                    type="number"
                                    placeholder="Enter Area"
                                    min={1}
                                    {...field}
                                    onKeyDown={(e) => {
                                        if (e.key === "-" || e.key === "e") {
                                            e.preventDefault();
                                        }
                                    }}
                                />
                            </FormControl>
                            <FormMessage />
                        </div>
                        <FormDescription>Area in Sqft</FormDescription>
                    </FormItem>
                )}
            />

            <div className="flex items-center justify-end">
                <Button onClick={onNext}>Next</Button>
            </div>
        </>
    );
};

export default ProjectDetailsStep;
