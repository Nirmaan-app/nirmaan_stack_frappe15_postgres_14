import React, { useState, useMemo, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import ReactSelect from "react-select";
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";
import { Trash2, FileText, PlusCircle, ExternalLink } from 'lucide-react';
import { useTdsExistingProjectItems } from '../../data/tds/useTdsQueries';
import { useDeleteTdsItem } from '../../data/tds/useTdsMutations';
import { toast } from "@/components/ui/use-toast";
import { RequestTdsItemDialog } from "./RequestTdsItemDialog";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeUpdateDoc, useFrappeGetCall } from "frappe-react-sdk";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUserData } from "@/hooks/useUserData";
import { TdsDraftResumeDialog } from "./TdsDraftResumeDialog";
// DraftIndicator is shared but consumed UNMODIFIED — its copy ("Saved 5 minutes
// ago") carries no flow-specific wording, so PR is unaffected by rendering it here.
import { DraftIndicator } from "@/components/ui/draft-indicator";
import { useTdsRequestDraftManager } from "../hooks/useTdsRequestDraftManager";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 (ADR-0003) — group-driven project TDS consumption.
//
// A project consumes by selecting a **TDS Item (group) + Make**. One cart row =
// one `(TDS Item, Make)` pair. The picker (FuzzySearchSelect backed by the
// `search_tds_items` API) fuzzy-matches the group NAME and member item SKUs; a
// member hit resolves server-side to its parent group (surfaced with a "contains
// …" subtitle). On group pick, the Make dropdown is limited to makes that already
// HAVE a Repository Entry (datasheet) for that group. Picking an existing entry →
// a "Pending" row carrying the frozen `(tds_item_id, tds_make)` snapshot + the
// entry's datasheet. New requests (missing make / new group) come from the
// RequestTdsItemDialog and produce "New" rows. Dedup is on `(tds_item_id,
// tds_make)` exact id+make, never name.
// ─────────────────────────────────────────────────────────────────────────────

interface TdsCreateFormProps {
    projectId: string;
    onSuccess?: () => void;
    /**
     * Called when a saved draft is resumed. Both tabs are always MOUNTED (the
     * parent toggles them with `hidden`), so this form — and its resume dialog —
     * loads even while the user is on TDS History. Resuming has to bring the tab
     * with it, or the restored cart lands on a screen nobody is looking at.
     */
    onDraftResumed?: () => void;
}

// One make-with-datasheet for a group (mirrors BE-PICKER `makes[]` shape).
interface GroupMake {
    make: string;
    entry: string;
    tds_attachment?: string;
    status?: string;
}

// One result row from `search_tds_items`.
interface GroupResult {
    tds_item: string;
    tds_item_name: string;
    work_package: string;
    matched_member?: { item: string; item_name: string } | null;
    makes: GroupMake[];
}

// A staged cart row destined for `Project TDS Item List`.
interface CartItem {
    // Frozen TDS Item id (group). Empty string for a brand-new group request.
    tds_item_id: string;
    tds_item_name: string;
    make: string;              // the chosen make (frozen as tds_make)
    work_package: string;
    category?: string;         // optional snapshot; new picks leave blank
    description?: string;
    tds_attachment?: string;   // datasheet url for an existing entry
    tds_boq_line_item?: string;
    is_new_request?: boolean;  // true ⇒ status "New" + needs upload
    attachmentFile?: File;     // for newly requested items (uploaded on submit)
    previousDocName?: string;  // a Rejected row being replaced
}

