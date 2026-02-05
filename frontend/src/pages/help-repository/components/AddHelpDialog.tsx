import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusCircle } from "lucide-react";
import { useFrappeCreateDoc } from "frappe-react-sdk";
import { toast } from "@/components/ui/use-toast";
import { helpItemSchema, HelpItemFormValues } from "../types";

interface AddHelpDialogProps {
    onSuccess: () => void;
}

export const AddHelpDialog: React.FC<AddHelpDialogProps> = ({ onSuccess }) => {
    const [open, setOpen] = useState(false);
    const { createDoc, loading: creating } = useFrappeCreateDoc();

    const form = useForm<HelpItemFormValues>({
        resolver: zodResolver(helpItemSchema),
        defaultValues: {
            title: "",
            description: "",
            video_link: "",
        },
    });

    const onSubmit = async (values: HelpItemFormValues) => {
        try {
            await createDoc("Help Repository", {
                title: values.title,
                description: values.description || "",
                video_link: values.video_link,
            });
            toast({ title: "Success", description: "Help article added", variant: "success" });
            form.reset();
            setOpen(false);
            onSuccess();
        } catch (e: any) {
            console.error("Error creating help article:", e);
            const msg = e?.message?.includes("DuplicateEntryError")
                ? "A help article with this title already exists"
                : "Failed to create help article";
            toast({ title: "Error", description: msg, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) form.reset(); }}>
            <DialogTrigger asChild>
                <Button className="bg-red-600 hover:bg-red-700 text-white">
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Help Article
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] p-0 rounded-xl border-none max-h-[85vh] flex flex-col">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="text-xl font-bold">Add Help Article</DialogTitle>
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
                                            <Input placeholder="e.g. How to create a PR" {...field} className="bg-white border-gray-200" />
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
                                            <Textarea placeholder="Brief description of this help article" {...field} className="bg-white border-gray-200 min-h-[80px]" />
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
                                            <Input placeholder="https://www.loom.com/share/..." {...field} className="bg-white border-gray-200" />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                        <p className="text-xs text-gray-400 mt-1">Paste a Loom share link (e.g. loom.com/share/abc123)</p>
                                    </FormItem>
                                )}
                            />
                            <DialogFooter className="pt-4 border-t border-gray-100 gap-2 sm:gap-0">
                                <Button type="button" variant="outline" onClick={() => setOpen(false)} className="bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100">
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={creating} className="bg-red-600 hover:bg-red-700 text-white">
                                    {creating ? "Saving..." : "Save"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </div>
            </DialogContent>
        </Dialog>
    );
};
