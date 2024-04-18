import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useEffect } from "react"

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
import { ButtonLoading } from "./button-loading"



// 1.a Create Form Schema accordingly
const projectTypeFormSchema = z.object({
    project_type_name: z
        .string({
            required_error: "Must provide type Name"
        })
        .min(3, {
            message: "Type Name must be at least 3 characters.",
        }),
    standard_project_duration: z
        .number({
            required_error: "Enter standard duration in days"
        })
        .nonnegative(),
})

type ProjectTypeFormValues = z.infer<typeof projectTypeFormSchema>

export default function ProjectTypeForm({project_types_mutate}){
    // 1.b Define your form.
    // Has handleSubmit, control functions
    const form = useForm<ProjectTypeFormValues>({
        resolver: zodResolver(projectTypeFormSchema),
        defaultValues: {
            project_type_name: ""
        },
        mode: "onChange",
    })

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof projectTypeFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        createDoc('Project Types', values)
            .then(() => {
                console.log(values)
            }).catch(() => {
                console.log(submit_error)
            })
    }
    function closewindow(){
        var button = document.getElementById('dialogClose');
        project_types_mutate()
        button.click();
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
                            <FormLabel>Project Type Name</FormLabel>
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
                            <FormLabel>Standard Project Duration</FormLabel>
                            <FormControl>
                                <Input
                                    type="number"
                                    placeholder="Duration in days"
                                    {...field}
                                    onChange={event => field.onChange(+event.target.value)}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {(loading) ? (<ButtonLoading />) : (<Button type="submit">Submit</Button>)}
                <DialogClose asChild><Button id="dialogClose" className="w-0 h-0 invisible"></Button></DialogClose>
                <div>
                    {submit_complete && 
                    <div>
                    <div className="font-semibold text-green-500"> Customer added</div>
                    {closewindow()}
                    </div>
                    }
                    {submit_error && <div>{submit_error}</div>}
                </div>
            </form>
        </Form>
    )
}