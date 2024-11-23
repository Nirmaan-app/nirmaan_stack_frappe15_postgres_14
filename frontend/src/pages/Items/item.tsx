import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogHeader, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { OverviewSkeleton, Skeleton } from "@/components/ui/skeleton"
import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
import { ArrowLeft, FilePenLine, ListChecks } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"
import { toast } from "@/components/ui/use-toast"
import { useUserData } from "@/hooks/useUserData"

const Item = () => {
    const { itemId } = useParams<{ itemId: string }>()

    return (
        <div>
            {itemId && <ItemView itemId={itemId} />}
        </div>
    )
}

export const Component = Item

const ItemView = ({ itemId }: { itemId: string }) => {

    const navigate = useNavigate();

    const userData = useUserData()

    const { data, error, isLoading, mutate } = useFrappeGetDoc(
        'Items',
        itemId,
        `Items ${itemId}`,
        {
            revalidateIfStale: false,
        }
    );

    const { data: category_list, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
        fields: ["category_name", "work_package"],
        orderBy: { field: 'work_package', order: 'asc' },
        limit: 1000
    })

    interface SelectOption {
        label: string;
        value: string;
    }

    const category_options: SelectOption[] = category_list
        ?.map(item => ({
            label: `${item.category_name}-(${item.work_package})`,
            value: item.category_name
        })) || [];


    const [curItem, setCurItem] = useState('');
    const [unit, setUnit] = useState('');
    const [category, setCategory] = useState('');

    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    useEffect(() => {
        if(data) {
            setCurItem(data?.item_name)
            setCategory(data?.category)
            setUnit(data?.unit_name)
        }
    }, [data])

    const handleEditItem = () => {
        updateDoc('Items', itemId, {
            category: category ? category : data?.category,
            unit_name: unit ? unit : data.unit_name,
            item_name: curItem ? curItem : data.item_name
        })
            .then(() => {
                mutate()
                toast({
                    title: "Success!",
                    description: `Item ${data?.name} updated successfully!`,
                    variant: "success"
                })
                setUnit('')
                setCurItem('')
                setCategory('')
            }).catch(() => {
                toast({
                    title: "Failed!",
                    description: `Unable to update Item ${data?.name}.`,
                    variant: "destructive"
                })
                console.log("update_submit_error", update_submit_error)
            })
    }

    if (error) return <h1 className="text-red-700">There is an error while fetching the document, please check!</h1>

    return (
        <div className="flex-1 md:space-y-4">
            <div className="flex items-center max-md:mb-2">
                {/* <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate(-1)} /> */}
                {isLoading ? (<Skeleton className="h-10 w-1/3 bg-gray-300" />) :
                    <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">{data?.item_name}</h2>}
                    {(userData.user_id === "Administrator" || userData.role === "Nirmaan Admin Profile") && (
                        <Dialog>
                        <DialogTrigger>
                            <FilePenLine className="w-10 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle className="mb-2">Edit Item</DialogTitle>
                                <DialogDescription className="flex flex-col gap-2">
                                    <div className="flex flex-col gap-4 ">
    
                                        <div className="flex flex-col items-start">
                                            <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Item Name<sup className="pl-1 text-sm text-red-600">*</sup></label>
                                            <Input
                                                type="text"
                                                id="itemName"
                                                value={curItem}
                                                onChange={(e) => setCurItem(e.target.value)}
                                                className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                            />
                                        </div>
                                        <div className="flex flex-col items-start">
                                            <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Item Unit<sup className="pl-1 text-sm text-red-600">*</sup></label>
                                            <Select onValueChange={(value) => setUnit(value)} defaultValue={unit}>
                                                <SelectTrigger className="">
                                                    <SelectValue className="text-gray-200" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="BOX">BOX</SelectItem>
                                                    <SelectItem value="ROLL">ROLL</SelectItem>
                                                    <SelectItem value="LENGTH">LTH</SelectItem>
                                                    <SelectItem value="MTR">MTR</SelectItem>
                                                    <SelectItem value="NOS">NOS</SelectItem>
                                                    <SelectItem value="KGS">KGS</SelectItem>
                                                    <SelectItem value="PAIRS">PAIRS</SelectItem>
                                                    <SelectItem value="PACKS">PACKS</SelectItem>
                                                    <SelectItem value="DRUM">DRUM</SelectItem>
                                                    <SelectItem value="SQMTR">SQMTR</SelectItem>
                                                    <SelectItem value="LTR">LTR</SelectItem>
                                                    <SelectItem value="BUNDLE">BUNDLE</SelectItem>
                                                    <SelectItem value="FEET">FEET</SelectItem>
                                                </SelectContent>
                                            </Select>
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
                        {/* <CardHeader>
                            <CardTitle>
                                {data?.item_name}
                            </CardTitle>
                        </CardHeader> */}
                        <CardContent className="flex items-start mt-6">
                            <div className="space-y-4">
                                <CardDescription className="space-y-2">
                                    <span>Item ID</span>
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

        </div>
    )
}