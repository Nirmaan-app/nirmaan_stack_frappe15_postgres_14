//import React, {useState, useEffect} from "react"
import React , {useState} from "react"
import { useEffect } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import {DialogClose} from "@/components/ui/dialog"
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
import { ButtonLoading } from "./button-loading"

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
        filters: [["work_package", "=", wp]]
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
        console.log("values ",values)

        createDoc('Scopes of Work', values)
            .then(() => {
                console.log(values)
            }).catch(() => {
                console.log(submit_error)
            })
    }
    const [current,setCurrent] = useState<string>("")
    function closewindow(){
        var button = document.getElementById('dialogClose');
        mutate()
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
                        <Button className="p-3 pb-4" onClick={()=>{setCurrent(wp)}} variant="secondary">+</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Add New Scope of Work</DialogTitle>
                            <DialogDescription>
                                Add new Scopes of Work in {wp}.
                            </DialogDescription>
                        </DialogHeader>
                        <Form {...form}>
                            <form onSubmit={(event) => {
                                event.stopPropagation();
                                return form.handleSubmit(onSubmit)(event);

                            }} className="space-y-8">
                                <FormField
                                    control={form.control}
                                    name="scope_of_work_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Scope of Work Name</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Scope of Work Name" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                    {(loading) ? (<ButtonLoading />) : (<DialogClose asChild><Button type="submit">Submit</Button></DialogClose>)}
                                        {/* <DialogClose asChild><Button id="dialogClose" className="w-0 h-0 invisible"></Button></DialogClose> */}
                                        <div>
                                            {submit_complete && 
                                            <div>
                                            {/* <div className="font-semibold text-green-500"> Customer added</div> */}
                                            {closewindow()}
                                            </div>
                                            }
                                    {submit_error && <div>{submit_error}</div>}
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
                    {(isLoading) && (<p>Loading</p>)}
                    {error && <p>Error</p>}
                    {(data || []).map(d =>
                        <div>
                            <SOWCard sow_id={d.name} sow_name={d.scope_of_work_name} />
                        </div>
                    )}
                </div>
                {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
            </CardContent>
        </Card>

    )
}