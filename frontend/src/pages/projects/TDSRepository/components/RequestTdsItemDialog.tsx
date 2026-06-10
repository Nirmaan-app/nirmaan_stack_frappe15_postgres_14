import React, { useState, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
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
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 (ADR-0003) — group-aware "Request new" dialog.
//
// A project files a "New" request proposing a (TDS Item group, Make) it can't pick
// because the group is missing that make's datasheet, or because the group itself
// doesn't exist yet. The user chooses:
//   • Existing group → pick it via the group picker (backed by `search_tds_items`).
//     `tds_item_id` = the frozen group id; `tds_item_name` / `tds_work_package`
//     snapshot the group's name + WP.
//   • New group → free-text label + a Work Package. `tds_item_id` stays empty; the
//     backend creates the member-less TDS Item on approval (BE-APPROVE).
// Plus: a make from the FULL Makelist (NO "+ Others" custom-make path), a REQUIRED
// datasheet PDF, and optional description / BOQ. The result is a "New" cart row.
//
// `tds_make` stores the Makelist row id (label = make_name) — matching the rest of
// the TDS flow which keys makes by their Makelist `name`.
//
// react-select portal styles: pointerEvents:"auto" is REQUIRED inside a Radix
// Dialog — the dialog sets pointer-events:none on document.body, so a menu portaled
// there inherits it and swallows clicks. (Only used where a menu is portaled.)
// ─────────────────────────────────────────────────────────────────────────────

const PORTAL_SELECT_STYLES = {
    menuPortal: (base: any) => ({ ...base, zIndex: 9999, pointerEvents: "auto" }),
    control: (base: any) => ({ ...base, minHeight: "44px", borderRadius: "8px", borderColor: "#e5e7eb" }),
};

// One result row from `search_tds_items`.
interface GroupResult {
    tds_item: string;
    tds_item_name: string;
    work_package: string;
    matched_member?: { item: string; item_name: string } | null;
    makes: { make: string; entry: string; tds_attachment?: string; status?: string }[];
}

const formSchema = z
    .object({
        mode: z.enum(["existing", "new"]),
        // existing-group selection
        tds_item_id: z.string().optional(),
        // shared
        tds_item_name: z.string().optional(),
        work_package: z.string().optional(),
        make: z.string().min(1, "Make is required"),
        boq_ref: z.string().optional(),
        description: z.string().optional(),
    })
    .superRefine((val, ctx) => {
        if (val.mode === "existing") {
            if (!val.tds_item_id) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tds_item_id"], message: "Select a TDS item" });
            }
        } else {
            if (!val.tds_item_name || !val.tds_item_name.trim()) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tds_item_name"], message: "Group label is required" });
            }
            if (!val.work_package) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["work_package"], message: "Work Package is required" });
            }
        }
    });

interface RequestTdsItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAddItem: (item: any) => void;
}

// Debounce a value (used for the picker search query → API swrKey).
function useDebouncedValue<T>(value: T, delay = 300): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
}

