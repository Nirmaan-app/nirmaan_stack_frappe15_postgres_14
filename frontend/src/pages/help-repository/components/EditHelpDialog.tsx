import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeUpdateDoc } from "frappe-react-sdk";
import { toast } from "@/components/ui/use-toast";
import { helpItemSchema, HelpItemFormValues } from "../types";
import { HelpRepository } from "@/types/NirmaanStack/HelpRepository";

interface EditHelpDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: HelpRepository | null;
    onSuccess: () => void;
}

export const EditHelpDialog: React.FC<EditHelpDialogProps> = ({ open, onOpenChange, item, onSuccess }) => {
    const { updateDoc, loading: updating } = useFrappeUpdateDoc();

    const form = useForm<HelpItemFormValues>({
        resolver: zodResolver(helpItemSchema),
        defaultValues: {
            title: "",
            description: "",
            video_link: "",
        },
    });

    // Initialize form values when dialog opens (event-driven, not useEffect)
    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen && item) {
            form.reset({
                title: item.title,
                description: item.description || "",
                video_link: item.video_link,
            });
        }
        onOpenChange(isOpen);
    };

    const onSubmit = async (values: HelpItemFormValues) => {
        if (!item) return;
        try {
            await updateDoc("Help Repository", item.name, {
                title: values.title,
                description: values.description || "",
                video_link: values.video_link,
            });
            toast({ title: "Success", description: "Help article updated", variant: "success" });
            onOpenChange(false);
            onSuccess();
        } catch (e: any) {
            console.error("Error updating help article:", e);
            toast({ title: "Error", description: "Failed to update help article", variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[500px] p-0 rounded-xl border-none max-h-[85vh] flex flex-col">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="text-xl font-bold">Edit Help Article</DialogTitle>
                </DialogHeader>
                <div className="p-6 overflow-y-auto">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="title"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold">
                                            Title<span className="text-red-500 ml-0.5">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Input {...field} className="bg-white border-gray-200" />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold">
                                            Description <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Textarea {...field} className="bg-white border-gray-200 min-h-[80px]" />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="video_link"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold">
                                            Loom Video Link<span className="text-red-500 ml-0.5">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Input {...field} className="bg-white border-gray-200" />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                        <p className="text-xs text-gray-400 mt-1">Paste a Loom share link (e.g. loom.com/share/abc123)</p>
                                    </FormItem>
                                )}
                            />
                            <DialogFooter className="pt-4 border-t border-gray-100 gap-2 sm:gap-0">
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100">
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={updating} className="bg-blue-600 hover:bg-blue-700 text-white">
                                    {updating ? "Updating..." : "Update"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </div>
            </DialogContent>
        </Dialog>
    );
};
