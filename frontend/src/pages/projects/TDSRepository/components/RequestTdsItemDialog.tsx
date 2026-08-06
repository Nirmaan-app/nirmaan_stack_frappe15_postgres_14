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

export const RequestTdsItemDialog: React.FC<RequestTdsItemDialogProps> = ({ open, onOpenChange, onAddItem }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);

    // Existing-group picker state. No typed-query state: the whole (optionally
    // WP-scoped) set is loaded once and FuzzySearchSelect filters it client-side.
    // `filterWP` is the EXISTING tab's scope only — deliberately separate from the
    // form's `work_package` (which is the NEW tab's declared value + the snapshot
    // `handleGroupChange` writes). The two draw from different option lists, so
    // sharing one field would let a value valid in one tab be absent in the other.
    const [filterWP, setFilterWP] = useState<string>("");
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

    // Makes the PICKED GROUP already has a Repository Entry (datasheet) for.
    // `search_tds_items` returns these on every result; the dialog used to ignore
    // them and offer all ~372 Makelist rows, so a user could file a "New" request
    // for a datasheet that already exists. Approval then does NOTHING useful:
    // `_ensure_entry` returns early on an existing entry and never applies the
    // uploaded `tds_attachment`, so the PDF is silently discarded while the
    // project row keeps it — master and project end up on different documents.
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
    const wpOptions = useMemo(
        () => (wpList || []).map((w: any) => ({ label: w.work_package_name, value: w.name })),
        [wpList]
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
    // Only fetches while the dialog is open AND on the existing tab.
    const { data: searchData, isLoading: isSearching } = useFrappeGetCall<{ message: GroupResult[] }>(
        "nirmaan_stack.api.tds.picker.search_tds_items",
        { work_package: filterWP || undefined, limit: 0 },
        open && mode === "existing" ? `tds_request_groups_${filterWP || "all"}` : null
    );

    // Member count per group — ONE batched pass over `Items`. A group ABSENT from
    // `counts` has ZERO members: a "custom item" (Work Package + label only).
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

    // ADR-0004: group-name-only search, so no member hit to attribute — the old
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

    const handleModeChange = (next: "existing" | "new") => {
        if (next === mode) return;
        form.setValue("mode", next);

        // `tds_item_name` / `work_package` are SHARED between the two tabs, and
        // who wrote them decides whether they may survive the switch:
        //   • typed by the user in "new" mode  → keep, so a half-finished custom
        //     label is not lost on a tab round-trip;
        //   • snapshotted from a PICKED GROUP by `handleGroupChange` → drop, or
        //     the New tab opens pre-filled with the existing item's name.
        // `selectedGroup` is the discriminator: it is set only while a group is
        // picked, which is exactly when those fields hold the group's values.
        if (mode === "existing" && selectedGroup) {
            form.setValue("tds_item_name", "");
            form.setValue("work_package", "");
        }

        // The picked-group identity + picker UI state are meaningful only in
        // "existing" mode. (Everything resets on dialog close via handleCancel.)
        setSelectedGroup(null);
        setFilterWP("");
        form.setValue("tds_item_id", "");
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
                            {/* Mode toggle: existing group vs new group.
                                The house segmented control — same shape, same red
                                active fill, and the same two labels as the Edit
                                dialog, which offers this identical choice. Label
                                left, toggle right on one row. */}
                            <div className="space-y-1">
                                <div className="flex items-center justify-between gap-3">
                                    <FormLabel className="text-sm font-bold text-gray-700">TDS Item :</FormLabel>
                                    <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                                        <button
                                            type="button"
                                            onClick={() => handleModeChange("existing")}
                                            className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === "existing" ? "bg-[#dc2626] text-white shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                                        >
                                            Existing Item
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleModeChange("new")}
                                            className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === "new" ? "bg-[#dc2626] text-white shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                                        >
                                            New Item
                                        </button>
                                    </div>
                                </div>
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                    {mode === "existing"
                                        ? "Pick a TDS Item already in the repository."
                                        : "Create a new TDS Item — needs a name, Work Package and datasheet."}
                                </p>
                            </div>

                            {mode === "existing" ? (
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
                                                                        custom · no SKUs
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
                                                    Custom item — no linked product SKUs, so this row's <b>Category will be blank</b>.
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
                                                        // Inline, not portalled — see the Make select for why.
                                                        menuPlacement="auto"
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
