import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeFileUpload, useFrappeUpdateDoc } from "frappe-react-sdk";
import RSelect from "react-select";
import { toast } from "@/components/ui/use-toast";
import { TDSItem, TDSItemValues, tdsItemSchema } from "./types";
import { useTDSItemOptions } from "../hooks/useTDSItemOptions";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";

interface EditTDSItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: TDSItem | null;
    onSuccess: () => void;
}

export const EditTDSItemDialog: React.FC<EditTDSItemDialogProps> = ({ open, onOpenChange, item, onSuccess }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isCustomMake, setIsCustomMake] = useState(false);
    const [customMake, setCustomMake] = useState("");
    const [customItemName, setCustomItemName] = useState("");
    const [showItemDropdown, setShowItemDropdown] = useState(false); // Toggle between custom input and dropdown
    
    const { updateDoc, loading: updating } = useFrappeUpdateDoc();
    const { upload: uploadFile, loading: uploading } = useFrappeFileUpload();

    // Check if this is a custom item (original item has CUS- prefix)
    const isOriginalCustomItem = item?.tds_item_id?.startsWith("CUS-") || false;

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
        },
    });

    const selectedCategory = form.watch("category");
    const watchedTdsItemId = form.watch("tds_item_id");
    const selectedWP = form.watch("work_package");

    const { 
        wpOptions, 
        catOptions, 
        itemOptions, 
        makeOptions 
    } = useTDSItemOptions({
        selectedWP,
        selectedCategory,
        watchedTdsItemId,
        currentItem: item
    });

    const previousItemIdRef = useRef<string | null>(null);

    // Reset form when item changes OR when dialog opens
    useEffect(() => {
        if (open && item) {
            form.reset({
                work_package: item.work_package,
                category: item.category,
                tds_item_id: item.tds_item_id || "", 
                tds_item_name: item.tds_item_name || "",
                is_custom_item: item.tds_item_id?.startsWith("CUS-") || false,
                item_description: item.description,
                make: item.make,
            });
            setSelectedFile(null);
            setCustomItemName(item.tds_item_name || "");
            setShowItemDropdown(false); // Reset to custom input mode for custom items
            previousItemIdRef.current = item.tds_item_id || "";
        }
    }, [open, item, form]);
    
    // Detect if the item's make is a custom value
    useEffect(() => {
        if (open && item && makeOptions.length > 0) {
            const itemMake = item.make;
            const makeExistsInOptions = makeOptions.some(
                opt => opt.value !== "__others__" && opt.value === itemMake
            );
            
            if (itemMake && !makeExistsInOptions) {
                setIsCustomMake(true);
                setCustomMake(itemMake);
            } else {
                setIsCustomMake(false);
                setCustomMake("");
            }
        }
    }, [open, item, makeOptions]);

    // Reset make when item changes
    useEffect(() => {
        const currentId = watchedTdsItemId || "";
        const prevId = previousItemIdRef.current || "";

        if (currentId !== prevId) {
            form.setValue("make", "");
            form.setValue("item_description", "");
            previousItemIdRef.current = currentId;
        }
    }, [watchedTdsItemId, form.setValue]);

    const prevMakeRef = useRef<string | null>(null);
    const watchedMake = form.watch("make");

    useEffect(() => {
        if (open && item) {
            prevMakeRef.current = item.make;
        }
    }, [open, item]);

    useEffect(() => {
        const currentMake = watchedMake || "";
        const prevMake = prevMakeRef.current || "";

        if (currentMake !== prevMake) {
             form.setValue("item_description", "");
             prevMakeRef.current = currentMake;
        }
    }, [watchedMake, form.setValue]);
    

    const onSubmit = async (values: TDSItemValues) => {
        if (!item) return;

        try {
            const updatePayload: any = {
                work_package: values.work_package,
                category: values.category,
                tds_item_id: values.tds_item_id,
                description: values.item_description,
                make: values.make,
            };

            // Always update tds_item_name for display
            // If originally custom item BUT user switched to dropdown -> use selected item's label
            if (isOriginalCustomItem && !showItemDropdown) {
                // User is editing custom item name
                updatePayload.tds_item_name = customItemName || values.tds_item_name;
            } else {
                // Standard items OR user switched from custom to standard
                const selectedItem = itemOptions.find(opt => opt.value === values.tds_item_id);
                updatePayload.tds_item_name = selectedItem?.label || values.tds_item_name;
            }

            await updateDoc("TDS Repository", item.name, updatePayload);

            if (selectedFile) {
                const uploadResp = await uploadFile(selectedFile, {
                    doctype: "TDS Repository",
                    docname: item.name,
                    fieldname: "tds_attachment",
                    isPrivate: true
                });

                const responseData = uploadResp as any;
                const fileUrl = responseData?.message?.file_url || responseData?.file_url;
                if (fileUrl) {
                    await updateDoc("TDS Repository", item.name, {
                        tds_attachment: fileUrl
                    });
                }
            }

            toast({ title: "Success", description: "TDS Item updated successfully", variant: "success" });
            onOpenChange(false);
            onSuccess();
        } catch (e: any) {
            console.error("Error updating TDS Item:", e);
            toast({ title: "Error", description: e?.message || "Failed to update TDS Item", variant: "destructive" });
        }
    };


    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] p-0 rounded-xl border-none max-h-[85vh] flex flex-col">
                <DialogHeader className="p-6 pb-0 flex flex-row items-center justify-between">
                    <div>
                        <DialogTitle className="text-xl font-bold">Edit TDS Item</DialogTitle>
                        {isOriginalCustomItem && (
                            <p className="text-sm text-blue-600 mt-1">Custom Item: {item?.tds_item_id}</p>
                        )}
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
                                                isDisabled={true}
                                            />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                            {/* Item Name - Different UI for custom vs standard */}
                            <FormField
                                control={form.control}
                                name="tds_item_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Item Name<span className="text-red-500 ml-0.5">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            {isOriginalCustomItem && !showItemDropdown ? (
                                                // Custom item: Show text input to edit name
                                                <div className="space-y-2">
                                                    <Input
                                                        value={customItemName}
                                                        onChange={(e) => {
                                                            setCustomItemName(e.target.value);
                                                            form.setValue("tds_item_name", e.target.value);
                                                        }}
                                                        placeholder="Enter custom item name"
                                                        className="bg-white border-gray-200"
                                                    />
                                                    <input type="hidden" {...field} />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setShowItemDropdown(true)}
                                                        className="text-xs text-gray-500 hover:text-gray-700 h-6 px-2"
                                                    >
                                                        ← Back to Items list
                                                    </Button>
                                                </div>
                                            ) : (
                                                // Standard item or switched to dropdown: Show dropdown
                                                <div className="space-y-2">
                                                    <RSelect
                                                        options={itemOptions}
                                                        value={itemOptions.find(opt => opt.value === field.value) || null}
                                                        onChange={(opt) => {
                                                            field.onChange(opt?.value);
                                                            form.setValue("tds_item_name", opt?.label || "");
                                                        }}
                                                        placeholder="Select Item"
                                                        className="react-select-container"
                                                        classNamePrefix="react-select"
                                                    />
                                                    {isOriginalCustomItem && showItemDropdown && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => {
                                                                setShowItemDropdown(false);
                                                                // Restore original custom item values
                                                                form.setValue("tds_item_id", item?.tds_item_id || "");
                                                                form.setValue("tds_item_name", item?.tds_item_name || "");
                                                                setCustomItemName(item?.tds_item_name || "");
                                                            }}
                                                            className="text-xs text-blue-600 hover:text-blue-700 h-6 px-2"
                                                        >
                                                            ← Back to Custom item
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                            {/* Category - Editable for custom items */}
                            <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Category<span className="text-red-500 ml-0.5">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <RSelect
                                                options={catOptions}
                                                value={catOptions.find(opt => opt.value === field.value) || null}
                                                onChange={(opt) => field.onChange(opt?.value)}
                                                placeholder="Select product category"
                                                className="react-select-container"
                                                classNamePrefix="react-select"
                                                isDisabled={!isOriginalCustomItem}
                                            />
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
                                    Attach Document <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                                </label>
                                {item?.tds_attachment && !selectedFile && (
                                    <div className="text-xs text-gray-500 mb-2">
                                        Current: <a href={item.tds_attachment} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{item.tds_attachment.split('/').pop()}</a>
                                    </div>
                                )}
                                <CustomAttachment
                                    maxFileSize={50 * 1024 * 1024}
                                    selectedFile={selectedFile}
                                    onFileSelect={setSelectedFile}
                                    acceptedTypes="application/pdf"
                                    label={item?.tds_attachment ? "Replace Document" : "Upload PDF Document"}
                                    className="w-full"
                                />
                            </div>

                            <DialogFooter className="pt-4 border-t border-gray-100 gap-2 sm:gap-0">
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100">
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={updating || uploading} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
                                    {updating || uploading ? (
                                        <>
                                            <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Updating...
                                        </>
                                    ) : (
                                        "Update Item"
                                    )}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </div>
            </DialogContent>
        </Dialog>
    );
};
