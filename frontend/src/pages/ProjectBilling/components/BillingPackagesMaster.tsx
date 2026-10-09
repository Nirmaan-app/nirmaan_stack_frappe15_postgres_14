// Billing Packages tab (Admin Options → Packages Settings), laid out like PR Header Packages
// (components/PRHeaderTagMaster.tsx). Admin and the Billing Lead add, rename and delete; everyone
// else with billing access sees the list. The list, add and delete use the standard document
// API; the rename is the one endpoint, because it carries the project records and bills with it.
// The package hooks are the boundary: they check who may, duplicates, and packages in use.

import React, { useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { CheckCheck, CircleX, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { canManageBillingPackages } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { getFrappeError } from "@/utils/frappeErrors";
import { useBillingMutations, useBillingPackages } from "../data/useBillingQueries";
import type { BillingPackageRow } from "../types";
import { clashingPackage, cleanPackageName } from "../utils/billingFormat";

const HEAD = "text-slate-500 font-medium text-xs uppercase tracking-wider";

export const BillingPackagesMaster: React.FC = () => {
  const { data, isLoading, error } = useBillingPackages();
  const rows = data ?? [];
  const { role, user_id } = useUserData();
  // Display only: the package hooks refuse anyone else whatever the screen shows.
  const canEdit = canManageBillingPackages(role, user_id);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <TailSpin width={32} height={32} color="#475569" />
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">Error loading billing packages: {getFrappeError(error)}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Billing Packages</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {canEdit
                  ? "The packages a project's billing is split into, picked from its Billing tab → Packages"
                  : "View only: Admin manages billing packages"}
              </p>
            </div>
            {canEdit && <CreateBillingPackageDialog existing={rows.map((r) => r.name)} />}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className={HEAD}>Package</TableHead>
                {canEdit && <TableHead className={`w-24 text-right ${HEAD}`}>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canEdit ? 2 : 1} className="h-24 text-center text-slate-500">
                    No billing packages found.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.name} className="transition-colors hover:bg-slate-50">
                    <TableCell className="font-medium text-slate-900">{row.name}</TableCell>
                    {canEdit && (
                      <TableCell className="space-x-2 text-right">
                        <EditBillingPackageDialog pkg={row} existing={rows.map((r) => r.name)} />
                        <DeleteBillingPackageDialog pkg={row} />
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

// --- Dialog Components ---

const CreateBillingPackageDialog: React.FC<{ existing: string[] }> = ({ existing }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { addPackage, loading } = useBillingMutations();

  const cleaned = cleanPackageName(name);
  const clash = clashingPackage(name, existing);

  const onOpenChange = (next: boolean) => {
    if (next) setName("");
    setOpen(next);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleaned || clash) return;
    try {
      await addPackage(cleaned);
      toast({ title: "Success", description: `Billing package "${cleaned}" created successfully.`, variant: "success" });
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: getFrappeError(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-slate-900 text-white hover:bg-slate-800">
          <PlusCircle className="mr-1.5 h-4 w-4" />
          Add Billing Package
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Billing Package</DialogTitle>
          <DialogDescription>It becomes available in every project's Packages list.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="billing-package-name">Package Name</Label>
            <Input
              id="billing-package-name"
              autoFocus
              placeholder="e.g. Solar PV"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {clash && <p className="text-sm font-medium text-destructive">"{clash}" already exists.</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !cleaned || !!clash} className="bg-slate-900 text-white">
              {loading ? <TailSpin height={16} width={16} color="white" /> : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const EditBillingPackageDialog: React.FC<{ pkg: BillingPackageRow; existing: string[] }> = ({ pkg, existing }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(pkg.name);
  const { renamePackage, loading } = useBillingMutations();

  const cleaned = cleanPackageName(name);
  // Its own name (in any case) is not a clash: changing only capitals is a valid rename.
  const clash = clashingPackage(name, existing.filter((n) => n !== pkg.name));
  const unchanged = cleaned === pkg.name;

  const onOpenChange = (next: boolean) => {
    if (next) setName(pkg.name);
    setOpen(next);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleaned || clash || unchanged) return;
    try {
      await renamePackage(pkg.name, cleaned);
      toast({
        title: "Updated",
        description: `Billing package "${pkg.name}" renamed to "${cleaned}".`,
        variant: "success",
      });
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: getFrappeError(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-400 hover:text-slate-600"
          aria-label={`Rename ${pkg.name}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Billing Package</DialogTitle>
          <DialogDescription>
            Every project and bill using "{pkg.name}" will show the new name.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`rename-${pkg.name}`}>Package Name</Label>
            <Input id={`rename-${pkg.name}`} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            {clash && <p className="text-sm font-medium text-destructive">"{clash}" already exists.</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !cleaned || !!clash || unchanged}
              className="bg-slate-900 text-white"
            >
              {loading ? <TailSpin height={16} width={16} color="white" /> : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const DeleteBillingPackageDialog: React.FC<{ pkg: BillingPackageRow }> = ({ pkg }) => {
  const [open, setOpen] = useState(false);
  const { deletePackage, loading } = useBillingMutations();

  const handleDelete = async () => {
    try {
      await deletePackage(pkg.name);
      toast({ title: "Deleted", description: `Billing package "${pkg.name}" deleted successfully.`, variant: "success" });
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: getFrappeError(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-400 hover:text-red-600"
          aria-label={`Delete ${pkg.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Billing Package?</DialogTitle>
          <DialogDescription>
            This will permanently remove the billing package "{pkg.name}". A package any project uses can't be deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-4">
          <DialogClose asChild>
            <Button variant="outline">
              <CircleX className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading ? (
              <TailSpin height={16} width={16} color="white" />
            ) : (
              <>
                <CheckCheck className="mr-2 h-4 w-4" />
                Confirm
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
