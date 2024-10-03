import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import {  useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import {  useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListChecks } from "lucide-react";

interface SelectOption {
    label: string;
    value: string;
}

export default function EditItems({data}) {

    const { data: category_list, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
        fields: ["category_name", "work_package"],
        orderBy: { field: 'category_name', order: 'asc' },
        limit: 1000

    })

    const category_options: SelectOption[] = category_list
        ?.map(item => ({
            label: `${item.category_name}-(${item.work_package})`,
            value: item.category_name
        })) || [];


    const [curItem, setCurItem] = useState('');
    const [unit, setUnit] = useState('');
    const [category, setCategory] = useState('');

    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    const handleEditItem = () => {
        updateDoc('Items', id, {
            category: category ? category : data?.category,
            unit_name: unit ? unit : data.unit_name,
            item_name: curItem ? curItem : data.item_name
        })
            .then(() => {
                console.log("edited", id)
                setUnit('')
                setCurItem('')
                setCategory('')
            }).catch(() => {
                console.log("update_submit_error", update_submit_error)
            })
    }

    return (
        <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
            <div className="flex items-center space-x-2">
                        <div>
                            <p>
                                Enter Item Details here.
                            </p>
                            <div className="mb-4">
                                <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Item Name</label>
                                <Input
                                    type="text"
                                    id="itemName"
                                    placeholder={data?.item_name}
                                    value={curItem}
                                    onChange={(e) => setCurItem(e.target.value)}
                                    className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                />
                            </div>
                            <div className="mb-4">
                                <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Item Unit</label>
                                <Select onValueChange={(value) => setUnit(value)}>
                                    <SelectTrigger className="w-[180px]">
                                        <SelectValue className="text-gray-200" placeholder={data?.unit_name} />
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
                            <div className="mb-4">
                                <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Category</label>
                                <Select onValueChange={(value) => setCategory(value)}>
                                    <SelectTrigger className="w-[180px]">
                                        <SelectValue className="text-gray-200" placeholder={data?.category} />
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
                        <div className="flex">
                                <Button onClick={() => handleEditItem()} className="flex items-center gap-1">
                                        <ListChecks className="h-4 w-4" />
                                        Submit</Button>
                                {/* <Button className="flex right-0" onClick={() => handleEditItem()}>Submit</Button> */}
                                <DialogClose className="flex-1 right-0 hidden">
                                            close button
                                </DialogClose>
                        </div>
            </div>
        </div>
    )
}