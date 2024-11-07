import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects"
import { ServiceRequests as ServiceRequestsType } from "@/types/NirmaanStack/ServiceRequests"
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { NewPRSkeleton } from "../ui/skeleton"
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers"
import { NirmaanComments as NirmaanCommentsType } from "@/types/NirmaanStack/NirmaanComments"
import { ArrowBigUpDash, ArrowLeft, CheckCheck, CirclePlus, Undo2 } from "lucide-react"
import { ProcurementHeaderCard } from "../ui/ProcurementHeaderCard"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import { formatDate } from "@/utils/FormatDate"
import Select from 'react-select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet"
import { NewVendor } from "@/pages/vendors/new-vendor"
import { Button } from "../ui/button"
import { Table as AntTable, ConfigProvider, TableColumnsType } from "antd"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog"
import TextArea from "antd/es/input/TextArea"
import formatToIndianRupee from "@/utils/FormatPrice"

const SelectServiceVendor = () => {
    const { id }: any = useParams()
    const [project, setProject] = useState<string>()

    const { data: sr_data, isLoading: sr_data_loading, error: sr_data_error } = useFrappeGetDoc<ServiceRequestsType>("Service Requests", id)

    useEffect(() => {
        if (sr_data) {
            setProject(sr_data?.project)
        }
    }, [sr_data])

    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", project)

    const { data: usersList, isLoading: userLoading, error: userError } = useFrappeGetDocList<NirmaanUsersType>("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
    })

    const { data: universalComments, isLoading: universalCommentsLoading, error: universalCommentsError } = useFrappeGetDocList<NirmaanCommentsType>("Nirmaan Comments", {
        fields: ["*"],
        limit: 1000,
        filters: [["reference_name", "=", id]],
        orderBy: { field: "creation", order: "desc" }
    })

    return (
        <>  {(sr_data_loading || project_loading || userLoading || universalCommentsLoading) ? <NewPRSkeleton /> : <SelectServiceVendorPage sr_data={sr_data} project_data={project_data} universalComments={universalComments} usersList={usersList} />}
            {(sr_data_error || project_error || userError || universalCommentsError) && <h1>Errro</h1>}
        </>
    )
};

interface SelectServiceVendorPageProps {
    sr_data: ServiceRequestsType | undefined
    project_data: ProjectsType | undefined
    usersList: NirmaanUsersType[] | undefined
    universalComments: NirmaanCommentsType[] | undefined
}

interface DataType {
    key: React.ReactNode;
    category: string | null;
    description: string;
    rate: number | null;
    selectedVendor: string;
    amount: number;
    children?: DataType[];
}

const columns: TableColumnsType<DataType> = [
    {
        title: 'Description',
        dataIndex: 'description',
        key: 'description',
        render: (text, record) => {
            return (
                <div className="inline items-baseline">
                    <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal', fontStyle: record.unit !== null ? 'italic' : "normal" }}>
                        {text}
                    </span>
                </div>
            )
        }
    },
    {
        title: 'Rate',
        dataIndex: 'rate',
        width: '7%',
        key: 'rate',
        render: (text) => {
            return (
                <span>{formatToIndianRupee(text)}</span>
            )
        }
    },
    {
        title: 'Selected Vendor',
        dataIndex: 'selectedVendor',
        width: '15%',
        key: 'selectedVendor',
    },
    {
        title: 'Amount',
        dataIndex: 'amount',
        width: '9%',
        key: 'amount',
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {formatToIndianRupee(text)}
            </span>
        ),
    },
];

