// src/pages/projects/WorkHeaderMilestones.tsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Pencil, PlusCircle, Trash2, CheckCheck, X, FileEdit } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeGetDocList, useFrappeUpdateDoc, useFrappePostCall } from "frappe-react-sdk"; // <-- ADDED useFrappePostCall

// Assuming these types are correctly defined based on Frappe DocType structure
// You MUST ensure these type definitions reflect the actual field names in Frappe
// src/types/NirmaanStack/WorkHeaders.ts
export interface WorkHeaders {
    name: string; // Frappe ID
    work_header_name: string; // Corrected field name
    creation?: string;
    modified?: string;
    owner?: string;
    modified_by?: string;
}

// src/types/NirmaanStack/WorkMilestone.ts
export interface WorkMilestone {
    name: string; // Frappe ID
    work_milestone_name: string; // Corrected field name
    work_header: string; // Link to Work Headers (Frappe ID)
    creation?: string;
    modified?: string;
    owner?: string;
    modified_by?: string;
}


// =========================================================================
// 1. Zod Schemas for Form Validation
// =========================================================================

const workHeaderFormSchema = z.object({
  work_header_name: z.string().min(1, "Work Header Name is required."),
});
type WorkHeaderFormValues = z.infer<typeof workHeaderFormSchema>;

const workMilestoneFormSchema = z.object({
  work_milestone_name: z.string().min(1, "Milestone Name is required."),
});
type WorkMilestoneFormValues = z.infer<typeof workMilestoneFormSchema>;


// =========================================================================
// 2. Main WorkHeaderMilestones Component
// =========================================================================

export const WorkHeaderMilestones: React.FC = () => {
  const { data: workHeaders, isLoading: workHeadersLoading, error: workHeadersError, mutate: workHeadersMutate } = useFrappeGetDocList<WorkHeaders>(
    "Work Headers",
    { fields: ["name", "work_header_name"], limit: 0, orderBy: { field: "creation", order: "asc" } }
  );

  const { data: workMilestones, isLoading: workMilestonesLoading, error: workMilestonesError, mutate: workMilestonesMutate } = useFrappeGetDocList<WorkMilestone>(
    "Work Milestones", // Ensure this matches your DocType name exactly
    { fields: ["name", "work_milestone_name", "work_header"], limit: 0, orderBy: { field: "creation", order: "asc" } }
  );

  if (workHeadersLoading || workMilestonesLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <TailSpin width={40} height={40} color="#007bff" />
      </div>
    );
  }

  if (workHeadersError || workMilestonesError) {
    return (
      <div className="p-4 text-center text-red-600">
        Error loading data: {workHeadersError?.message || workMilestonesError?.message}
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold tracking-tight">Work Headers & Milestones</h2>
        <CreateWorkHeaderDialog mutate={workHeadersMutate} />
      </div>

      <Separator />

      <div className="space-y-6">
        {workHeaders?.length === 0 ? (
          <p className="text-center text-gray-500">No Work Headers found. Start by creating a new one!</p>
        ) : (
          workHeaders?.map((header) => (
            <WorkHeaderCard
              key={header.name}
              header={header}
              milestones={workMilestones?.filter(m => m.work_header === header.name) || []}
              workHeadersMutate={workHeadersMutate}
              workMilestonesMutate={workMilestonesMutate}
            />
          ))
        )}
      </div>
    </div>
  );
};


// =========================================================================
// 3. Sub-components for Dialogs and Cards
// =========================================================================

// --- Dialog for Creating New Work Header ---
interface CreateWorkHeaderDialogProps {
  mutate: () => Promise<any>;
}