export const TdsCreateForm: React.FC<TdsCreateFormProps> = ({ projectId, onSuccess, onDraftResumed }) => {
    const { role } = useUserData();
    const [cartItems, setCartItems] = useState<CartItem[]>([]);

    // Persists the staged cart per project, so navigating away no longer loses
    // it. Everything draft-related lives in the hook; this component only reads
    // its flags. A restored "New" request row cannot carry its uploaded PDF
    // (a File does not survive JSON storage), so it comes back flagged and the
    // submit stays blocked until it is removed and re-requested.
    const draft = useTdsRequestDraftManager<CartItem>({
        projectId,
        cartItems,
        setCartItems,
    });

    // Picker state. There is no typed-query state any more: the whole (optionally
    // WP-scoped) group set is fetched ONCE and `FuzzySearchSelect` filters it
    // client-side — see the fetch below for why.
    const [selectedWP, setSelectedWP] = useState<string>("");
    const [selectedGroup, setSelectedGroup] = useState<GroupResult | null>(null);
    const [selectedMake, setSelectedMake] = useState<string | null>(null);
    const [selectedBoqLineItem, setSelectedBoqLineItem] = useState("");

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);

    // Ref used to pull the picker field to the top of the viewport when its
    // dropdown opens, so the option list has room to expand below.
    const itemNameWrapperRef = useRef<HTMLDivElement>(null);
    const handleItemMenuOpen = () => {
        requestAnimationFrame(() => {
            itemNameWrapperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    };

    const { createDoc: createFrappeDoc } = useFrappeCreateDoc();
    const { upload: uploadFile } = useFrappeFileUpload();
    const { updateDoc: updateFrappeDoc } = useFrappeUpdateDoc();
    const { deleteDoc: deleteOldStyleDoc } = useDeleteTdsItem();

    // Resubmit-rejected confirmation dialog state.
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState("");
    const [pendingItemToAdd, setPendingItemToAdd] = useState<CartItem | null>(null);

    // Existing project rows (dedup against (tds_item_id, tds_make), allow re-entry of Rejected).
    const { data: existingProjectItems } = useTdsExistingProjectItems(projectId);

    // ── Work Package options (OPTIONAL filter above the picker) ────────────────
    // Sourced from `TDS Items` itself, NOT a work-package doctype, so every
    // option is guaranteed to return groups and the ids are exactly what
    // `search_tds_items(work_package=…)` filters on. `group_count` labels each
    // option so the user can see how big the list will be before picking.
    const { data: wpData } = useFrappeGetCall<{
        message: { work_package: string; group_count: number }[];
    }>("nirmaan_stack.api.tds.picker.get_tds_work_packages", undefined, "tds_picker_work_packages");

    // `label` stays the BARE work package name: react-select filters on it, so
    // baking the count in would make typing "21" match a package. The count
    // rides alongside and is rendered by `formatOptionLabel`.
    const wpOptions = useMemo(
        () =>
            (wpData?.message ?? []).map(w => ({
                label: w.work_package,
                value: w.work_package,
                groupCount: w.group_count,
            })),
        [wpData]
    );

    // ── Group+make picker source (BE-PICKER) ───────────────────────────────────
    // LOAD-ONCE, FILTER-CLIENT-SIDE. `limit: 0` means unlimited (the endpoint
    // treats <= 0 that way); no `query` is sent at all.
    //
    // Why not a per-keystroke server search: the server matches ONE CONTIGUOUS
    // substring over the whole typed string, while `FuzzySearchSelect` tokenizes
    // and needs only one token to hit. With the server running first, its
    // strictness won — "hydrogen exhaust" returned nothing for a group that
    // exists, because "Gas " sits between the two words. Handing the component
    // the full set lets it do the matching it was built for, and removes a
    // 300 ms debounce + round-trip from every keystroke.
    //
    // Cost is bounded and small: 352 groups uncapped ≈ 222 KB, and a WP scope
    // cuts it further (largest package is 131). One fetch per WP, SWR-cached.
    const { data: searchData, isLoading: isSearching } = useFrappeGetCall<{ message: GroupResult[] }>(
        "nirmaan_stack.api.tds.picker.search_tds_items",
        { work_package: selectedWP || undefined, limit: 0 },
        `tds_picker_groups_${selectedWP || "all"}`
    );

    // Sets used to exclude already-consumed (group, make) pairs from selection.
    // Pending/Approved (and legacy null-status) rows block re-selection; Rejected
    // rows are allowed back (with a resubmit confirmation).
    const activePairs = useMemo(() => {
        const set = new Set<string>();
        (existingProjectItems || []).forEach((i: any) => {
            if (i.tds_status === "Rejected") return;
            set.add(`${i.tds_item_id}__${i.tds_make}`);
        });
        return set;
    }, [existingProjectItems]);

    const isAdmin = role === "Nirmaan Admin Profile" || role === "Administrator";
    const isPMO = role === "Nirmaan PMO Executive Profile";
    const canRequestNew = isAdmin || isPMO;

    const cartPairs = useMemo(
        () => new Set(cartItems.map(i => `${i.tds_item_id}__${i.make}`)),
        [cartItems]
    );

    // Member count per group — ONE batched pass over `Items` (the same endpoint
    // the TDS master page uses). A group ABSENT from `counts` has ZERO members:
    // a "custom item" in the domain's vocabulary (Work Package + label only).
    //
    // Why the picker has to say so: a TDS Item has no category of its own, so
    // `Project TDS Item List.tds_category` is DERIVED from its members'
    // `Items.category` (`get_group_category`, run in the before_save hook). A
    // member-less group therefore freezes an EMPTY category — and the cart has
    // no Category column, so nothing reveals that until the submittal history or
    // the exported PDF. These groups are fully pickable (all of them carry
    // datasheets), which is exactly why the blank is easy to walk into.
    const { data: memberIndexData } = useFrappeGetCall<{
        message: { counts: Record<string, number>; categories: string[] };
    }>("nirmaan_stack.api.tds.members.get_tds_member_index", undefined, "tds_member_index");

    const memberCounts = memberIndexData?.message?.counts ?? {};

    // Picker options: one per group result. ADR-0004 — the picker searches GROUP
    // NAMES only (stakeholder ruling), so there is no member hit to attribute and
    // the old "contains <member>" subtitle is gone. `search_tds_items` still
    // returns `matched_member`, but always null unless someone opts back in via
    // its default-off `include_member_matches`.
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

    // Make options for the picked group — only makes-with-datasheet, minus any
    // (group, make) pair already consumed by the project or staged in the cart.
    const makeOptions = useMemo(() => {
        if (!selectedGroup) return [];
        return selectedGroup.makes
            .filter(m => {
                const key = `${selectedGroup.tds_item}__${m.make}`;
                return !cartPairs.has(key);
            })
            .map(m => ({
                label: m.make,
                value: m.make,
                entry: m,
                consumed: activePairs.has(`${selectedGroup.tds_item}__${m.make}`),
            }));
    }, [selectedGroup, cartPairs, activePairs]);

    // The resolved make entry (datasheet) for the current (group, make) selection.
    const selectedEntry = useMemo<GroupMake | null>(() => {
        if (!selectedGroup || !selectedMake) return null;
        return selectedGroup.makes.find(m => m.make === selectedMake) || null;
    }, [selectedGroup, selectedMake]);

    // Work Package is required, but never a step the user has to take first:
    // picking a group auto-fills it (`handleGroupChange`), so item-first entry
    // satisfies this on its own. It can only be empty when nothing is picked —
    // and then the group/make checks already block the add.
    const canAdd = !!selectedWP && !!selectedGroup && !!selectedMake && !!selectedEntry;

    // ── Handlers ────────────────────────────────────────────────────────────────
    const handleGroupChange = (opt: any) => {
        const g: GroupResult | null = opt?.group || null;
        setSelectedGroup(g);
        setSelectedMake(null);
        // Picking an item DERIVES the work package (the field is only a filter,
        // so a user who goes straight to the item never has to set it). Safe to
        // set unconditionally: the group is by definition in its own WP, so the
        // narrowed list still contains it.
        if (g?.work_package) setSelectedWP(g.work_package);
    };

    // Deliberately a HANDLER, not a useEffect on `selectedWP`. `handleGroupChange`
    // writes selectedWP too, and an effect could not tell that derived write apart
    // from a user's — it would clear the very group that caused it.
    const handleWPChange = (opt: any) => {
        const nextWP: string = opt?.value || "";
        // Re-picking the value already showing (typically the one auto-filled by
        // the group) is a no-op — it must NOT wipe the selection.
        if (nextWP === selectedWP) return;
        setSelectedWP(nextWP);
        // Drop the picks that hang off the old scope — a group belongs to exactly
        // one work package, so any change strands it, and the BOQ ref describes an
        // item that no longer exists. `clearPicks`, NOT `resetSelection`: the
        // latter blanks the work package too and would undo the line above.
        clearPicks();
    };

    const handleAddItem = () => {
        if (!selectedGroup || !selectedMake || !selectedEntry) return;

        if (selectedBoqLineItem.length > 500) {
            toast({
                title: "Validation Error",
                description: "BOQ Line Item cannot exceed 500 characters",
                variant: "destructive",
            });
            return;
        }

        const pairKey = `${selectedGroup.tds_item}__${selectedMake}`;

        // Duplicate in cart (defensive — make options already exclude staged pairs).
        if (cartPairs.has(pairKey)) {
            toast({
                title: "Duplicate in Cart",
                description: "This item + make is already in your current selection.",
                variant: "destructive",
            });
            return;
        }

        const newRow: CartItem = {
            tds_item_id: selectedGroup.tds_item,
            tds_item_name: selectedGroup.tds_item_name,
            make: selectedMake,
            work_package: selectedGroup.work_package,
            category: "",
            description: "",
            tds_attachment: selectedEntry.tds_attachment,
            tds_boq_line_item: selectedBoqLineItem,
            is_new_request: false,
        };

        // Replace a previously-rejected row? Require typed confirmation.
        const rejectedEntry = existingProjectItems?.find((i: any) =>
            i.tds_item_id === selectedGroup.tds_item &&
            i.tds_make === selectedMake &&
            i.tds_status === "Rejected"
        );
        if (rejectedEntry) {
            setPendingItemToAdd({ ...newRow, previousDocName: rejectedEntry.name });
            setConfirmInput("");
            setShowConfirmDialog(true);
            return;
        }

        setCartItems(prev => [...prev, newRow]);
        resetSelection();
    };

    const confirmResubmission = () => {
        if (confirmInput === "1" && pendingItemToAdd) {
            setCartItems(prev => [...prev, pendingItemToAdd]);
            setPendingItemToAdd(null);
            setShowConfirmDialog(false);
            resetSelection();
            toast({ title: "Item Added", description: "Previous rejected entry will be replaced upon submission." });
        } else {
            toast({ title: "Invalid Input", description: "Please enter '1' to continue.", variant: "destructive" });
        }
    };

    const handleRemoveItem = (index: number) => {
        setCartItems(prev => prev.filter((_, i) => i !== index));
    };

    // Clears the WHOLE selection — scope included. Every entry starts from a
    // blank form: after an item lands in the cart, after a rejected-row
    // resubmit, and on the explicit Reset button.
    // Clears everything that hangs off a work package — but NOT the scope itself.
    // Used when the scope CHANGES (the new one must survive).
    const clearPicks = () => {
        setSelectedGroup(null);
        setSelectedMake(null);
        setSelectedBoqLineItem("");
    };

    // Full reset, scope included: after an item lands in the cart, after a
    // rejected-row resubmit, and on the Reset button. Never call this from the
    // work-package handler — it would blank the value the user just chose.
    const resetSelection = () => {
        setSelectedWP("");
        clearPicks();
    };

    const handleReset = () => {
        resetSelection();
    };

    // A "New" request from the RequestTdsItemDialog. Dedup on (tds_item_id, make);
    // new-group requests (empty tds_item_id) are always allowed through.
    const handleAddRequestedItem = (item: CartItem) => {
        if (item.tds_item_id) {
            const pairKey = `${item.tds_item_id}__${item.make}`;
            if (cartPairs.has(pairKey)) {
                toast({
                    title: "Duplicate in Cart",
                    description: "This item + make is already in your current selection.",
                    variant: "destructive",
                });
                return;
            }
            if (activePairs.has(pairKey)) {
                toast({
                    title: "Already Submitted",
                    description: "This item + make already exists for this project.",
                    variant: "destructive",
                });
                return;
            }
        }
        setCartItems(prev => [...prev, item]);
    };

    const NewItemBadge = () => (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase tracking-tight ml-2">
            New
        </span>
    );

    const handleLogSubmit = async () => {
        if (cartItems.length === 0) return;
        setIsSubmitting(true);

        // Allocate the next RQ request id for this project.
        let nextSeq = 1;
        const projectSuffix = projectId.slice(-3);
        if (existingProjectItems) {
            const prefix = `RQ-${projectSuffix}-`;
            const reqIds = existingProjectItems
                .map((i: any) => i.tds_request_id)
                .filter((id: string) => id && id.startsWith(prefix));
            if (reqIds.length > 0) {
                const maxId = Math.max(...reqIds.map((id: string) => {
                    const parts = id.split("-");
                    return parseInt(parts[parts.length - 1]) || 0;
                }));
                if (!isNaN(maxId)) nextSeq = maxId + 1;
            }
        }
        const uniqueReqId = `RQ-${projectSuffix}-${nextSeq.toString().padStart(2, '0')}`;

        try {
            // 1. Delete previous rejected records being replaced.
            const itemsToDelete = cartItems
                .filter(item => item.previousDocName)
                .map(item => item.previousDocName!);
            if (itemsToDelete.length > 0) {
                await Promise.all(itemsToDelete.map(name => deleteOldStyleDoc(name, projectId)));
            }

            // 2. Create each row (pure snapshot — ROW SHAPE per ADR-0003).
            await Promise.all(cartItems.map(async (item) => {
                const docData = {
                    tdsi_project_id: projectId,
                    tds_request_id: uniqueReqId,
                    tds_item_id: item.tds_item_id || "",   // frozen TDS Item id ("" for new group)
                    tds_item_name: item.tds_item_name,
                    tds_make: item.make,
                    tds_description: item.description || "",
                    tds_work_package: item.work_package,
                    tds_category: item.category || "",
                    tds_status: item.is_new_request ? "New" : "Pending",
                    tds_boq_line_item: item.tds_boq_line_item || "",
                    tds_attachment: item.tds_attachment, // carried over for picked entries
                };

                const newDoc = await createFrappeDoc("Project TDS Item List", docData);

                // 3. Upload the requested datasheet (New rows) if present.
                if (newDoc && newDoc.name && item.attachmentFile) {
                    try {
                        const uploadResp = await uploadFile(item.attachmentFile, {
                            doctype: "Project TDS Item List",
                            docname: newDoc.name,
                            fieldname: "tds_attachment",
                            isPrivate: true,
                        });
                        const responseData = uploadResp as any;
                        const fileUrl = responseData?.message?.file_url || responseData?.file_url;
                        if (fileUrl) {
                            await updateFrappeDoc("Project TDS Item List", newDoc.name, {
                                tds_attachment: fileUrl,
                            });
                        }
                    } catch (uploadError) {
                        console.error(`Failed to upload file for ${item.tds_item_name}:`, uploadError);
                        // Record is created; continue.
                    }
                }
            }));

            toast({
                title: "Request Submitted",
                description: `Successfully submitted ${cartItems.length} items for approval.`,
                className: "bg-green-50 border-green-200 text-green-800",
            });

            // Only on SUCCESS — a failed submit must keep the draft.
            draft.clearDraftAfterSubmit();
            setCartItems([]);
            handleReset();
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error("Submission failed", error);
            toast({
                title: "Submission Failed",
                description: "There was an error submitting your items. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-8">
            {/* Form Section */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Select Items for TDS</h3>
                        <p className="text-sm text-gray-500">Optionally narrow by work package, then search a TDS item and choose a make.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleReset} className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
                        Reset
                    </Button>
                </div>

                {/* Selection grid, TWO columns so the four fields auto-flow as:
                    row 1 = Work Package | TDS Item,  row 2 = Make | BOQ Line Item. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    {/* Work Package scope. Narrows the TDS Item list; picking an
                        item without setting this DERIVES it (see handleGroupChange). */}
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold text-gray-700">
                            Work Package <span className="text-red-500">*</span>
                        </Label>
                        <ReactSelect
                            options={wpOptions}
                            value={wpOptions.find(o => o.value === selectedWP) || null}
                            onChange={handleWPChange}
                            placeholder="All work packages"
                            isClearable
                            classNamePrefix="react-select"
                            formatOptionLabel={(option: any) => (
                                <span>
                                    {option.label}{" "}
                                    <span className="text-xs text-blue-600">
                                        ({option.groupCount} TDS item{option.groupCount === 1 ? "" : "s"})
                                    </span>
                                </span>
                            )}
                        />
                        <p className="text-xs text-muted-foreground">
                            {selectedWP
                                ? "Showing TDS items in this work package only. Clearing it resets the selection."
                                : "Showing every TDS item. Pick a work package to shorten the list, or choose an item and this fills itself."}
                        </p>
                    </div>

                    {/* TDS Item group picker */}
                    <div className="space-y-2 scroll-mt-4" ref={itemNameWrapperRef}>
                        <Label className="text-sm font-semibold text-gray-700">TDS Item <span className="text-red-500">*</span></Label>
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
                                    {/* Unscoped, the list spans every package, so the group
                                        name alone can't say which one a result belongs to. */}
                                    {!selectedWP && option.workPackage && (
                                        <span className="text-xs text-muted-foreground">{option.workPackage}</span>
                                    )}
                                </div>
                            )}
                            placeholder="Search TDS item..."
                            isClearable
                            isLoading={isSearching}
                            noOptionsMessage={() => isSearching ? "Loading TDS items..." : "No matching TDS items"}
                            onMenuOpen={handleItemMenuOpen}
                        />
                        {/* Picked a member-less group: say what it costs BEFORE the row is
                            created, since the cart shows no category and the blank only
                            surfaces in the submittal history and the exported PDF.

                            "first" is load-bearing. The before_save hook fills tds_category
                            only when the row `is_new()` or its `tds_item_id` changed, so
                            linking SKUs AFTER the row exists does NOT backfill it. Linking
                            now, then adding to the cart, is the whole difference. */}
                        {selectedGroup && (memberCounts[selectedGroup.tds_item] ?? 0) === 0 && (
                            <p className="text-xs text-amber-600">
                                Custom item — no linked SKUs, so <b>Category will be blank</b>.
                                Link SKUs first and Category fills in automatically:{" "}
                                {/* A NEW TAB, not `navigate` — the fix is on another page and the
                                    user is mid-cart. Routing away would unmount the form; the
                                    draft would restore it, but only through the resume prompt. */}
                                <a
                                    href={`/tds-repository/item/${selectedGroup.tds_item}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
                                >
                                    {selectedGroup.tds_item}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                            Can't find it?{" "}
                            {canRequestNew ? (
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                                    onClick={() => setIsRequestDialogOpen(true)}
                                >
                                    <PlusCircle className="h-3.5 w-3.5" />
                                    Request New
                                </button>
                            ) : (
                                <span className="text-gray-500 italic">Please contact PMO to request a new item.</span>
                            )}
                        </p>
                        <RequestTdsItemDialog
                            open={isRequestDialogOpen}
                            onOpenChange={setIsRequestDialogOpen}
                            onAddItem={handleAddRequestedItem}
                        />
                    </div>

                    {/* Make */}
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold text-gray-700">Make <span className="text-red-500">*</span></Label>
                        <ReactSelect
                            options={makeOptions}
                            value={selectedMake ? { label: selectedMake, value: selectedMake } : null}
                            onChange={(opt: any) => {
                                if (opt?.consumed) {
                                    toast({
                                        title: "Already Submitted",
                                        description: "This item + make already exists for this project.",
                                        variant: "destructive",
                                    });
                                    return;
                                }
                                setSelectedMake(opt?.value || null);
                            }}
                            placeholder={selectedGroup ? (makeOptions.length ? "Select Make" : "No datasheets available") : "Select TDS item first"}
                            isDisabled={!selectedGroup}
                            className="react-select-container"
                            classNamePrefix="react-select"
                            formatOptionLabel={(option: any) => (
                                <span className={option.consumed ? "text-gray-400" : ""}>
                                    {option.label}
                                    {option.consumed && <span className="text-[10px] ml-2 uppercase">(already submitted)</span>}
                                </span>
                            )}
                        />
                        {selectedGroup && makeOptions.length === 0 && (
                            <p className="text-xs text-amber-600">
                                No makes with datasheets are available for this item. {canRequestNew ? 'Use "Request New" to request one.' : 'Please contact PMO to request a new one.'}
                            </p>
                        )}
                    </div>

                    {/* BOQ Line Item (Optional) — sits beside Make on row 2. */}
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold text-gray-700">BOQ Line Item <span className="text-gray-400 font-normal">(Optional)</span></Label>
                        <Textarea
                            value={selectedBoqLineItem}
                            onChange={(e) => setSelectedBoqLineItem(e.target.value)}
                            placeholder="Enter BOQ Line Item Ref"
                            rows={3}
                            maxLength={500}
                        />
                        <div className="text-xs text-right text-gray-500 mt-1">
                            {selectedBoqLineItem.length}/500
                        </div>
                    </div>
                </div>

                <Button
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-medium disabled:bg-gray-100 disabled:text-gray-400 disabled:border disabled:border-gray-200 disabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-100"
                    onClick={handleAddItem}
                    disabled={!canAdd}
                >
                    Add item
                </Button>
            </div>

            {/* Cart Table Section */}
            {cartItems.length > 0 && (
                <div>
                    <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">Selected Items for TDS</h3>
                            <p className="text-sm text-gray-500">Review selected items before sending for approval.</p>
                        </div>
                        {(draft.hasDraft || draft.isSaving || draft.lastSavedText) && (
                            <DraftIndicator
                                lastSavedText={draft.lastSavedText}
                                isSaving={draft.isSaving}
                            />
                        )}
                    </div>

                    {/* A restored request row lost its uploaded PDF — the cart is not
                        editable, so the only remedy is remove-and-re-request. */}
                    {draft.needsReattachCount > 0 && (
                        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            {draft.needsReattachCount} restored request{draft.needsReattachCount === 1 ? "" : "s"}{" "}
                            {draft.needsReattachCount === 1 ? "has" : "have"} lost the attached datasheet — a saved draft
                            cannot keep an uploaded file. Remove {draft.needsReattachCount === 1 ? "it" : "them"} below
                            and file the request again before sending for approval.
                        </div>
                    )}

                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <Table>
                            <TableHeader className="bg-gray-50">
                                <TableRow>
                                    <TableHead className="font-semibold text-gray-700">Work Package</TableHead>
                                    <TableHead className="font-semibold text-gray-700">Item Name</TableHead>
                                    <TableHead className="font-semibold text-gray-700 w-1/3">Description</TableHead>
                                    <TableHead className="font-semibold text-gray-700">Make</TableHead>
                                    <TableHead className="font-semibold text-gray-700 text-center">BOQ Ref</TableHead>
                                    <TableHead className="font-semibold text-gray-700 text-center">Doc.</TableHead>
                                    <TableHead className="font-semibold text-gray-700 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {cartItems.map((item, idx) => (
                                    <TableRow key={`${item.tds_item_id}-${item.make}-${idx}`}>
                                        <TableCell>{item.work_package}</TableCell>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center">
                                                {item.tds_item_name}
                                                {item.is_new_request && <NewItemBadge />}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="truncate max-w-[200px]" title={item.description}>
                                                {item.description}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                                                {item.make}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {item.tds_boq_line_item ? (
                                                <span className="text-sm text-gray-700 whitespace-normal break-words">
                                                    {item.tds_boq_line_item}
                                                </span>
                                            ) : (
                                                <span className="text-gray-300">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {item.tds_attachment ? (
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => window.open(item.tds_attachment, '_blank')}>
                                                    <FileText className="h-4 w-4" />
                                                </Button>
                                            ) : item.attachmentFile ? (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-blue-600 hover:bg-blue-50"
                                                                onClick={() => {
                                                                    const url = URL.createObjectURL(item.attachmentFile!);
                                                                    window.open(url, '_blank');
                                                                }}
                                                            >
                                                                <FileText className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent className="max-w-[300px] whitespace-normal break-words">
                                                            <p>{item.attachmentFile.name} (uploads on submit)</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            ) : (
                                                <span className="text-gray-300">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                                                onClick={() => handleRemoveItem(idx)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="mt-6 flex justify-end">
                        <Button
                            size="lg"
                            className="w-full md:w-auto bg-[#dc2626] hover:bg-[#b91c1c] text-white font-semibold text-base py-6 px-8 shadow-md shadow-red-100 hover:shadow-red-200 transition-all"
                            onClick={handleLogSubmit}
                            disabled={isSubmitting || draft.needsReattachCount > 0}
                            title={
                                draft.needsReattachCount > 0
                                    ? "Remove the restored request rows that lost their datasheet first."
                                    : undefined
                            }
                        >
                            {isSubmitting ? "Sending..." : "Send For Approval"}
                        </Button>
                    </div>
                </div>
            )}

            {/* Continue with the saved draft, or clear it and start fresh.
                TDS-local by owner ruling — the shared `draft-resume-dialog` is
                left untouched so the Approve New PR flow cannot be affected. */}
            <TdsDraftResumeDialog
                open={draft.showResumeDialog}
                onOpenChange={draft.setShowResumeDialog}
                onResume={() => {
                    draft.resumeDraft();
                    // Bring the tab along — the restored cart lives on this tab,
                    // and the dialog can be answered from TDS History.
                    onDraftResumed?.();
                }}
                onStartFresh={draft.startFresh}
                draftDate={draft.draftDate}
                itemCount={draft.pendingItemCount}
                needsReattachCount={draft.pendingNeedsReattachCount}
            />

            {/* Resubmit-rejected Confirmation Dialog */}
            <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Resubmit Rejected Item?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This item was previously rejected. To continue and replace the old entry, please enter <strong>"1"</strong> below.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4">
                        <Input
                            value={confirmInput}
                            onChange={(e) => setConfirmInput(e.target.value)}
                            placeholder="Enter 1 to confirm"
                            className="text-center text-lg font-bold"
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setShowConfirmDialog(false)}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                confirmResubmission();
                            }}
                            className="bg-red-600 hover:bg-red-700"
                            disabled={confirmInput !== "1"}
                        >
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
