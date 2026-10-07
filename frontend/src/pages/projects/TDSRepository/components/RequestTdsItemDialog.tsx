import React, { useState, useMemo } from "react";
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
import { foldItemName } from "@/utils/tdsRequestRules";

// ─────────────────────────────────────────────────────────────────────────────
// "Request New TDS Item" dialog (ADR-0025 Amendment A, #1377). The first field is
// Type, with two choices:
//   • New Make → a make the picked TDS Item has no datasheet for. Picked via the
//     group picker (backed by `search_tds_items`); `tds_item_id` = the frozen group
//     id, `tds_item_name` / `tds_work_package` snapshot the group's name + WP.
//     Approval adds a Verified Repository Entry.
//   • Project Custom → an item only this project uses: name, Work Package
//     (Procurement Packages, the list TDS Items link to), a Category under that
//     package. The server issues its project-only `PCUS-` id; it never enters the
//     TDS Repository.
// A project can no longer create a shared TDS Item.
// Both: a make from the FULL Makelist (NO "+ Others" custom-make path), a REQUIRED
// datasheet PDF, and optional description / BOQ.
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

type RequestMode = "new_make" | "project_custom";

const TYPE_CHOICES: { value: RequestMode; label: string; help: string }[] = [
    {
        value: "new_make",
        label: "Add New Make to an Existing TDS Item",
        help: "The item is in the repository but this make has no datasheet yet. Approving adds it to the repository.",
    },
    {
        value: "project_custom",
        label: "Create a Project Specific Custom TDS Item",
        help: "Only for this project. It never goes into the TDS Repository.",
    },
];

const formSchema = z
    .object({
        mode: z.enum(["new_make", "project_custom"]),
        // New Make: the picked group + its snapshot
        tds_item_id: z.string().optional(),
        tds_item_name: z.string().optional(),
        work_package: z.string().optional(),
        // Project Custom
        custom_name: z.string().optional(),
        custom_work_package: z.string().optional(),
        category: z.string().optional(),
        // both
        make: z.string().min(1, "Make is required"),
        boq_ref: z.string().optional(),
        description: z.string().optional(),
    })
    .superRefine((val, ctx) => {
        const require = (path: "tds_item_id" | "custom_name" | "custom_work_package" | "category", message: string) => {
            if (!(val[path] ?? "").trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
        };
        if (val.mode === "new_make") {
            require("tds_item_id", "Select a TDS item");
        } else {
            require("custom_name", "Item Name is required");
            require("custom_work_package", "Work Package is required");
            require("category", "Category is required");
        }
    });

const EMPTY_FORM: z.infer<typeof formSchema> = {
    mode: "new_make",
    tds_item_id: "",
    tds_item_name: "",
    work_package: "",
    custom_name: "",
    custom_work_package: "",
    category: "",
    make: "",
    boq_ref: "",
    description: "",
};

interface RequestTdsItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAddItem: (item: any) => void;
}