export const RequestTdsItemDialog: React.FC<RequestTdsItemDialogProps> = ({ open, onOpenChange, onAddItem }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);

    // Group picker (existing-group mode) search query.
    const [searchQuery, setSearchQuery] = useState("");
    const debouncedQuery = useDebouncedValue(searchQuery, 300);
    const [selectedGroup, setSelectedGroup] = useState<GroupResult | null>(null);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            mode: "existing",
            tds_item_id: "",
            tds_item_name: "",
            work_package: "",
            make: "",
            boq_ref: "",
            description: "",
        },
    });

    const mode = form.watch("mode");

    // ── Reference data ──────────────────────────────────────────────────────────
    // Full Makelist (no "+ Others"). Work Packages for the new-group WP dropdown.
    const { data: makeList } = useFrappeGetDocList("Makelist", { fields: ["name", "make_name"], limit: 0 });
    const { data: wpList } = useFrappeGetDocList("Work Packages", { fields: ["name", "work_package_name"], limit: 0 });

    const makeOptions = useMemo(
        () => (makeList || []).map((m: any) => ({ label: m.make_name, value: m.name })),
        [makeList]
    );
    const wpOptions = useMemo(
        () => (wpList || []).map((w: any) => ({ label: w.work_package_name, value: w.name })),
        [wpList]
    );

    // ── Existing-group search (BE-PICKER) ────────────────────────────────────────
    // 3rd arg is the swrKey (NOT options); embed the debounced query so it refetches
    // as the user types. Only fetch when this dialog is open AND in existing mode.
    const { data: searchData, isLoading: isSearching } = useFrappeGetCall<{ message: GroupResult[] }>(
        "nirmaan_stack.api.tds.picker.search_tds_items",
        { query: debouncedQuery, limit: 50 },
        open && mode === "existing" ? `tds_request_search_${debouncedQuery}` : null
    );

    const groupOptions = useMemo(() => {
        const groups = searchData?.message ?? [];
        return groups.map(g => ({
            label: g.tds_item_name,
            value: g.tds_item,
            subtitle: g.matched_member ? `contains ${g.matched_member.item_name}` : "",
            group: g,
        }));
    }, [searchData]);

    const handleGroupChange = (opt: any) => {
        const g: GroupResult | null = opt?.group || null;
        setSelectedGroup(g);
        form.setValue("tds_item_id", g?.tds_item || "");
        form.setValue("tds_item_name", g?.tds_item_name || "");
        form.setValue("work_package", g?.work_package || "");
    };

    const handleModeChange = (next: "existing" | "new") => {
        form.setValue("mode", next);
        // Clear group-specific fields when switching mode.
        setSelectedGroup(null);
        setSearchQuery("");
        form.setValue("tds_item_id", "");
        form.setValue("tds_item_name", "");
        form.setValue("work_package", "");
    };

    const onSubmit = (values: z.infer<typeof formSchema>) => {
        if (!selectedFile) {
            setFileError("Attachment is required");
            return;
        }
        const makeName = makeOptions.find(m => m.value === values.make)?.label || values.make;
        onAddItem({
            // For an existing group: the frozen group id. For a new group: empty
            // (backend creates the member-less TDS Item on approval).
            tds_item_id: values.mode === "existing" ? (values.tds_item_id || "") : "",
            tds_item_name: values.tds_item_name || "",
            make: makeName,                  // human make name (frozen as tds_make)
            work_package: values.work_package || "",
            category: "",
            description: values.description || "",
            tds_boq_line_item: values.boq_ref || "",
            attachmentFile: selectedFile,
            is_new_request: true,
        });
        handleCancel();
    };

    const handleCancel = () => {
        onOpenChange(false);
        form.reset({
            mode: "existing",
            tds_item_id: "",
            tds_item_name: "",
            work_package: "",
            make: "",
            boq_ref: "",
            description: "",
        });
        setSelectedGroup(null);
        setSearchQuery("");
        setSelectedFile(null);
        setFileError(null);
    };

    return (
        <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : handleCancel())}>
            <DialogContent className="sm:max-w-[450px] p-0 rounded-xl border-none max-h-[90vh] flex flex-col overflow-hidden shadow-2xl bg-white">
                <DialogHeader className="p-6 pb-2 border-b border-gray-50">
                    <DialogTitle className="text-xl font-bold tracking-tight">Request New TDS Item</DialogTitle>
                </DialogHeader>

                <div className="p-6 py-4 overflow-y-auto flex-1 custom-scrollbar">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            {/* Mode toggle: existing group vs new group */}
                            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => handleModeChange("existing")}
                                    className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${mode === "existing" ? "bg-red-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                                >
                                    Existing Item
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleModeChange("new")}
                                    className={`flex-1 px-3 py-2 text-sm font-medium transition-colors border-l border-gray-200 ${mode === "new" ? "bg-red-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                                >
                                    New Item Group
                                </button>
                            </div>

                            {mode === "existing" ? (
                                /* Existing group picker */
                                <FormField
                                    control={form.control}
                                    name="tds_item_id"
                                    render={() => (
                                        <FormItem className="space-y-1">
                                            <FormLabel className="text-sm font-bold text-gray-700">TDS Item<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                            <FormControl>
                                                <FuzzySearchSelect
                                                    allOptions={groupOptions}
                                                    tokenSearchConfig={{
                                                        searchFields: ['label', 'value', 'subtitle'],
                                                        minSearchLength: 1,
                                                        partialMatch: true,
                                                        minTokenLength: 1,
                                                        fieldWeights: { label: 2.0, value: 1.5, subtitle: 1.0 },
                                                        minTokenMatches: 1,
                                                    }}
                                                    value={selectedGroup ? { label: selectedGroup.tds_item_name, value: selectedGroup.tds_item } : null}
                                                    onChange={handleGroupChange as any}
                                                    onSearchInputChange={(v) => setSearchQuery(v)}
                                                    placeholder="Search TDS item or member item..."
                                                    classNamePrefix="react-select"
                                                    isClearable
                                                    isLoading={isSearching}
                                                    noOptionsMessage={() => isSearching ? "Searching..." : "No matching TDS items"}
                                                    menuPortalTarget={document.body}
                                                    menuPosition="fixed"
                                                    styles={PORTAL_SELECT_STYLES}
                                                    formatOptionLabel={(option: any) => (
                                                        <div className="flex flex-col">
                                                            <span>{option.label}</span>
                                                            {option.subtitle && (
                                                                <span className="text-xs text-blue-600">{option.subtitle}</span>
                                                            )}
                                                        </div>
                                                    )}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            ) : (
                                /* New group: free-text label + Work Package */
                                <>
                                    <FormField
                                        control={form.control}
                                        name="tds_item_name"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1">
                                                <FormLabel className="text-sm font-bold text-gray-700">New Item Label<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="e.g. MCB 32A Type C" className="h-11 border-gray-200 rounded-lg bg-gray-50/30 focus:bg-white transition-all font-medium" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
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
                                                        onChange={(opt: any) => field.onChange(opt?.value || "")}
                                                        placeholder="Select Work Package"
                                                        classNamePrefix="react-select"
                                                        menuPortalTarget={document.body}
                                                        menuPosition="fixed"
                                                        styles={PORTAL_SELECT_STYLES}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </>
                            )}

                            {/* Make — full Makelist, no "+ Others" */}
                            <FormField
                                control={form.control}
                                name="make"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="text-sm font-bold text-gray-700">Make<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                        <FormControl>
                                            <RSelect
                                                options={makeOptions}
                                                value={makeOptions.find(opt => opt.value === field.value) || null}
                                                onChange={(opt: any) => field.onChange(opt?.value || "")}
                                                placeholder="Select Make"
                                                classNamePrefix="react-select"
                                                menuPortalTarget={document.body}
                                                menuPosition="fixed"
                                                styles={PORTAL_SELECT_STYLES}
                                            />
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

                            {/* Attach Document — required datasheet PDF */}
                            <div className="space-y-1.5 mt-2">
                                <FormLabel className="text-sm font-bold text-gray-700 tracking-tight">Attach Datasheet<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                <CustomAttachment
                                    selectedFile={selectedFile}
                                    onFileSelect={(file) => {
                                        setSelectedFile(file);
                                        if (file) setFileError(null);
                                    }}
                                    acceptedTypes="application/pdf"
                                    label="Upload PDF Document"
                                    maxFileSize={50 * 1024 * 1024}
                                    className="w-full"
                                />
                                {fileError && (
                                    <p className="text-xs font-medium text-red-500">{fileError}</p>
                                )}
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
        </Dialog>
    );
};
