// src/pages/ExpenseRequests/components/ExpensePackagesMaster.tsx
//
// Packages Settings → "Expense Packages". Manages the `Expense Type` master: add a type,
// edit its project / non-project scope, and author the Expense Request form format.
//
// The scope checkboxes are not cosmetic — they drive real behaviour downstream:
//   project only      -> the request form REQUIRES a project; approval writes Project Expenses
//   non-project only  -> the Project field is HIDDEN; approval writes Non Project Expenses
//   both              -> the field is OPTIONAL and the requester's choice picks the ledger
//   neither           -> unusable; the request form refuses the type outright

import React, { useMemo, useState } from "react";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { Braces, Pencil, PlusCircle, Search } from "lucide-react";

import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

import type { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

interface ExpenseCategoryRow { name: string; reviewer_role?: string | null }

// Every type belongs to a category; where none of the named ones fit, that category is
// "Other". There is deliberately no blank option -- an uncategorised type appears in no
// category list and routes to a reviewer nobody chose.
const FALLBACK_CATEGORY = "Other";
import { ExpenseFormatDialog } from "./ExpenseFormatDialog";

type ScopeLabel = "Project" | "Non-Project" | "Both" | "Unusable";

const scopeOf = (t: ExpenseType): ScopeLabel =>
    t.project && t.non_project ? "Both"
        : t.project ? "Project"
            : t.non_project ? "Non-Project"
                : "Unusable";

const SCOPE_STYLE: Record<ScopeLabel, string> = {
    Project: "bg-sky-100 text-sky-800",
    "Non-Project": "bg-violet-100 text-violet-800",
    Both: "bg-amber-100 text-amber-900",
    Unusable: "bg-red-100 text-red-800",
};

interface EditState {
    open: boolean;
    /** null = adding a new type */
    target: ExpenseType | null;
    expense_name: string;
    project: boolean;
    non_project: boolean;
    expense_category: string;
}

const BLANK: EditState = {
    open: false, target: null, expense_name: "", project: false, non_project: false,
    expense_category: FALLBACK_CATEGORY,
};

export const ExpensePackagesMaster: React.FC = () => {
    const [search, setSearch] = useState("");
    const [edit, setEdit] = useState<EditState>(BLANK);
    const [formatFor, setFormatFor] = useState<ExpenseType | null>(null);

    const { data, isLoading, error, mutate } = useFrappeGetDocList<ExpenseType>("Expense Type", {
        fields: ["name", "expense_name", "project", "non_project", "source_format",
                 "expense_category"],
        limit: 0,
        orderBy: { field: "expense_name", order: "asc" },
    });

    // Categories are CREATED in Frappe Desk (owner ruling); this screen only assigns one.
    const { data: categories } = useFrappeGetDocList<ExpenseCategoryRow>("Expense Category", {
        fields: ["name", "reviewer_role"],
        limit: 0,
        orderBy: { field: "name", order: "asc" },
    });

    // ADMIN-GATED endpoints, not raw doc writes: `Expense Type` carries write for ~15 roles
    // (Project Manager included), and the scope flags decide which ledger a request becomes.
    const { call: createType, loading: creating } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.masters.create_expense_type");
    const { call: updateType, loading: updating } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.masters.update_expense_type");
    const busy = creating || updating;

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const all = data ?? [];
        return q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all;
    }, [data, search]);

    const withFormat = useMemo(
        () => (data ?? []).filter((t) => (t.source_format || "").trim()).length,
        [data]
    );

    const handleSave = async () => {
        const name = edit.expense_name.trim();
        if (!name) {
            toast({ title: "Name is required", variant: "destructive" });
            return;
        }
        if (!edit.expense_category) {
            toast({
                title: "Pick a category",
                description: "Use 'Other' if none of the named ones fit.",
                variant: "destructive",
            });
            return;
        }
        if (!edit.project && !edit.non_project) {
            toast({
                title: "Pick at least one scope",
                description: "A type flagged for neither project nor non-project use cannot be requested at all.",
                variant: "destructive",
            });
            return;
        }
        try {
            if (edit.target) {
                await updateType({
                    name: edit.target.name,
                    project: edit.project ? 1 : 0,
                    non_project: edit.non_project ? 1 : 0,
                    expense_category: edit.expense_category,
                });
                toast({ title: "Updated", description: edit.target.name, variant: "success" });
            } else {
                await createType({
                    expense_name: name,
                    project: edit.project ? 1 : 0,
                    non_project: edit.non_project ? 1 : 0,
                    expense_category: edit.expense_category,
                });
                toast({ title: "Expense type added", description: name, variant: "success" });
            }
            setEdit(BLANK);
            mutate();
        } catch (e) {
            toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
        }
    };

    if (isLoading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <TailSpin width={32} height={32} color="#475569" />
            </div>
        );
    }
    if (error) {
        return <div className="p-8 text-center text-destructive">Could not load expense types: {error.message}</div>;
    }

    return (
        <div className="flex flex-col gap-4 p-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">Expense Packages</h2>
                    <p className="text-sm text-muted-foreground">
                        {data?.length ?? 0} expense types · {withFormat} with a request form
                    </p>
                </div>
                <Button size="sm" onClick={() => setEdit({ ...BLANK, open: true })}>
                    <PlusCircle className="mr-1.5 h-4 w-4" /> Add Expense Type
                </Button>
            </div>

            <div className="relative max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    className="pl-8"
                    placeholder="Search expense types…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            <div className="overflow-x-auto rounded border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Expense Type</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Scope</TableHead>
                            <TableHead>Request Form</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((t) => {
                            const scope = scopeOf(t);
                            const hasFormat = !!(t.source_format || "").trim();
                            return (
                                <TableRow key={t.name}>
                                    <TableCell className="font-medium">{t.name}</TableCell>
                                    <TableCell className="text-sm">
                                        {t.expense_category || (
                                            <span className="text-amber-700">uncategorised</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Badge className={cn(SCOPE_STYLE[scope], "hover:bg-inherit")}>
                                            {scope}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        {hasFormat ? (
                                            <span className="text-xs text-emerald-700">Custom form</span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">Plain form</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        <Button
                                            variant="ghost" size="sm"
                                            onClick={() => setEdit({
                                                open: true, target: t, expense_name: t.name,
                                                project: !!t.project, non_project: !!t.non_project,
                                                expense_category: t.expense_category || FALLBACK_CATEGORY,
                                            })}
                                        >
                                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => setFormatFor(t)}>
                                            <Braces className="mr-1 h-3.5 w-3.5" /> Format
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                                    No expense types match “{search}”.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* --- add / edit --- */}
            <Dialog open={edit.open} onOpenChange={(o) => !o && setEdit(BLANK)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{edit.target ? `Edit — ${edit.target.name}` : "Add Expense Type"}</DialogTitle>
                        <DialogDescription>
                            The scope decides whether a request of this type asks for a project, and
                            which ledger approval writes to.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-1">
                        <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input
                                value={edit.expense_name}
                                onChange={(e) => setEdit((s) => ({ ...s, expense_name: e.target.value }))}
                                disabled={!!edit.target}
                                placeholder="e.g. Site Refreshments"
                            />
                            {edit.target && (
                                <p className="text-xs text-muted-foreground">
                                    The name is the record's ID, referenced by every existing
                                    expense, so renaming it is a different operation from
                                    editing its scope and is not offered here.
                                </p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label>Category <span className="text-destructive">*</span></Label>
                            <Select
                                value={edit.expense_category}
                                onValueChange={(v) => setEdit((s) => ({ ...s, expense_category: v }))}
                            >
                                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                                <SelectContent>
                                    {(categories ?? []).map((c) => (
                                        <SelectItem key={c.name} value={c.name}>
                                            {c.name}
                                            {c.reviewer_role ? ` — ${c.reviewer_role}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Decides who reviews requests of this type. Categories are added in
                                Frappe Desk; use “Other” if none of the named ones fit.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>Scope</Label>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={edit.project}
                                    onCheckedChange={(v) => setEdit((s) => ({ ...s, project: !!v }))}
                                />
                                Project — can be charged to a project
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={edit.non_project}
                                    onCheckedChange={(v) => setEdit((s) => ({ ...s, non_project: !!v }))}
                                />
                                Non-Project — company-wide
                            </label>
                            <p className="text-xs text-muted-foreground">
                                {edit.project && edit.non_project
                                    ? "Both: the Project field is optional and the requester's choice picks the ledger."
                                    : edit.project
                                        ? "Project only: a project is required on every request."
                                        : edit.non_project
                                            ? "Non-Project only: the Project field is hidden."
                                            : "Pick at least one — a type with neither cannot be requested."}
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setEdit(BLANK)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={busy}>
                            {busy ? "Saving…" : edit.target ? "Save changes" : "Add"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ExpenseFormatDialog
                expenseType={formatFor}
                open={!!formatFor}
                onOpenChange={(o) => !o && setFormatFor(null)}
                onSaved={mutate}
            />
        </div>
    );
};

export default ExpensePackagesMaster;
