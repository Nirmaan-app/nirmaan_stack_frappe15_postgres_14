import React, { useState, useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import { toast } from "@/components/ui/use-toast";
import { AlertCircle, Layers, ListChecks } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ReactSelect from "react-select";
import { getSelectStyles } from "@/config/selectTheme";
import { SRFormValues, ServiceItemType, createServiceItem } from "../schema";
import { WOServiceItem } from "../hooks/useSRFormData";
import { PackageOption, ServiceItemKind, groupItemsByPackage, orderPackageOptions } from "../utils";
import { ApprovedServicesPicker } from "../components/ApprovedServicesPicker";
import {
    CustomServiceDraft,
    CustomServiceForm,
    EMPTY_CUSTOM_DRAFT,
    isCustomDraftReady,
} from "../components/CustomServiceForm";
import { SelectedServiceItemsTable } from "../components/SelectedServiceItemsTable";

interface CategoryOption {
    value: string;
    label: string;
    image_url?: string;
}

interface StepProps {
    form: UseFormReturn<SRFormValues>;
    /** Packages that have ≥1 WO Service Item (Approved and Custom both offered) */
    categories: CategoryOption[];
    /** Packages with no rate-card items (Custom only) — same alphabetical picker list */
    emptyCategories: CategoryOption[];
    serviceItems: WOServiceItem[];
    isLoading?: boolean;
    /** Allow a negative rate / total. Set true only in amend flows. */
    allowNegative?: boolean;
}

/**
 * ServiceItemsStep - Step 1 of SR Wizard
 *
 * Pick a package, then a Service Type:
 * - Approved Service: tick services from the package's rate card
 * - Custom Service: type in a service that is not in the rate card
 * Everything added, of either kind, lands in the one Selected Service Items
 * table below, and the package resets for the next pick.
 */
export const ServiceItemsStep: React.FC<StepProps> = ({
    form,
    categories,
    emptyCategories,
    serviceItems,
    isLoading,
    allowNegative = false,
}) => {
    const [selectedCategory, setSelectedCategory] = useState<string>("");
    const [serviceType, setServiceType] = useState<ServiceItemKind>("approved");
    const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
    const [customDraft, setCustomDraft] = useState<CustomServiceDraft>(EMPTY_CUSTOM_DRAFT);
    const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
    const [deletePackageName, setDeletePackageName] = useState<string | null>(null);

    const items = form.watch("items") || [];

    const packageOptions = useMemo(
        () => orderPackageOptions(categories, emptyCategories),
        [categories, emptyCategories],
    );
    const selectedPackage = packageOptions.find((p) => p.value === selectedCategory);

    // Rate-card services of the selected package that are not added yet
    const availableStandardItems = useMemo(() => {
        if (!selectedCategory || !serviceItems) return [];
        const addedDescriptions = new Set(items.map((i) => i.description));
        return serviceItems.filter(
            (item) => item.category_link === selectedCategory && !addedDescriptions.has(item.item_name)
        );
    }, [selectedCategory, serviceItems, items]);

    const selectedGroups = useMemo(() => groupItemsByPackage(items), [items]);

    // Grouped validation errors for the summary under the table
    const groupedErrors = useMemo(() => {
        if (form.formState.submitCount === 0 || !form.formState.errors.items || !Array.isArray(form.formState.errors.items)) {
            return null;
        }

        const groups: Record<string, Array<{ name: string; errs: string[] }>> = {};
        const itms = form.getValues("items") || [];

        (form.formState.errors.items as any[]).forEach((err, index) => {
            if (!err) return;
            const item = itms[index];
            if (!item) return;

            const itemErrors: string[] = [];
            if (err.quantity) itemErrors.push("Quantity");
            if (err.rate) itemErrors.push("Rate");

            if (itemErrors.length > 0) {
                if (!groups[item.category]) {
                    groups[item.category] = [];
                }
                groups[item.category].push({
                    name: item.description.split('\n')[0],
                    errs: itemErrors
                });
            }
        });

        return Object.keys(groups).length > 0 ? groups : null;
    }, [form.formState.errors.items, form.formState.submitCount]);

    const hasFieldError = (index: number, field: "quantity" | "rate") =>
        form.formState.submitCount > 0 && !!(form.formState.errors.items as any)?.[index]?.[field];

    // Each pick starts on Approved; a package with no rate-card services can only take custom ones.
    const handlePackageChange = (value: string) => {
        const hasItems = packageOptions.find((p) => p.value === value)?.hasItems ?? false;
        setServiceType(hasItems ? "approved" : "custom");
        setSelectedCategory(value);
        setCheckedItems(new Set());
    };

    // After an add the package resets, which hides the Service Type choice until the next pick.
    const resetPackage = () => {
        setSelectedCategory("");
        setCheckedItems(new Set());
    };

    const handleToggleChecked = (itemName: string) => {
        setCheckedItems((prev) => {
            const next = new Set(prev);
            if (next.has(itemName)) next.delete(itemName);
            else next.add(itemName);
            return next;
        });
    };

    // Add ticked rate-card services, then reset the package.
    const handleAddStandardItems = () => {
        const selectedDocs = serviceItems.filter((item) => checkedItems.has(item.name));

        const newItems = selectedDocs.map((doc) =>
            createServiceItem(
                selectedCategory,
                doc.item_name,
                doc.unit || "",
                0,
                undefined,
                doc.rate || 0, // standard_rate from rate card → marks this as a standard item
            )
        );

        form.setValue("items", [...items, ...newItems]);
        resetPackage();
        toast({
            title: "Items Added",
            description: `Added ${newItems.length} standard items to the list.`,
        });
    };

    // Add the typed custom service to the selected package, then reset the package.
    const handleAddCustomItem = () => {
        if (!selectedCategory || !isCustomDraftReady(customDraft, allowNegative)) return;

        const newItem = createServiceItem(
            selectedCategory,
            customDraft.description.trim(),
            customDraft.uom.trim(),
            customDraft.quantity,
            customDraft.rate,
            undefined, // standard_rate undefined → marks this as a custom item
        );

        form.setValue("items", [...items, newItem]);
        setCustomDraft(EMPTY_CUSTOM_DRAFT);
        resetPackage();
    };

    const handleDeleteItem = () => {
        if (!deleteItemId) return;
        form.setValue("items", items.filter((item) => item.id !== deleteItemId));
        setDeleteItemId(null);
    };

    // Delete package (all items in category, approved and custom)
    const handleDeletePackage = () => {
        if (!deletePackageName) return;
        form.setValue("items", items.filter((item) => item.category !== deletePackageName));
        setDeletePackageName(null);
        toast({
            title: "Package Removed",
            description: `All items from package "${deletePackageName}" have been removed.`,
        });
    };

    const updateItemField = (index: number, field: keyof ServiceItemType, value: ServiceItemType[keyof ServiceItemType]) => {
        const updatedItems = [...items];
        updatedItems[index] = { ...updatedItems[index], [field]: value };
        form.setValue("items", updatedItems);
    };

    const approvedDisabled = !selectedPackage?.hasItems;
    const packageLabel = selectedPackage?.label ?? selectedCategory;

    const typeOptions: Array<{ kind: ServiceItemKind; title: string; subtitle: string; disabled: boolean }> = [
        {
            kind: "approved",
            title: "List of Approved Services",
            subtitle: approvedDisabled
                ? "No rate-card services in this package"
                : `From rate card · ${availableStandardItems.length} available`,
            disabled: approvedDisabled,
        },
        { kind: "custom", title: "Custom Service", subtitle: "Not in the rate card", disabled: false },
    ];

    return (
        <div className="space-y-6">
            {/* Package Selection */}
            <div className="w-full md:w-1/2 space-y-2">
                <Label htmlFor="category" className="text-sm font-semibold flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    Select Package <span className="text-red-500">*</span>
                </Label>
                <ReactSelect<PackageOption>
                    inputId="category"
                    value={selectedPackage ?? null}
                    options={packageOptions}
                    onChange={(opt) => (opt ? handlePackageChange(opt.value) : resetPackage())}
                    placeholder="Search or select package"
                    noOptionsMessage={() => "No matching package"}
                    isClearable
                    isLoading={isLoading}
                    isDisabled={isLoading}
                    styles={getSelectStyles<PackageOption>()}
                    classNamePrefix="react-select"
                />
            </div>

            {/* Service Type + its input area — shown once a package is picked */}
            {selectedCategory && (
                <div className="space-y-5">
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold">
                            Service Type <span className="text-red-500">*</span>
                        </Label>
                        <RadioGroup
                            value={serviceType}
                            onValueChange={(v) => setServiceType(v as ServiceItemKind)}
                            className="grid grid-cols-1 md:grid-cols-2 gap-3"
                        >
                            {typeOptions.map((opt) => {
                                const checked = serviceType === opt.kind;
                                const radioId = `service-type-${opt.kind}`;
                                return (
                                    <Label
                                        key={opt.kind}
                                        htmlFor={radioId}
                                        className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${opt.disabled
                                            ? "cursor-not-allowed opacity-60 border-slate-200 bg-slate-50"
                                            : checked
                                                ? "cursor-pointer border-primary/40 bg-primary/5"
                                                : "cursor-pointer border-slate-200 bg-white hover:border-slate-300"
                                            }`}
                                    >
                                        <RadioGroupItem id={radioId} value={opt.kind} disabled={opt.disabled} className="mt-0.5" />
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-slate-900">{opt.title}</div>
                                            <div className="text-xs font-normal text-muted-foreground mt-0.5">{opt.subtitle}</div>
                                        </div>
                                    </Label>
                                );
                            })}
                        </RadioGroup>
                    </div>

                    {serviceType === "approved" && !approvedDisabled ? (
                        <ApprovedServicesPicker
                            packageLabel={packageLabel}
                            items={availableStandardItems}
                            checked={checkedItems}
                            onToggle={handleToggleChecked}
                            onToggleAll={(checkAll) =>
                                setCheckedItems(checkAll ? new Set(availableStandardItems.map((i) => i.name)) : new Set())
                            }
                            onAdd={handleAddStandardItems}
                        />
                    ) : (
                        <CustomServiceForm
                            packageLabel={packageLabel}
                            draft={customDraft}
                            onChange={setCustomDraft}
                            onAdd={handleAddCustomItem}
                            allowNegative={allowNegative}
                        />
                    )}
                </div>
            )}

            {/* Selected Service Items — one list for both service types */}
            <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between border-b pb-2">
                    <Label className="text-sm font-semibold flex items-center gap-2">
                        <ListChecks className="h-4 w-4 text-primary" />
                        Selected Service Items
                    </Label>
                    <span className="text-xs font-medium bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                        {items.length} item{items.length !== 1 ? "s" : ""}
                    </span>
                </div>
                <SelectedServiceItemsTable
                    groups={selectedGroups}
                    onUpdate={updateItemField}
                    onDeleteItem={setDeleteItemId}
                    onDeletePackage={setDeletePackageName}
                    hasError={hasFieldError}
                />
            </div>

            {/* Detailed Validation Summary (Grouped by Package) */}
            {groupedErrors && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                        <div className="space-y-3 w-full">
                            <div>
                                <p className="text-sm font-bold text-red-800">Required fields missing in the following items:</p>
                                <p className="text-[10px] text-red-600/80 font-medium">Please enter the negotiated rates and quantities for each highlighted row.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {Object.entries(groupedErrors).map(([pkg, errItems]) => (
                                    <div key={pkg} className="bg-white/50 border border-red-100 rounded p-2 space-y-1.5">
                                        <div className="flex items-center gap-1.5 border-b border-red-100 pb-1 mb-1">
                                            <Layers className="h-3 w-3 text-red-400" />
                                            <span className="text-[10px] font-bold text-red-900 uppercase tracking-tight">{pkg}</span>
                                        </div>
                                        <ul className="space-y-1">
                                            {errItems.map((item, idx) => (
                                                <li key={idx} className="flex items-start justify-between gap-2 text-[11px]">
                                                    <span className="text-red-700 font-medium line-clamp-1 flex-1">• {item.name}</span>
                                                    <div className="flex gap-1 shrink-0">
                                                        {item.errs.map(type => (
                                                            <span key={type} className="bg-red-100 text-[9px] text-red-600 px-1 rounded font-bold uppercase">
                                                                {type}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={!!deleteItemId} onOpenChange={() => setDeleteItemId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Item?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to remove this service item? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteItem}
                            className="bg-red-500 hover:bg-red-600"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Package Delete Confirmation Dialog */}
            <AlertDialog open={!!deletePackageName} onOpenChange={() => setDeletePackageName(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove All Package Items?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-600">
                            If you proceed, all selected items from the package <span className="font-bold text-foreground">"{deletePackageName}"</span> will be removed from your selected list.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep Items</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeletePackage}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            Confirm Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

        </div>
    );
};

export default ServiceItemsStep;
