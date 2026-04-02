import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { DialogClose } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk"
import { ButtonLoading } from "./ui/button-loading"
import { toast } from "./ui/use-toast"
import { CheckCheck, ArrowRight, Building2, MapPin, Hash, City } from "lucide-react"
import { ProjectGST } from "@/types/NirmaanStack/ProjectGST"
import { cn } from "@/lib/utils"

const projectGstFormSchema = z.object({
    gst_name: z
        .string({
            required_error: "Must provide GST Name"
        })
        .min(3, {
            message: "GST Name must be at least 3 characters.",
        }),
    gstin: z
        .string({
            required_error: "Must provide GSTIN"
        })
        .length(15, {
            message: "GSTIN must be exactly 15 characters.",
        }),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
})

type ProjectGstFormValues = z.infer<typeof projectGstFormSchema>

interface ProjectGstFormProps {
    gst?: ProjectGST
    mutate: () => void
}

export default function ProjectGstForm({ gst, mutate }: ProjectGstFormProps) {
    const form = useForm<ProjectGstFormValues>({
        resolver: zodResolver(projectGstFormSchema),
        defaultValues: {
            gst_name: gst?.gst_name || "",
            gstin: gst?.gstin || "",
            address: gst?.address || "",
            city: gst?.city || "",
            state: gst?.state || "",
            pincode: gst?.pincode || "",
        },
        mode: "onBlur",
    })

    const { createDoc, loading: createLoading } = useFrappeCreateDoc()
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc()

    const loading = createLoading || updateLoading

    function onSubmit(values: ProjectGstFormValues) {
        if (gst) {
            updateDoc('Project GST', gst.name, values)
                .then(() => {
                    mutate()
                    toast({
                        title: "Success!",
                        description: `Project GST: ${values.gst_name} updated successfully!`,
                        variant: "success"
                    })
                    document.getElementById("projectGstDialogClose")?.click()
                }).catch((error) => {
                    toast({
                        title: "Failed!",
                        description: error?.message || "Error while updating Project GST",
                        variant: "destructive"
                    })
                })
        } else {
            createDoc('Project GST', values)
                .then((doc) => {
                    mutate()
                    toast({
                        title: "Success!",
                        description: `Project GST: ${doc.name} created successfully!`,
                        variant: "success"
                    })
                    document.getElementById("projectGstDialogClose")?.click()
                }).catch((error) => {
                    toast({
                        title: "Failed!",
                        description: error?.message || "Error while creating Project GST",
                        variant: "destructive"
                    })
                })
        }
    }

    return (
        <Form {...form}>
            <form onSubmit={(event) => {
                event.stopPropagation();
                return form.handleSubmit(onSubmit)(event);
            }} className="space-y-4 pt-4">
                <FormField
                    control={form.control}
                    name="gst_name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                                <Building2 className="w-3 h-3" />
                                GST Name<sup>*</sup>
                            </FormLabel>
                            <FormControl>
                                <Input placeholder="e.g., Bangalore Office" className="h-9" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="gstin"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                                <Hash className="w-3 h-3" />
                                GSTIN<sup>*</sup>
                            </FormLabel>
                            <FormControl>
                                <Input disabled={!!gst} placeholder="15 character GSTIN" className="h-9 uppercase" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                                <MapPin className="w-3 h-3" />
                                Address
                            </FormLabel>
                            <FormControl>
                                <Textarea placeholder="Full Address" className="min-h-[80px] resize-none" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">City</FormLabel>
                                <FormControl>
                                    <Input placeholder="City" className="h-9" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">State</FormLabel>
                                <FormControl>
                                    <Input placeholder="State" className="h-9" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
                <FormField
                    control={form.control}
                    name="pincode"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Pincode</FormLabel>
                            <FormControl>
                                <Input placeholder="Pincode" className="h-9" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="flex justify-end pt-4">
                    {loading ? (
                        <ButtonLoading className="w-full h-10" />
                    ) : (
                        <Button 
                            type="submit" 
                            className={cn(
                                "h-10 px-5 text-sm font-medium w-full",
                                "bg-blue-600 hover:bg-blue-700 text-white",
                                "shadow-sm shadow-blue-600/20",
                                "transition-all duration-200 flex items-center justify-center gap-2"
                            )}
                        >
                            {gst ? "Update Details" : "Create GST Record"}
                            <ArrowRight className="w-4 h-4" />
                        </Button>
                    )}
                </div>
                <DialogClose asChild>
                    <Button id="projectGstDialogClose" className="hidden"></Button>
                </DialogClose>
            </form>
        </Form>
    )
}
