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
import {DialogClose} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useFrappeCreateDoc } from "frappe-react-sdk"
import { ButtonLoading } from "./ui/button-loading"
import { toast } from "./ui/use-toast"

const projectTypeFormSchema = z.object({
    project_type_name: z
        .string({
            required_error: "Must provide type Name"
        })
        .min(3, {
            message: "Type Name must be at least 3 characters.",
        }),
    standard_project_duration: z
        .string({
            required_error: "Must provide Duration"
        })
        .min(1, {
            message: "Must provide Duration"
        })
        .or(z.number()),
})

type ProjectTypeFormValues = z.infer<typeof projectTypeFormSchema>

export default function ProjectTypeForm({project_types_mutate}){
    const form = useForm<ProjectTypeFormValues>({
        resolver: zodResolver(projectTypeFormSchema),
        defaultValues: {
            project_type_name: ""
        },
        mode: "onBlur",
    })

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()

    function onSubmit(values: z.infer<typeof projectTypeFormSchema>) {
        createDoc('Project Types', values)
            .then((doc) => {
                console.log(values)
                project_types_mutate()
                toast({
                    title: "Success!",
                    description: `Project Type: ${doc.name} created successfully!`,
                    variant: "success"
                })
                document.getElementById("dialogClose")?.click()
            }).catch(() => {
                console.log("Error while creating Project Type", submit_error)
                toast({
                    title: "Failed!",
                    description: `Project Type: ${submit_error?.message} created successfully!`,
                    variant: "destructive"
                })
            })
    }

    return (
        <Form {...form}>
            <form onSubmit={(event) => {
                event.stopPropagation();
                return form.handleSubmit(onSubmit)(event);

            }} className="space-y-8">
                <FormField
                    control={form.control}
                    name="project_type_name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Project Type Name<sup>*</sup></FormLabel>
                            <FormControl>
                                <Input placeholder="Project Type Name" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>

                    )}
                />
                <FormField
                    control={form.control}
                    name="standard_project_duration"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Standard Project Duration<sup>*</sup></FormLabel>
                            <FormControl>
                                <Input
                                    type="number"
                                    placeholder="Duration in days"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {(loading) ? (<ButtonLoading />) : (<Button type="submit">Submit</Button>)}
                <DialogClose asChild><Button id="dialogClose" className="hidden"></Button></DialogClose>
            </form>
        </Form>
    )
}