const CreateWorkHeaderDialog: React.FC<CreateWorkHeaderDialogProps> = ({ mutate }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<WorkHeaderFormValues>({
    resolver: zodResolver(workHeaderFormSchema),
    defaultValues: {
      work_header_name: "",
    },
  });

  const onSubmit = async (values: WorkHeaderFormValues) => {
    try {
      await createDoc("Work Headers", { work_header_name: values.work_header_name });
      toast({ title: "Success", description: "Work Header created successfully.", variant: "success" });
      form.reset();
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({ title: "Error", description: `Failed to create Work Header: ${error.message}`, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" /> Add New Work Header
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Work Header</DialogTitle>
          <DialogDescription>
            Define a new category of work for project milestones (e.g., Civil Work, Electrical).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="work_header_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work Header Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Civil Work, Electrical, Plumbing" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? <TailSpin height={20} width={20} color="currentColor" /> : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Dialog for Editing Work Header (UPDATED TO USE RENAME API) ---
interface EditWorkHeaderDialogProps {
  header: WorkHeaders;
  mutate: () => Promise<any>;
  milestoneMutate: () => Promise<any>;


}

const EditWorkHeaderDialog: React.FC<EditWorkHeaderDialogProps> = ({ header, mutate,milestoneMutate }) => {
  const [open, setOpen] = useState(false);
  const { call: renameDoc, loading: renameLoading } = useFrappePostCall( // <-- Using useFrappePostCall
    'frappe.model.rename_doc.update_document_title'
  );

  const form = useForm<WorkHeaderFormValues>({
    resolver: zodResolver(workHeaderFormSchema),
    defaultValues: {
      work_header_name: header.work_header_name,
    },
  });

  const onSubmit = async (values: WorkHeaderFormValues) => {
    // Check if the name actually changed
    if (values.work_header_name === header.work_header_name) {
      toast({ title: "Info", description: "No changes detected.", variant: "default" });
      setOpen(false);
      return;
    }

    try {
      const payload = {
        doctype: "Work Headers", // The DocType to rename
        docname: header.name,      // The old Frappe 'name' (ID)
        name: values.work_header_name, // The new Frappe 'name' (ID) and title
        merge: 0,                  // Do not merge with an existing document
        // enqueue: true,            // Removing enqueue makes it synchronous
        freeze: true,              // Freeze UI during rename on Frappe's side
        freeze_message: `Renaming Work Header "${header.work_header_name}" and updating related records...`,
      };

      await renameDoc(payload); // <-- Calling the rename API
   

      toast({ title: "Success", description: `Work Header renamed to "${values.work_header_name}" and related records updated.`, variant: "success" });
      mutate()
      milestoneMutate()
      setOpen(false);
    } catch (error: any) {
      console.error("Failed to rename Work Header:", error);
      toast({ title: "Error", description: `Failed to rename Work Header: ${error.message || 'Unknown error'}`, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <FileEdit className="h-4 w-4 text-gray-500 hover:text-blue-600" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Work Header</DialogTitle>
          <DialogDescription>
            Rename this work header. This will update its ID and name in all linked records.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="work_header_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Work Header Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={renameLoading}> {/* <-- Use renameLoading here */}
                {renameLoading ? <TailSpin height={20} width={20} color="currentColor" /> : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Dialog for Creating New Work Milestone ---
interface CreateWorkMilestoneDialogProps {
  workHeaderId: string;
  mutate: () => Promise<any>;
}

const CreateWorkMilestoneDialog: React.FC<CreateWorkMilestoneDialogProps> = ({ workHeaderId, mutate }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<WorkMilestoneFormValues>({
    resolver: zodResolver(workMilestoneFormSchema),
    defaultValues: {
      work_milestone_name: "",
    },
  });

  const onSubmit = async (values: WorkMilestoneFormValues) => {
    try {
      await createDoc("Work Milestones", { // Ensure DocType name is correct
        work_milestone_name: values.work_milestone_name,
        work_header: workHeaderId,
      });
      toast({ title: "Success", description: "Work Milestone created successfully.", variant: "success" });
      form.reset();
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({ title: "Error", description: `Failed to create Work Milestone: ${error.message}`, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PlusCircle className="mr-2 h-3 w-3" /> Add Milestone
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Work Milestone</DialogTitle>
          <DialogDescription>
            Define a new milestone for this work header.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="work_milestone_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Milestone Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Foundation, Rough-in Wiring" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? <TailSpin height={20} width={20} color="currentColor" /> : "Create Milestone"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Dialog for Editing Work Milestone ---
interface EditWorkMilestoneDialogProps {
  milestone: WorkMilestone;
  mutate: () => Promise<any>;
}

const EditWorkMilestoneDialog: React.FC<EditWorkMilestoneDialogProps> = ({ milestone, mutate }) => {
  const [open, setOpen] = useState(false);
  const { updateDoc, loading } = useFrappeUpdateDoc();
  const form = useForm<WorkMilestoneFormValues>({
    resolver: zodResolver(workMilestoneFormSchema),
    defaultValues: {
      work_milestone_name: milestone.work_milestone_name,
    },
  });

  const onSubmit = async (values: WorkMilestoneFormValues) => {
    try {
      await updateDoc("Work Milestones", milestone.name, {
        work_milestone_name: values.work_milestone_name,
      });
      toast({ title: "Success", description: "Work Milestone updated successfully.", variant: "success" });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({ title: "Error", description: `Failed to update Work Milestone: ${error.message}`, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Work Milestone</DialogTitle>
          <DialogDescription>
            Modify the details of this milestone.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="work_milestone_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Milestone Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? <TailSpin height={20} width={20} color="currentColor" /> : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Alert Dialog for Deleting Work Milestone ---
interface DeleteMilestoneAlertDialogProps {
  milestone: WorkMilestone;
  mutate: () => Promise<any>;
}

const DeleteMilestoneAlertDialog: React.FC<DeleteMilestoneAlertDialogProps> = ({ milestone, mutate }) => {
  const [open, setOpen] = useState(false);
  const { deleteDoc, loading } = useFrappeDeleteDoc();

  const handleDelete = async () => {
    try {
      await deleteDoc("Work Milestones", milestone.name);
      toast({ title: "Success", description: "Work Milestone deleted successfully.", variant: "success" });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({ title: "Error", description: `Failed to delete Work Milestone: ${error.message}`, variant: "destructive" });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-800">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the milestone "<span className="font-bold">{milestone.work_milestone_name}</span>".
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={loading} className="bg-red-600 hover:bg-red-700">
            {loading ? <TailSpin height={20} width={20} color="white" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};


// --- Card Component for each Work Header and its Milestones ---
interface WorkHeaderCardProps {
  header: WorkHeaders;
  milestones: WorkMilestone[];
  workHeadersMutate: () => Promise<any>;
  workMilestonesMutate: () => Promise<any>;
}

const WorkHeaderCard: React.FC<WorkHeaderCardProps> = ({key, header, milestones, workHeadersMutate, workMilestonesMutate }) => {
  return (
    <Card className="hover:animate-shadow-drop-center">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          {header.work_header_name}
          <EditWorkHeaderDialog header={header} mutate={workHeadersMutate} milestoneMutate={workMilestonesMutate} />
        </CardTitle>
        <CreateWorkMilestoneDialog workHeaderId={header.name} mutate={workMilestonesMutate} />
      </CardHeader>
      <CardContent className="overflow-auto pt-4">
        {milestones.length === 0 ? (
          <p className="text-gray-500 text-sm">No milestones defined for this work header. Click "Add Milestone" to create one.</p>
        ) : (
          <Table>
            <TableHeader className="bg-gray-100">
              <TableRow>
                <TableHead className="w-[80%]">Milestone</TableHead>
                <TableHead className="w-[20%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {milestones.map((milestone) => (
                <TableRow key={milestone.name}>
                  <TableCell>{milestone.work_milestone_name}</TableCell>
                  <TableCell className="text-right flex items-center justify-end space-x-2">
                    <EditWorkMilestoneDialog milestone={milestone} mutate={workMilestonesMutate} />
                    <DeleteMilestoneAlertDialog milestone={milestone} mutate={workMilestonesMutate} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

// // src/pages/projects/WorkHeaderMilestones.tsx
// import React, { useState, useEffect, useCallback, useMemo } from "react";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { toast } from "@/components/ui/use-toast";
// import { TailSpin } from "react-loader-spinner";
// import { Pencil, PlusCircle, Trash2, CheckCheck, X, FileEdit } from "lucide-react";
// import {
//   Dialog,
//   DialogContent,
//   DialogDescription,
//   DialogHeader,
//   DialogTitle,
//   DialogTrigger,
//   DialogClose,
// } from "@/components/ui/dialog";
// import {
//   AlertDialog,
//   AlertDialogAction,
//   AlertDialogCancel,
//   AlertDialogContent,
//   AlertDialogDescription,
//   AlertDialogFooter,
//   AlertDialogHeader,
//   AlertDialogTitle,
//   AlertDialogTrigger,
// } from "@/components/ui/alert-dialog";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Separator } from "@/components/ui/separator";
// import {
//   Table,
//   TableBody,
//   TableCell,
//   TableHead,
//   TableHeader,
//   TableRow,
// } from "@/components/ui/table";
// import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
// import { useForm } from "react-hook-form";
// import { zodResolver } from "@hookform/resolvers/zod";
// import * as z from "zod";
// import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";

// // Assuming these types are correctly defined based on Frappe DocType structure
// // You MUST ensure these type definitions reflect the actual field names in Frappe
// // src/types/NirmaanStack/WorkHeaders.ts
// export interface WorkHeaders {
//     name: string; // Frappe ID
//     work_header_name: string; // Corrected field name
//     creation?: string;
//     modified?: string;
//     owner?: string;
//     modified_by?: string;
// }

// // src/types/NirmaanStack/WorkMilestone.ts
// export interface WorkMilestone {
//     name: string; // Frappe ID
//     work_milestone_name: string; // Corrected field name
//     work_header: string; // Link to Work Headers (Frappe ID)
//     creation?: string;
//     modified?: string;
//     owner?: string;
//     modified_by?: string;
// }


// // =========================================================================
// // 1. Zod Schemas for Form Validation (UPDATED)
// // =========================================================================

// // Schema for Work Header creation/editing
// const workHeaderFormSchema = z.object({
//   work_header_name: z.string().min(1, "Work Header Name is required."),
// });
// type WorkHeaderFormValues = z.infer<typeof workHeaderFormSchema>;

// // Schema for Work Milestone creation/editing (UPDATED - removed duration and description)
// const workMilestoneFormSchema = z.object({
//   work_milestone_name: z.string().min(1, "Milestone Name is required."),
//   // `work_header` is linked, not directly editable via this form, so not included here.
// });
// type WorkMilestoneFormValues = z.infer<typeof workMilestoneFormSchema>;


// // =========================================================================
// // 2. Main WorkHeaderMilestones Component
// // =========================================================================

// export const WorkHeaderMilestones: React.FC = () => {
//   // Fetch all Work Headers (UPDATED fields)
//   const { data: workHeaders, isLoading: workHeadersLoading, error: workHeadersError, mutate: workHeadersMutate } = useFrappeGetDocList<WorkHeaders>(
//     "Work Headers",
//     { fields: ["name", "work_header_name"], limit: 0, orderBy: { field: "creation", order: "asc" } }
//   );

//   // Fetch all Work Milestones (UPDATED fields)
//   const { data: workMilestones, isLoading: workMilestonesLoading, error: workMilestonesError, mutate: workMilestonesMutate } = useFrappeGetDocList<WorkMilestone>(
//     "Work Milestones",
//     { fields: ["name", "work_milestone_name", "work_header"], limit: 0, orderBy: { field: "creation", order: "asc" } }
//   );

//   if (workHeadersLoading || workMilestonesLoading) {
//     return (
//       <div className="flex justify-center items-center h-screen">
//         <TailSpin width={40} height={40} color="#007bff" />
//       </div>
//     );
//   }

//   if (workHeadersError || workMilestonesError) {
//     return (
//       <div className="p-4 text-center text-red-600">
//         Error loading data: {workHeadersError?.message || workMilestonesError?.message}
//       </div>
//     );
//   }

//   return (
//     <div className="flex-1 space-y-6 p-4 md:p-6">
//       <div className="flex justify-between items-center mb-6">
//         <h2 className="text-2xl font-bold tracking-tight">Work Headers & Milestones</h2>
//         {/* Component to create a new Work Header */}
//         <CreateWorkHeaderDialog mutate={workHeadersMutate} />
//       </div>

//       <Separator />

//       <div className="space-y-6">
//         {workHeaders?.length === 0 ? (
//           <p className="text-center text-gray-500">No Work Headers found. Start by creating a new one!</p>
//         ) : (
//           workHeaders?.map((header) => (
//             <WorkHeaderCard
//               key={header.name}
//               header={header}
//               // Filter milestones to show only those belonging to the current header
//               milestones={workMilestones?.filter(m => m.work_header === header.name) || []}
//               workHeadersMutate={workHeadersMutate}
//               workMilestonesMutate={workMilestonesMutate}
//             />
//           ))
//         )}
//       </div>
//     </div>
//   );
// };


// // =========================================================================
// // 3. Sub-components for Dialogs and Cards
// // =========================================================================

// // --- Dialog for Creating New Work Header ---
// interface CreateWorkHeaderDialogProps {
//   mutate: () => Promise<any>; // Function to re-fetch work headers list
// }

// const CreateWorkHeaderDialog: React.FC<CreateWorkHeaderDialogProps> = ({ mutate }) => {
//   const [dialogOpen, setDialogOpen] = useState(false);
//   const { createDoc, loading } = useFrappeCreateDoc();

//   const form = useForm<WorkHeaderFormValues>({
//     resolver: zodResolver(workHeaderFormSchema),
//     defaultValues: {
//       work_header_name: "",
//     },
//   });

//   const onSubmit = async (values: WorkHeaderFormValues) => {
//     try {
//       await createDoc("Work Headers", { work_header_name: values.work_header_name }); // UPDATED payload
//       toast({ title: "Success", description: "Work Header created successfully.", variant: "success" });
//       form.reset();
//       await mutate();
//       setDialogOpen(false);
//     } catch (error: any) {
//       toast({ title: "Error", description: `Failed to create Work Header: ${error.message}`, variant: "destructive" });
//     }
//   };

//   return (
//     <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
//       <DialogTrigger asChild>
//         <Button>
//           <PlusCircle className="mr-2 h-4 w-4" /> Add New Work Header
//         </Button>
//       </DialogTrigger>
//       <DialogContent className="sm:max-w-[425px]">
//         <DialogHeader>
//           <DialogTitle>Create New Work Header</DialogTitle>
//           <DialogDescription>
//             Define a new category of work for project milestones (e.g., Civil Work, Electrical).
//           </DialogDescription>
//         </DialogHeader>
//         <Form {...form}>
//           <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
//             <FormField
//               control={form.control}
//               name="work_header_name" // UPDATED name
//               render={({ field }) => (
//                 <FormItem>
//                   <FormLabel>Work Header Name</FormLabel>
//                   <FormControl>
//                     <Input placeholder="e.g., Civil Work, Electrical, Plumbing" {...field} />
//                   </FormControl>
//                   <FormMessage />
//                 </FormItem>
//               )}
//             />
//             <div className="flex justify-end space-x-2">
//               <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
//                 Cancel
//               </Button>
//               <Button type="submit" disabled={loading}>
//                 {loading ? <TailSpin height={20} width={20} color="currentColor" /> : "Create"}
//               </Button>
//             </div>
//           </form>
//         </Form>
//       </DialogContent>
//     </Dialog>
//   );
// };

// // --- Dialog for Editing Work Header ---
// interface EditWorkHeaderDialogProps {
//   header: WorkHeaders;
//   mutate: () => Promise<any>;
//   onOpenChange: (open: boolean) => void;
// }

// const EditWorkHeaderDialog: React.FC<EditWorkHeaderDialogProps> = ({ header, mutate, onOpenChange }) => {
//   const { updateDoc, loading } = useFrappeUpdateDoc();
//   const form = useForm<WorkHeaderFormValues>({
//     resolver: zodResolver(workHeaderFormSchema),
//     defaultValues: {
//       work_header_name: header.work_header_name, // Pre-fill with existing name
//     },
//   });

//   const onSubmit = async (values: WorkHeaderFormValues) => {
//     try {
//       await updateDoc("Work Headers", header.name, { work_header_name: values.work_header_name }); // UPDATED payload
//       toast({ title: "Success", description: "Work Header updated successfully.", variant: "success" });
//       await mutate();
//       onOpenChange(false);
//     } catch (error: any) {
//       toast({ title: "Error", description: `Failed to update Work Header: ${error.message}`, variant: "destructive" });
//     }
//   };

//   return (
//     <Dialog onOpenChange={onOpenChange}>
//       <DialogContent className="sm:max-w-[425px]">
//         <DialogHeader>
//           <DialogTitle>Edit Work Header</DialogTitle>
//           <DialogDescription>
//             Rename this work header.
//           </DialogDescription>
//         </DialogHeader>
//         <Form {...form}>
//           <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
//             <FormField
//               control={form.control}
//               name="work_header_name" // UPDATED name
//               render={({ field }) => (
//                 <FormItem>
//                   <FormLabel>Work Header Name</FormLabel>
//                   <FormControl>
//                     <Input {...field} />
//                   </FormControl>
//                   <FormMessage />
//                 </FormItem>
//               )}
//             />
//             <div className="flex justify-end space-x-2">
//               <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
//                 Cancel
//               </Button>
//               <Button type="submit" disabled={loading}>
//                 {loading ? <TailSpin height={20} width={20} color="currentColor" /> : "Save Changes"}
//               </Button>
//             </div>
//           </form>
//         </Form>
//       </DialogContent>
//     </Dialog>
//   );
// };

// // --- Dialog for Creating New Work Milestone ---
// interface CreateWorkMilestoneDialogProps {
//   workHeaderId: string;
//   mutate: () => Promise<any>;
// }

// const CreateWorkMilestoneDialog: React.FC<CreateWorkMilestoneDialogProps> = ({ workHeaderId, mutate }) => {
//   const [dialogOpen, setDialogOpen] = useState(false);
//   const { createDoc, loading } = useFrappeCreateDoc();

//   const form = useForm<WorkMilestoneFormValues>({
//     resolver: zodResolver(workMilestoneFormSchema),
//     defaultValues: {
//       work_milestone_name: "",
//     },
//   });

//   const onSubmit = async (values: WorkMilestoneFormValues) => {
//     try {
//       console.log("Creating Work Milestone with values:", values, "under Work Header ID:", workHeaderId);
//       await createDoc("Work Milestones", {
//         work_milestone_name: values.work_milestone_name, // UPDATED payload field
//         work_header: workHeaderId, // Link to the parent Work Header
//       });
//       toast({ title: "Success", description: "Work Milestone created successfully.", variant: "success" });
//       form.reset();
//       await mutate();
//       setDialogOpen(false);
//     } catch (error: any) {
//       toast({ title: "Error", description: `Failed to create Work Milestone: ${error.message}`, variant: "destructive" });
//     }
//   };

//   return (
//     <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
//       <DialogTrigger asChild>
//         <Button variant="outline" size="sm">
//           <PlusCircle className="mr-2 h-3 w-3" /> Add Milestone
//         </Button>
//       </DialogTrigger>
//       <DialogContent className="sm:max-w-[425px]">
//         <DialogHeader>
//           <DialogTitle>Add New Work Milestone</DialogTitle>
//           <DialogDescription>
//             Define a new milestone for this work header.
//           </DialogDescription>
//         </DialogHeader>
//         <Form {...form}>
//           <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
//             <FormField
//               control={form.control}
//               name="work_milestone_name" // UPDATED name
//               render={({ field }) => (
//                 <FormItem>
//                   <FormLabel>Milestone Name</FormLabel>
//                   <FormControl>
//                     <Input placeholder="e.g., Foundation, Rough-in Wiring" {...field} />
//                   </FormControl>
//                   <FormMessage />
//                 </FormItem>
//               )}
//             />
//             {/* Removed Expected Duration and Description fields */}
//             <div className="flex justify-end space-x-2">
//               <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
//                 Cancel
//               </Button>
//               <Button type="submit" disabled={loading}>
//                 {loading ? <TailSpin height={20} width={20} color="currentColor" /> : "Create Milestone"}
//               </Button>
//             </div>
//           </form>
//         </Form>
//       </DialogContent>
//     </Dialog>
//   );
// };

// // --- Dialog for Editing Work Milestone ---
// interface EditWorkMilestoneDialogProps {
//   milestone: WorkMilestone;
//   mutate: () => Promise<any>;
//   onOpenChange: (open: boolean) => void;
// }

// const EditWorkMilestoneDialog: React.FC<EditWorkMilestoneDialogProps> = ({ milestone, mutate, onOpenChange }) => {
//   const { updateDoc, loading } = useFrappeUpdateDoc();
//   const form = useForm<WorkMilestoneFormValues>({
//     resolver: zodResolver(workMilestoneFormSchema),
//     defaultValues: {
//       work_milestone_name: milestone.work_milestone_name, // UPDATED pre-fill
//     },
//   });

//   const onSubmit = async (values: WorkMilestoneFormValues) => {
//     try {
//       await updateDoc("Work Milestones", milestone.name, {
//         work_milestone_name: values.work_milestone_name, // UPDATED payload field
//       });
//       toast({ title: "Success", description: "Work Milestone updated successfully.", variant: "success" });
//       await mutate();
//       onOpenChange(false);
//     } catch (error: any) {
//       toast({ title: "Error", description: `Failed to update Work Milestone: ${error.message}`, variant: "destructive" });
//     }
//   };

//   return (
//     <Dialog onOpenChange={onOpenChange}>
//       <DialogContent className="sm:max-w-[425px]">
//         <DialogHeader>
//           <DialogTitle>Edit Work Milestone</DialogTitle>
//           <DialogDescription>
//             Modify the details of this milestone.
//           </DialogDescription>
//         </DialogHeader>
//         <Form {...form}>
//           <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
//             <FormField
//               control={form.control}
//               name="work_milestone_name" // UPDATED name
//               render={({ field }) => (
//                 <FormItem>
//                   <FormLabel>Milestone Name</FormLabel>
//                   <FormControl>
//                     <Input {...field} />
//                   </FormControl>
//                   <FormMessage />
//                 </FormItem>
//               )}
//             />
//             {/* Removed Expected Duration and Description fields */}
//             <div className="flex justify-end space-x-2">
//               <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
//                 Cancel
//               </Button>
//               <Button type="submit" disabled={loading}>
//                 {loading ? <TailSpin height={20} width={20} color="currentColor" /> : "Save Changes"}
//               </Button>
//             </div>
//           </form>
//         </Form>
//       </DialogContent>
//     </Dialog>
//   );
// };

// // --- Alert Dialog for Deleting Work Milestone ---
// interface DeleteMilestoneAlertDialogProps {
//   milestone: WorkMilestone;
//   mutate: () => Promise<any>;
// }

// const DeleteMilestoneAlertDialog: React.FC<DeleteMilestoneAlertDialogProps> = ({ milestone, mutate }) => {
//   const { deleteDoc, loading } = useFrappeDeleteDoc();
//   const [open, setOpen] = useState(false);

//   const handleDelete = async () => {
//     try {
//       await deleteDoc("Work Milestones", milestone.name);
//       toast({ title: "Success", description: "Work Milestone deleted successfully.", variant: "success" });
//       await mutate();
//       setOpen(false);
//     } catch (error: any) {
//       toast({ title: "Error", description: `Failed to delete Work Milestone: ${error.message}`, variant: "destructive" });
//     }
//   };

//   return (
//     <AlertDialog open={open} onOpenChange={setOpen}>
//       <AlertDialogTrigger asChild>
//         <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-800">
//           <Trash2 className="h-4 w-4" />
//         </Button>
//       </AlertDialogTrigger>
//       <AlertDialogContent>
//         <AlertDialogHeader>
//           <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
//           <AlertDialogDescription>
//             This action cannot be undone. This will permanently delete the milestone "<span className="font-bold">{milestone.work_milestone_name}</span>". {/* UPDATED display name */}
//           </AlertDialogDescription>
//         </AlertDialogHeader>
//         <AlertDialogFooter>
//           <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
//           <AlertDialogAction onClick={handleDelete} disabled={loading} className="bg-red-600 hover:bg-red-700">
//             {loading ? <TailSpin height={20} width={20} color="white" /> : "Delete"}
//           </AlertDialogAction>
//         </AlertDialogFooter>
//       </AlertDialogContent>
//     </AlertDialog>
//   );
// };


// // --- Card Component for each Work Header and its Milestones ---
// interface WorkHeaderCardProps {
//   header: WorkHeaders;
//   milestones: WorkMilestone[];
//   workHeadersMutate: () => Promise<any>;
//   workMilestonesMutate: () => Promise<any>;
// }

// const WorkHeaderCard: React.FC<WorkHeaderCardProps> = ({ header, milestones, workHeadersMutate, workMilestonesMutate }) => {
//   const [editHeaderDialogOpen, setEditHeaderDialogOpen] = useState(false);

//   return (
//     <Card className="hover:animate-shadow-drop-center">
//       <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//         <CardTitle className="text-xl font-semibold flex items-center gap-2">
//           {header.work_header_name} 
//           <Dialog open={editHeaderDialogOpen} onOpenChange={setEditHeaderDialogOpen}>
//             <DialogTrigger asChild>
//               <Button variant="ghost" size="icon" className="h-6 w-6">
//                 <FileEdit className="h-4 w-4 text-gray-500 hover:text-blue-600" />
//               </Button>
//             </DialogTrigger>
//             {/* The actual Edit Work Header Dialog */}
//             <EditWorkHeaderDialog header={header} mutate={workHeadersMutate} onOpenChange={setEditHeaderDialogOpen} />
//           </Dialog>
//         </CardTitle>
//         {/* Button to add a new milestone for this specific Work Header */}
//         <CreateWorkMilestoneDialog workHeaderId={header.name} mutate={workMilestonesMutate} />
//       </CardHeader>
//       <CardContent className="overflow-auto pt-4">
//         {milestones.length === 0 ? (
//           <p className="text-gray-500 text-sm">No milestones defined for this work header. Click "Add Milestone" to create one.</p>
//         ) : (
//           <Table>
//             <TableHeader className="bg-gray-100">
//               <TableRow>
//                 <TableHead className="w-[80%]">Milestone</TableHead> {/* Adjusted width */}
//                 <TableHead className="w-[20%] text-right">Actions</TableHead> {/* Adjusted width */}
//               </TableRow>
//             </TableHeader>
//             <TableBody>
//               {milestones.map((milestone) => (
//                 <TableRow key={milestone.name}>
//                   <TableCell>{milestone.work_milestone_name}</TableCell> {/* UPDATED display name */}
//                   <TableCell className="text-right flex items-center justify-end space-x-2">
//                     {/* Trigger for editing the Work Milestone */}
//                     <Dialog>
//                       <DialogTrigger asChild>
//                         <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800">
//                           <Pencil className="h-4 w-4" />
//                         </Button>
//                       </DialogTrigger>
//                       {/* The actual Edit Work Milestone Dialog */}
//                       <EditWorkMilestoneDialog milestone={milestone} mutate={workMilestonesMutate} onOpenChange={() => {}} />
//                     </Dialog>
//                     {/* Alert Dialog for deleting the Work Milestone */}
//                     <DeleteMilestoneAlertDialog milestone={milestone} mutate={workMilestonesMutate} />
//                   </TableCell>
//                 </TableRow>
//               ))}
//             </TableBody>
//           </Table>
//         )}
//       </CardContent>
//     </Card>
//   );
// };