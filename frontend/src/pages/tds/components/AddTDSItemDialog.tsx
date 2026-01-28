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
    DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusCircle } from "lucide-react";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeUpdateDoc } from "frappe-react-sdk";
import RSelect from "react-select";
import { toast } from "@/components/ui/use-toast";
import { TDSItemValues, tdsItemSchema } from "./types";
import { useTDSItemOptions } from "../hooks/useTDSItemOptions";

interface AddTDSItemDialogProps {
    onSuccess: () => void;
}



export const AddTDSItemDialog: React.FC<AddTDSItemDialogProps> = ({ onSuccess }) => {
    const [open, setOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isCustomMake, setIsCustomMake] = useState(false);
    const [customMake, setCustomMake] = useState("");
    const { createDoc, loading: creating } = useFrappeCreateDoc();
    const { upload: uploadFile, loading: uploading } = useFrappeFileUpload();
    const { updateDoc } = useFrappeUpdateDoc();

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
        watchedTdsItemId
    });

    // Track previous values to detect changes reliably
    const prevWPRef = useRef(selectedWP);
    const prevCatRef = useRef(selectedCategory);
    const prevItemRef = useRef(watchedTdsItemId);

    // Reset downstream fields when Work Package changes
    useEffect(() => {
        if (selectedWP !== prevWPRef.current) {
            form.setValue("category", "");
            form.setValue("tds_item_id", "");
            form.setValue("make", "");
            form.setValue("item_description", "");
            prevWPRef.current = selectedWP;
        }
    }, [selectedWP, form]);

    // Reset downstream fields when Category changes
    useEffect(() => {
        if (selectedCategory !== prevCatRef.current) {
            form.setValue("tds_item_id", "");
            form.setValue("make", "");
            form.setValue("item_description", "");
            prevCatRef.current = selectedCategory;
        }
    }, [selectedCategory, form]);

    // Reset Make when Item changes
    useEffect(() => {
        if (watchedTdsItemId !== prevItemRef.current) {
            form.setValue("make", "");
            form.setValue("item_description", "");
            prevItemRef.current = watchedTdsItemId;
        }
    }, [watchedTdsItemId, form]);
    
    // Track previous Make to detect changes
    const prevMakeRef = useRef(form.watch("make"));
    const watchedMake = form.watch("make");

    // Reset Description when Make changes
    useEffect(() => {
        if (watchedMake !== prevMakeRef.current) {
             form.setValue("item_description", "");
             prevMakeRef.current = watchedMake;
        }
    }, [watchedMake, form]);
    
    // Reset form when dialog closes
    useEffect(() => {
        if (!open) {
            form.reset();
            setSelectedFile(null);
            setIsCustomMake(false);
            setCustomMake("");
        }
    }, [open, form]);

    const onSubmit = async (values: TDSItemValues) => {
        try {
            // 1. Create the Doc
            const newDoc = await createDoc("TDS Repository", {
                work_package: values.work_package,
                category: values.category,
                tds_item_id: values.tds_item_id,
                description: values.item_description,
                make: values.make,
            });

            if (newDoc && newDoc.name && selectedFile) {
                const uploadResp = await uploadFile(selectedFile, {
                    doctype: "TDS Repository",
                    docname: newDoc.name,
                    fieldname: "tds_attachment",
                    isPrivate: true
                });

                // Explicitly update the doc with the file URL if it wasn't attached automatically
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
            setOpen(false);
            onSuccess();
        } catch (e) {
            console.error("Error creating TDS Item:", e);
            toast({ title: "Error", description: "Failed to create TDS Item", variant: "destructive" });
        }
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
                                        </FormLabel>
                                        <FormControl>
                                            <RSelect
                                                options={catOptions}
                                                value={catOptions.find(opt => opt.value === field.value) || null}
                                                onChange={(opt) => field.onChange(opt?.value)}
                                                placeholder="Select product category"
                                                className="react-select-container"
                                                classNamePrefix="react-select"
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
                                <CustomAttachment
                                    maxFileSize={50 * 1024 * 1024}
                                    selectedFile={selectedFile}
                                    onFileSelect={setSelectedFile}
                                    acceptedTypes="application/pdf"
                                    label="Upload PDF Document"
                                    className="w-full"
                                />               
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
        </Dialog>
    );
};
