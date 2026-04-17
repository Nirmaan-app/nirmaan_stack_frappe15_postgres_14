import React, { useState, useEffect, useMemo, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import RSelect from "react-select";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { useTDSItemOptions } from "@/pages/tds/hooks/useTDSItemOptions";
import { CustomItemDialog } from "@/pages/tds/components/AddTDSItemDialog";

const formSchema = z.object({
    work_package: z.string().min(1, "Work Package is required"),
    category: z.string().min(1, "Category is required"),
    tds_item_id: z.string().optional(),
    tds_item_name: z.string().optional(),
    is_custom_item: z.boolean().optional(),
    make: z.string().min(1, "Make is required"),
    boq_ref: z.string().optional(),
    description: z.string().optional(),
});

interface RequestTdsItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAddItem: (item: any) => void;
}

export const RequestTdsItemDialog: React.FC<RequestTdsItemDialogProps> = ({ open, onOpenChange, onAddItem }) => {
    const [isCustomMake, setIsCustomMake] = useState(false);
    const [customMake, setCustomMake] = useState("");
    const [customItemDialogOpen, setCustomItemDialogOpen] = useState(false);
    const [isCustomItem, setIsCustomItem] = useState(false);
    const [customItemName, setCustomItemName] = useState("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            work_package: "",
            category: "",
            tds_item_id: "",
            tds_item_name: "",
            is_custom_item: false,
            make: "",
            boq_ref: "",
            description: "",
        },
    });

    const selectedWP = useWatch({ control: form.control, name: "work_package" });
    const selectedCategory = useWatch({ control: form.control, name: "category" });
    const watchedTdsItemId = useWatch({ control: form.control, name: "tds_item_id" });

    const { 
        wpOptions, 
        catOptions, 
        itemOptionsForWP,
        makeOptions,
        allCustomItems,
        getCategoryForItem,
        catList
    } = useTDSItemOptions({
        selectedWP,
        selectedCategory,
        watchedTdsItemId
    });

    const itemOptionsWithCustom = useMemo(() => {
        const standardItems = itemOptionsForWP.map(item => ({
            label: item.label,
            value: item.value,
            category: item.category,
            categoryName: item.categoryName
        }));

        return [...standardItems, { label: "+ Custom Item", value: "__custom__", category: "", categoryName: "" }];
    }, [itemOptionsForWP]);

    const prevWPRef = useRef(selectedWP);
    const prevItemRef = useRef(watchedTdsItemId);

    useEffect(() => {
        if (selectedWP !== prevWPRef.current) {
            form.setValue("tds_item_id", "");
            form.setValue("category", "");
            form.setValue("make", "");
            form.setValue("description", "");
            form.setValue("tds_item_name", "");
            form.setValue("is_custom_item", false);
            setIsCustomItem(false);
            setCustomItemName("");
            prevWPRef.current = selectedWP;
        }
    }, [selectedWP, form]);

    useEffect(() => {
        if (watchedTdsItemId !== prevItemRef.current) {
            form.setValue("make", "");
            form.setValue("description", "");
            prevItemRef.current = watchedTdsItemId;
        }
    }, [watchedTdsItemId, form]);

    const handleItemChange = (opt: any) => {
        if (opt?.value === "__custom__") {
            setCustomItemDialogOpen(true);
        } else {
            const isCustom = opt?.value?.startsWith("CUS-");
            const itemInfo = getCategoryForItem(opt?.value);
            
            if (itemInfo) {
                form.setValue("category", itemInfo.category);
                if (itemInfo.workPackage && itemInfo.workPackage !== form.getValues("work_package")) {
                     prevWPRef.current = itemInfo.workPackage;
                     form.setValue("work_package", itemInfo.workPackage);
                }
            }
            
            form.setValue("tds_item_id", opt?.value);
            form.setValue("tds_item_name", opt?.label || "");
            setIsCustomItem(isCustom);
            setCustomItemName(isCustom ? (opt?.label || "") : "");
            form.setValue("is_custom_item", isCustom);
        }
    };

    const handleCustomItemSelect = (item: { id: string; name: string; category: string; workPackage: string; isNew: boolean }) => {
        setCustomItemDialogOpen(false);
        if (item.isNew) {
            setIsCustomItem(true);
            setCustomItemName(item.name);
            form.setValue("tds_item_id", "");
            form.setValue("tds_item_name", item.name);
            form.setValue("is_custom_item", true);
        } else {
            setIsCustomItem(item.id.startsWith("CUS-"));
            setCustomItemName(item.name);
            form.setValue("tds_item_id", item.id);
            form.setValue("tds_item_name", item.name);
            form.setValue("is_custom_item", item.id.startsWith("CUS-"));
            form.setValue("category", item.category);
            
            if (item.workPackage) {
                if (item.workPackage !== form.getValues("work_package")) {
                    prevWPRef.current = item.workPackage;
                }
                form.setValue("work_package", item.workPackage);
            }
        }
    };

    const getItemDisplayValue = () => {
        if (isCustomItem && customItemName) {
            return { label: customItemName, value: watchedTdsItemId || "__new_custom__" };
        }
        if (watchedTdsItemId) {
            const option = itemOptionsWithCustom.find(opt => opt.value === watchedTdsItemId);
            return option || null;
        }
        return null;
    };

    const onSubmit = (values: z.infer<typeof formSchema>) => {
        onAddItem({
            tds_item_name: values.tds_item_name,
            tds_item_id: values.tds_item_id,
            make: values.make,
            work_package: values.work_package,
            category: values.category,
            description: values.description || "",
            tds_boq_line_item: values.boq_ref || "",
            attachmentFile: selectedFile,
            is_new_request: true, // All items from this dialog are considered new requests
        });
        onOpenChange(false);
        form.reset();
        setIsCustomMake(false);
        setCustomMake("");
        setIsCustomItem(false);
        setCustomItemName("");
        setSelectedFile(null);
    };

    const handleCancel = () => {
        onOpenChange(false);
        form.reset();
        setIsCustomMake(false);
        setCustomMake("");
        setIsCustomItem(false);
        setCustomItemName("");
        setSelectedFile(null);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[450px] p-0 rounded-xl border-none max-h-[90vh] flex flex-col overflow-hidden shadow-2xl bg-white">
                <DialogHeader className="p-6 pb-2 border-b border-gray-50">
                    <DialogTitle className="text-xl font-bold tracking-tight">Add New TDS Item</DialogTitle>
                </DialogHeader>

                <div className="p-6 py-4 overflow-y-auto flex-1 custom-scrollbar">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            {/* Work Package */}
                            <FormField
                                control={form.control}
                                name="work_package"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="text-sm font-bold text-gray-700">Work Package<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                        <FormControl>
                                            <RSelect
                                                options={wpOptions}
                                                value={wpOptions.find(opt => opt.value === field.value) || null}
                                                onChange={(opt) => field.onChange(opt?.value || "")}
                                                placeholder="Select Work Package"
                                                classNamePrefix="react-select"
                                                styles={{
                                                    control: (base) => ({ ...base, minHeight: '44px', borderRadius: '8px', borderColor: '#e5e7eb' })
                                                }}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Item Name */}
                            <FormField
                                control={form.control}
                                name="tds_item_id"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="text-sm font-bold text-gray-700">Item Name<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                        <FormControl>
                                            {isCustomItem ? (
                                                <div className="flex items-center justify-between p-3 border rounded-lg bg-orange-50 border-orange-200 shadow-sm transition-all hover:shadow-md">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-semibold text-orange-900 leading-tight">{customItemName}</span>
                                                        <span className="text-[10px] text-orange-600 font-black uppercase tracking-widest mt-0.5">Custom Item</span>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-orange-700 hover:text-orange-900 hover:bg-orange-100 h-8 px-3 text-xs font-bold"
                                                        onClick={() => setCustomItemDialogOpen(true)}
                                                    >
                                                        Change
                                                    </Button>
                                                </div>
                                            ) : (
                                                <RSelect
                                                    options={itemOptionsWithCustom}
                                                    value={getItemDisplayValue()}
                                                    onChange={handleItemChange}
                                                    placeholder="Select Item"
                                                    classNamePrefix="react-select"
                                                    isDisabled={!selectedWP}
                                                    styles={{
                                                        control: (base) => ({ ...base, minHeight: '44px', borderRadius: '8px', borderColor: '#e5e7eb' })
                                                    }}
                                                    formatOptionLabel={(option) => (
                                                        option.value === "__custom__" ? (
                                                            <span className="text-blue-600 font-black tracking-tight flex items-center gap-1">
                                                                <span className="text-lg">+</span> Custom Item
                                                            </span>
                                                        ) : option.label
                                                    )}
                                                />
                                            )}
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Category */}
                            <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="text-sm font-bold text-gray-700">Category<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                        <FormControl>
                                            <RSelect
                                                options={catOptions}
                                                value={catOptions.find(opt => opt.value === field.value) || null}
                                                onChange={(opt) => field.onChange(opt?.value || "")}
                                                placeholder={isCustomItem ? "Select category" : "Auto-filled from item"}
                                                isDisabled={!isCustomItem && !!selectedCategory}
                                                classNamePrefix="react-select"
                                                styles={{
                                                    control: (base) => ({ ...base, minHeight: '44px', borderRadius: '8px', borderColor: '#e5e7eb' })
                                                }}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Make */}
                            <FormField
                                control={form.control}
                                name="make"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="text-sm font-bold text-gray-700">Make<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                        <FormControl>
                                            {isCustomMake ? (
                                                <div className="space-y-2">
                                                    <Input
                                                        placeholder="Enter custom make name"
                                                        value={customMake}
                                                        onChange={(e) => {
                                                            setCustomMake(e.target.value);
                                                            field.onChange(e.target.value);
                                                        }}
                                                        className="h-11 border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-100 transition-all font-medium"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setIsCustomMake(false);
                                                            setCustomMake("");
                                                            field.onChange("");
                                                        }}
                                                        className="text-xs text-blue-600 hover:text-blue-700 h-6 px-2 font-black tracking-tight"
                                                    >
                                                        ← BACK TO LIST
                                                    </Button>
                                                </div>
                                            ) : (
                                                <RSelect
                                                    options={makeOptions}
                                                    value={makeOptions.find(opt => opt.value === field.value) || null}
                                                    onChange={(opt) => {
                                                        if (opt?.value === "__others__") {
                                                            setIsCustomMake(true);
                                                            setCustomMake("");
                                                            field.onChange("");
                                                        } else {
                                                            field.onChange(opt?.value || "");
                                                        }
                                                    }}
                                                    placeholder="Select Make"
                                                    isDisabled={!selectedCategory}
                                                    classNamePrefix="react-select"
                                                    styles={{
                                                        control: (base) => ({ ...base, minHeight: '44px', borderRadius: '8px', borderColor: '#e5e7eb' }),
                                                        option: (base, state: any) => ({
                                                            ...base,
                                                            ...(state.data.value === "__others__" ? {
                                                                backgroundColor: state.isFocused ? '#eff6ff' : '#f8fafc',
                                                                color: '#2563eb',
                                                                fontWeight: 800,
                                                                borderTop: '1px solid #f1f5f9',
                                                                letterSpacing: '-0.025em'
                                                            } : {})
                                                        }),
                                                    }}
                                                    formatOptionLabel={(option) => (
                                                        option.value === "__others__" ? (
                                                            <span className="flex items-center gap-1 uppercase text-xs font-black">
                                                                <span>+ OTHERS</span>
                                                            </span>
                                                        ) : option.label
                                                    )}
                                                />
                                            )}
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* TDS BOQ Line Item */}
                            <FormField
                                control={form.control}
                                name="boq_ref"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="text-sm font-bold text-gray-700 tracking-tight">TDS BOQ Line Item</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="Enter BOQ Line Item" className="h-11 border-gray-200 rounded-lg bg-gray-50/30 focus:bg-white transition-all font-medium" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Item Description */}
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="text-sm font-bold text-gray-700 tracking-tight">Item Description <span className="text-gray-400 font-normal ml-0.5">(Optional)</span></FormLabel>
                                        <FormControl>
                                            <Textarea {...field} placeholder="Type Description" rows={3} className="border-gray-200 rounded-lg bg-gray-50/30 focus:bg-white transition-all resize-none custom-scrollbar" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Attach Document */}
                            <div className="space-y-1.5 mt-2">
                                <FormLabel className="text-sm font-bold text-gray-700 tracking-tight">Attach Document <span className="text-gray-400 font-normal ml-0.5">(Optional)</span></FormLabel>
                                <CustomAttachment
                                    selectedFile={selectedFile}
                                    onFileSelect={setSelectedFile}
                                    acceptedTypes="application/pdf"
                                    label="Upload PDF Document"
                                    maxFileSize={50 * 1024 * 1024}
                                    className="w-full"
                                />
                            </div>

                            <div className="flex bg-gray-50 -mx-6 -mb-6 p-4 px-6 border-t border-gray-100 gap-3 justify-end items-center mt-6">
                                <Button type="button" variant="ghost" onClick={handleCancel} className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 h-10 px-6 font-bold tracking-tight rounded-lg transition-colors">
                                    Cancel
                                </Button>
                                <Button type="submit" className="bg-[#cc4444] hover:bg-red-700 text-white h-10 px-10 font-black tracking-tight rounded-lg shadow-lg shadow-red-100 transform transition-transform active:scale-95">
                                    Save
                                </Button>
                            </div>
                        </form>
                    </Form>
                </div>
            </DialogContent>

            <CustomItemDialog
                open={customItemDialogOpen}
                onClose={() => setCustomItemDialogOpen(false)}
                onSelect={handleCustomItemSelect}
                allCustomItems={allCustomItems}
                standardItems={itemOptionsForWP}
                catList={catList || []}
            />
        </Dialog>
    );
};
