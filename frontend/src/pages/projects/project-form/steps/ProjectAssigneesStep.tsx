import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
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
import { ProjectFormValues } from "../schema";
import { ProjectFormData } from "../hooks/useProjectFormData";

interface ProjectAssigneesStepProps {
    form: UseFormReturn<ProjectFormValues>;
    formData: ProjectFormData;
    onNext: () => void;
    onPrevious: () => void;
}

export const ProjectAssigneesStep: React.FC<ProjectAssigneesStepProps> = ({
    form,
    formData,
    onNext,
    onPrevious,
}) => {
    const {
        projectLeadOptions,
        projectManagerOptions,
        procurementLeadOptions,
        accountantOptions,
        usersLoading,
        usersError,
    } = formData;

    return (
        <>
            <p className="text-sky-600 font-semibold">Project Assignees (Optional)</p>

            {/* Project Lead */}
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
                                    {usersLoading && <div>Loading...</div>}
                                    {usersError && <div>Error: {usersError.message}</div>}
                                    {projectLeadOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <FormDescription>Select Project Lead</FormDescription>
                    </FormItem>
                )}
            />

            {/* Project Manager */}
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
                                    {usersLoading && <div>Loading...</div>}
                                    {usersError && <div>Error: {usersError.message}</div>}
                                    {projectManagerOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <FormDescription>Select Project Manager</FormDescription>
                    </FormItem>
                )}
            />

            {/* Procurement Lead */}
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
                                    {usersLoading && <div>Loading...</div>}
                                    {usersError && <div>Error: {usersError.message}</div>}
                                    {procurementLeadOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <FormDescription>Select Procurement Lead</FormDescription>
                    </FormItem>
                )}
            />

            {/* Accountant */}
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
                                    {usersLoading && <div>Loading...</div>}
                                    {usersError && <div>Error: {usersError.message}</div>}
                                    {accountantOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <FormDescription>Select Accountant</FormDescription>
                    </FormItem>
                )}
            />

            <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={onPrevious}>
                    Previous
                </Button>
                <Button onClick={onNext}>Next</Button>
            </div>
        </>
    );
};

export default ProjectAssigneesStep;
