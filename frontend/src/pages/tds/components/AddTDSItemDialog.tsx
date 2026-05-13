import React, { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusCircle, Search, Plus } from "lucide-react";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeUpdateDoc } from "frappe-react-sdk";
import RSelect, { components as RSComponents, MenuListProps } from "react-select";
import { toast } from "@/components/ui/use-toast";
import { TDSItemValues, tdsItemSchema, TDS_STATUS_OPTIONS } from "./types";
import { useTDSItemOptions } from "../hooks/useTDSItemOptions";
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";

// Custom MenuList for the Item Name dropdown — renders the standard MenuList
// plus a sticky "+ Custom Item" footer that opens the CustomItemDialog.
const AddItemMenuList = (props: MenuListProps<any, false>) => {
    const onAdd = (props as any).onAdd;
    return (
        <div>
            <RSComponents.MenuList {...props}>{props.children}</RSComponents.MenuList>
            <button
                type="button"
                onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onAdd?.();
                    (props.selectProps as any).onMenuClose?.();
                }}
                className="w-full text-left px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border-t border-gray-200 sticky bottom-0"
            >
                + Custom Item
            </button>
        </div>
    );
};

interface AddTDSItemDialogProps {
    onSuccess: () => void;
}

// Custom Item Dialog Component
export interface CustomItemDialogProps {
    open: boolean;
    onClose: () => void;
    onSelect: (item: { id: string; name: string; category: string; workPackage: string; isNew: boolean }) => void;
    allCustomItems: Array<{ id: string; name: string; wp: string; cat: string }>;
    standardItems: Array<{ label: string; value: string; category?: string; categoryName?: string }>;
    catList: any[];
    // When true, hides the "Matching Custom" and "Matching Standard" suggestion lists
    // and shows only the search field + "Create New Custom" action. Used by the
    // project-side request dialog where reusing existing items is intentionally
    // blocked — the user is creating a project-only custom and shouldn't be nudged
    // toward the master.
    hideMatches?: boolean;
}

