import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { ArrowLeft, CirclePlus, MessageCircleMore } from 'lucide-react';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams } from "react-router-dom";
import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom";
import { Button } from '@/components/ui/button'
import { NewVendor } from '@/pages/vendors/new-vendor';
import { ButtonLoading } from '../ui/button-loading';
import { DataTable } from '../data-table/data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ColumnDef } from "@tanstack/react-table";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { formatDate } from '@/utils/FormatDate';
import Select from 'react-select'
import { AddVendorCategories } from "../forms/addvendorcategories";
import { Badge } from "../ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";

export const ProcurementOrder = () => {

    const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate();

    const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]); // State for dynamic category options

    const [page, setPage] = useState<string>('approve')
    const [uniqueVendors, setUniqueVendors] = useState({
        list: []
    })
    const [orderData, setOrderData] = useState({
        project: '',
        work_package: '',
        procurement_list: {
            list: []
        },
        category_list: {
            list: []
        }
    })
    const [categories, setCategories] = useState({})
    const [selectedCategories, setSelectedCategories] = useState(null)
    const [uniqueCategories, setUniqueCategories] = useState({
        list: []
    })

    const { data: category_data, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
        fields: ["*"],
        limit: 1000
    })

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ["*"],
            filters: [["name", "=", orderId]],
            limit: 1000
        },
        `Procurement Requests, filters(name,${orderId})`
    );
    const { data: vendor_category_list, isLoading: vendor_category_list_loading, error: vendor_category_list_error, mutate: vendor_category_mutate } = useFrappeGetDocList("Vendor Category",
        {
            fields: ["*"],
            limit: 1000
        },
        "Vendor Category"
    );

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error, mutate: vendor_list_mutate } = useFrappeGetDocList("Vendors",
        {
            fields: ["*"],
            limit: 1000
        },
        "Vendors"
    );

    const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ["*"],
            limit: 10000
        },
        `Quotation Requests`
    );
    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_complete, error: update_error } = useFrappeUpdateDoc()




    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package'],
            orderBy: { field: 'category_name', order: 'asc' },
            limit: 100,
            filters: [['work_package', '=', orderData.work_package]]
        });


    if (!orderData.project) {
        procurement_request_list?.map(item => {
            if (item.name === orderId) {
                setOrderData(item)
            }
        })
    }

    // Extract unique categories from the data dynamically
    useEffect(() => {
        if (category_data) {
            const currOptions = category_data.map((item) => ({
                value: item.name,
                label: item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")"
            }))
            setCategoryOptions(currOptions);
        }
    }, [category_data]);

    const columns: ColumnDef<ProjectsType>[] = useMemo(
        () => [
            {
                accessorKey: "vendor_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Name" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("vendor_name")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date Created" />
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
                accessorKey: "vendor_category",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Categories" />
                    )
                },
                cell: ({ row }) => {
                    const categories = row.getValue("vendor_category")
                    const vendor_name = row.getValue("vendor_name")
                    return (
                        <div className="space-x-1 space-y-1">
                            {categories?.categories.map((cat) => (
                                <Badge key={cat} >{cat}</Badge>
                            ))}
                            <Sheet>
                                <SheetTrigger>
                                    <button className="px-2 border flex gap-1 items-center rounded-md hover:bg-gray-200">
                                        <CirclePlus className="w-3 h-3" />
                                        <span>Add Category</span>
                                    </button>
                                </SheetTrigger>
                                <SheetContent>
                                    <AddVendorCategories vendor_name={vendor_name} isSheet={true} />
                                </SheetContent>
                            </Sheet>
                        </div>
                    )
                },
                // Implement filtering for the categories
                filterFn: (row, _columnId, filterValue: string[]) => {
                    const categories = row.getValue<string[]>("vendor_category")['categories'] || [];
                    return filterValue.every((filter) => categories.includes(filter));
                },
            },
        ],
        []
    )

    useEffect(() => {
        const updatedCategories = { ...categories };

        vendor_category_list?.forEach((item) => {
            const fieldName = `${item.category}`;
            if (!Array.isArray(updatedCategories[fieldName])) {
                updatedCategories[fieldName] = [];
            }
            const exists = updatedCategories[fieldName].some(
                (entry) => entry.value === item.vendor
            );
            if (!exists) {
                updatedCategories[fieldName].push({
                    value: item.vendor,
                    label: item.vendor_name,
                });
            }
        });

        setCategories(updatedCategories);
    }, [vendor_category_list]);

    const handleChange = (category) => (selectedOptions) => {
        console.log(selectedOptions)
        const updatedCategories = { ...selectedCategories };
        const newVendors = [];
        selectedOptions?.map((item) => {
            if (!Array.isArray(updatedCategories[category])) {
                updatedCategories[category] = [];
            }
            newVendors.push(item.value)
        })
        updatedCategories[category] = newVendors
        setSelectedCategories(updatedCategories);
    }
    const getCategoryByName = (name) => {
        const fieldName = `${name}`;
        return categories[fieldName];
    };

    const handleSubmit = async () => {
        if (Object.keys(selectedCategories).length != orderData.category_list.list.length) return
        const cats = uniqueCategories.list;
        const promises = [];

        orderData.procurement_list.list.forEach((item) => {
            const categoryExists = cats.some(category => category === item.category);
            if (!categoryExists) {
                cats.push(item.category);
            }

            const curCategory = `${item.category}`;
            selectedCategories[curCategory].forEach((cat) => {
                const new_procurement_list = procurement_request_list?.find(value => value.name === orderId).procurement_list;
                const new_quantity = new_procurement_list?.list.find(value => value.name === item.name).quantity;

                const quotation_request = {
                    procurement_task: orderId,
                    category: item.category,
                    item: item.name,
                    vendor: cat,
                    quantity: new_quantity
                };

                const vendors = uniqueVendors.list;
                vendors.push(cat);

                const removeDuplicates = (array) => {
                    return Array.from(new Set(array));
                };
                const uniqueList = removeDuplicates(vendors);
                setUniqueVendors({
                    list: uniqueList
                });

                promises.push(
                    createDoc('Quotation Requests', quotation_request)
                        .then(() => {
                            console.log(quotation_request);
                        })
                        .catch(() => {
                            console.log(submit_error);
                        })
                );
            });
        });

        setUniqueCategories({
            list: cats
        });

        try {
            await Promise.all(promises);
            updateDoc('Procurement Requests', orderId, {
                workflow_state: "RFQ Generated",
            })
                .then(() => {
                    console.log(orderId)
                    navigate(`/procure-request/quote-update/${orderId}`);
                }).catch(() => {
                    console.log("error", update_error)
                })

        } catch (error) {
            console.error("Error in creating documents:", error);
        }
    };

    console.log("orderdata", orderData)

    return (
        <>
            {page == 'approve' &&
                    <div className="flex-1 md:space-y-4 p-4">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft className='cursor-pointer' onClick={() => navigate("/procure-request")} />
                            <h2 className="text-base pl-2 font-bold tracking-tight"><span className="text-red-700">PR-{orderData?.name?.slice(-4)}</span>: Summary </h2>
                        </div>
                        <Card className="flex md:grid md:grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                            <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Date:</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(orderData?.creation?.split(" ")[0])}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project Lead</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                            </div>
                            {/* <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div> */}
                        </Card>
                        <div className="overflow-x-auto">
                            <div className="min-w-full inline-block align-middle">
                                {orderData?.category_list.list.map((cat: any) => {
                                    return <div className="p-5">
                                        {/* <div className="text-base font-semibold text-black p-2">{cat.name}</div> */}
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-red-100">
                                                    <TableHead className="w-[50%]"><span className="text-red-700 pr-1 font-extrabold">{cat.name}</span>Items</TableHead>
                                                    <TableHead className="w-[20%]">UOM</TableHead>
                                                    <TableHead className="w-[10%]">Qty</TableHead>
                                                    <TableHead className="w-[10%]">Est. Amt</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {orderData?.procurement_list.list.map((item: any) => {
                                                    if (item.category === cat.name) {
                                                        const quotesForItem = quote_data
                                                            ?.filter(value => value.item === item.name && value.quote != null)
                                                            ?.map(value => value.quote);
                                                        let minQuote;
                                                        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                                                        return (
                                                            <TableRow key={item.item}>
                                                                <TableCell className="flex gap-1 items-center">{item.item}
                                                                    {item.comment && (
                                                                    <HoverCard>
                                                                        <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-6 h-6" /></HoverCardTrigger>
                                                                        <HoverCardContent className="max-w-[300px]">
                                                                        <div className="relative pb-4">
                                                                            <span className="block">{item.comment}</span>
                                                                            <span className="text-xs absolute right-0 italic text-gray-500">-Comment by PL</span>
                                                                        </div>

                                                                        </HoverCardContent>
                                                                    </HoverCard>
                                                                    )}
                                                                </TableCell>
                                                                <TableCell>{item.unit}</TableCell>
                                                                <TableCell>{item.quantity}</TableCell>
                                                                <TableCell>{minQuote ? minQuote * item.quantity : "N/A"}</TableCell>
                                                            </TableRow>
                                                        )
                                                    }
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                })}
                            </div>
                            {/* <table className="min-w-full divide-gray-200">
                                <thead className="border-b-2 border-black">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UOM</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Price</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {orderData?.procurement_list?.list.map(item => {
                                        const quotesForItem = quote_data
                                            ?.filter(value => value.item === item.name && value.quote != null)
                                            ?.map(value => value.quote);
                                        let minQuote;
                                        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                        return <tr key={item.item}>
                                            <td className="px-6 py-4">{item.item}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {item.category}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.unit}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.quantity}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                {minQuote ? minQuote * item.quantity : "N/A"}
                                            </td>
                                        </tr>
                                    })}
                                </tbody>
                            </table> */}
                        </div>
                        <div className="flex flex-col justify-end items-end">
                            <Button onClick={() => setPage('vendors')}>
                                Select Vendors
                            </Button>
                        </div>
                    </div>}
            {page == 'vendors' &&
                    <div className="flex-1 md:space-y-4 p-4">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft onClick={() => setPage("approve")} />
                            <h2 className="text-base pl-2 font-bold tracking-tight"><span className="text-red-700">PR-{orderData?.name?.slice(-4)}</span>: Select Vendors</h2>
                        </div>
                        <Card className="flex md:grid md:grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                            <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Date:</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(orderData?.creation?.split(" ")[0])}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project Lead</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                            </div>
                            {/* <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div> */}
                        </Card>
                        {orderData?.category_list?.list.map((cat) => {
                            return <div>
                                <div className="flex m-2 justify-between">
                                    <div>
                                        <div className="text-xl font-bold py-2 text-red-700">{cat.name}</div>
                                        <div className="text-sm text-gray-400">Select vendors for <span className="text-red-700 italic">{cat.name}</span> category</div>
                                    </div>
                                    <Sheet>
                                        <SheetTrigger className="text-blue-500">
                                            <div className="flex">
                                                <div className="text-base text-blue-400 flex" >
                                                    <CirclePlus className="w-5 h-5 mr-2" />Add Vendor</div>
                                            </div>
                                        </SheetTrigger>
                                        <SheetContent className='overflow-auto'>
                                            <SheetHeader className="text-start">
                                                <SheetTitle>
                                                    <div className="flex-1">
                                                        <span className="underline">Add Vendor for <span className="text-red-700">{cat.name}</span></span>
                                                        <p className=" text-xs font-light text-slate-500 p-1">Add a new vendor here with at least <span className="text-red-700 italic">{cat.name}</span> added as category</p>
                                                        <p className=" text-xs font-light text-slate-500 p-1"><span className="text-red-700 font-bold">NOTE: </span>Check if the vendor is already available! If yes, then click on cross at top right, scroll down to add <span className="text-red-700 italic">{cat.name}</span> to that vendor.</p>

                                                    </div>
                                                </SheetTitle>
                                                {/* <SheetDescription> */}
                                                {/* <VendorForm work_package={orderData.work_package} vendor_category_mutate={vendor_category_mutate} vendor_list_mutate={vendor_list_mutate} /> */}
                                                <NewVendor dynamicCategories={category_list || []} renderCategorySelection={true} navigation={false} />
                                                {/* </SheetDescription> */}
                                            </SheetHeader>
                                        </SheetContent>
                                    </Sheet>
                                </div>
                                <Select options={getCategoryByName(cat.name)} onChange={handleChange(cat.name)} isMulti />
                            </div>
                        })}
                        <div className="flex flex-col justify-end items-end max-md:py-6 pb-10">
                            {/* {block ? <div>loading...</div> : <Button onClick={() => { handleSubmit(); setBlock(true) }}>
                                Send RFQ
                            </Button>} */}
                            {(loading || update_loading) ? <ButtonLoading /> : (
                                <Button disabled={selectedCategories === null} onClick={handleSubmit}>Send RFQ</Button>
                            )}
                        </div>
                        <Accordion type="multiple" defaultValue={["Vendors"]}>
                            <AccordionItem value="Vendors">
                                <AccordionTrigger>
                                    <div className="md:mb-2 text-base md:text-lg px-2  w-full text-left">
                                        <div className="flex-1">
                                            <span className=" text-base mb-0.5 md:text-lg font-slim">Recently Added Vendors</span>
                                            <div className="text-sm text-gray-400">Check if you have added a vendor previously and want to update their <span className="text-red-700 italic">category</span> </div>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="">
                                        <Card className=''>
                                            <CardHeader>
                                                <CardContent>
                                                    <DataTable columns={columns} data={vendor_list || []} category_options={categoryOptions} />
                                                </CardContent>
                                            </CardHeader>
                                        </Card>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                        {/* <Button onClick={() => setShow(!show)}>Recently Added Vendors</Button>
                        {show && (
                            <div className='px-20'>
                            <Card className=''>
                                <CardHeader>
                                    <CardContent>
                                        <DataTable columns={columns} data={vendor_list || []}/>
                                    </CardContent>
                                </CardHeader>
                            </Card>
                        </div>
                        )} */}
                    </div>}
        </>
    )
}


// const CustomSelect = ({ options, defaultValue, onChange }) => {
//     const [selectedOptions, setSelectedOptions] = useState(defaultValue || []);
//     const [filteredOptions, setFilteredOptions] = useState([]);
//     const [searchTerm, setSearchTerm] = useState("");

//     console.log("default", defaultValue)
//     console.log("selectedOptions", selectedOptions) 
//     console.log("options", options)

//     // Update selected options when defaultValue changes
//     useEffect(() => {
//         setSelectedOptions(defaultValue || []);
//     }, [defaultValue]);

//     // Filter options based on the selected ones
//     useEffect(() => {
//         if (options) {
//             const availableOptions = options.filter(
//                 (option) => !selectedOptions.some((selected) => selected.value === option.value)
//             );
//             setFilteredOptions(availableOptions);
//         }
//     }, [selectedOptions, options]);

//     const handleSelect = (option) => {
//         const newSelectedOptions = [...selectedOptions, option];
//         setSelectedOptions(newSelectedOptions);
//         onChange(newSelectedOptions);
//     };

//     const handleDeselect = (option) => {
//         const newSelectedOptions = selectedOptions.filter((item) => item.value !== option.value);
//         setSelectedOptions(newSelectedOptions);
//         onChange(newSelectedOptions);
//     };

//     const handleSearch = (e) => {
//         setSearchTerm(e.target.value);
//     };

//     const filteredResults = filteredOptions.filter(option =>
//         option.label.toLowerCase().includes(searchTerm.toLowerCase())
//     );

//     return (
//         <div className="custom-select h-[500px] overflow-auto">
//             <div className="selected-options">
//                 {selectedOptions.map(option => (
//                     <span key={option.value} className="option-tag">
//                         {option.label}
//                         <button className="remove-btn" onClick={() => handleDeselect(option)}>
//                             x
//                         </button>
//                     </span>
//                 ))}
//             </div>

//             <input 
//                 type="text" 
//                 className="search-bar" 
//                 value={searchTerm} 
//                 onChange={handleSearch} 
//                 placeholder="Search categories..."
//             />

//             <ul className="options-list">
//                 {filteredResults.map(option => (
//                     <li 
//                         key={option.value} 
//                         className="option-item"
//                         onClick={() => handleSelect(option)}
//                     >
//                         {option.label}
//                     </li>
//                 ))}
//             </ul>
//         </div>
//     );
// };
