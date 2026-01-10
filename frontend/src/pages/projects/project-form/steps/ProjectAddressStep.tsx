import { UseFormReturn } from "react-hook-form";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { ProjectFormValues } from "../schema";
import { ProjectFormData } from "../hooks/useProjectFormData";

interface ProjectAddressStepProps {
    form: UseFormReturn<ProjectFormValues>;
    formData: ProjectFormData;
    onNext: () => void;
    onPrevious: () => void;
}

export const ProjectAddressStep: React.FC<ProjectAddressStepProps> = ({
    form,
    formData,
    onNext,
    onPrevious,
}) => {
    const { pincodeData, debouncedPincodeFetch } = formData;

    // Update city and state when pincode data changes
    useEffect(() => {
        const pinValue = form.getValues("pin");
        if (typeof pinValue === 'string' && pinValue.length >= 6 && !pincodeData) {
            form.setValue("project_city", "Not Found");
            form.setValue("project_state", "Not Found");
        } else if (pincodeData) {
            form.setValue("project_city", pincodeData?.city || "");
            form.setValue("project_state", pincodeData?.state || "");
        }
    }, [pincodeData, form]);

    const handlePincodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        debouncedPincodeFetch(event.target.value);
    };

    return (
        <>
            <p className="text-sky-600 font-semibold">Project Address Details</p>

            {/* Address Line 1 */}
            <FormField
                control={form.control}
                name="address_line_1"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Address Line 1<sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
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

            {/* Address Line 2 */}
            <FormField
                control={form.control}
                name="address_line_2"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Address Line 2<sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
                        <div className="md:basis-2/4">
                            <FormControl>
                                <Input placeholder="Address Line 2" {...field} />
                            </FormControl>
                            <FormMessage />
                        </div>
                        <FormDescription>Example: Road Name, Area name</FormDescription>
                    </FormItem>
                )}
            />

            {/* City */}
            <FormField
                control={form.control}
                name="project_city"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            City<sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
                        <div className="md:basis-2/4">
                            <FormControl>
                                <Input
                                    placeholder={pincodeData?.city || "City"}
                                    disabled={true}
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </div>
                        <FormDescription>Example: City name</FormDescription>
                    </FormItem>
                )}
            />

            {/* State */}
            <FormField
                control={form.control}
                name="project_state"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            State<sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
                        <div className="md:basis-2/4">
                            <FormControl>
                                <Input
                                    placeholder={pincodeData?.state || "State"}
                                    disabled={true}
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </div>
                        <FormDescription>Example: State name</FormDescription>
                    </FormItem>
                )}
            />

            {/* Pin Code */}
            <FormField
                control={form.control}
                name="pin"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">
                            Pin Code<sup className="pl-1 text-sm text-red-600">*</sup>
                        </FormLabel>
                        <div className="md:basis-2/4">
                            <FormControl>
                                <Input
                                    type="number"
                                    placeholder="6 digit PIN"
                                    {...field}
                                    onChange={(e) => {
                                        field.onChange(e);
                                        handlePincodeChange(e);
                                    }}
                                />
                            </FormControl>
                            <FormMessage />
                        </div>
                        <FormDescription>Example: 100000</FormDescription>
                    </FormItem>
                )}
            />

            {/* Phone */}
            <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                    <FormItem className="lg:flex lg:items-center gap-4">
                        <FormLabel className="md:basis-2/12">Phone</FormLabel>
                        <div className="md:basis-2/4">
                            <FormControl>
                                <Input type="number" placeholder="Phone" {...field} />
                            </FormControl>
                            <FormMessage />
                        </div>
                        <FormDescription>Example: 90000000000</FormDescription>
                    </FormItem>
                )}
            />

            {/* Email */}
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
                        <FormDescription>Example: abc@mail.com</FormDescription>
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

export default ProjectAddressStep;
