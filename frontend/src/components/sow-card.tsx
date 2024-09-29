//import React, {useState, useEffect} from "react"
import React, { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { DialogClose } from "@/components/ui/dialog"
import { useFrappeGetDocList } from "frappe-react-sdk"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { PersonStanding } from "lucide-react"
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { Input } from "@/components/ui/input"
import { useFrappeCreateDoc } from "frappe-react-sdk"
import { ButtonLoading } from "./ui/button-loading"
import { Skeleton } from "./ui/skeleton"
import { useToast } from "./ui/use-toast"

interface SOWCardProps {
    sow_id: string
    sow_name: string
}

interface Milestones {
    name: string
    milestone_name: string
}

const MilestonesFormSchema = z.object({
    milestone_name: z
        .string({
            required_error: "Must provide type Name"
        })
        .min(3, {
            message: "Type Name must be at least 3 characters.",
        }),
    scope_of_work: z
        .string({
            required_error: "Must provide type Name"
        })
})

type MilestonesFormValues = z.infer<typeof MilestonesFormSchema>


export const SOWCard: React.FC<SOWCardProps> = ({ sow_id, sow_name }) => {

    const { data: data, isLoading: isLoading, error: error, mutate } = useFrappeGetDocList<Milestones>("Milestones", {
        fields: ["name", "milestone_name"],
        filters: [["scope_of_work", "=", sow_id]],
        limit: 1000
    })
    const form = useForm<MilestonesFormValues>({
        resolver: zodResolver(MilestonesFormSchema),
        defaultValues: {
            milestone_name: "",
            scope_of_work: ""
        },
        mode: "onChange",
    })

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof MilestonesFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        values.scope_of_work = current;
        console.log("values ", values)

        createDoc('Milestones', values)
            .then(() => {
                mutate()
                console.log(values)
                document.getElementById("dialogClosesow")?.click()
            }).catch(() => {
                console.log(submit_error)
            })
    }
    const [current, setCurrent] = useState<string>("")
    const { toast } = useToast()

    if (error) {
        console.log("Error in sow-card.tsx", error?.message)
        toast({
            title: "Error!",
            description: `Error ${error?.message}`,
            variant: "destructive"
        })
    }

    return (
        <Card className="hover:animate-shadow-drop-center" >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                    {sow_name}
                </CardTitle>
                <div className="flex items-center">
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button className="p-3 pb-4 cursor-pointer hover:bg-gray-300" onClick={() => { setCurrent(sow_name) }} variant="secondary">+</Button>
                        </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Add New Milestone</DialogTitle>
                                </DialogHeader>
                                <Form {...form}>
                                    <form onSubmit={(event) => {
                                        event.stopPropagation();
                                        return form.handleSubmit(onSubmit)(event);

                                    }} className="flex flex-col gap-2">
                                        <FormField
                                            control={form.control}
                                            name="milestone_name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Milestone Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Milestone Name..." {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="flex items-center justify-center">
                                        {(loading) ? (<ButtonLoading />) : (
                                            <>
                                            <Button type="submit">Submit</Button>
                                            <DialogClose id="dialogClosesow" className="hidden">hello</DialogClose>
                                            </>
                                            )}       
                                        </div>                                    
                                    </form>
                                </Form>
                            </DialogContent>
                    </Dialog>
                    <PersonStanding className="h-4 w-4 text-muted-foreground" />
                </div>
            </CardHeader>
            <CardContent>
                <div>
                    {(isLoading) ? (<Skeleton className="w-1/3 h-4" />) : (
                        (data || []).map(d =>
                            <p key={d.milestone_name} className="text-xs text-muted-foreground">{d.milestone_name}</p>
                        )
                    )}
                </div>
            </CardContent>
        </Card>
    )
}