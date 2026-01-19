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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileText, UploadCloud, X, Download, AlertTriangle } from "lucide-react";
import { useFrappeFileUpload, useFrappeUpdateDoc } from "frappe-react-sdk";
import RSelect from "react-select";
import { toast } from "@/components/ui/use-toast";
import { TDSItem, TDSItemValues, tdsItemSchema } from "./types";
import { useTDSItemOptions } from "../hooks/useTDSItemOptions";

interface EditTDSItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: TDSItem | null;
    onSuccess: () => void;
}



export const EditTDSItemDialog: React.FC<EditTDSItemDialogProps> = ({ open, onOpenChange, item, onSuccess }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | null>(null);
    const [attachmentAction, setAttachmentAction] = useState<"keep" | "replace" | "remove">("keep");
    
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
            setExistingAttachmentUrl(item.tds_attachment || null);
            setAttachmentAction(item.tds_attachment ? "keep" : "remove");
            
            // Sync the ref with the freshly loaded item ID so we don't trigger a "change"
            previousItemIdRef.current = item.tds_item_id || "";
        }
    }, [open, item, form]);

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
    

    const handleNewFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
            setAttachmentAction("replace");
        }
    };

    const handleRemoveExistingAttachment = () => {
        setSelectedFile(null);
        setAttachmentAction("remove");
    };

    const handleUndoRemove = () => {
        setAttachmentAction("keep");
    };

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

            // Handle attachment changes - DON'T delete actual files, just update URL
            if (attachmentAction === "remove") {
                // Just clear the URL field, don't delete the file
                updatePayload.tds_attachment = "";
            }

            await updateDoc("TDS Repository", item.name, updatePayload);

            // If replacing with a new file, upload and update URL
            if (attachmentAction === "replace" && selectedFile) {
                const uploadResp = await uploadFile(selectedFile, {
                    doctype: "TDS Repository",
                    docname: item.name,
                    fieldname: "tds_attachment",
                    isPrivate: false
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
                                            <RSelect
                                                options={makeOptions}
                                                value={makeOptions.find(opt => opt.value === field.value) || null}
                                                onChange={(opt) => field.onChange(opt?.value)}
                                                placeholder="Select Make"
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
                            <div className="space-y-2">
                                <label className="text-sm font-semibold">
                                    Attach Document
                                </label>
                                
                                {selectedFile ? (
                                    // New File Selected State
                                    <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-lg">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <div className="p-2 bg-blue-100 rounded-md">
                                                <FileText className="h-5 w-5 text-blue-600" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-900 truncate">{selectedFile.name}</p>
                                                <p className="text-xs text-blue-600 font-medium">New Attachment</p>
                                            </div>
                                        </div>
                                        <button 
                                            type="button" 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedFile(null);
                                                setAttachmentAction(existingAttachmentUrl ? "keep" : "remove");
                                            }}
                                            className="p-1 hover:bg-blue-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                                        >
                                            <X className="h-5 w-5" />
                                        </button>
                                    </div>
                                ) : attachmentAction === "keep" && existingAttachmentUrl ? (
                                    // Existing File State
                                    <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <div className="p-2 bg-gray-200 rounded-md">
                                                <FileText className="h-5 w-5 text-gray-600" />
                                            </div>
                                            <div className="min-w-0">
                                                <a 
                                                    href={existingAttachmentUrl} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="text-sm font-medium text-gray-900 truncate hover:underline hover:text-blue-600"
                                                >
                                                    {existingAttachmentUrl.split('/').pop()}
                                                </a>
                                                <p className="text-xs text-green-600 font-medium flex items-center gap-1">
                                                    Current Attachment
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <a 
                                                            href={existingAttachmentUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="p-2 hover:bg-gray-200 rounded-md text-gray-500 transition-colors"
                                                        >
                                                            <Download className="h-4 w-4" />
                                                        </a>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>Download/View</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>

                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <button 
                                                            type="button" 
                                                            onClick={() => document.getElementById('edit-tds-file-upload')?.click()}
                                                            className="p-2 hover:bg-gray-200 rounded-md text-gray-500 hover:text-blue-600 transition-colors"
                                                        >
                                                            <UploadCloud className="h-4 w-4" />
                                                        </button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>Replace File</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>

                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <button 
                                                            type="button" 
                                                            onClick={handleRemoveExistingAttachment}
                                                            className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-md transition-colors"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>Remove File</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    </div>
                                ) : attachmentAction === "remove" && existingAttachmentUrl ? (
                                    // Removed State
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg border-dashed">
                                            <div className="flex items-center gap-3">
                                                <AlertTriangle className="h-5 w-5 text-amber-500" />
                                                <p className="text-sm text-amber-700">Attachment will be removed</p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleUndoRemove}
                                                className="text-amber-700 hover:text-amber-800 hover:bg-amber-100 h-8 text-xs font-medium"
                                            >
                                                Undo
                                            </Button>
                                        </div>
                                        <div 
                                            className="border-2 border-dashed border-gray-200 bg-gray-50/50 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 hover:border-blue-300 transition-colors group"
                                            onClick={() => document.getElementById('edit-tds-file-upload')?.click()}
                                        >
                                            <div className="p-3 bg-white rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
                                                <UploadCloud className="h-6 w-6 text-blue-500" />
                                            </div>
                                            <p className="text-sm font-medium text-gray-900 mb-1">Click to upload replacement</p>
                                            <p className="text-xs text-gray-500">PDF only, up to 10MB</p>
                                        </div>
                                    </div>
                                ) : (
                                    // Empty State (Upload)
                                    <div 
                                        className="border-2 border-dashed border-gray-200 bg-gray-50/50 rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 hover:border-blue-300 transition-colors group"
                                        onClick={() => document.getElementById('edit-tds-file-upload')?.click()}
                                    >
                                        <div className="p-2 bg-white rounded-full shadow-sm mb-2 group-hover:scale-110 transition-transform">
                                            <UploadCloud className="h-5 w-5 text-blue-500" />
                                        </div>
                                        <p className="text-sm font-medium text-gray-900 mb-0.5">Click to upload or drag and drop</p>
                                        <p className="text-xs text-gray-500">PDF only, up to 10MB</p>
                                        
                                    </div>
                                )}
                                
                                <input 
                                    type="file" 
                                    id="edit-tds-file-upload" 
                                    className="hidden" 
                                    accept=".pdf,application/pdf"
                                    onChange={handleNewFileSelected}
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
