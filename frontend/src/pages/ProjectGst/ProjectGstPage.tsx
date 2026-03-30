import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { ProjectGST } from "@/types/NirmaanStack/ProjectGST";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { useUserData } from "@/hooks/useUserData";
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
import ProjectGstForm from "@/components/project-gst-form";
import { Pencil, Trash2, Plus, Building2, ClipboardList, X } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { DialogClose as PrimitiveDialogClose } from "@radix-ui/react-dialog";

export default function ProjectGstPage() {
  const { role } = useUserData();
  const { data: gstList, mutate, isLoading } = useFrappeGetDocList<ProjectGST>("Project GST", {
    fields: ["*"],
    orderBy: { field: "creation", order: "desc" },
  });

  // Delete functionality removed as per user request

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">Project GST Management</h2>
          <p className="text-muted-foreground">
            Manage GSTINs and addresses for project print formats & POs and WOs.
          </p>
        </div>
        {role === "Nirmaan Admin Profile" && (
          <Dialog>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Project GST
              </Button>
            </DialogTrigger>
            <DialogContent disableCloseIcon={false} className="sm:max-w-[500px] p-0 gap-0 overflow-hidden border-0 shadow-2xl">
              {/* Header */}
              <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/20 ring-1 ring-blue-500/30">
                      <Building2 className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <DialogTitle className="text-lg font-semibold text-white tracking-tight">
                        Add New Project GST
                      </DialogTitle>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Enter GST details and address for billing
                      </p>
                    </div>
                  </div>
                  <DialogClose asChild>
                    <Button variant="ghost" size="icon" className="text-white/70 hover:text-white hover:bg-white/10 -mt-5 -mr-2">
                      <X className="h-5 w-5" />
                    </Button>
                  </DialogClose>
                </div>
              </div>
              <div className="px-6 pb-6 bg-white dark:bg-slate-950">
                <ProjectGstForm mutate={mutate} />
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>GST Name</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead className="hidden md:table-cell">City</TableHead>
              <TableHead className="hidden md:table-cell">State</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10">
                  <div className="flex justify-center items-center gap-2">
                    <span className="animate-pulse">Loading GST entries...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : gstList?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                  No Project GST entries found.
                </TableCell>
              </TableRow>
            ) : (
              gstList?.map((gst) => (
                <TableRow key={gst.name}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {gst.gst_name}
                    </div>
                  </TableCell>
                  <TableCell>{gst.gstin}</TableCell>
                  <TableCell className="hidden md:table-cell">{gst.city || "--"}</TableCell>
                  <TableCell className="hidden md:table-cell">{gst.state || "--"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {role === "Nirmaan Admin Profile" && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Pencil className="h-4 w-4 text-blue-600" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent disableCloseIcon={false} className="sm:max-w-[500px] p-0 gap-0 overflow-hidden border-0 shadow-2xl">
                            {/* Header */}
                            <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/20 ring-1 ring-blue-500/30">
                                    <Pencil className="w-5 h-5 text-blue-400" />
                                  </div>
                                  <div>
                                    <DialogTitle className="text-lg font-semibold text-white tracking-tight">
                                      Edit Project GST
                                    </DialogTitle>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                      Update GST details for {gst.gst_name}
                                    </p>
                                  </div>
                                </div>
                                <DialogClose asChild>
                                  <Button variant="ghost" size="icon" className="text-white/70 hover:text-white hover:bg-white/10 -mt-5 -mr-2">
                                    <X className="h-5 w-5" />
                                  </Button>
                                </DialogClose>
                              </div>
                            </div>
                            <div className="px-6 pb-6 bg-white dark:bg-slate-950">
                              <ProjectGstForm gst={gst} mutate={mutate} />
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
