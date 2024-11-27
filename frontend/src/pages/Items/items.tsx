import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft, CirclePlus, ListChecks, ShoppingCart } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { TailSpin } from "react-loader-spinner";
import { TableSkeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";
import { Items as ItemsType } from "@/types/NirmaanStack/Items"

export default function Items() {

    const [curItem, setCurItem] = useState('');
    const [make, setMake] = useState('');
    const [unit, setUnit] = useState('');
    const [category, setCategory] = useState('');
    const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]);

    const { data: data, isLoading: isLoading, error: error, mutate: mutate } = useFrappeGetDocList("Items", {

        fields: ["name", "item_name", "unit_name", "make_name", "category", "creation"],
        limit: 10000,
        orderBy: { field: "creation", order: "desc" }
    })
    const { data: category_list, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {

        fields: ["*"],
        orderBy: { field: 'work_package', order: 'asc' },
        limit: 1000
    })

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { toast } = useToast()
    const navigate = useNavigate();


    useEffect(() => {
        if (category_list) {
            const currOptions = category_list.map((item) => ({
                value: item.name,
                label: item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")"
            }))
            setCategoryOptions(currOptions);
        }
    }, [category_list]);

    const columns: ColumnDef<ItemsType>[] = useMemo(
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
                                {row.getValue("name").slice(-6)}
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
                            <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/items/${row.getValue("name")}`}>
                                {row.getValue("item_name")}
                            </Link>
                            {/* `${item.item_name} ${ ? "-" + row.getValue("make_name") : ""}` */}
                        </div>
                    )
                }
            },
            {
                accessorKey: "make_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Make" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("make_name") || "--"}
                            {/* `${item.item_name} ${ ? "-" + row.getValue("make_name") : ""}` */}
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
                            {formatDate(row.getValue("creation")?.split(" ")[0])}
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
                            <Badge>{row.getValue("category")}</Badge>
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                },
            }
        ],
        []
    )

    const handleAddItem = () => {
        const itemData = {
            category: category,
            unit_name: unit,
            item_name: curItem,
            make_name: make
        }
        createDoc('Items', itemData)
            .then(() => {
                console.log(itemData)
                toast({
                    title: "Success!",
                    description: `Item: ${curItem} created successfully!`,
                    variant: "success"
                })
                document.getElementById("dialogCloseItem")?.click()
                setUnit('')
                setCurItem('')
                setCategory('')
                setMake('')
                mutate()
            }).catch(() => {
                console.log("submit_error", submit_error)
                toast({
                    title: "Error!",
                    description: `Error ${submit_error?.message}`,
                    variant: "destructive"
                })
            })
    }

    // if (isLoading || category_loading) return <h1>Loading</h1>
    if (error || category_error) return (error ? <h1>error.message</h1> : <h1>category_error.message</h1>)

    return (

        <div className="flex-1 space-y-4">
            {/* <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate("/")} />
                    <h2 className="text-xl md:text-3xl font-bold tracking-tight">Items List</h2>
                </div>
            </div> */}
            <div className="flex justify-between">
                <Card className="hover:animate-shadow-drop-center w-[60%]">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Total Items
                        </CardTitle>
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />) : (data?.length)}
                        </div>
                    </CardContent>
                </Card>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button className="flex items-center gap-1">
                            <CirclePlus className="w-5 h-5" />
                            <span className="hidden md:flex">Add New Item</span>
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle className="mb-2">Add New Item</DialogTitle>
                            <div className="flex flex-col gap-4 ">
                                <div className="flex flex-col items-start">
                                    <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Category<sup className="pl-1 text-sm text-red-600">*</sup></label>
                                    <Select onValueChange={(value) => setCategory(value)}>
                                        <SelectTrigger className="">
                                            <SelectValue className="text-gray-200" placeholder="Select Category" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {category_list?.map((cat) => {
                                                return <SelectItem value={cat.category_name}>{cat.category_name}-({cat.work_package})</SelectItem>
                                            })}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex flex-col items-start">
                                    <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Item Name<sup className="pl-1 text-sm text-red-600">*</sup></label>
                                    <Input
                                        type="text"
                                        id="itemName"
                                        placeholder="Enter name..."
                                        value={curItem}
                                        onChange={(e) => setCurItem(e.target.value)}
                                        className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                    />
                                </div>
                                <div className="flex flex-col items-start">
                                    <label htmlFor="makeName" className="block text-sm font-medium text-gray-700">Make Name(optional)</label>
                                    <Input
                                        type="text"
                                        id="makeName"
                                        value={make}
                                        onChange={(e) => setMake(e.target.value)}
                                        className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                    />
                                </div>
                                <div className="flex flex-col items-start">
                                    <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Item Unit<sup className="pl-1 text-sm text-red-600">*</sup></label>
                                    <Select onValueChange={(value) => setUnit(value)}>
                                        <SelectTrigger className="">
                                            <SelectValue className="text-gray-200" placeholder="Select Unit" />
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
                            </div>
                        </DialogHeader>
                        <Button onClick={() => handleAddItem()} disabled={loading || !curItem || !unit || !category} className="flex items-center gap-1">
                            <ListChecks className="h-4 w-4" />
                            Submit</Button>
                        <DialogClose className="hidden" id="dialogCloseItem">
                            close
                        </DialogClose>
                    </DialogContent>
                </Dialog>
            </div>
            <div className="pl-0 pr-2">
                {isLoading || category_loading ? (
                    <TableSkeleton />
                ) : (
                    <DataTable columns={columns} data={data || []} category_options={categoryOptions} />
                )}
            </div>
        </div>
    )
}