const SelectServiceVendorPage = ({ sr_data, project_data, usersList, universalComments }: SelectServiceVendorPageProps) => {

    const navigate = useNavigate()
    const [comment, setComment] = useState<any>(null)
    const [section, setSection] = useState('choose-vendor')
    const [vendorOptions, setVendorOptions] = useState<{ label: string; value: string }[]>([]); // State for dynamic category options
    const [selectedVendor, setSelectedvendor] = useState()
    const [amounts, setAmounts] = useState<{ [key: string]: string }>({}); // New state for amounts
    const [order, setOrder] = useState(JSON.parse(sr_data?.service_order_list).list); // New state for amounts
    const [data, setData] = useState<DataType>([])


    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error, mutate: vendor_list_mutate } = useFrappeGetDocList("Vendors",
        {
            fields: ["*"],
            filters: [['vendor_type', '=', 'Service']],
            limit: 10000
        },
        "Vendors"
    );

    useEffect(() => {
        if (vendor_list) {
            const currOptions = vendor_list?.map((item) => ({
                value: item.name,
                label: item.vendor_name
            }))
            setVendorOptions(currOptions);
        }
    }, [vendor_list]);

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_complete, error: update_error } = useFrappeUpdateDoc()
    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package'],
            orderBy: { field: 'category_name', order: 'asc' },
            limit: 100,
            filters: [['work_package', '=', 'Services']]
        });

    useEffect(() => {
        if (universalComments) {
            const comment = universalComments?.find((cmt) => cmt.subject === "approving sr")
            setComment(comment)
        }
    }, [universalComments])

    const getTotal = (cat: string) => {
        let total: number = 0;
        order.map((item) => {
            if (item.category === cat) {
                const price = item.amount;
                total += (price ? parseFloat(price) : 0) * 1.18;
            }
        })
        return total
    }

    useEffect(() => {
        if (sr_data?.project) {
            const newData: DataType[] = [];
            console.log(JSON.parse(sr_data.service_category_list).list)
            JSON.parse(sr_data.service_category_list).list.map((cat: any) => {
                const items: DataType[] = [];
                console.log(order)
                order.forEach((item: any) => {
                    if (item.category === cat.name) {
                        // const price = Number(getPrice(selectedVendors[item.name], item.name))
                        // const quotesForItem = quote_data
                        //     ?.filter(value => value.item_id === item.name && value.quote)
                        //     ?.map(value => value.quote);
                        // let minQuote;
                        // if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                        // minQuote = (minQuote ? parseFloat(minQuote) * item.quantity : 0)

                        items.push({
                            description: item.description,
                            key: item.description,
                            category: item.category,
                            rate: item.amount,
                            amount: item.amount * 1.18,
                            selectedVendor: selectedVendor ? selectedVendor : "",
                        });
                    }
                });

                if (items.length) {
                    const node: DataType = {
                        description: cat.name,
                        key: cat.name,
                        category: null,
                        rate: null,
                        amount: getTotal(cat.name),
                        selectedVendor: selectedVendor ? selectedVendor : "",
                        children: items,
                    };
                    newData.push(node);
                }
            });
            // console.log("newData", newData)
            setData(newData)
        }
    }, [order, selectedVendor]);

    const getFullName = (id: any) => {
        return usersList?.find((user) => user?.name == id)?.full_name
    }

    const handleChange = () => (vendor: any) => {
        setSelectedvendor(vendor)
    }

    const handleAmountChange = (description: string, value: string) => {
        setAmounts((prev) => ({ ...prev, [description]: value }));
    };

    const handleSaveAmounts = () => {
        console.log("Amounts to save:", amounts);
        let newOrderData = []
        for (let item in order) {
            let entry: any = {}
            entry.category = item.category
            entry.description = item.description
            entry.amount = amounts['item.description']
            newOrderData.push(entry)
        }
        setOrder(newOrderData)
        setSection('summary')
        // Add logic to save amounts to backend
    };

    return (
        <>
            {section === 'choose-vendor' && <>
                <div className="flex-1 md:space-y-4">
                    <div className="flex items-center pt-1 pb-4">
                        <ArrowLeft className='cursor-pointer' onClick={() => navigate(-1)} />
                        <h2 className="text-base pl-2 font-bold tracking-tight"><span className="text-red-700">SR-{sr_data?.name?.slice(-4)}</span>: Choose Service Vendor </h2>
                    </div>
                    <ProcurementHeaderCard orderData={sr_data} sr={true} />

                    <div>
                        <div className="flex m-2 justify-left gap-2">

                            <div className="text-lg text-gray-400 mt-1">Select vendors for this SR:</div>
                            <Select className="w-72" value={selectedVendor} options={vendorOptions} onChange={handleChange()} />
                            <Sheet>
                                <SheetTrigger className="text-blue-500">
                                    <div className="text-base text-blue-400 flex items-center gap-1" >
                                        <CirclePlus className="w-5 h-5" />Add New Vendor
                                    </div>
                                </SheetTrigger>
                                <SheetContent className='overflow-auto'>
                                    <SheetHeader className="text-start">
                                        <SheetTitle>
                                            <div className="flex-1">
                                                <span className="underline">Add Service Vendor</span>
                                                <p className=" text-xs font-light text-slate-500 p-1">Add a new service vendor here</p>
                                            </div>
                                        </SheetTitle>
                                        {/* <SheetDescription> */}
                                        {/* <VendorForm work_package={orderData.work_package} vendor_category_mutate={vendor_category_mutate} vendor_list_mutate={vendor_list_mutate} /> */}
                                        <NewVendor renderCategorySelection={false} navigation={false} service={true} />
                                        {/* </SheetDescription> */}
                                    </SheetHeader>
                                </SheetContent>
                            </Sheet>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <div className="min-w-full inline-block align-middle">
                            {JSON.parse(sr_data?.service_category_list).list.map((cat: any) => {
                                return <div className="p-5">
                                    {/* <div className="text-base font-semibold text-black p-2">{cat.name}</div> */}
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-red-100">
                                                <TableHead className="w-[20%]"><span className="text-red-700 pr-1 font-extrabold">{cat.name}</span></TableHead>
                                                <TableHead className="w-[60%]">Description</TableHead>
                                                <TableHead className="w-[20%]">Amount</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {JSON.parse(sr_data?.service_order_list).list.map((item: any) => {

                                                if (item.category === cat.name) {
                                                    return (
                                                        <TableRow key={item.description}>
                                                            <TableCell>{item.category}</TableCell>
                                                            <TableCell>{item.description}</TableCell>
                                                            <TableCell>
                                                                {selectedVendor && (
                                                                    <input
                                                                        type="text"
                                                                        className="border p-1 w-full"
                                                                        value={amounts[item.description] || ""}
                                                                        onChange={(e) => handleAmountChange(item.description, e.target.value)}
                                                                    />
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                }
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            })}
                        </div>
                    </div>
                    <div className="flex justify-end mt-4">
                        <Button onClick={handleSaveAmounts}>Next</Button>
                    </div>
                    <div className="flex items-center space-y-2">
                        <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">SR Comments</h2>
                    </div>
                    <div className="border border-gray-200 rounded-lg p-4">
                        {comment ? (
                            <>
                                {/* <div className="flex justify-between items-end">
                                         <p className="font-semibold text-[15px]">{universalComments?.find((cmt) => cmt.subject === "approving pr")?.content}</p>
                                         {universalComments?.find((cmt) => cmt.subject === "approving pr")?.comment_by === "Administrator" ? (
                                             <span className="text-sm italic">-Administrator</span>
                                         ) : (
                                             <span className="text-sm italic">- {getFullName(universalComments?.find((cmt) => cmt.subject === "approving pr")?.comment_by)}</span>
                                         )}
                                     </div> */}
                                <div key={comment.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg">
                                    <Avatar>
                                        <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${comment.comment_by}`} />
                                        <AvatarFallback>{comment.comment_by[0]}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1">
                                        <p className="font-medium text-sm text-gray-900">{comment.content}</p>
                                        <div className="flex justify-between items-center mt-2">
                                            <p className="text-sm text-gray-500">
                                                {comment.comment_by === "Administrator" ? "Administrator" : getFullName(comment.comment_by)}
                                            </p>
                                            <p className="text-xs text-gray-400">
                                                {formatDate(comment.creation.split(" ")[0])} {comment.creation.split(" ")[1].substring(0, 5)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <span className="text-xs font-semibold">No Comments Found</span>
                        )
                        }
                    </div>
                    {/* PLACEHOLDER */}

                </div>
            </>}
            {section == 'summary' &&
                <>
                    <div className="flex-1 md:space-y-4">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft className='cursor-pointer' onClick={() => setSection('choose-vendor')} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Comparison</h2>
                        </div>
                        <ProcurementHeaderCard orderData={sr_data} />
                        {/* {orderData?.category_list?.list.map((cat) => {
                            const curCategory = cat.name
                            let total: number = 0;
                            const lowest = getLowest(cat.name);
                            let count: number = 0;

                            return <div className="grid grid-cols-2 gap-4 w-full">

                                <div className="col-span-2 font-bold text-xl py-2">{cat.name}</div>
                                <Card className="flex w-full shadow-none border border-grey-500" >
                                    <CardHeader className="w-full">
                                        <CardTitle>
                                            <div className="flex justify-between border-b">
                                                <div className="font-bold text-lg py-2 border-gray-200">Total</div>
                                                <div className="font-bold text-2xl text-red-500 py-2 border-gray-200">{getTotal(curCategory)}</div>
                                            </div>
                                        </CardTitle>
                                        {orderData?.procurement_list.list.map((item) => {
                                            if (count === 2) { return }
                                            if (item.category === curCategory) {
                                                count++;
                                                const price = getPrice(selectedVendors[item.name], item.name);
                                                total += price ? parseFloat(price) : 0;
                                                return <div className="flex justify-between py-2">
                                                    <div className="text-sm">{item.item}</div>
                                                    <div className="text-sm">{selectedVendors[item.name] ? price * item.quantity : "Delayed"}</div>
                                                </div>
                                            }
                                        })}
                                        <div className="flex justify-between py-2">
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <div className="text-sm text-blue-500 cursor-pointer">View All</div>
                                                </DialogTrigger>
                                                <DialogContent className="md:min-w-[825px]">
                                                    <DialogHeader>
                                                        <DialogTitle>Items List</DialogTitle>
                                                        <DialogDescription>
                                                            <div className="grid grid-cols-12 font-medium text-black justify-between">
                                                                <div className="text-sm col-span-2 border p-2">Items</div>
                                                                <div className="text-sm border p-2">Unit</div>
                                                                <div className="text-sm border p-2">Qty</div>
                                                                <div className="text-sm border p-2">Rate</div>
                                                                <div className="text-sm border p-2">Amount</div>
                                                                <div className="text-sm col-span-2 border p-2">Selected Vendor</div>
                                                                <div className="text-sm col-span-2 border p-2">Lowest Quoted Vendor</div>
                                                                <div className="text-sm col-span-2 border p-2">3 months Lowest Amount</div>
                                                            </div>
                                                            {orderData?.procurement_list?.list.map((item) => {
                                                                if (item.category === curCategory) {
                                                                    const price = getPrice(selectedVendors[item.name], item.name);
                                                                    total += price ? parseFloat(price) : 0;

                                                                    const lowest2 = getLowest2(item.name)

                                                                    const quotesForItem = quote_data
                                                                        ?.filter(value => value.item_id === item.name && value.quote)
                                                                        ?.map(value => value.quote);
                                                                    let minQuote;
                                                                    if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                                    return <div className="grid grid-cols-12">
                                                                        <div className="text-sm col-span-2 border p-2">{item.item}</div>
                                                                        <div className="text-sm border p-2">{item.unit}</div>
                                                                        <div className="text-sm border p-2">{item.quantity}</div>
                                                                        <div className="text-sm border p-2">{selectedVendors[item.name] ? price : "Delayed"}</div>
                                                                        <div className="text-sm border p-2">{selectedVendors[item.name] ? price * item.quantity : "Delayed"}</div>
                                                                        <div className="text-sm col-span-2 border p-2">{selectedVendors[item.name] ? getVendorName(selectedVendors[item.name]) : "Delayed"}</div>
                                                                        <div className="text-sm col-span-2 border p-2">{lowest2 ? lowest2 * item.quantity : "N/A"}</div>
                                                                        <div className="text-sm col-span-2 border p-2">{minQuote ? minQuote * item.quantity : "N/A"}</div>
                                                                    </div>
                                                                }
                                                            })}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                </DialogContent>
                                            </Dialog>
                                        </div>
                                    </CardHeader>
                                </Card>

                                <div>
                                    <div className="h-[50%] p-5 rounded-lg border border-grey-500">
                                        <div className="flex justify-between">
                                            <div className="text-sm font-medium text-gray-400">Lowest Quoted Vendor</div>
                                            <div className="font-bold text-2xl text-gray-500 border-gray-200 py-0">{lowest.quote}
                                                <div className='flex'>
                                                    {
                                                        (lowest?.quote < getTotal(curCategory)) ?
                                                            <TrendingDown className="text-red-500" /> : <CheckCheck className="text-blue-500" />
                                                    }
                                                    <span className={`pl-2 text-base font-medium ${(lowest?.quote < getTotal(curCategory)) ? "text-red-500" : "text-blue-500"}`}>{getPercentdiff(lowest?.quote, getTotal(curCategory))}%</span>
                                                </div>

                                            </div>
                                        </div>
                                        <div className="flex justify-between font-medium text-gray-700 text-sm">
                                            {getVendorName(lowest.vendor)}
                                            <div className="text-end text-sm text-gray-400">Delivery Time: {getLeadTime(selectedVendors[curCategory], curCategory)} Days</div>
                                        </div>

                                    </div>
                                    <div className="mt-2 h-[45%] p-5 rounded-lg border border-grey-500">
                                        <div className="flex justify-between">
                                            <div className="text-sm font-medium text-gray-400">Last 3 months Metric</div>
                                            <div className="font-bold text-2xl text-gray-500 border-gray-200">{getLowest3(curCategory)}
                                                <div className='flex'>
                                                    {
                                                        (getLowest3(curCategory) > getTotal(curCategory)) ?
                                                            <TrendingUp className="text-green-500" /> : ((getLowest3(curCategory) < getTotal(curCategory)) ? <TrendingDown className="text-red-500" /> : <CheckCheck className="text-blue-500" />)
                                                    }
                                                    <span className={`pl-2 text-base font-medium ${(getLowest3(curCategory) < getTotal(curCategory)) ? "text-red-500" : ((getLowest3(curCategory) > getTotal(curCategory)) ? "text-green-500" : "text-blue-500")}`}>{getPercentdiff(getTotal(curCategory), getLowest3(curCategory))}%</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="font-medium text-gray-700 text-sm">
                                            Last 3 months Lowest Amount
                                        </div>
                                    </div>
                                </div>
                            </div>
                        })} */}
                        {/* <div className='p-10'></div> */}
                        {/* <div className="flex flex-col justify-end items-end">
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button>
                                        Send for Approval
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Have you cross-checked your selections?</DialogTitle>
                                        <DialogDescription>
                                            Remainder: Items whose quotes are not selected will have a delayed status attached to them. If confirmed, Delayed sent back request will be created for those Items.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogClose>
                                        <Button variant="secondary">Go Back</Button>
                                        <Button variant="secondary" onClick={() => handleSubmit()}>Confirm</Button>
                                    </DialogClose>
                                </DialogContent>
                            </Dialog>
                        </div> */}
                    </div>
                    <div className='pt-6 overflow-x-auto'>
                        <ConfigProvider
                            theme={{
                                token: {
                                    // Seed Token
                                    colorPrimary: '#FF2828',
                                    borderRadius: 4,


                                    // Alias Token
                                    colorBgContainer: '#FFFFFF',
                                },
                            }}
                        >
                            <AntTable
                                dataSource={data}
                                expandable={{ defaultExpandAllRows: true }}
                                columns={columns}
                            />

                        </ConfigProvider>
                    </div>
                    {/* <div className="flex flex-col justify-end items-end mr-2 mb-4 mt-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="flex items-center gap-1" disabled={submitClicked}>
                                    <ArrowBigUpDash className="" />
                                    Send for Approval
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Have you cross-checked your selections?</DialogTitle>
                                    <DialogDescription>
                                        Remainder: Items whose quotes are not selected will have a delayed status attached to them. If confirmed, Delayed sent back request will be created for those Items.


                                        {Object.keys(delayedItems).length !== 0 ? (
                                            <div className='flex flex-col gap-2 mt-2 text-start'>
                                                <h4 className='font-bold'>some items are delayed, any reason?</h4>
                                                <TextArea placeholder='type here...' value={comment} onChange={(e) => setComment(e.target.value)} />
                                            </div>
                                        ) : <></>}
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogDescription className='flex items-center justify-center gap-2'>
                                    <DialogClose><Button variant="secondary" className="flex items-center gap-1">
                                        <Undo2 className="h-4 w-4" />
                                        Cancel</Button></DialogClose>
                                    <Button variant="default" onClick={() => handleSubmit()} disabled={submitClicked} className="flex items-center gap-1">
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm</Button>
                                </DialogDescription>
                            </DialogContent>
                        </Dialog>
                    </div> */}
                </>}
        </>


    )
}

export const Component = SelectServiceVendor