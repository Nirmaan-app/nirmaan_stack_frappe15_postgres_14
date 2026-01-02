import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFrappeUpdateDoc } from "frappe-react-sdk";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { DatePicker } from "antd";
import dayjs from "dayjs";

// Zod Schema
const editTaskFormSchema = z.object({
  status: z.enum(["Not Released", "Partially Released", "Released", "Not Applicable"]),
  revised_date: z.string().optional(),
  remarks: z.string().optional(),
});

type EditTaskFormValues = z.infer<typeof editTaskFormSchema>;

interface EditTaskDialogProps {
  task: CriticalPOTask;
  mutate: () => Promise<any>;
}

export const EditTaskDialog: React.FC<EditTaskDialogProps> = ({ task, mutate }) => {
  const [open, setOpen] = useState(false);
  const { updateDoc, loading } = useFrappeUpdateDoc();

  const form = useForm<EditTaskFormValues>({
    resolver: zodResolver(editTaskFormSchema),
    defaultValues: {
      status: task.status,
      revised_date: task.revised_date || "",
      remarks: task.remarks || "",
    },
  });

  const onSubmit = async (values: EditTaskFormValues) => {
    try {
      await updateDoc("Critical PO Tasks", task.name, {
        status: values.status,
        revised_date: values.revised_date || null,
        remarks: values.remarks || "",
      });
      toast({ title: "Success", description: "Task updated successfully.", variant: "success" });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 w-full">
          <Pencil className="h-4 w-4 mr-1" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Critical PO Task</DialogTitle>
          <DialogDescription>
            Update status, revised date, and remarks for "{task.item_name}"
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Item Name (Read-only) */}
            <FormItem>
              <FormLabel>Item Name</FormLabel>
              <Input value={task.item_name} disabled className="bg-gray-50" />
            </FormItem>

            {/* Category (Read-only) */}
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Input value={task.critical_po_category} disabled className="bg-gray-50" />
            </FormItem>

            {/* Sub Category (Read-only) */}
            <FormItem>
              <FormLabel>Sub Category</FormLabel>
              <Input value={task.sub_category || "-"} disabled className="bg-gray-50" />
            </FormItem>

            {/* Status (Editable) */}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Not Released">Not Released</SelectItem>
                      <SelectItem value="Partially Released">Partially Released</SelectItem>
                      <SelectItem value="Released">Released</SelectItem>
                      <SelectItem value="Not Applicable">Not Applicable</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Original Release Date (Read-only) */}
            <FormItem>
              <FormLabel>Original PO Release Date</FormLabel>
              <Input value={task.po_release_date} disabled className="bg-gray-50" />
            </FormItem>

            {/* Revised Date (Editable) */}
            <FormField
              control={form.control}
              name="revised_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Revised Date (Optional)</FormLabel>
                  <FormControl>
                    <DatePicker
                      format="YYYY-MM-DD"
                      className="w-full"
                      value={field.value ? dayjs(field.value) : null}
                      onChange={(date) => {
                        field.onChange(date ? date.format("YYYY-MM-DD") : "");
                      }}
                      placeholder="Select revised date"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Remarks (Editable) */}
            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add any remarks or notes..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
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
                {loading ? <TailSpin height={20} width={20} color="white" /> : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
