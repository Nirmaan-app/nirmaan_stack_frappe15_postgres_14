
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

import { Link, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/main-layout"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export function ItemComponent({ item_id }) {
    const { data: item_data, isLoading: item_loading, error: item_error } = useFrappeGetDoc("Items", item_id);

    if (item_loading) return <>Loading</>
    if (item_error) return <>{item_error.message}</>
    return item_data?.item_name
}

export default function Items() {
    const navigate = useNavigate();


    const columns: ColumnDef[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Item ID" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/items/${row.getValue("name")}`}>
                                {row.getValue("name")}
                            </Link>
                        </div>
                    )
                }


            },
            {
                accessorKey: "item_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Item Name" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("item_name")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date Added" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("creation")?.split(" ")[0]}
                        </div>
                    )
                }
            },
            {
                accessorKey: "unit_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Unit" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("unit_name")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "category",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Category" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("category")}
                        </div>
                    )
                }
            }
        ],
        []
    )


    const { data: data, isLoading: isLoading, error: error, mutate: mutate } = useFrappeGetDocList("Items", {

        fields: ["name", "item_name", "unit_name", "category", "creation"],
        limit: 1000
    })


    const [curItem, setCurItem] = useState('');
    const [unit, setUnit] = useState('');
    const [category, setCategory] = useState('');

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()


    const handleAddItem = () => {
        const itemData = {
            category: category,
            unit_name: unit,
            item_name: curItem
        }
        createDoc('Items', itemData)
            .then(() => {
                console.log(itemData)
                setUnit('')
                setCurItem('')
                setCategory('')
                mutate()
            }).catch(() => {
                console.log("submit_error", error)
            })
    }

    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    const handleEditItem = (item_id: string, itemName: string, cat: string, curUnit: string) => {
        updateDoc('Items', item_id, {
            category: category ? category : cat,
            unit_name: unit ? unit : curUnit,
            item_name: curItem ? curItem : itemName
        })
            .then(() => {
                console.log("edited", item_id)
                setUnit('')
                setCurItem('')
                setCategory('')
                mutate()
            }).catch(() => {
                console.log("update_submit_error", update_submit_error)
            })
    }


    return (

        <MainLayout>
            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                {/* <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/items" className="text-gray-400 md:text-base text-sm">
                                Items
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div> */}
                <div className="flex items-center justify-between mb-2 space-y-2">
                    <div className="flex">
                        <ArrowLeft className="mt-1.5" onClick={() => navigate("/")} />
                        <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">Items List</h2>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button>
                                    <CirclePlus className="w-5 h-5 mt- pr-1 " /><span className="hidden md:flex pl-1">Add New Item</span>
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Add New Item</DialogTitle>
                                    <DialogDescription>
                                        Enter Item Details here.
                                    </DialogDescription>
                                    <div className="mb-4">
                                        <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Item Name</label>
                                        <Input
                                            type="text"
                                            id="itemName"
                                            value={curItem}
                                            onChange={(e) => setCurItem(e.target.value)}
                                            className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Item Unit</label>
                                        <Select onValueChange={(value) => setUnit(value)}>
                                            <SelectTrigger className="w-[180px]">
                                                <SelectValue className="text-gray-200" placeholder="Select Unit" />
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
                                                <SelectValue className="text-gray-200" placeholder="Select Category" />
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
                                        <Button className="flex right-0" onClick={() => handleAddItem()}>Submit</Button>
                                    </DialogClose>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>

                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                    <Card className="hover:animate-shadow-drop-center" onClick={() => {

                    }}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Total Items
                            </CardTitle>
                            <HardHat className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(isLoading) ? (<p>Loading</p>) : (data?.length)}
                                {error && <p>Error</p>}
                            </div>
                            <p className="text-xs text-muted-foreground">COUNT</p>
                        </CardContent>
                    </Card>
                </div>
                <div className="cmx-auto py-10">
                    {isLoading && <h3>LOADING</h3>}
                    {error && <h3>ERROR</h3>}
                    <DataTable columns={columns} data={data || []} />
                </div>
            </div>
        </MainLayout>

    )
}