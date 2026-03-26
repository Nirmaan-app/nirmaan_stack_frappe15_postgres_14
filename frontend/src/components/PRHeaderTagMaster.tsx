// src/components/PRHeaderTagMaster.tsx
// Enterprise Minimalist PR Header Tags Configuration

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import {
  Pencil,
  PlusCircle,
  Trash2,
  Package,
  Layers,
  CircleX,
  CheckCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";

// --- Types ---
export interface PRTagHeader {
  name: string;
  pr_header: string;
  tag_package?: string;
  creation?: string;
}

export interface ProcurementPackage {
  name: string;
  work_package_name: string;
}

// --- Schemas ---
const prTagHeaderFormSchema = z.object({
  pr_header: z.string().min(1, "PR Header name is required."),
  tag_package: z.string().optional(),
});
type PRTagHeaderFormValues = z.infer<typeof prTagHeaderFormSchema>;

// --- Main Component ---
export const PRHeaderTagMaster: React.FC = () => {
  const {
    data: prTags,
    isLoading: prTagsLoading,
    error: prTagsError,
    mutate: prTagsMutate,
  } = useFrappeGetDocList<PRTagHeader>("PR Tag Headers", {
    fields: ["name", "pr_header", "tag_package"],
    limit: 0,
    orderBy: { field: "pr_header", order: "asc" },
  });

  const { data: packageList } = useFrappeGetDocList<ProcurementPackage>(
    "Procurement Packages",
    {
      fields: ["name", "work_package_name"],
      limit: 0,
      orderBy: { field: "work_package_name", order: "asc" },
    }
  );

  if (prTagsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <TailSpin width={32} height={32} color="#475569" />
      </div>
    );
  }

  if (prTagsError) {
    return (
      <div className="p-8 text-center text-red-500">
        Error loading PR Tag Headers: {prTagsError.message}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
                PR Header Packages
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Manage PR Tag Headers and their procurement package links
              </p>
            </div>
            <CreatePRTagHeaderDialog
              mutate={prTagsMutate}
              packages={packageList || []}
              existingTags={prTags || []}
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider">
                  PR Header
                </TableHead>
                <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider">
                  Tag Package
                </TableHead>
                <TableHead className="w-24 text-right text-slate-500 font-medium text-xs uppercase tracking-wider">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prTags?.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="h-24 text-center text-slate-500"
                  >
                    No PR Tag Headers found.
                  </TableCell>
                </TableRow>
              ) : (
                prTags?.map((tag) => (
                  <TableRow key={tag.name} className="hover:bg-slate-50 transition-colors">
                    <TableCell className="font-medium text-slate-900">
                      {tag.pr_header}
                    </TableCell>
                    <TableCell>
                      {tag.tag_package ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">
                          <Package className="w-3 h-3" />
                          {tag.tag_package}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                       <EditPRTagHeaderDialog 
                         tag={tag} 
                         mutate={prTagsMutate} 
                         packages={packageList || []}
                         existingTags={prTags || []}
                       />
                       <DeletePRTagHeaderDialog tag={tag} mutate={prTagsMutate} />
                    </TableCell>
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

interface PRTagHeaderDialogProps {
  mutate: () => Promise<any>;
  packages: ProcurementPackage[];
  existingTags: PRTagHeader[];
}

const CreatePRTagHeaderDialog: React.FC<PRTagHeaderDialogProps> = ({ mutate, packages, existingTags }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  // Allow all packages to be selectable multiple times
  const availablePackages = packages;

  const form = useForm<PRTagHeaderFormValues>({
    resolver: zodResolver(prTagHeaderFormSchema),
    defaultValues: { pr_header: "", tag_package: "" },
  });

  const onSubmit = async (values: PRTagHeaderFormValues) => {
    // Check for duplicate PR Header name
    if (existingTags.some(t => t.pr_header.toLowerCase() === values.pr_header.toLowerCase())) {
        form.setError("pr_header", { message: "This PR Header already exists." });
        return;
    }

    try {
      await createDoc("PR Tag Headers", values);
      toast({ title: "Success", description: `PR Tag Header "${values.pr_header}" created successfully.`, variant: "success" });
      form.reset();
      await mutate();
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white">
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add Package Header
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create PR Tag Header</DialogTitle>
          <DialogDescription>Add a new header and link it to a procurement package.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="pr_header"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PR Header</FormLabel>
                  <FormControl><Input placeholder="e.g. Civil Materials" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tag_package"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tag Package (Optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select Package" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availablePackages.map((p) => (<SelectItem key={p.name} value={p.name}>{p.work_package_name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading} className="bg-slate-900 text-white">
                {loading ? <TailSpin height={16} width={16} color="white" /> : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

const EditPRTagHeaderDialog: React.FC<{ tag: PRTagHeader } & PRTagHeaderDialogProps> = ({ tag, mutate, packages, existingTags }) => {
  const [open, setOpen] = useState(false);
  const { updateDoc, loading } = useFrappeUpdateDoc();

  // Allow all packages to be selectable multiple times
  const availablePackages = packages;

  const form = useForm<PRTagHeaderFormValues>({
    resolver: zodResolver(prTagHeaderFormSchema),
    defaultValues: {
      pr_header: tag.pr_header,
      tag_package: tag.tag_package || "",
    },
  });

  const onSubmit = async (values: PRTagHeaderFormValues) => {
     // Check for duplicate PR Header name (excluding current tag)
     if (existingTags.some(t => t.name !== tag.name && t.pr_header.toLowerCase() === values.pr_header.toLowerCase())) {
        form.setError("pr_header", { message: "This PR Header already exists." });
        return;
    }

    try {
      await updateDoc("PR Tag Headers", tag.name, values);
      toast({ title: "Updated", description: `PR Tag Header "${values.pr_header}" updated successfully.`, variant: "success" });
      await mutate();
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit PR Tag Header</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="pr_header"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PR Header</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tag_package"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tag Package</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select Package" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availablePackages.map((p) => (<SelectItem key={p.name} value={p.name}>{p.work_package_name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading} className="bg-slate-900 text-white">
                {loading ? <TailSpin height={16} width={16} color="white" /> : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

const DeletePRTagHeaderDialog: React.FC<{ tag: PRTagHeader; mutate: () => Promise<any> }> = ({ tag, mutate }) => {
  const [open, setOpen] = useState(false);
  const { deleteDoc, loading } = useFrappeDeleteDoc();

  const handleDelete = async () => {
    try {
      await deleteDoc("PR Tag Headers", tag.name);
      toast({ title: "Deleted", description: `PR Tag Header "${tag.pr_header}" deleted successfully.`, variant: "success" });
      await mutate();
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Header?</DialogTitle>
          <DialogDescription>This will permanently remove the PR Tag Header "{tag.pr_header}".</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-4">
          <DialogClose asChild><Button variant="outline"><CircleX className="w-4 h-4 mr-2" />Cancel</Button></DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading ? <TailSpin height={16} width={16} color="white" /> : <><CheckCheck className="w-4 h-4 mr-2" />Confirm</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
