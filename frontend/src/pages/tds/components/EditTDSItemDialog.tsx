import React, { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { FileText, UploadCloud, X } from "lucide-react";
import { useFrappeGetDocList, useFrappeFileUpload, useFrappeUpdateDoc } from "frappe-react-sdk";
import RSelect from "react-select";
import { toast } from "@/components/ui/use-toast";
import { TDSItem, TDSItemValues, tdsItemSchema } from "./types";

interface EditTDSItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: TDSItem | null;
    onSuccess: () => void;
}

export const EditTDSItemDialog: React.FC<EditTDSItemDialogProps> = ({ open, onOpenChange, item, onSuccess }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const { updateDoc, loading: updating } = useFrappeUpdateDoc();
    const { upload: uploadFile, loading: uploading } = useFrappeFileUpload();

    // Fetch Options for Form
    const { data: wpList } = useFrappeGetDocList("Procurement Packages", { fields: ["name", "work_package_name"], limit: 1000 });
    const { data: catList } = useFrappeGetDocList("Category", { fields: ["name", "category_name", "work_package"], limit: 1000 });
    const { data: itemList } = useFrappeGetDocList("Items", { fields: ["name", "item_name", "category"], limit: 1000 });
    const { data: makeList } = useFrappeGetDocList("Makelist", { fields: ["name", "make_name"], limit: 1000 });
    const { data: catMakeList } = useFrappeGetDocList("Category Makelist", { fields: ["category", "make"], limit: 5000 });

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

    // Reset form when item changes
    useEffect(() => {
        if (item) {
            form.reset({
                work_package: item.work_package,
                category: item.category,
                tds_item_id: item.tds_item_id || "", 
                item_description: item.description,
                make: item.make,
            });
            setSelectedFile(null);
        }
    }, [item, form]);

    // Watch form values for dependent filtering
    const selectedWP = form.watch("work_package");
    const selectedCategory = form.watch("category");

    // Memoize options
    const wpOptions = useMemo(() => wpList?.map(d => ({ label: d.work_package_name, value: d.name })) || [], [wpList]);

    const catOptions = useMemo(() => {
        if (!selectedWP) return [];
        return catList
            ?.filter(d => d.work_package === selectedWP)
            .map(d => ({ label: d.category_name, value: d.name })) || [];
    }, [catList, selectedWP]);

    const itemOptions = useMemo(() => {
        if (!selectedCategory) return [];
        return itemList
            ?.filter(d => d.category === selectedCategory)
            .map(d => ({ label: d.item_name, value: d.name })) || [];
    }, [itemList, selectedCategory]);

    const makeOptions = useMemo(() => {
        if (!selectedCategory || !catMakeList || !makeList) return [];
        
        const validMakesForCategory = new Set(
            catMakeList
                .filter(cm => cm.category === selectedCategory)
                .map(cm => cm.make)
        );

        if (validMakesForCategory.size === 0) {
            return makeList.map(d => ({ label: d.make_name, value: d.name }));
        }

        return makeList
            .filter(m => validMakesForCategory.has(m.name))
            .map(d => ({ label: d.make_name, value: d.name }));
    }, [makeList, catMakeList, selectedCategory]);


    const onSubmit = async (values: TDSItemValues) => {
        if (!item) return;

        try {
            await updateDoc("TDS Repository", item.name, {
                work_package: values.work_package,
                category: values.category,
                tds_item_id: values.tds_item_id,
                description: values.item_description,
                make: values.make,
            });

            if (selectedFile) {
                const uploadResp = await uploadFile(selectedFile, {
                    doctype: "TDS Repository",
                    docname: item.name,
                    fieldname: "tds_attachment",
                    isPrivate: false
                });

                const fileUrl = uploadResp?.message?.file_url || uploadResp?.file_url;
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
            <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden rounded-xl border-none">
                <DialogHeader className="p-6 pb-0 flex flex-row items-center justify-between">
                    <div>
                        <DialogTitle className="text-xl font-bold">Edit TDS Item</DialogTitle>
                    </div>
                </DialogHeader>

                <div className="p-6">
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
                                                value={wpOptions.find(opt => opt.value === field.value)}
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
                                                value={catOptions.find(opt => opt.value === field.value)}
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
                                                value={itemOptions.find(opt => opt.value === field.value)}
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

                            {/* Item Description */}
                            <FormField
                                control={form.control}
                                name="item_description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Item Description<span className="text-red-500 ml-0.5">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Input placeholder="Type Description" {...field} className="bg-white border-gray-200 focus:ring-1 focus:ring-gray-300 h-10" />
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
                                                value={makeOptions.find(opt => opt.value === field.value)}
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

                            {/* Attach Document */}
                            <div className="space-y-2">
                                <label className="text-sm font-semibold">
                                    Attach Document {item?.tds_attachment && <span className="text-green-600 ml-2 text-xs">(Current: Loaded)</span>}
                                </label>
                                <div 
                                    className="border-2 border-dashed border-blue-100 bg-blue-50/50 rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-blue-50 transition-colors relative"
                                    onClick={() => document.getElementById('edit-tds-file-upload')?.click()}
                                >
                                    {selectedFile ? (
                                        <div className="flex flex-col items-center">
                                            <FileText className="h-10 w-10 text-blue-500 mb-2" />
                                            <span className="text-sm font-medium text-gray-700">{selectedFile.name}</span>
                                            <span className="text-xs text-gray-400">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                                            <button 
                                                type="button" 
                                                className="absolute top-2 right-2 p-1 bg-white rounded-full shadow-sm hover:bg-gray-100"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedFile(null);
                                                }}
                                            >
                                                <X className="h-4 w-4 text-gray-400" />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="bg-blue-900 text-white p-2 rounded-lg mb-3 shadow-md">
                                                <UploadCloud className="h-6 w-6" />
                                            </div>
                                            <span className="text-sm text-gray-600 mb-3">Drag and drop files here to replace, or</span>
                                            <Button type="button" variant="outline" className="bg-[#5c8ee6] hover:bg-[#4a79d1] text-white border-none h-8 px-4 text-xs">
                                                Click to browse
                                            </Button>
                                        </>
                                    )}
                                    <input 
                                        type="file" 
                                        id="edit-tds-file-upload" 
                                        className="hidden" 
                                        accept=".xlsx,.pdf"
                                        onChange={(e) => e.target.files && setSelectedFile(e.target.files[0])}
                                    />
                                </div>
                            </div>

                            <DialogFooter className="pt-4 border-t border-gray-100 gap-2 sm:gap-0">
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100">
                                    Cancel
                                </Button>
                                <Button type="submit" className="bg-[#dc2626] hover:bg-[#b91c1c] text-white" disabled={updating || uploading}>
                                    {updating || uploading ? "Updating..." : "Update"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </div>
            </DialogContent>
        </Dialog>
    );
};
