import { SelectUnit } from "@/components/helpers/SelectUnit"
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OverviewSkeleton, Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/use-toast"
import { useUserData } from "@/hooks/useUserData"
import { Items } from "@/types/NirmaanStack/Items"
import { useFrappeDocumentEventListener, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
import { FilePenLine, ListChecks } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import React, { Suspense } from "react";
import { TailSpin } from "react-loader-spinner";

const ApprovedQuotationsTable = React.lazy(()=>import("../ApprovedQuotationsFlow/ApprovedQuotationsTable"));

const Item = () => {
    const { productId } = useParams<{ productId: string }>()

    if(productId) {
        return <ItemView productId={productId} />
    }
}

export const Component = Item

const ItemView = ({ productId }: { productId: string }) => {

    const userData = useUserData()

    const { data, error, isLoading, mutate } = useFrappeGetDoc<Items>(
        'Items',
        productId,
        `Items ${productId}`,
        {
            revalidateIfStale: false,
        }
    );

    useFrappeDocumentEventListener("Items", productId, (event) => {
          console.log("Items document updated (real-time):", event);
          toast({
              title: "Document Updated",
              description: `Items ${event.name} has been modified.`,
          });
          mutate(); // Re-fetch this specific document
        },
        true // emitOpenCloseEventsOnMount (default)
        )

    const { data: category_list, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
        fields: ["category_name", "work_package"],
        orderBy: { field: 'work_package', order: 'asc' },
        limit: 1000
    })
// console.log("category",data)

    interface SelectOption {
        label: string;
        value: string;
    }

    const category_options: SelectOption[] = useMemo(() => category_list
        ?.map(item => ({
            label: `${item.category_name}-(${item.work_package})`,
            value: item.category_name
        })) || [], [category_list]);


    const [curItem, setCurItem] = useState('');
    const [unit, setUnit] = useState('');
    const [category, setCategory] = useState('');

    const { updateDoc: updateDoc, loading: update_loading, error: update_submit_error } = useFrappeUpdateDoc()

    useEffect(() => {
        if(data) {
            setCurItem(data?.item_name)
            setCategory(data?.category)
            setUnit(data?.unit_name)
        }
    }, [data])
    

    const handleEditItem = () => {
        updateDoc('Items', productId, {
            category: category ? category : undefined,
            unit_name: unit ? unit : undefined,
            item_name: curItem ? curItem : undefined
        })
            .then(() => {
                mutate()
                toast({
                    title: "Success!",
                    description: `Product ${data?.name} updated successfully!`,
                    variant: "success"
                })
                setUnit('')
                setCurItem('')
                setCategory('')
            }).catch(() => {
                toast({
                    title: "Failed!",
                    description: `Unable to update Product ${data?.name}.`,
                    variant: "destructive"
                })
                console.log("update_submit_error", update_submit_error)
            })
    }

    if (error) return <AlertDestructive error={error} />

    return (
        <div className="flex-1 md:space-y-4">
            <div className="flex items-center max-md:mb-2">
                {isLoading ? (<Skeleton className="h-10 w-1/3 bg-gray-300" />) :
                    <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">{data?.item_name}</h2>}
                    {(userData.role === "Nirmaan Admin Profile") && (
                        <Dialog>
                        <DialogTrigger>
                            <FilePenLine className="w-10 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle className="mb-2">Edit Product</DialogTitle>
                                <DialogDescription className="flex flex-col gap-2">
                                    <div className="flex flex-col gap-4 ">
    
                                        <div className="flex flex-col items-start">
                                            <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Product Name<sup className="pl-1 text-sm text-red-600">*</sup></label>
                                            <Input
                                                type="text"
                                                id="itemName"
                                                value={curItem}
                                                onChange={(e) => setCurItem(e.target.value)}
                                                className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                            />
                                        </div>
                                        <div className="flex flex-col items-start">
                                            <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Product Unit<sup className="pl-1 text-sm text-red-600">*</sup></label>
                                            <SelectUnit value={unit} onChange={(value) => setUnit(value)} />
                                        </div>
                                        <div className="flex flex-col items-start">
                                            <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Category<sup className="pl-1 text-sm text-red-600">*</sup></label>
                                            <Select onValueChange={(value) => setCategory(value)} defaultValue={category}>
                                                <SelectTrigger className="">
                                                    <SelectValue className="text-gray-200" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {category_options?.map((item) => {
                                                        return (
                                                            <SelectItem value={item.value}>{item.label}</SelectItem>
                                                        )
                                                    })}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <DialogClose className="flex justify-center">
                                        <Button disabled={update_loading || (data?.item_name === curItem && data?.category === category && data?.unit_name === unit)} className="flex items-center gap-1" onClick={() => handleEditItem()}>
                                            <ListChecks className="h-4 w-4" />
                                            Submit</Button>
                                    </DialogClose>
                                </DialogDescription>
                            </DialogHeader>
                        </DialogContent>
                    </Dialog>
                    )}
            </div>
            {isLoading ? <OverviewSkeleton /> : (
                <div>
                    <Card>
                        <CardContent className="flex items-start mt-6">
                            <div className="space-y-4">
                                <CardDescription className="space-y-2">
                                    <span>Product ID</span>
                                    <p className="font-bold text-black">{data?.name}</p>
                                </CardDescription>

                                <CardDescription className="space-y-2">
                                    <span>Category</span>
                                    <p className="font-bold text-black">{data?.category}</p>
                                </CardDescription>

                                <CardDescription className="space-y-2">
                                    <span>Unit</span>
                                    <p className="font-bold text-black">{data?.unit_name}</p>
                                </CardDescription>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
             <Suspense fallback={<div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>}>
                        
                          <ApprovedQuotationsTable productId={productId} item_name={curItem} />
                         
                      </Suspense>
            
        </div>
    )
}