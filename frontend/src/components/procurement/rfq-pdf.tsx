import redlogo from "@/assets/red-logo.png";
import { ProcurementItem } from "@/types/NirmaanStack/ProcurementRequests";
import { formatDate } from "@/utils/FormatDate";
import { Button, Layout } from "antd";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { CircleChevronDown, CircleChevronLeft, FolderUp, MessageCircleMore, Printer } from "lucide-react";
import * as pdfjsLib from 'pdfjs-dist';
import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from 'react-to-print';
import { Separator } from "../ui/separator";
import { Switch } from "../ui/switch";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js"

const {  Sider, Content } = Layout;

interface PrintFRQProps {
    pr_id : string
    vendor_id: string
    itemList : ProcurementItem[]
}

export const PrintRFQ : React.FC<PrintFRQProps> = ({ pr_id, vendor_id, itemList }) => {

    const {data : boqAttachments} = useFrappeGetDocList("Category BOQ Attachments", {
        fields: ["*"],
        filters: [["procurement_request", "=", pr_id]]
    })

    const [collapsed, setCollapsed] = useState(true);

    // console.log("BOQ Attachments", boqAttachments)

    const [pdfImages, setPdfImages] = useState({});

    const [categoryForVendor, setCategoryVendor] = useState(new Set())
    const [displayBOQ, setDisplayBOQ] = useState({})
    const [includeComments, setIncludeComments] = useState(false)
    
    // console.log("displayBOQ", displayBOQ)

    const loadPdfAsImages = async (pdfData, category) => {
      try {
    
        const response = await fetch(pdfData, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/pdf',
          },
        });
    
        if (!response.ok) {
          throw new Error(`Failed to fetch PDF: ${response.statusText}`);
        }
    
        const pdfArrayBuffer = await response.arrayBuffer();
    
        const loadingTask = pdfjsLib.getDocument({ data: pdfArrayBuffer });
        const pdf = await loadingTask.promise;
    
        const pages = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
        
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
        
          await page.render({ canvasContext: context, viewport }).promise;
          const imgData = canvas.toDataURL();
          pages.push(imgData);
        }
    
        setPdfImages((prevData) => ({
          ...prevData,
          [category]: pages,
        }));
        setDisplayBOQ(prevData => ({
            ...prevData,
            [category] : true
        }))
      } catch (error) {
        console.error('Failed to load PDF as images:', error);
      }
    };

    useEffect(() => {
        const baseURL = window.location.origin
        boqAttachments?.forEach((boq) => {
            loadPdfAsImages(`${baseURL}${boq.boq}`, boq.category)
        })
    }, [boqAttachments]);

    // console.log("pdfImages", pdfImages)

    const {data: procurement_request, isLoading: procurement_request_loading, error: procurement_request_error} = useFrappeGetDoc("Procurement Requests", pr_id, pr_id ? undefined : null);

    // const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
    //     {
    //         fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
    //         filters: [["name", "=", pr_id]],
    //     });

    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'quantity', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'makes'],
            filters: [["procurement_task", "=", pr_id], ["vendor", "=", vendor_id]],
            limit: 1000
        });
    
    const {data: procurement_project} = useFrappeGetDoc("Projects", procurement_request?.project, procurement_request?.project ? undefined : null);

    // const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
    //     {
    //         fields: ['name', 'project_name', 'project_address', 'project_city', 'project_state'],
    //         filters: [['name', 'like', `%${pr_id.split("-").at(1)}`]],
    //         limit: 1000
    //     });
    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ['name', 'address_title', 'address_line1', 'address_line2', 'city', 'state', 'pincode'],
            limit: 10000
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_city', 'vendor_type'],
            filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
            limit: 10000
        });

    // const [orderData, setOrderData] = useState({
    //     name: ''
    // });
    
      // useEffect to extract and add unique categories when itemList changes
    useEffect(() => {
      if (itemList && itemList.list) {
        // Extract unique categories based on the provided condition
        const uniqueCategories = new Set(
          itemList.list
            .filter((item) => 
              quotation_request_list?.some((q) => q.item === item.name)
            )
            .map((item) => item.category) // Get the `category` field
        );

        // Add the unique categories to the state
        setCategoryVendor(uniqueCategories);
      }
    }, [itemList, quotation_request_list]);

    // useEffect(() => {
    //     if (procurement_request) {
    //         setOrderData(procurement_request);
    //     }
    // }, [procurement_request]);

    const getProjectAddress = () => {
        const id = procurement_project?.project_address;
        const doc = address_list?.find(item => item.name === id);
        const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}-${doc?.pincode}, ${doc?.state}`
        return address
    }
    const getVendorName = (item: string) => {
        const name = vendor_list?.find(value => value.name === item)?.vendor_name;
        return name
    }
    const getVendorCity = (item: string) => {
        const name = vendor_list?.find(value => value.name === item)?.vendor_city;
        return name
    }

    const componentRef = useRef();

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${getVendorName(vendor_id)}_${getVendorCity(vendor_id)}`
    });

    const exportToCSV = () => {
        const csvHeaders = ['Item', 'Category', 'Unit', 'Quantity', 'Rate'];

        const csvRows = [];

        csvRows.push(csvHeaders.join(','));
        itemList?.list?.filter((item) =>
            quotation_request_list?.some((q) => q.item === item.name)
        ).forEach(i => {
            const row = [i.item, i.category, i.unit, i.quantity, ""];
            csvRows.push(row.join(','));
        });

        const csvString = csvRows.join('\n');

        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'rfq_data.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // console.log("categories", categoryForVendor)

    return (
            <Layout>
                <Sider theme='light' collapsedWidth={0} width={150}  trigger={null} collapsible collapsed={collapsed}>
                    <div className="py-2">
                        <h3 className="text-black font-semibold pb-2">Include Attachments</h3>

                        {(Object.keys(pdfImages).filter((cat) => Array.from(categoryForVendor).includes(cat))).length ? (
                            <div>
                                {(Object.keys(pdfImages).filter((cat) => Array.from(categoryForVendor).includes(cat))).map((cat) => (
                                <div className="flex gap-2">
                                {/* {[...categoryForVendor].map((cat) => ( */}
                                    <input type="checkbox" checked={displayBOQ[cat]} onChange={() => {
                                        setDisplayBOQ(prevState => ({
                                            ...prevState,
                                            [cat] : !prevState[cat]
                                        }))
                                    }} />
                                    <label>{cat}</label>
                                </div>
                                ))}
                            </div>
                        ) : (
                            <div>
                                No Attachments found for this vendor category(s)
                            </div>
                        )}
                    </div>

                    <Separator />

                    <div className="py-2">
                        <h3 className="text-black font-semibold pb-2">Include Comments</h3>
                        <Switch id="hello" value={includeComments} onCheckedChange={(e) => setIncludeComments(e)}  /> 
                    </div>
                </Sider>
            {/* RFQ pdf */}
            <Layout className='bg-white'>
            <div>
                <div className="flex items-center ml-4">
                    <Button
                        type="text"
                        icon={collapsed ? <CircleChevronDown /> : <CircleChevronLeft />}
                        className="p-0"
                        onClick={() => setCollapsed(!collapsed)}
                        style={{
                          fontSize: '16px',
                          backgroundColor: "white"
                        }}
                        >
                            <p className="underline hover:text-blue-400">Attachment Options</p>
                        </Button>
                    
                </div>
            <Content>
            <div ref={componentRef} className="px-4 pb-4">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="w-full border-b border-black">
                            <tr>
                                <th colSpan={5} className="p-0">
                                    <div className="mt-6 flex justify-between">
                                        <div>
                                            <img className="w-44" src={redlogo} alt="Nirmaan" />
                                            <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr>
                                <th colSpan={5} className="p-0">
                                    <div className="py-2 border-b-2 border-gray-600 pb-3 mb-3">
                                        <div className="flex justify-between">
                                            <div className="text-xs text-gray-500 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                                            <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr>
                                <th colSpan={5} className="p-0">
                                    <div className="grid grid-cols-2 justify-between border border-gray-100 rounded-lg p-4">
                                        <div className="border-0 flex flex-col">
                                            <p className="text-left py-1 font-medium text-xs text-gray-500">Date</p>
                                            <p className="text-left font-bold py-1 font-semibold text-sm text-black">{formatDate(procurement_project?.creation?.split(" ")[0])}</p>
                                        </div>
                                        <div className="border-0 flex flex-col ml-10">
                                            <p className="text-left py-1 font-medium text-xs text-gray-500">Project ID</p>
                                            <p className="text-left font-bold py-1 font-semibold text-sm text-black">{procurement_project?.name}</p>
                                        </div>
                                        <div className="border-0 flex flex-col">
                                            <p className="text-left py-1 font-medium text-xs text-gray-500">Project Address</p>
                                            <p className="text-left font-bold py-1 font-semibold text-sm text-black truncate pr-4 text-wrap">{getProjectAddress()}</p>
                                        </div>
                                        <div className="border-0 flex flex-col ml-10">
                                            <p className="text-left py-1 font-medium text-xs text-gray-500">Vendor Name</p>
                                            <p className="text-left font-bold py-1 font-semibold text-sm text-black text-wrap">{getVendorName(vendor_id)}</p>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-32">Item</th>
                                <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Category</th>
                                <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                                <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Quantity</th>
                                <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {itemList?.list?.filter((item) => quotation_request_list?.some((q) => q.item === item.name)).map((i) => {
                                return (
                                    <tr className="">
                                    <td className="px-6 py-2 text-sm">
                                        {i.item}
                                        {quotation_request_list?.find(q => q?.item === i?.name)?.makes?.list?.length > 0 ? (
                                            <div>
                                                        <span className="text-primary">makes- </span>
                                                {quotation_request_list?.find(q => q?.item === i?.name)?.makes?.list?.map((i, index, arr) => (
                                                    
                                                        <div className="text-sm font-bold text-gray-500 inline">
                                                            <i>{i?.make}{index < arr.length - 1 && ", "}</i>
                                                        </div>
                                                    
                                                ))}
                                            </div>
                                            ) : null }
                                        {(i.comment && includeComments) &&
                                            <div className="flex gap-1 items-start block p-1">
                                                <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                                                <div className="text-xs text-gray-400">{i.comment}</div>
                                            </div>
                                        }
                                    </td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">
                                        {i.category}
                                    </td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">{i.unit}</td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">{i.quantity}</td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">{ }</td>
                                </tr>
                                )
                            })}
                        </tbody>

                            {/* {[...Array(30)].map((_, index) => (
                                quotation_request_list?.map((item) => {
                                    return <tr className="">
                                        <td className="px-6 py-2 text-sm">{getItem(item.item)}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">
                                            {item.category}
                                        </td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">meter</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{ }</td>
                                    </tr>
                                })
                            ))} */}
                            {/* {testQuotationRequestList?.map((item)=>
                                        {return <tr className="">
                                        <td className="px-6 py-2 text-sm whitespace-nowrap">{getItem(item.item)}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">
                                            {item.category}
                                        </td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">meter</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{}</td>
                                    </tr>})} */}
                    </table>
                    <div className="pt-24">
                        <p className="text-md font-bold text-red-700 underline">Note</p>
                        <p className="text-xs">Please share the quotes as soon as possible</p>
                    </div>
                    <div className="">
                        {Array.from(categoryForVendor).map((cat) => (
                                <div>
                                    {/* <p className="text-lg font-semibold mb-4">{cat}</p> */}
                                    {(pdfImages[cat] && displayBOQ[cat]) && pdfImages[cat].map((imgSrc, index) => (
                                        <img key={index} src={imgSrc} alt={`PDF page ${index + 1}`} style={{ width: '100%', marginBottom: '20px' }} />
                                    ))}
                                </div>
                            ))}
                    </div>
                </div>
            </div>
            </Content>
            </div>
            <div className="flex items-center gap-2 justify-end mt-4">
                <button onClick={handlePrint} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded flex items-center gap-1"><Printer className="w-6 h-6 max-md:w-4 max-md:h-4" />Print</button>
                <button
                    onClick={exportToCSV}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded flex items-center gap-1"
                    >
                        <FolderUp className="w-6 h-6 max-md:w-4 max-md:h-4" />
                    Export to CSV
                </button>
            </div>
            </Layout>
            </Layout>
    )
}