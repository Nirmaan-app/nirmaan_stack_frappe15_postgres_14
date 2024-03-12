import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";


// 1.a Create Form Schema accordingly
const userFormSchema = z.object({
    first_name: z
        .string({
            required_error: "Must provide type First Name"
        })
        .min(3, {
            message: "Employee Name must be at least 3 characters.",
        }),
    last_name: z.string(),
    phone: z.number().nonnegative(),
    email: z
        .string({
            required_error: "Must Provide email"
        })
        .email()
})

type UserFormValues = z.infer<typeof userFormSchema>

interface SelectOption {
    label: string;
    value: string;
}

export default function UserForm() {
    return (
        <h1>Hello User FORM</h1>
    )
}

// export const CustomerForm = () => {
//     // 1.b Define your form.
//     // Has handleSubmit, control functions
//     const form = useForm<UserFormValues>({
//         resolver: zodResolver(userFormSchema),
//         defaultValues: {
//         },
//         mode: "onChange",
//     })

//     // const { data: address, isLoading: address_isLoading, error: address_error } = useFrappeGetDocList('Address', {
//     //     fields: ["name", "address_title"],
//     //     filters: [["address_type", "=", "Customer"]]
//     // });

//     const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
//     // 2. Define a submit handler.
//     function onSubmit(values: z.infer<typeof userFormSchema>) {
//         // Do something with the form values.
//         // ✅ This will be type-safe and validated.
//         createDoc('Nirmaan Users', values)
//             .then(() => {
//                 createDoc('User')
//             }).catch(() => {
//                 console.log(submit_error)
//             })
//     }

//     // Transform data to select options
//     const options: SelectOption[] = address?.map(item => ({
//         label: item.name, // Adjust based on your data structure
//         value: item.name
//     })) || [];

//     return (
//         <Form {...form}>
//             <form onSubmit={(event) => {
//                 event.stopPropagation();
//                 return form.handleSubmit(onSubmit)(event);

//             }} className="space-y-8">
//                 <FormField
//                     control={form.control}
//                     name="company_name"
//                     render={({ field }) => (
//                         <FormItem>
//                             <FormLabel>Company Name</FormLabel>
//                             <FormControl>
//                                 <Input placeholder="Company Name" {...field} />
//                             </FormControl>
//                             <FormMessage />
//                         </FormItem>

//                     )}
//                 />
//                 <FormField
//                     control={form.control}
//                     name="company_address"
//                     render={({ field }) => {
//                         return (
//                             <FormItem>
//                                 <FormLabel>Company Address Select</FormLabel>
//                                 <Select onValueChange={field.onChange} defaultValue={field.value}>
//                                     <FormControl>
//                                         <SelectTrigger>
//                                             <SelectValue placeholder="Select an address" />
//                                         </SelectTrigger>
//                                     </FormControl>
//                                     <SelectContent>
//                                         {address_isLoading && <div>Loading...</div>}
//                                         {address_error && <div>Error: {address_error.message}</div>}
//                                         {options.map(option => (
//                                             <SelectItem value={option.value}>{option.label}</SelectItem>
//                                         ))}

//                                     </SelectContent>
//                                 </Select>
//                                 <Dialog>
//                                     <DialogTrigger asChild>
//                                         <Button variant="secondary"> + Add Project Address</Button>
//                                     </DialogTrigger>

//                                     <DialogContent className="sm:max-w-[425px]">
//                                         <ScrollArea className="h-[600px] w-[350px]">
//                                             <DialogHeader>
//                                                 <DialogTitle>Add New Project Address</DialogTitle>
//                                                 <DialogDescription>
//                                                     Add new project address here.
//                                                 </DialogDescription>
//                                             </DialogHeader>
//                                             <Separator className="my-6" />

//                                             <AddressForm type={"Customer"} />

//                                         </ScrollArea>
//                                     </DialogContent>
//                                 </Dialog>
//                                 <FormMessage />
//                             </FormItem>
//                         )
//                     }}
//                 />
//                 <FormField
//                     control={form.control}
//                     name="company_contact_person"
//                     render={({ field }) => (
//                         <FormItem>
//                             <FormLabel>Company Contact Person</FormLabel>
//                             <FormControl>
//                                 <Input placeholder="Person Name" {...field} />
//                             </FormControl>
//                             <FormMessage />
//                         </FormItem>

//                     )}
//                 />
//                 {(loading) ? (<ButtonLoading />) : (<Button type="submit">Submit</Button>)}
//                 <div>
//                     {submit_complete && <div className="font-semibold text-green-500"> Project Type added</div>}
//                 </div>
//             </form>
//         </Form>
//     )
// }



