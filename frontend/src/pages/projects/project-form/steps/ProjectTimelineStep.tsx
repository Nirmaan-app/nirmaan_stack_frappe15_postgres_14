import { UseFormReturn } from "react-hook-form";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { ProjectFormValues } from "../schema";

interface ProjectTimelineStepProps {
    form: UseFormReturn<ProjectFormValues>;
    onNext: () => void;
    onPrevious: () => void;
}

export const ProjectTimelineStep: React.FC<ProjectTimelineStepProps> = ({
    form,
    onNext,
    onPrevious,
}) => {
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [popoverOpen2, setPopoverOpen2] = useState(false);
    const [duration, setDuration] = useState(0);

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

    return (
        <>
            <p className="text-sky-600 font-semibold">Project Timeline</p>

            {/* Project Start Date */}
            <FormField
                control={form.control}
                name="project_start_date"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Project Start Date
                            <sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
                        <div className="md:basis-1/4">
                            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <FormControl>
                                        <Button
                                            variant="outline"
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
                                            field.onChange(date);
                                            setPopoverOpen(false);
                                        }}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                            <FormMessage />
                        </div>
                        <FormDescription>Select project start date</FormDescription>
                    </FormItem>
                )}
            />

            {/* Project End Date */}
            <FormField
                control={form.control}
                name="project_end_date"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Project End Date
                            <sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
                        <div className="md:basis-1/4">
                            <Popover open={popoverOpen2} onOpenChange={setPopoverOpen2}>
                                <PopoverTrigger asChild>
                                    <FormControl>
                                        <Button
                                            variant="outline"
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
                                            field.onChange(date);
                                            setPopoverOpen2(false);
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
                        <FormDescription>Select project end date</FormDescription>
                    </FormItem>
                )}
            />

            {/* Duration Display */}
            <div className="flex items-center">
                <FormLabel className="md:basis-2/12">Duration: </FormLabel>
                <div className="pl-4 flex items-center gap-2">
                    <h1>{duration}</h1>
                    <h1 className="text-sm text-red-600">
                        <sup>*</sup>(Days)
                    </h1>
                </div>
            </div>

            <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={onPrevious}>
                    Previous
                </Button>
                <Button onClick={onNext}>Next</Button>
            </div>
        </>
    );
};

export default ProjectTimelineStep;