export const RequestTdsItemDialog: React.FC<RequestTdsItemDialogProps> = ({ open, onOpenChange, onAddItem }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);

    // New Make picker state. No typed-query state: the whole (optionally
    // WP-scoped) set is loaded once and FuzzySearchSelect filters it client-side.
    // `filterWP` is the New Make scope only — deliberately separate from the
    // form's `work_package` (the snapshot `handleGroupChange` writes) and from
    // `custom_work_package` (Project Custom's declared package).
    const [filterWP, setFilterWP] = useState<string>("");
    const [selectedGroup, setSelectedGroup] = useState<GroupResult | null>(null);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: EMPTY_FORM,
    });

    const mode = form.watch("mode");
    const customName = form.watch("custom_name") ?? "";
    const customWP = form.watch("custom_work_package") ?? "";

    // ── Reference data ──────────────────────────────────────────────────────────
    // Full Makelist (no "+ Others"). Project Custom's Work Package comes from
    // Procurement Packages — the list `TDS Items.work_package` and
    // `Category.work_package` link to — and its Category from that package only.
    const { data: makeList } = useFrappeGetDocList("Makelist", { fields: ["name", "make_name"], limit: 0 });
    const isCustom = open && mode === "project_custom";
    const { data: packageList } = useFrappeGetDocList(
        "Procurement Packages",
        { fields: ["name"], orderBy: { field: "name", order: "asc" }, limit: 0 },
        isCustom ? "tds_request_procurement_packages" : null
    );
    const { data: categoryList, isLoading: isLoadingCategories } = useFrappeGetDocList(
        "Category",
        {
            fields: ["name"],
            filters: [["work_package", "=", customWP]],
            orderBy: { field: "name", order: "asc" },
            limit: 0,
        },
        isCustom && customWP ? `tds_request_categories_${customWP}` : null
    );

    // Makes the PICKED GROUP already has a Repository Entry (datasheet) for.
    // `search_tds_items` returns these on every result; the dialog used to ignore
    // them and offer all ~372 Makelist rows, so a user could file a "New" request
    // for a datasheet that already exists. Approval then makes the Admin choose
    // between the entry's datasheet and the uploaded one (`approve.py`
    // `_approve_new_make`), work the requester could have skipped.
    //
    // Requesting is the EXCEPTION path (add what is missing); the normal
    // "Select Items for TDS" picker is the path for makes that already have a
    // sheet. Marking them here makes the two surfaces complements, not overlaps.
    //
    // Matching is case-insensitive + trimmed ON PURPOSE, unlike the server's
    // exact `_find_entry`. A stored 'Matrix' vs a Makelist 'matrix' would NOT
    // match server-side — so requesting it would mint a SECOND entry for the same
    // real make. Blocking on the looser comparison is what prevents that.
    const takenMakes = useMemo(() => {
        const s = new Set<string>();
        (selectedGroup?.makes ?? []).forEach(m => {
            const k = (m.make || "").trim().toLowerCase();
            if (k) s.add(k);
        });
        return s;
    }, [selectedGroup]);

    const makeOptions = useMemo(
        () =>
            (makeList || []).map((m: any) => ({
                label: m.make_name,
                value: m.name,
                taken: takenMakes.has((m.make_name || "").trim().toLowerCase()),
            })),
        [makeList, takenMakes]
    );
    const packageOptions = useMemo(
        () => (packageList || []).map((p: { name: string }) => ({ label: p.name, value: p.name })),
        [packageList]
    );
    const categoryOptions = useMemo(
        () => (categoryList || []).map((c: { name: string }) => ({ label: c.name, value: c.name })),
        [categoryList]
    );

    // ── Existing tab: Work Package scope ────────────────────────────────────────
    // Sourced from `TDS Items` itself (NOT a work-package doctype), so every
    // option is guaranteed to return groups and the ids are exactly what
    // `search_tds_items(work_package=…)` filters on.
    const { data: tdsWpData } = useFrappeGetCall<{
        message: { work_package: string; group_count: number }[];
    }>("nirmaan_stack.api.tds.picker.get_tds_work_packages", undefined, "tds_picker_work_packages");

    // `label` stays the bare name — react-select filters on it, so baking the
    // count in would make typing a digit match a package.
    const tdsWpOptions = useMemo(
        () =>
            (tdsWpData?.message ?? []).map(w => ({
                label: w.work_package,
                value: w.work_package,
                groupCount: w.group_count,
            })),
        [tdsWpData]
    );

    // ── Existing-group source (BE-PICKER) ───────────────────────────────────────
    // LOAD-ONCE, FILTER-CLIENT-SIDE — same as TdsCreateForm. `limit: 0` is
    // unlimited; no `query` is sent. The server matches ONE CONTIGUOUS substring
    // while FuzzySearchSelect tokenizes, so running the server first made its
    // strictness win ("hydrogen exhaust" found nothing for a group that exists).
    // Only fetches while the dialog is open. Project Custom reads the unscoped
    // list for its name-clash warning; with no scope picked, New Make shares
    // that same fetch.
    const groupScope = mode === "new_make" ? filterWP : "";
    const { data: searchData, isLoading: isSearching } = useFrappeGetCall<{ message: GroupResult[] }>(
        "nirmaan_stack.api.tds.picker.search_tds_items",
        { work_package: groupScope || undefined, limit: 0 },
        open ? `tds_request_groups_${groupScope || "all"}` : null
    );

    // Project Custom name clash: a repository TDS Item with the same name,
    // ignoring case. Advisory only — a different item may share a name.
    const clashGroup = useMemo(() => {
        const typed = foldItemName(customName);
        if (mode !== "project_custom" || !typed) return null;
        return (searchData?.message ?? []).find(g => foldItemName(g.tds_item_name) === typed) ?? null;
    }, [mode, customName, searchData]);

    // Member count per group — ONE batched pass over `Items`. A group ABSENT from
    // `counts` has ZERO members: an Unlinked TDS Item (Work Package + label only).
    //
    // It matters HERE too, not just on the create form: a "New" request against
    // an existing group still produces a `Project TDS Item List` row, and the
    // same before_save hook derives its `tds_category` from the group's members'
    // `Items.category`. Member-less group ⇒ the row freezes an EMPTY category.
    // Shares the create form's swrKey, so the two screens hit one cached fetch.
    const { data: memberIndexData } = useFrappeGetCall<{
        message: { counts: Record<string, number>; categories: string[] };
    }>("nirmaan_stack.api.tds.members.get_tds_member_index", undefined, "tds_member_index");

    const memberCounts = memberIndexData?.message?.counts ?? {};

    // ADR-0026: group-name-only search, so no member hit to attribute — the old
    // "contains <member>" subtitle is gone.
    const groupOptions = useMemo(() => {
        const groups = searchData?.message ?? [];
        return groups.map(g => ({
            memberCount: memberCounts[g.tds_item] ?? 0,
            label: g.tds_item_name,
            value: g.tds_item,
            workPackage: g.work_package,
            group: g,
        }));
    }, [searchData, memberIndexData]);

    const handleGroupChange = (opt: any) => {
        const g: GroupResult | null = opt?.group || null;
        setSelectedGroup(g);
        form.setValue("tds_item_id", g?.tds_item || "");
        form.setValue("tds_item_name", g?.tds_item_name || "");
        form.setValue("work_package", g?.work_package || "");
        // Picking an item DERIVES the scope, so choosing the item first never
        // requires setting the Work Package. Safe unconditionally: the group is
        // by definition in its own WP, so the narrowed list still contains it.
        if (g?.work_package) setFilterWP(g.work_package);

        // A make chosen BEFORE the group may already have a datasheet under the
        // group just picked. Read `g.makes` directly — `takenMakes` derives from
        // `selectedGroup`, which this render has not seen updated yet.
        const currentMake = form.getValues("make");
        if (currentMake) {
            const label =
                (makeList || []).find((m: any) => m.name === currentMake)?.make_name || currentMake;
            const nowTaken = (g?.makes ?? []).some(
                mk => (mk.make || "").trim().toLowerCase() === String(label).trim().toLowerCase()
            );
            if (nowTaken) form.setValue("make", "");
        }
    };

    // A HANDLER, not a useEffect on `filterWP` — `handleGroupChange` writes it
    // too, and an effect could not tell that derived write from a user's; it
    // would clear the very group that caused it.
    const handleFilterWPChange = (opt: any) => {
        const nextWP: string = opt?.value || "";
        if (nextWP === filterWP) return; // no-op re-pick must not wipe the pick
        setFilterWP(nextWP);
        // A group belongs to exactly one WP, so any real change strands the pick.
        setSelectedGroup(null);
        form.setValue("tds_item_id", "");
        form.setValue("tds_item_name", "");
        form.setValue("work_package", "");
    };

    // Each type keeps its own fields, so a round-trip loses nothing typed. Only
    // the New Make pick is dropped on leaving it: its greyed-out makes would
    // otherwise follow the user into Project Custom.
    // (Everything resets on dialog close via handleCancel.)
    const handleModeChange = (next: RequestMode) => {
        if (next === mode) return;
        form.setValue("mode", next);
        form.clearErrors();
        if (mode === "new_make") {
            setSelectedGroup(null);
            setFilterWP("");
            form.setValue("tds_item_id", "");
            form.setValue("tds_item_name", "");
            form.setValue("work_package", "");
        }
    };

    // The clash warning's one-click fix: switch to New Make with that item picked.
    const switchToNewMake = (g: GroupResult) => {
        handleModeChange("new_make");
        handleGroupChange({ group: g });
    };

    // A HANDLER, not an effect: a Category belongs to one package, so any
    // package change strands it.
    const handleCustomWPChange = (opt: { value: string } | null) => {
        const next: string = opt?.value || "";
        if (next === customWP) return;
        form.setValue("custom_work_package", next, { shouldValidate: form.formState.isSubmitted });
        form.setValue("category", "");
    };

    const onSubmit = (values: z.infer<typeof formSchema>) => {
        if (!selectedFile) {
            setFileError("Attachment is required");
            return;
        }
        const makeName = makeOptions.find(m => m.value === values.make)?.label || values.make;
        const shared = {
            make: makeName,                  // human make name (frozen as tds_make)
            description: values.description || "",
            tds_boq_line_item: values.boq_ref || "",
            attachmentFile: selectedFile,
            is_new_request: true,
        };
        onAddItem(
            values.mode === "new_make"
                ? {
                    ...shared,
                    tds_item_id: values.tds_item_id || "",
                    tds_item_name: values.tds_item_name || "",
                    work_package: values.work_package || "",
                    category: "",
                }
                : {
                    ...shared,
                    // The server issues the project-only PCUS- id on send.
                    tds_item_id: "",
                    tds_item_name: (values.custom_name || "").trim(),
                    work_package: values.custom_work_package || "",
                    category: values.category || "",
                    is_project_custom: true,
                }
        );
        handleCancel();
    };

    const handleCancel = () => {
        onOpenChange(false);
        form.reset(EMPTY_FORM);
        setSelectedGroup(null);
        setFilterWP("");
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
                            {/* Type: two stacked radio cards, each with one line of help. */}
                            <fieldset className="space-y-2">
                                <legend className="text-sm font-bold text-gray-700 mb-2">Type</legend>
                                <div role="radiogroup" aria-label="Type" className="space-y-2">
                                    {TYPE_CHOICES.map(choice => {
                                        const on = mode === choice.value;
                                        return (
                                            <button
                                                key={choice.value}
                                                type="button"
                                                role="radio"
                                                aria-checked={on}
                                                onClick={() => handleModeChange(choice.value)}
                                                className={`w-full text-left flex gap-3 items-start rounded-lg border p-3 transition-colors ${on ? "border-[#dc2626] bg-red-50" : "border-gray-200 hover:bg-gray-50"}`}
                                            >
                                                <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${on ? "border-[#dc2626]" : "border-gray-300"}`}>
                                                    {on && <span className="h-2 w-2 rounded-full bg-[#dc2626]" />}
                                                </span>
                                                <span>
                                                    <span className="block text-sm font-semibold text-gray-900">{choice.label}</span>
                                                    <span className="block text-xs text-gray-500">{choice.help}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>

                            {mode === "new_make" ? (
                              <>
                                {/* Work Package scope for the existing-group picker.
                                    Narrows the list; picking an item DERIVES it. */}
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-sm font-bold text-gray-700">
                                        Work Package<span className="text-red-500 ml-0.5">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <RSelect
                                            options={tdsWpOptions}
                                            value={tdsWpOptions.find(o => o.value === filterWP) || null}
                                            onChange={handleFilterWPChange}
                                            placeholder="All work packages"
                                            isClearable
                                            classNamePrefix="react-select"
                                            // Inline, not portalled — see the Make select below for why a
                                            // body-level portal cannot be wheel-scrolled inside a Radix Dialog.
                                            menuPlacement="auto"
                                            formatOptionLabel={(option: any) => (
                                                <span>
                                                    {option.label}{" "}
                                                    <span className="text-xs text-blue-600">
                                                        ({option.groupCount} TDS item{option.groupCount === 1 ? "" : "s"})
                                                    </span>
                                                </span>
                                            )}
                                        />
                                    </FormControl>
                                </FormItem>

                                {/* Existing group picker */}
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
                                                        searchFields: ['label', 'value'],
                                                        minSearchLength: 1,
                                                        partialMatch: true,
                                                        minTokenLength: 1,
                                                        fieldWeights: { label: 2.0, value: 1.5 },
                                                        minTokenMatches: 1,
                                                    }}
                                                    value={selectedGroup ? { label: selectedGroup.tds_item_name, value: selectedGroup.tds_item } : null}
                                                    onChange={handleGroupChange as any}
                                                    placeholder="Search TDS item..."
                                                    classNamePrefix="react-select"
                                                    isClearable
                                                    isLoading={isSearching}
                                                    noOptionsMessage={() => isSearching ? "Loading TDS items..." : "No matching TDS items"}
                                                    menuPortalTarget={document.body}
                                                    menuPosition="fixed"
                                                    styles={PORTAL_SELECT_STYLES}
                                                    formatOptionLabel={(option: any) => (
                                                        <div className="flex flex-col">
                                                            <span>
                                                                {option.label}
                                                                {/* No members ⇒ the frozen category will be blank. */}
                                                                {option.memberCount === 0 && (
                                                                    <span className="ml-2 text-[10px] uppercase text-amber-600">
                                                                        No linked SKUs
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {/* Unscoped, the list spans every package, so the
                                                                name alone can't say which one a result is in. */}
                                                            {!filterWP && option.workPackage && (
                                                                <span className="text-xs text-muted-foreground">{option.workPackage}</span>
                                                            )}
                                                        </div>
                                                    )}
                                                />
                                            </FormControl>
                                            {/* Picked a member-less group: say what it costs BEFORE the
                                                request is filed. Approval creates the row either way, and
                                                the blank only surfaces in the history / exported PDF. */}
                                            {selectedGroup && (memberCounts[selectedGroup.tds_item] ?? 0) === 0 && (
                                                <p className="text-xs text-amber-600">
                                                    Unlinked TDS Item — no linked product SKUs, so this row's <b>Category will be blank</b>.
                                                    Category is derived from the item's linked SKUs; link SKUs to it in the TDS
                                                    Repository first if the report needs one.
                                                </p>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                              </>
                            ) : (
                                /* Project Custom: name, Work Package, Category */
                                <>
                                    <FormField
                                        control={form.control}
                                        name="custom_name"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1">
                                                <FormLabel className="text-sm font-bold text-gray-700">Item Name<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="e.g. Facade Linear Light 24W" className="h-11 border-gray-200 rounded-lg bg-gray-50/30 focus:bg-white transition-all font-medium" />
                                                </FormControl>
                                                {clashGroup && (
                                                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                                        <b>"{clashGroup.tds_item_name}" already exists in the TDS Repository.</b> Use{" "}
                                                        <button
                                                            type="button"
                                                            className="underline font-semibold"
                                                            onClick={() => switchToNewMake(clashGroup)}
                                                        >
                                                            Add New Make
                                                        </button>{" "}
                                                        instead? You can still create it as a Project Custom item.
                                                    </div>
                                                )}
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="custom_work_package"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1 min-w-0">
                                                    <FormLabel className="text-sm font-bold text-gray-700">Work Package<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                                    <FormControl>
                                                        <RSelect
                                                            options={packageOptions}
                                                            value={packageOptions.find(opt => opt.value === field.value) || null}
                                                            onChange={handleCustomWPChange}
                                                            placeholder="Select Work Package"
                                                            classNamePrefix="react-select"
                                                            // Inline, not portalled — see the Make select for why.
                                                            menuPlacement="auto"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="category"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1 min-w-0">
                                                    <FormLabel className="text-sm font-bold text-gray-700">Category<span className="text-red-500 ml-0.5">*</span></FormLabel>
                                                    <FormControl>
                                                        <RSelect
                                                            options={categoryOptions}
                                                            value={categoryOptions.find(opt => opt.value === field.value) || null}
                                                            onChange={(opt: any) => field.onChange(opt?.value || "")}
                                                            placeholder={customWP ? "Select Category" : "Pick a Work Package first"}
                                                            isDisabled={!customWP}
                                                            isLoading={!!customWP && isLoadingCategories}
                                                            noOptionsMessage={() => "No categories under this package"}
                                                            classNamePrefix="react-select"
                                                            menuPlacement="auto"
                                                        />
                                                    </FormControl>
                                                    <p className="text-[11px] text-gray-500">Categories under the chosen package.</p>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
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
                                                // NOT portalled, unlike the other selects here — this menu is
                                                // the long one (~378 makes) and must scroll on the wheel.
                                                // Radix Dialog wraps its content in `react-remove-scroll`,
                                                // which puts a non-passive `wheel` listener on `document` and
                                                // preventDefault()s any event whose target is OUTSIDE the
                                                // dialog content. A menu portalled to document.body is
                                                // outside it, so the wheel does nothing and only dragging the
                                                // scrollbar works. Rendering inline keeps the menu inside the
                                                // lock container, which is why the identical select on the
                                                // Select-Items-for-TDS page (no portal, no dialog) scrolls fine.
                                                // `menuPlacement="auto"` flips it upward when the dialog body
                                                // has no room below, since Make sits low in the form.
                                                menuPlacement="auto"
                                                // react-select blocks selection natively — stronger than an
                                                // onChange guard, which a keyboard pick could still slip past.
                                                isOptionDisabled={(opt: any) => !!opt.taken}
                                                formatOptionLabel={(option: any) => (
                                                    <span className={option.taken ? "text-gray-400" : ""}>
                                                        {option.label}
                                                        {option.taken && (
                                                            <span className="ml-2 text-[10px] uppercase">
                                                                (datasheet already exists — pick it in Select Items for TDS)
                                                            </span>
                                                        )}
                                                    </span>
                                                )}
                                            />
                                        </FormControl>
                                        {mode === "project_custom" && (
                                            <p className="text-[11px] text-gray-500">From the Makelist only.</p>
                                        )}
                                        {selectedGroup && takenMakes.size > 0 && (
                                            <p className="text-xs text-muted-foreground">
                                                {takenMakes.size} make{takenMakes.size === 1 ? "" : "s"} already
                                                {takenMakes.size === 1 ? " has" : " have"} a datasheet for this item and
                                                {takenMakes.size === 1 ? " is" : " are"} greyed out — request only a make that is missing one.
                                            </p>
                                        )}
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