export const CustomItemDialog: React.FC<CustomItemDialogProps> = ({
    open, onClose, onSelect, allCustomItems, standardItems, catList, hideMatches = false
}) => {
    const [searchQuery, setSearchQuery] = useState("");

    // Reset search when opened
    useEffect(() => {
        if (open) setSearchQuery("");
    }, [open]);

    // Filter custom items by search
    const matchingCustom = useMemo(() => {
        if (!searchQuery.trim()) return allCustomItems.slice(0, 5);
        return allCustomItems.filter(item => 
            item.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [allCustomItems, searchQuery]);

    // Filter standard items by search
    const matchingStandard = useMemo(() => {
        if (!searchQuery.trim()) return standardItems.slice(0, 5);
        return standardItems.filter(item => 
            item.label.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [standardItems, searchQuery]);

    const handleSelectCustom = (item: typeof allCustomItems[0]) => {
        onSelect({
            id: item.id,
            name: item.name,
            category: item.cat,
            workPackage: item.wp,
            isNew: false
        });
    };

    const handleSelectStandard = (item: typeof standardItems[0]) => {
        const category = catList?.find(c => c.name === item.category);
        onSelect({
            id: item.value,
            name: item.label,
            category: item.category || "",
            workPackage: category?.work_package || "",
            isNew: false
        });
    };

    const handleCreateNew = () => {
        onSelect({
            id: "",
            name: searchQuery,
            category: "",
            workPackage: "",
            isNew: true
        });
    };

    return (
        <Dialog open={open} onOpenChange={() => { onClose(); setSearchQuery(""); }}>
            <DialogContent className="sm:max-w-[450px] p-0 rounded-xl">
                <DialogHeader className="p-4 pb-2">
                    <DialogTitle className="text-lg font-bold">Custom Item</DialogTitle>
                </DialogHeader>
                <div className="px-4 pb-4 space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Type item name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                            autoFocus
                        />
                    </div>

                    {!hideMatches && (
                        <div className="max-h-[250px] overflow-y-auto space-y-3">
                            {/* Matching Custom Items */}
                            {matchingCustom.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 mb-1">── Matching Custom ──</p>
                                    {matchingCustom.map(item => (
                                        <button
                                            key={item.id}
                                            onClick={() => handleSelectCustom(item)}
                                            className="w-full text-left p-3 bg-yellow-50 border border-yellow-200 hover:bg-yellow-100 rounded-md text-sm flex items-center justify-between transition-colors mb-2"
                                        >
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-yellow-800">[{item.id}] {item.name}</span>
                                                <span className="text-xs text-yellow-600 mt-1">{item.wp} → {item.cat}</span>
                                            </div>
                                            <PlusCircle className="h-5 w-5 text-red-500 drop-shadow-sm hover:text-red-600 transition-transform hover:scale-105" />
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Matching Standard Items */}
                            {matchingStandard.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 mb-1">── Matching Standard ──</p>
                                    {matchingStandard.map(item => (
                                        <button
                                            key={item.value}
                                            onClick={() => handleSelectStandard(item)}
                                            className="w-full text-left p-3 bg-green-50 border border-green-200 hover:bg-green-100 rounded-md text-sm flex items-center justify-between transition-colors mb-2"
                                        >
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-green-800">{item.label}</span>
                                                <span className="text-xs text-green-600 mt-1">({item.categoryName})</span>
                                            </div>
                                            <PlusCircle className="h-5 w-5 text-red-500 drop-shadow-sm hover:text-red-600 transition-transform hover:scale-105" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2 border-t">
                        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                        <Button 
                            size="sm" 
                            onClick={handleCreateNew}
                            disabled={!searchQuery.trim()}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            + Create New Custom
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};



export const AddTDSItemDialog: React.FC<AddTDSItemDialogProps> = ({ onSuccess }) => {
    const [open, setOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);
    const [isCustomMake, setIsCustomMake] = useState(false);
    const [customMake, setCustomMake] = useState("");
    const [customItemDialogOpen, setCustomItemDialogOpen] = useState(false);
    const [isCustomItem, setIsCustomItem] = useState(false);
    const [customItemName, setCustomItemName] = useState("");
    
    const { createDoc, loading: creating } = useFrappeCreateDoc();
    const { upload: uploadFile, loading: uploading } = useFrappeFileUpload();
    const { updateDoc } = useFrappeUpdateDoc();

    const form = useForm<TDSItemValues>({
        resolver: zodResolver(tdsItemSchema),
        defaultValues: {
            work_package: "",
            category: "",
            tds_item_id: "",
            tds_item_name: "",
            is_custom_item: false,
            item_description: "",
            make: "",
            status: "Not Verified",
        },
    });

    const selectedCategory = form.watch("category");
    const watchedTdsItemId = form.watch("tds_item_id");
    const selectedWP = form.watch("work_package");

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

    // Build item options (Custom Item is rendered as a sticky footer, not an option)
    const itemOptionsWithCustom = useMemo(() => {
        const nameCounts = new Map<string, number>();
        itemOptionsForWP.forEach(item => {
            nameCounts.set(item.label, (nameCounts.get(item.label) || 0) + 1);
        });
        return itemOptionsForWP.map(item => ({
            label: item.label,
            value: item.value,
            category: item.category,
            categoryName: item.categoryName,
            showCategory: (nameCounts.get(item.label) || 0) > 1,
        }));
    }, [itemOptionsForWP]);

    // Track previous values
    const prevWPRef = useRef(selectedWP);
    const prevItemRef = useRef(watchedTdsItemId);

    // Reset downstream fields when Work Package changes
    useEffect(() => {
        if (selectedWP !== prevWPRef.current) {
            form.setValue("tds_item_id", "");
            form.setValue("category", "");
            form.setValue("make", "");
            form.setValue("item_description", "");
            form.setValue("tds_item_name", "");
            form.setValue("is_custom_item", false);
            setIsCustomItem(false);
            setCustomItemName("");
            prevWPRef.current = selectedWP;
        }
    }, [selectedWP, form]);

    // Reset Make when Item changes
    useEffect(() => {
        if (watchedTdsItemId !== prevItemRef.current) {
            form.setValue("make", "");
            form.setValue("item_description", "");
            prevItemRef.current = watchedTdsItemId;
        }
    }, [watchedTdsItemId, form]);
    
    // Reset form when dialog closes
    useEffect(() => {
        if (!open) {
            form.reset();
            setSelectedFile(null);
            setFileError(null);
            setIsCustomMake(false);
            setCustomMake("");
            setIsCustomItem(false);
            setCustomItemName("");
        }
    }, [open, form]);

    // Handle item selection
    const handleItemChange = (opt: any) => {
        if (opt?.value === "__custom__") {
            setCustomItemDialogOpen(true);
        }
         else {
            // Standard or Existing Custom Item selected
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

    // Handle custom item dialog selection
    const handleCustomItemSelect = (item: { id: string; name: string; category: string; workPackage: string; isNew: boolean }) => {
        setCustomItemDialogOpen(false);
        
        if (item.isNew) {
            // Creating new custom item
            setIsCustomItem(true);
            setCustomItemName(item.name);
            form.setValue("tds_item_id", "");
            form.setValue("tds_item_name", item.name);
            form.setValue("is_custom_item", true);
            // User needs to select category manually
        } else {
            // Selected existing custom or standard item
            setIsCustomItem(item.id.startsWith("CUS-"));
            setCustomItemName(item.name);
            form.setValue("tds_item_id", item.id);
            form.setValue("tds_item_name", item.name);
            form.setValue("is_custom_item", item.id.startsWith("CUS-"));
            form.setValue("category", item.category);
            
            if (item.workPackage) {
                // Determine if WP is changing
                const currentWP = form.getValues("work_package");
                if (item.workPackage !== currentWP) {
                    // Update ref to prevent useEffect from resetting fields
                    prevWPRef.current = item.workPackage;
                }
                form.setValue("work_package", item.workPackage);
            }
        }
    };

    const onSubmit = async (values: TDSItemValues) => {
        if (!selectedFile) {
            setFileError("Attachment is required");
            return;
        }
        try {
            const docData: any = {
                work_package: values.work_package,
                category: values.category,
                description: values.item_description,
                make: values.make,
                status: values.status,
            };

            // If custom item, send tds_item_name (backend will generate ID)
            if (values.is_custom_item && !values.tds_item_id) {
                docData.tds_item_name = values.tds_item_name;
            } else {
                docData.tds_item_id = values.tds_item_id;
                docData.tds_item_name = values.tds_item_name; // Always send item name for display
            }

            const newDoc = await createDoc("TDS Repository", docData);

            if (newDoc && newDoc.name && selectedFile) {
                const uploadResp = await uploadFile(selectedFile, {
                    doctype: "TDS Repository",
                    docname: newDoc.name,
                    fieldname: "tds_attachment",
                    isPrivate: true
                });

                const responseData = uploadResp as any;
                const fileUrl = responseData?.message?.file_url || responseData?.file_url;
                if (fileUrl) {
                    await updateDoc("TDS Repository", newDoc.name, {
                        tds_attachment: fileUrl
                    });
                }
            }

            form.reset();
            setSelectedFile(null);
            setFileError(null);
            setOpen(false);
            toast({ title: "Success", description: "TDS Item created successfully" });
            onSuccess();
        } catch (e: any) {
            console.error("Error creating TDS Item:", e);
            toast({ title: "Error", description: e?.message || "Failed to create TDS Item", variant: "destructive" });
        }
    };

    // Get display value for item field
    const getItemDisplayValue = () => {
        // If a custom item is selected (either new or existing CUS-*)
        if (isCustomItem && customItemName) {
            // Return the custom item with its actual ID (or placeholder for new items)
            return { 
                label: customItemName, 
                value: watchedTdsItemId || "__new_custom__" 
            };
        }
        // Standard item - find in options
        if (watchedTdsItemId) {
            const option = itemOptionsWithCustom.find(opt => opt.value === watchedTdsItemId);
            return option || null;
        }
        return null;
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="bg-[#dc2626] hover:bg-[#b91c1c] text-white">
                    <PlusCircle className="mr-2 h-4 w-4" /> Add New
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] p-0 rounded-xl border-none max-h-[85vh] flex flex-col">
                <DialogHeader className="p-6 pb-0 flex flex-row items-center justify-between">
                    <div>
                        <DialogTitle className="text-xl font-bold">Add New TDS Item</DialogTitle>
                    </div>
                </DialogHeader>

                <div className="p-6 overflow-y-auto">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            {/* Work Package */}
                            <FormField
                                control={form.control}
                                name="work_package"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Work Package<span className="text-red-500 ml-0.5">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <RSelect
                                                options={wpOptions}
                                                value={wpOptions.find(opt => opt.value === field.value) || null}
                                                onChange={(opt) => field.onChange(opt?.value)}
                                                placeholder="Select Work Package"
                                                className="react-select-container"
                                                classNamePrefix="react-select"
                                            />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                            {/* Category */}
                            <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Category<span className="text-red-500 ml-0.5">*</span>
                                            {!isCustomItem && watchedTdsItemId && selectedCategory && (
                                                <span className="text-xs text-gray-400 ml-2">(auto-filled)</span>
                                            )}
                                        </FormLabel>
                                        <FormControl>
                                            <RSelect
                                                options={catOptions}
                                                value={catOptions.find(opt => opt.value === field.value) || null}
                                                onChange={(opt) => field.onChange(opt?.value)}
                                                placeholder="Select Category"
                                                className="react-select-container"
                                                classNamePrefix="react-select"
                                                isDisabled={!selectedWP || (!isCustomItem && !!watchedTdsItemId)}
                                            />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                            {/* Item Name */}
                            <FormField
                                control={form.control}
                                name="tds_item_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Item Name<span className="text-red-500 ml-0.5">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            {isCustomItem ? (
                                                <div className="flex items-center justify-between p-2 border rounded-md bg-yellow-50 border-yellow-200">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-semibold text-yellow-800">
                                                            {customItemName}
                                                        </span>
                                                        <span className="text-xs text-yellow-600">
                                                            ID: {field.value}
                                                        </span>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-yellow-700 hover:text-yellow-900 hover:bg-yellow-100 h-8 px-2 text-xs"
                                                        onClick={() => setCustomItemDialogOpen(true)}
                                                    >
                                                        Edit / Change
                                                    </Button>
                                                </div>
                                            ) : (
                                                <FuzzySearchSelect
                                                    allOptions={itemOptionsWithCustom}
                                                    tokenSearchConfig={{
                                                        searchFields: ['label', 'value', 'categoryName'],
                                                        minSearchLength: 1,
                                                        partialMatch: true,
                                                        minTokenLength: 1,
                                                        fieldWeights: { label: 2.0, value: 1.5, categoryName: 1.0 },
                                                        minTokenMatches: 1,
                                                    }}
                                                    value={getItemDisplayValue()}
                                                    onChange={handleItemChange as any}
                                                    placeholder="Search Item Name..."
                                                    className="react-select-container"
                                                    classNamePrefix="react-select"
                                                    isDisabled={!selectedWP}
                                                    isClearable
                                                    customMenuListComponent={AddItemMenuList as any}
                                                    customMenuListProps={{
                                                        onAdd: () => handleItemChange({ value: "__custom__" }),
                                                    }}
                                                    formatOptionLabel={(option: any) => (
                                                        <span>
                                                            {option.label}
                                                            {option.showCategory && option.categoryName && (
                                                                <span className="text-blue-600 ml-1">({option.categoryName})</span>
                                                            )}
                                                        </span>
                                                    )}
                                                />
                                            )}
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                             {/* Make */}
                            <FormField
                                control={form.control}
                                name="make"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Make<span className="text-red-500 ml-0.5">*</span>
                                        </FormLabel>
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
                                                        className="bg-white border-gray-200"
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
                                                        className="text-xs text-gray-500 hover:text-gray-700 h-6 px-2"
                                                    >
                                                        ← Back to Make list
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
                                                            field.onChange(opt?.value);
                                                        }
                                                    }}
                                                    placeholder="Select Make"
                                                    className="react-select-container"
                                                    classNamePrefix="react-select"
                                                    isDisabled={!selectedCategory}
                                                    filterOption={(option, inputValue) => {
                                                        if (option.data.value === "__others__") return true;
                                                        return option.label.toLowerCase().includes(inputValue.toLowerCase());
                                                    }}
                                                    styles={{
                                                        option: (base, state) => ({
                                                            ...base,
                                                            ...(state.data.value === "__others__" ? {
                                                                backgroundColor: state.isFocused ? '#dbeafe' : '#eff6ff',
                                                                color: '#2563eb',
                                                                fontWeight: 600,
                                                                borderTop: '1px solid #e5e7eb',
                                                            } : {})
                                                        }),
                                                    }}
                                                    formatOptionLabel={(option) => (
                                                        option.value === "__others__" ? (
                                                            <span className="flex items-center gap-1">
                                                                <span>+ Others</span>
                                                                <span className="text-xs text-blue-400">(type custom)</span>
                                                            </span>
                                                        ) : option.label
                                                    )}
                                                />
                                            )}
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                            {/* Status */}
                            <FormField
                                control={form.control}
                                name="status"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Status<span className="text-red-500 ml-0.5">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <RSelect
                                                options={TDS_STATUS_OPTIONS.map(s => ({ label: s, value: s }))}
                                                value={field.value ? { label: field.value, value: field.value } : null}
                                                onChange={(opt) => field.onChange(opt?.value)}
                                                placeholder="Select Status"
                                                className="react-select-container"
                                                classNamePrefix="react-select"
                                            />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                            {/* Item Description */}
                            <FormField
                                control={form.control}
                                name="item_description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Item Description <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Textarea placeholder="Type Description" {...field} className="bg-white border-gray-200 focus:ring-1 focus:ring-gray-300 min-h-[100px]" />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                            {/* Attach Document */}
                            <div className="space-y-1.5">
                                <label className="text-sm font-semibold">
                                    Attach Document<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <CustomAttachment
                                    maxFileSize={50 * 1024 * 1024}
                                    selectedFile={selectedFile}
                                    onFileSelect={(file) => {
                                        setSelectedFile(file);
                                        if (file) setFileError(null);
                                    }}
                                    acceptedTypes="application/pdf"
                                    label="Upload PDF Document"
                                    className="w-full"
                                />
                                {fileError && (
                                    <p className="text-xs font-medium text-red-500">{fileError}</p>
                                )}
                            </div>

                            <DialogFooter className="pt-4 border-t border-gray-100 gap-2 sm:gap-0">
                                <Button type="button" variant="outline" onClick={() => setOpen(false)} className="bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100">
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={creating || uploading} className="bg-[#dc2626] hover:bg-[#b91c1c] text-white">
                                    {creating || uploading ? "Saving..." : "Save"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </div>
            </DialogContent>

            {/* Custom Item Dialog */}
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
