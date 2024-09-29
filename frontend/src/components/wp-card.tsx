//import React, {useState, useEffect} from "react"
import React, { useState } from "react"
import { useEffect } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { DialogClose } from "@/components/ui/dialog"
import * as z from "zod"

import { useFrappeGetDocList } from "frappe-react-sdk"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { PersonStanding } from "lucide-react"
import { SOWCard } from "./sow-card"
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useFrappeCreateDoc } from "frappe-react-sdk"
import { ButtonLoading } from "./ui/button-loading"
import { useToast } from "./ui/use-toast"
import { Skeleton } from "./ui/skeleton"

interface WPCardProps {
    wp: string
}

interface ScopesOfWork {
    name: string
    scope_of_work_name: string
}

const SOWFormSchema = z.object({
    scope_of_work_name: z
        .string({
            required_error: "Must provide type Name"
        })
        .min(3, {
            message: "Type Name must be at least 3 characters.",
        }),
    work_package: z
        .string({
            required_error: "Must provide type Name"
        })
})

type SOWFormValues = z.infer<typeof SOWFormSchema>



export const WPCard: React.FC<WPCardProps> = ({ wp }) => {

    const { data: data, isLoading: isLoading, error: error, mutate: mutate } = useFrappeGetDocList<ScopesOfWork>("Scopes of Work", {
        fields: ["name", "scope_of_work_name"],
        filters: [["work_package", "=", wp]],
        limit: 1000
    })
    const form = useForm<SOWFormValues>({
        resolver: zodResolver(SOWFormSchema),
        defaultValues: {
            scope_of_work_name: "",
            work_package: ""
        },
        mode: "onChange",
    })

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof SOWFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        values.work_package = current;
        console.log("values ", values)

        createDoc('Scopes of Work', values)
            .then(() => {
                console.log(values)
                mutate()
                document.getElementById("dialogClosewpCard")?.click()
            }).catch(() => {
                console.log(submit_error)
            })
    }
    const [current, setCurrent] = useState<string>("")

    const { toast } = useToast()

    if (error) {
        console.log("Error in wp-card.tsx", error?.message)
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
                    {wp}
                </CardTitle>
                <div className="flex items-center">
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button className="p-3 pb-4 cursor-pointer hover:bg-gray-300" onClick={() => { setCurrent(wp) }} variant="secondary">+</Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Add New Scope of Work</DialogTitle>
                                </DialogHeader>
                                <Form {...form}>
                                    <form onSubmit={(event) => {
                                        event.stopPropagation();
                                        return form.handleSubmit(onSubmit)(event);

                                    }} className="flex flex-col gap-2">
                                        <FormField
                                            control={form.control}
                                            name="scope_of_work_name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Scope of Work Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Scope of Work Name..." {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="flex items-center justify-center">
                                        {(loading) ? (<ButtonLoading />) : (
                                            <>
                                            <Button type="submit">Submit</Button>
                                            <DialogClose id="dialogClosewpCard" className="hidden">hello</DialogClose>
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
                    {isLoading ? (<Skeleton className="w-1/3 h-4" />) : (data || []).map(d =>
                        <div key={d.scope_of_work_name}>
                            <SOWCard sow_id={d.name} sow_name={d.scope_of_work_name} />
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>

    )
}