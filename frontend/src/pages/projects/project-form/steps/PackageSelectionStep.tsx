import { useState } from "react";
import { UseFormReturn, Controller } from "react-hook-form";
import ReactSelect from "react-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { ProjectFormValues } from "../schema";
import { ProjectFormData, WorkPackageType } from "../hooks/useProjectFormData";
import { WorkPackage } from "@/types/NirmaanStack/Projects";

interface PackageSelectionStepProps {
    form: UseFormReturn<ProjectFormValues>;
    formData: ProjectFormData;
    onNext: () => void;
    onPrevious: () => void;
}

export const PackageSelectionStep: React.FC<PackageSelectionStepProps> = ({
    form,
    formData,
    onNext,
    onPrevious,
}) => {
    const { workPackages, categories, categoryMakeList, isPackageDataLoading } = formData;
    const [openValue, setOpenValue] = useState<string | null>(null);

    const selectedWorkPackages: WorkPackage[] = form.watch("project_work_packages.work_packages");

    const handleSelectAll = (checked: boolean) => {
        if (checked && categories) {
            const allWorkPackages = categories.reduce((acc: WorkPackage[], category) => {
                const existingPackage = acc.find(
                    (wp) => wp?.work_package_name === category.work_package
                );
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

    const handleSelectMake = (
        workPackageName: string,
        categoryName: string,
        selectedMakes: { label: string; value: string }[]
    ) => {
        const updatedWorkPackages = [...selectedWorkPackages];

        let workPackage = updatedWorkPackages.find(
            (wp) => wp.work_package_name === workPackageName
        );

        if (!workPackage) {
            const associatedCategories =
                categories
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

        const category = workPackage.category_list.list.find(
            (cat) => cat.name === categoryName
        );

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

    if (isPackageDataLoading) {
        return <div>Loading...</div>;
    }

    return (
        <>
            <p className="text-sky-600 font-semibold">Package Specification</p>

            <FormField
                control={form.control}
                name="project_work_packages"
                render={() => (
                    <FormItem>
                        <div className="mb-4">
                            <FormLabel className="text-base flex">
                                Work Package Selection
                                <sup className="pl-1 text-sm text-red-600">*</sup>
                            </FormLabel>
                        </div>

                        <Checkbox className="mr-3" onCheckedChange={handleSelectAll} />
                        <span className="text-sm text-red-600 font-bold">Select All</span>

                        <Separator />
                        <Separator />

                        {workPackages?.map((item: WorkPackageType) => (
                            <Accordion
                                key={item.work_package_name}
                                type="single"
                                collapsible
                                value={openValue || undefined}
                                onValueChange={(value) => setOpenValue(value)}
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
                                                            checked={field.value?.some(
                                                                (i) =>
                                                                    i.work_package_name ===
                                                                    item.work_package_name
                                                            )}
                                                            onCheckedChange={(checked) => {
                                                                const updatedCategories = categories
                                                                    ?.filter(
                                                                        (cat) =>
                                                                            cat.work_package ===
                                                                            item.work_package_name
                                                                    )
                                                                    .map((cat) => ({
                                                                        name: cat.category_name,
                                                                        makes: [],
                                                                    }));

                                                                const updatedWorkPackages = checked
                                                                    ? [
                                                                          ...field.value,
                                                                          {
                                                                              work_package_name:
                                                                                  item.work_package_name,
                                                                              category_list: {
                                                                                  list: updatedCategories,
                                                                              },
                                                                          },
                                                                      ]
                                                                    : field.value.filter(
                                                                          (wp) =>
                                                                              wp.work_package_name !==
                                                                              item.work_package_name
                                                                      );

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
                                        {categories
                                            ?.filter(
                                                (cat) => cat.work_package === item.work_package_name
                                            )
                                            ?.map((cat) => {
                                                const categoryMakeOptions = categoryMakeList?.filter(
                                                    (make) => make.category === cat.name
                                                );
                                                const makeOptions = categoryMakeOptions?.map(
                                                    (make) => ({
                                                        label: make.make,
                                                        value: make.make,
                                                    })
                                                );

                                                const selectedMakes =
                                                    selectedWorkPackages
                                                        .find(
                                                            (wp) =>
                                                                wp.work_package_name ===
                                                                item.work_package_name
                                                        )
                                                        ?.category_list.list.find(
                                                            (c) => c.name === cat.category_name
                                                        )?.makes || [];

                                                return (
                                                    <div key={cat.name}>
                                                        <Separator />
                                                        <FormItem className="flex gap-4 items-center p-3">
                                                            <FormLabel className="w-[30%]">
                                                                {cat.category_name}
                                                            </FormLabel>
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
                                                                            handleSelectMake(
                                                                                item.work_package_name,
                                                                                cat.category_name,
                                                                                selected as {
                                                                                    label: string;
                                                                                    value: string;
                                                                                }[]
                                                                            )
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

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <Button
                    type="button"
                    variant="ghost"
                    onClick={onPrevious}
                    className="text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                >
                    ← Previous
                </Button>
                <Button
                    type="button"
                    onClick={onNext}
                    className="bg-sky-500 hover:bg-sky-600 text-white px-6"
                >
                    Continue →
                </Button>
            </div>
        </>
    );
};

export default PackageSelectionStep;
