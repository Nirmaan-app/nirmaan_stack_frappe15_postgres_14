
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { ColumnDef } from "@tanstack/react-table";
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { ArrowLeft, CirclePlus, HardHat } from "lucide-react";

import { useMemo, useState } from "react";

import { Link, useNavigate, useParams } from "react-router-dom";

import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { MainLayout } from "@/components/layout/main-layout"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export function ItemComponent({ item_id }) {
    const { data: item_data, isLoading: item_loading, error: item_error } = useFrappeGetDoc("Items", item_id);

    if (item_loading) return <>Loading</>
    if (item_error) return <>{item_error.message}</>
    return item_data?.item_name
}

export default function EditItems() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>()

    const { data: data, isLoading: isLoading, error: error} = useFrappeGetDoc("Items",id)


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
                navigate("/items")
                setUnit('')
                setCurItem('')
                setCategory('')
            }).catch(() => {
                console.log("update_submit_error", update_submit_error)
            })
    }


    return (

        <MainLayout>
            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-x-2">
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button>
                                <CirclePlus className="w-5 h-5 mt- pr-1 " /><span className="hidden md:flex pl-1">Edit Item</span>
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Edit Item</DialogTitle>
                                <DialogDescription>
                                    Enter Item Details here.
                                </DialogDescription>
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
                                            <SelectItem value="PCS">PCS</SelectItem>
                                            <SelectItem value="BOX">BOX</SelectItem>
                                            <SelectItem value="ROLL">ROLL</SelectItem>
                                            <SelectItem value="PKT">PKT</SelectItem>
                                            <SelectItem value="MTR">MTR</SelectItem>
                                            <SelectItem value="NOS">NOS</SelectItem>
                                            <SelectItem value="KGS">KGS</SelectItem>
                                            <SelectItem value="PAIRS">PAIRS</SelectItem>
                                            <SelectItem value="PACKS">PACKS</SelectItem>
                                            <SelectItem value="DRUM">DRUM</SelectItem>
                                            <SelectItem value="COIL">COIL</SelectItem>
                                            <SelectItem value="SQMTR">SQMTR</SelectItem>
                                            <SelectItem value="LTR">LTR</SelectItem>
                                            <SelectItem value="PAC">PAC</SelectItem>
                                            <SelectItem value="BAG">BAG</SelectItem>
                                            <SelectItem value="BUNDLE">BUNDLE</SelectItem>
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
                                            <SelectItem value="Miscellaneous">Miscellaneous</SelectItem>
                                            <SelectItem value="Conduits">Conduits</SelectItem>
                                            <SelectItem value="Wires & Cables">Wires & Cables</SelectItem>
                                            <SelectItem value="Switch Sockets">Switch Sockets</SelectItem>
                                            <SelectItem value="Accessories">Accessories</SelectItem>
                                            <SelectItem value="Lighting">Lighting</SelectItem>
                                            <SelectItem value="Raceway & Cabletray">Raceway & Cabletray</SelectItem>
                                            <SelectItem value="Switch Gear">Switch Gear</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </DialogHeader>
                            <div className="flex">
                                <DialogClose className="flex-1 right-0">
                                    <Button className="flex right-0" onClick={() => handleEditItem()}>Submit</Button>
                                </DialogClose>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>
        </MainLayout>
    )
}