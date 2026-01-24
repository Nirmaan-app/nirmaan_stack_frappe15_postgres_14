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
    
    const { updateDoc, loading: updating } = useFrappeUpdateDoc();
    const { upload: uploadFile, loading: uploading } = useFrappeFileUpload();

    const form = useForm<TDSItemValues>({
        resolver: zodResolver(tdsItemSchema),
        defaultValues: {
            work_package: "",
            category: "",
            tds_item_id: "",
            item_description: "",
            make: "",
        },
    });

    // Reactively fetch existing entries for the selected category to filter items and options
    const selectedCategory = form.watch("category");
    const watchedTdsItemId = form.watch("tds_item_id");
    const selectedWP = form.watch("work_package");

    // Use shared hook for options and filtering logic
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

    // Use a ref to track the previous item ID to detect actual changes
    const previousItemIdRef = useRef<string | null>(null);

    // Reset form when item changes OR when dialog opens
    // We must reset when 'open' becomes true to ensure any previous dirty state is discarded
    useEffect(() => {
        if (open && item) {
            form.reset({
                work_package: item.work_package,
                category: item.category,
                tds_item_id: item.tds_item_id || "", 
                item_description: item.description,
                make: item.make,
            });
            setSelectedFile(null);
            
            // Sync the ref with the freshly loaded item ID so we don't trigger a "change"
            previousItemIdRef.current = item.tds_item_id || "";
        }
    }, [open, item, form]);
    
    // Detect if the item's make is a custom value (not in the options list)
    useEffect(() => {
        if (open && item && makeOptions.length > 0) {
            const itemMake = item.make;
            // Check if item's make exists in makeOptions (excluding __others__)
            const makeExistsInOptions = makeOptions.some(
                opt => opt.value !== "__others__" && opt.value === itemMake
            );
            
            if (itemMake && !makeExistsInOptions) {
                // It's a custom make - show the custom input
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
        // Compare current watched ID with the ref
        // If they differ, it means the user changed the selection (or the form reset happened, but we handled that above)
        // Wait: The form.reset above runs. react-hook-form updates the watched value. This effect fires.
        // We need to ensure we don't clear 'make' immediately after reset.
        
        // The issue: form.reset updates the value.
        // If we set ref.current in the SAME render cycle (or strictly ordered effect), we should be fine?
        // Actually, the above effect runs FIRST (it has `open` dep which changes true).
        // Then Ref is set.
        // Then this effect runs (watchedTdsItemId changes).
        // checking ref.current vs watchedTdsItemId: They should be EQUAL if it was just reset.
        // So we ONLY clear if they are NOT equal.
        
        const currentId = watchedTdsItemId || "";
        const prevId = previousItemIdRef.current || "";

        if (currentId !== prevId) {
            // It's a real change (not the initial reset)
            form.setValue("make", "");
            form.setValue("item_description", "");
            previousItemIdRef.current = currentId;
        }
    }, [watchedTdsItemId, form.setValue]);

    // Track previous Make to detect changes
    const prevMakeRef = useRef<string | null>(null);
    const watchedMake = form.watch("make");

    // Initialize prevMakeRef when item loads
    useEffect(() => {
        if (open && item) {
            prevMakeRef.current = item.make;
        }
    }, [open, item]);

    // Reset Description when Make changes
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

            await updateDoc("TDS Repository", item.name, updatePayload);

            // If a new file is selected, upload it
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
        } catch (e) {
            console.error("Error updating TDS Item:", e);
            toast({ title: "Error", description: "Failed to update TDS Item", variant: "destructive" });
        }
    };


    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] p-0 rounded-xl border-none max-h-[85vh] flex flex-col">
                <DialogHeader className="p-6 pb-0 flex flex-row items-center justify-between">
                    <div>
                        <DialogTitle className="text-xl font-bold">Edit TDS Item</DialogTitle>
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

                            {/* Category */}
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
                                                isDisabled={true}
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
                                            <RSelect
                                                options={itemOptions}
                                                value={itemOptions.find(opt => opt.value === field.value) || null}
                                                onChange={(opt) => field.onChange(opt?.value)}
                                                placeholder="Select Item"
                                                className="react-select-container"
                                                classNamePrefix="react-select"
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
                                                        // Always show "Others" option
                                                        if (option.data.value === "__others__") return true;
                                                        // Default filter for other options
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
                                                                position: 'sticky',
                                                                bottom: 0,
                                                            } : {})
                                                        }),
                                                        menuList: (base) => ({
                                                            ...base,
                                                            paddingBottom: 0,
                                                        })
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
