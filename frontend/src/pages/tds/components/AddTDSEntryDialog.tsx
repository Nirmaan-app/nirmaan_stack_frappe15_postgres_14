import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import RSelect from "react-select";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";
import { toast } from "@/components/ui/use-toast";
import { TDS_STATUS_OPTIONS } from "./types";

// ---- Schema -------------------------------------------------------------
// A TDS Repository entry (the actual datasheet record) is keyed by
// (tds_item, make). work_package auto-fetches server-side from the linked
// TDS Item, so it is NOT part of the create payload.
const tdsEntrySchema = z.object({
    tds_item: z.string().min(1, "TDS Item is required."),
    make: z.string().min(1, "Make is required."),
    status: z.enum(TDS_STATUS_OPTIONS),
    description: z.string().optional(),
});

type TDSEntryValues = z.infer<typeof tdsEntrySchema>;

export interface AddTDSEntryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called after a TDS Repository entry is successfully created. */
    onCreated?: () => void;
    /**
     * Optional TDS Item name (TDS-ITEM-#####). When provided (e.g. the detail
     * page opens this dialog for a specific TDS Item) the picker is preselected
     * and locked.
     */
    presetTdsItem?: string;
}

export const AddTDSEntryDialog: React.FC<AddTDSEntryDialogProps> = ({
    open,
    onOpenChange,
    onCreated,
    presetTdsItem,
}) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);

    const { createDoc, loading: creating } = useFrappeCreateDoc();
    const { upload: uploadFile, loading: uploading } = useFrappeFileUpload();
    const { updateDoc } = useFrappeUpdateDoc();

    const form = useForm<TDSEntryValues>({
        resolver: zodResolver(tdsEntrySchema),
        defaultValues: {
            tds_item: presetTdsItem || "",
            make: "",
            status: "Not Verified",
            description: "",
        },
    });

    const selectedTdsItem = form.watch("tds_item");

    // ---- TDS Item options -----------------------------------------------
    // New shape: TDS Item is the grouping doctype. Label = tds_item_name,
    // value = name; we suffix the work package for disambiguation.
    const { data: tdsItemList } = useFrappeGetDocList("TDS Items", {
        fields: ["name", "tds_item_name", "work_package"],
        limit: 0,
    });

    const tdsItemOptions = useMemo(
        () =>
            (tdsItemList || []).map((d: any) => ({
                label: d.work_package ? `${d.tds_item_name} (${d.work_package})` : d.tds_item_name,
                value: d.name,
                tdsItemName: d.tds_item_name,
                workPackage: d.work_package,
            })),
        [tdsItemList]
    );

    // ---- Make options (full Makelist; NO "+ Others" / new-make path) -----
    const { data: makeList } = useFrappeGetDocList("Makelist", {
        fields: ["name", "make_name"],
        limit: 0,
    });

    // ---- De-dup: exclude makes that already have an entry for this TDS Item.
    // Uses the NEW TDS Repository shape (tds_item Link), NOT the removed
    // tds_item_id/tds_item_name/category fields.
    const { data: existingEntries } = useFrappeGetDocList(
        "TDS Repository",
        {
            filters: selectedTdsItem ? [["tds_item", "=", selectedTdsItem]] : undefined,
            fields: ["name", "make"],
            limit: 0,
        },
        selectedTdsItem ? undefined : null
    );

    const takenMakes = useMemo(
        () => new Set((existingEntries || []).map((e: any) => e.make)),
        [existingEntries]
    );

    const makeOptions = useMemo(
        () =>
            (makeList || [])
                .filter((m: any) => !takenMakes.has(m.name))
                .map((m: any) => ({ label: m.make_name, value: m.name })),
        [makeList, takenMakes]
    );

    // Keep the preset locked / in sync, and reset transient state on close.
    useEffect(() => {
        if (open) {
            form.reset({
                tds_item: presetTdsItem || "",
                make: "",
                status: "Not Verified",
                description: "",
            });
            setSelectedFile(null);
            setFileError(null);
        }
    }, [open, presetTdsItem, form]);

    // Clear a chosen make if it becomes taken (TDS Item changed → entries reloaded).
    useEffect(() => {
        const currentMake = form.getValues("make");
        if (currentMake && takenMakes.has(currentMake)) {
            form.setValue("make", "");
        }
    }, [takenMakes, form]);

    const onSubmit = async (values: TDSEntryValues) => {
        if (!selectedFile) {
            setFileError("Attachment is required");
            return;
        }
        try {
            // work_package is auto-fetched server-side from tds_item.
            const newDoc = await createDoc("TDS Repository", {
                tds_item: values.tds_item,
                make: values.make,
                status: values.status,
                description: values.description || "",
            });

            if (newDoc?.name) {
                const uploadResp = await uploadFile(selectedFile, {
                    doctype: "TDS Repository",
                    docname: newDoc.name,
                    fieldname: "tds_attachment",
                    isPrivate: true,
                });

                const responseData = uploadResp as any;
                const fileUrl = responseData?.message?.file_url || responseData?.file_url;
                if (fileUrl) {
                    await updateDoc("TDS Repository", newDoc.name, {
                        tds_attachment: fileUrl,
                    });
                }
            }

            toast({ title: "Success", description: "TDS entry created successfully" });
            onCreated?.();
            onOpenChange(false);
        } catch (e: any) {
            console.error("Error creating TDS entry:", e);
            toast({
                title: "Error",
                description: e?.message || "Failed to create TDS entry",
                variant: "destructive",
            });
        }
    };

    const selectedTdsItemOption = tdsItemOptions.find((o) => o.value === selectedTdsItem) || null;
    const isTdsItemLocked = !!presetTdsItem;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] p-0 rounded-xl border-none max-h-[85vh] flex flex-col">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="text-xl font-bold">Add Entry</DialogTitle>
                </DialogHeader>

                <div className="p-6 overflow-y-auto">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            {/* TDS Item */}
                            <FormField
                                control={form.control}
                                name="tds_item"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            TDS Item<span className="text-red-500 ml-0.5">*</span>
                                            {isTdsItemLocked && (
                                                <span className="text-xs text-gray-400 ml-2">(locked)</span>
                                            )}
                                        </FormLabel>
                                        <FormControl>
                                            <FuzzySearchSelect
                                                allOptions={tdsItemOptions}
                                                tokenSearchConfig={{
                                                    searchFields: ["label", "tdsItemName", "value", "workPackage"],
                                                    minSearchLength: 1,
                                                    partialMatch: true,
                                                    minTokenLength: 1,
                                                    fieldWeights: {
                                                        label: 2.0,
                                                        tdsItemName: 2.0,
                                                        value: 1.5,
                                                        workPackage: 1.0,
                                                    },
                                                    minTokenMatches: 1,
                                                }}
                                                value={selectedTdsItemOption}
                                                onChange={(opt: any) => field.onChange(opt?.value || "")}
                                                placeholder="Search TDS Item..."
                                                className="react-select-container"
                                                classNamePrefix="react-select"
                                                isDisabled={isTdsItemLocked}
                                                isClearable={!isTdsItemLocked}
                                            />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                            {/* Make — full Makelist, de-duped against existing entries.
                                No "+ Others"/custom-make creation in the new flow. */}
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
                                                value={makeOptions.find((opt) => opt.value === field.value) || null}
                                                onChange={(opt) => field.onChange(opt?.value || "")}
                                                placeholder={
                                                    selectedTdsItem ? "Select Make" : "Select a TDS Item first"
                                                }
                                                className="react-select-container"
                                                classNamePrefix="react-select"
                                                isDisabled={!selectedTdsItem}
                                                isClearable
                                            />
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
                                                options={TDS_STATUS_OPTIONS.map((s) => ({ label: s, value: s }))}
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

                            {/* Description */}
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold flex items-center">
                                            Description{" "}
                                            <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Textarea
                                                placeholder="Type Description"
                                                {...field}
                                                className="bg-white border-gray-200 focus:ring-1 focus:ring-gray-300 min-h-[100px]"
                                            />
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
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => onOpenChange(false)}
                                    className="bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={creating || uploading}
                                    className="bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                                >
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
