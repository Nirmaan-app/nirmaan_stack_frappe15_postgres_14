import { useNavigate, useParams } from "react-router-dom";
import { Pie, PieChart } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import formatToIndianRupee from "@/utils/FormatPrice";
import { Badge } from "./ui/badge";
import { ArrowLeft, Building, Calendar, MapPin, MessageCircleMore, Printer, ReceiptIndianRupee, User } from "lucide-react";
import { Label } from "./ui/label";
import { useEffect, useRef, useState } from "react";
import { ProcurementOrders as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { useReactToPrint } from "react-to-print";
import logo from "@/assets/logo-svg.svg"
import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import { Button } from "./ui/button";

const chartConfig = {
  visitors: {
    label: "Visitors",
  },
  category1: {
    label: "Category 1",
    color: "hsl(var(--chart-1))",
  },
  category2: {
    label: "Category 2",
    color: "hsl(var(--chart-2))",
  },
  category3: {
    label: "Category 3",
    color: "hsl(var(--chart-3))",
  },
} satisfies ChartConfig;

const POSummary = () => {

  const [address, setAddress] = useState()
  const { poId: id } = useParams();
  const poId = id?.replaceAll("&=", "/");


  const { data: po, isLoading: poLoading, error: poError } = useFrappeGetDoc("Procurement Orders", poId);
  const { data: vendor_address, isLoading: vendor_address_loading, error: vendor_address_error } = useFrappeGetDoc("Address", address, address ? undefined : null)

  const { data: project_address, isLoading: project_address_loading, error: project_address_error } = useFrappeGetDoc("Address", po?.project_address, po ? undefined : null)

  useEffect(() => {
    if (!poLoading && po) {
      setAddress(po?.vendor_address)
    }
  }, [po])

  if (poLoading || vendor_address_loading || project_address_loading) return <h1>Loading</h1>
  if (poError || vendor_address_error || project_address_error) return <h1>Error</h1>
  if (po && vendor_address) {
    return <POSummaryPage po_data={po} vendorAddress={vendor_address} projectAddress={project_address} />;
  }
};

interface POSummaryPageProps {
  po_data: ProcurementOrdersType
  vendorAddress: any
  projectAddress: any
}

const POSummaryPage = ({ po_data, vendorAddress, projectAddress }: POSummaryPageProps) => {

  // console.log("po_data", po_data)

  const itemsOrderList = JSON.parse(po_data?.order_list)?.list;
  const navigate = useNavigate();
  const [formattedProjAdd, setFormattedProjAdd] = useState(null)
  const [formattedVenAdd, setFormattedVenAdd] = useState(null)

  const [advance, setAdvance] = useState(0)
  const [materialReadiness, setMaterialReadiness] = useState(0)
  const [afterDelivery, setAfterDelivery] = useState(0)
  const [xDaysAfterDelivery, setXDaysAfterDelivery] = useState(0)

  const { data: mergedPOs, isLoading: mergedPOsLoading } = useFrappeGetDocList("Procurement Orders", {
    fields: ["name", "merged"],
    filters: [["merged", "=", po_data?.name]],
  })

  const { data: poPayments, isLoading: poPaymentsLoading } = useFrappeGetDocList("Project Payments", {
    fields: ["amount"],
    filters: [["document_name", "=", po_data?.name]],
  })

  // const { data: vendorAddress } = useFrappeGetDoc("Address", po_data?.vendor_address);

  const categoryTotals = itemsOrderList.reduce((acc, item) => {
    const category = acc[item.category] || { withoutGst: 0, withGst: 0 };
    const itemTotal = item.quantity * item.quote;
    const itemTotalWithGst = itemTotal * (1 + item.tax / 100);
    category.withoutGst += itemTotal;
    category.withGst += itemTotalWithGst;
    acc[item.category] = category;
    return acc;
  }, {});

  useEffect(() => {
    if (vendorAddress && projectAddress) {
      const address = `${projectAddress?.address_line1}, ${projectAddress?.address_line2}, ${projectAddress?.city}, ${projectAddress?.state}-${projectAddress?.pincode}`
      setFormattedProjAdd(address)
      const address2 = `${vendorAddress?.address_line1}, ${vendorAddress?.address_line2}, ${vendorAddress?.city}, ${vendorAddress?.state}-${vendorAddress?.pincode}`
      setFormattedVenAdd(address2)
    }

  }, [vendorAddress, projectAddress]);

  useEffect(() => {
    if (po_data) {
      const chargesArray = po_data?.advance?.split(", ")
      setAdvance(parseInt(chargesArray[0] || 0))
      setMaterialReadiness(parseInt(chargesArray[1] || 0))
      setAfterDelivery(parseInt(chargesArray[2] || 0))
      setXDaysAfterDelivery(parseInt(chargesArray[3] || 0))
    }
  }, [po_data])

  // const overallTotal = Object.values(categoryTotals).reduce(
  //   (acc, totals) => ({
  //     withoutGst: acc.withoutGst + totals.withoutGst,
  //     withGst: acc.withGst + totals.withGst,
  //   }),
  //   { withoutGst: 0, withGst: 0 }
  // );

  // const pieChartData = Object.keys(categoryTotals).map((category) => ({
  //   name: category,
  //   value: categoryTotals[category].withGst,
  //   fill: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // Random colors
  // }));

  const getTotal = () => {
    let total: number = 0;
    let totalGst = 0;
    JSON.parse(po_data?.order_list)?.list?.map((item) => {
      const price = item.quote;
      const gst = (price) * (item.quantity) * (item.tax / 100)

      totalGst += gst
      total += (price ? parseFloat(price) : 0) * (item.quantity ? parseFloat(item.quantity) : 1);
    })

    const loadingCharges = parseFloat(po_data?.loading_charges || 0)
    const freightCharges = parseFloat(po_data?.freight_charges || 0)

    total += loadingCharges + freightCharges
    totalGst += (loadingCharges * 0.18) + (freightCharges * 0.18)

    return { total, totalGst: totalGst, totalAmt: total + totalGst };
  }

  const componentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: `${po_data?.name}_${po_data?.vendor_name}`
  });

  // console.log("po_data", itemsOrderList)

  return (
    <div className="flex flex-col gap-4">
      {/* <div className="flex items-center gap-1 flex-wrap">
        <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
        <h2 className="text-xl max-md:text-lg font-bold tracking-tight">Summary: </h2>
        <span className="text-red-500 text-2xl max-md:text-xl"> {po_data?.name}</span>
      </div> */}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-xl text-red-600 flex items-center justify-between">
              PO Details
              <Badge variant={`${po_data.status === "PO Approved" ? "green" : "yellow"}`}>
                {po_data.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-muted-foreground" />
              <Label className="font-light text-red-700">Project:</Label>
              <span>{po_data?.project_name}</span>
            </div>
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              <Label className="font-light text-red-700">Vendor:</Label>
              <span>{po_data?.vendor_name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <Label className="font-light text-red-700">Date Created:</Label>
              <span>{new Date(po_data?.creation).toDateString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <ReceiptIndianRupee className="w-4 h-4 text-muted-foreground" />
              <Label className="font-light text-red-700">Vendor GST:</Label>
              <span>{po_data?.vendor_gst}</span>
            </div>
            <div className="flex-1 items-center gap-2">
              <div className="flex mb-2">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <Label className="font-light text-red-700">Vendor Address:</Label>
              </div>
              <span>
                {vendorAddress?.address_line1}, {vendorAddress?.address_line2}, {vendorAddress?.city}, {vendorAddress?.state}-{vendorAddress?.pincode}
              </span>
            </div>
            {po_data?.status === "Merged" && (
              <>
                <div className="flex items-center gap-2">
                  <Label className="font-light text-red-700">Master PO:</Label>
                  <span>{po_data?.merged}</span>
                </div>
              </>
            )}

            {po_data?.merged === "true" && (
              <>
                <div className="flex items-center gap-2">
                  <Label className="font-light text-red-700">Master PO:</Label>
                  <span>Yes</span>
                </div>
                <div className="flex gap-2">
                  <Label className="font-light text-red-700 mt-2">Child PO(s):</Label>
                  <ul className="list-disc pl-5">
                    {mergedPOs?.length > 0 ? (
                      mergedPOs?.map((po) => (
                        <li>{po?.name}</li>
                      ))
                    ) : "--"}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl text-red-600 flex items-center justify-between">
              Pricing Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Total (Excl. GST):</span>
                <span className="font-semibold">{formatToIndianRupee(getTotal().total)}</span>
              </div>
              {parseFloat(po_data?.loading_charges || 0) > 0 && (
                <div className="flex justify-between">
                  <span>Loading Charges (Inc. GST):</span>
                  <span className="font-semibold">{formatToIndianRupee(po_data?.loading_charges * 1.18)}</span>
                </div>
              )}
              {parseFloat(po_data?.freight_charges || 0) > 0 && (
                <div className="flex justify-between">
                  <span>Freight Charges (Inc. GST):</span>
                  <span className="font-semibold">{formatToIndianRupee(po_data?.freight_charges * 1.18)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Total (Incl. GST):</span>
                <span className="font-semibold">{formatToIndianRupee(getTotal().totalAmt)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Amt Paid:</span>
                <span className="font-semibold">{formatToIndianRupee(poPayments?.reduce((acc, i) => acc + parseFloat(i?.amount), 0))}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order Details and Totals */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl text-red-600">Order Details & Totals</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            // Group items by category without lodash
            const groupedItems = itemsOrderList.reduce((acc, item) => {
              if (!acc[item.category]) {
                acc[item.category] = [];
              }
              acc[item.category].push(item);
              return acc;
            }, {});

            return Object.entries(groupedItems).map(([categoryName, items]) => (
              <div key={categoryName} className="my-3 w-full overflow-x-auto">
                <Table className="overflow-x-auto">
                  <TableHeader>
                    <TableRow className="bg-red-100">
                      <TableHead className="w-[30%] text-red-700 font-extrabold">{categoryName}</TableHead>
                      <TableHead className="w-[15%]">Qty</TableHead>
                      <TableHead className="w-[15%]">Rate</TableHead>
                      <TableHead className="w-[15%]">UOM</TableHead>
                      <TableHead className="w-[15%]">Amount(Excl. GST)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.name}>
                        <TableCell>
                          <span>{item.item}
                          {item?.makes?.list?.length > 0 && (
  <span className="text-xs italic font-semibold text-gray-500">
    - {item.makes.list.find((i) => i?.enabled === "true")?.make || "no make specified"}
  </span>
)}
                          </span>
                          {item.comment && (
                            <div className="flex gap-1 items-start block border rounded-md p-1 md:w-[60%]">
                              <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                              <div className="text-xs ">
                                {item.comment}
                              </div>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>{formatToIndianRupee(item.quote)}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{formatToIndianRupee((item.quantity * item.quote))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ));
          })()}

        </CardContent>
      </Card>
      {/* <Card className="flex flex-col">
                <CardHeader className="items-center pb-0">
                  <CardTitle>Category-Wise Totals Visualization</CardTitle>
                  <CardDescription>PO-{po_data.name}</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-between max-md:flex-col items-center">
                  <ChartContainer
                    config={chartConfig}
                    className="mx-auto w-full min-h-[250px] max-h-[300px] flex-1 flex justify-center"
                  >
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie data={pieChartData} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={5}>
                        <Label
                          content={({ viewBox }) => {
                            if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                              return (
                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                  <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
                                    {overallTotal?.withGst?.toLocaleString()}
                                  </tspan>
                                  <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 24} className="fill-muted-foreground">
                                    Total
                                  </tspan>
                                </text>
                              );
                            }
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <ul className="flex-1 text-left list-disc">
                    <li className="font-bold text-lg text-gray-700">
                      Overall Total (without GST): <span className="font-medium">{formatToIndianRupee(overallTotal?.withoutGst)}</span>
                    </li>
                    <li className="font-bold text-lg text-gray-700">
                      Overall Total (with GST): <span className="font-medium">{formatToIndianRupee(overallTotal?.withGst)}</span>
                    </li>
                  </ul>
                </CardContent>
            </Card> */}

      <div className={`hidden`}>
        <div ref={componentRef} className="w-full p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-gray-200">
              <thead className="border-b border-black">
                <tr>
                  <th colSpan={8}>
                    <div className="flex justify-between border-gray-600 pb-1">
                      <div className="mt-2 flex justify-between">
                        <div>
                          {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
                          <img src={logo} alt="Nirmaan" width="180" height="52" />
                          <div className="pt-2 text-lg text-gray-600 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                        </div>
                      </div>
                      <div>
                        <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No.</div>
                        <div className="text-lg font-light italic text-black">{(po_data?.name)?.toUpperCase()}</div>
                      </div>
                    </div>

                    <div className=" border-b-2 border-gray-600 pb-1 mb-1">
                      <div className="flex justify-between">
                        <div className="text-xs text-gray-600 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                        <div className="text-xs text-gray-600 font-normal">GST: 29ABFCS9095N1Z9</div>
                      </div>
                    </div>

                    <div className="flex justify-between">
                      <div>
                        <div className="text-gray-600 text-sm pb-2 text-left">Vendor Address</div>
                        <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{po_data?.vendor_name}</div>
                        <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{formattedVenAdd}</div>
                        <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {vendorAddress?.vendor_gst || "N/A"}</div>
                      </div>
                      <div>
                        <div>
                          <h3 className="text-gray-600 text-sm pb-2 text-left">Delivery Location</h3>
                          <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{formattedProjAdd}</div>
                        </div>
                        <div className="pt-2">
                          <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-600 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{po_data?.creation?.split(" ")[0]}</i></div>
                          <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-600 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{po_data?.project_name}</i></div>
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr className="border-t border-black">
                  <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider">S. No.</th>
                  <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48">Items</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                  <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Qty</th>
                  <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                  <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>
                  <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                </tr>
              </thead>
              <tbody className={`bg-white`}>
                {/* {orderData?.order_list?.list.map((item: any, index: number) => {
                                                    return (<tr key={index} className={`${(!loadingCharges && !freightCharges && index === orderData?.order_list?.list.length - 1) && "border-b border-black"} page-break-inside-avoid ${index === 15 ? 'page-break-before' : ''}`}>
                                                        <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index + 1}.</td>
                                                        <td className=" py-2 text-sm whitespace-nowrap text-wrap">{item.item}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.quote)}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(((item.quote) * (item.quantity)).toFixed(2))}</td>
                                                    </tr>)
                                                })} */}

                {[...new Map(JSON.parse(po_data?.order_list)?.list.map(item =>
                  [item.item, {
                    ...item, quantity: JSON.parse(po_data?.order_list)?.list
                      .filter(({ item: itemName }) => itemName === item.item)
                      .reduce((total, curr) => total + curr.quantity, 0)
                  }]
                )).values()].map((item, index) => {

                  const length = [...new Map(JSON.parse(po_data?.order_list)?.list.map(item =>
                    [item.item, {
                      ...item, quantity: JSON.parse(po_data?.order_list)?.list
                        .filter(({ item: itemName }) => itemName === item.item)
                        .reduce((total, curr) => total + curr.quantity, 0)
                    }]
                  )).values()].length
                  return (
                    <tr key={index} className={`${(!parseFloat(po_data?.loading_charges) && !parseFloat(po_data?.freight_charges) && index === length - 1) && "border-b border-black"} page-break-inside-avoid ${index === 15 ? 'page-break-before' : ''}`}>
                      <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index + 1}.</td>
                      <td className="py-2 text-sm whitespace-nowrap text-wrap">
                        {item.item}
                        <p className="text-xs italic font-semibold text-gray-500"> - {item?.makes?.list?.find(i => i?.enabled === "true")?.make || "no make specified"}</p>
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.quote)}</td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee((item.quote * item.quantity))}</td>
                    </tr>
                  )
                })}
                {/* {[...Array(19)].map((_, index) => (
                                        orderData?.order_list?.list.map((item) => (
                                             <tr className="">
                                                <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index+1}.</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap text-wrap">sijdoodsjfo sfjdofjdsofjdsofj sdifjsojfosdjfjs </td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                                <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quote}</td>
                                                <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                                                <td className="px-4 py-2 text-sm whitespace-nowrap">{(item.quote) * (item.quantity)}</td>
                                            </tr>
                                        )
                                    )))} */}
                {parseFloat(po_data?.loading_charges || 0) ?
                  <tr className={`${!parseFloat(po_data?.freight_charges) && "border-b border-black"}`}>
                    <td className="py-2 text-sm whitespace-nowrap w-[7%]">-</td>
                    <td className=" py-2 text-sm whitespace-nowrap">LOADING CHARGES</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">NOS</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">1</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(po_data?.loading_charges)}</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(po_data?.loading_charges)}</td>
                  </tr>
                  :
                  <></>
                }
                {parseFloat(po_data?.freight_charges || 0) ?
                  <tr className={`border-b border-black`}>
                    <td className="py-2 text-sm whitespace-nowrap w-[7%]">-</td>
                    <td className=" py-2 text-sm whitespace-nowrap">FREIGHT CHARGES</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">NOS</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">1</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(po_data?.freight_charges)}</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(po_data?.freight_charges)}</td>
                  </tr>
                  :
                  <></>
                }
                <tr className="">
                  <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                  <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">Sub-Total</td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{formatToIndianRupee(getTotal().total)}</td>
                </tr>
                <tr className="border-none">
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                    <div>Total Tax(GST):</div>
                    <div>Round Off:</div>
                    <div>Total:</div>
                  </td>

                  <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                    <div className="ml-4">{formatToIndianRupee((getTotal().totalGst))}</div>
                    <div className="ml-4">- {formatToIndianRupee((getTotal().totalAmt - Math.floor(getTotal().totalAmt)))}</div>
                    <div className="ml-4">{formatToIndianRupee(Math.floor(getTotal().totalAmt))}</div>
                  </td>

                </tr>
                <tr className="end-of-page page-break-inside-avoid" >
                  <td colSpan={6}>
                    {po_data?.notes !== "" && (
                      <>
                        <div className="text-gray-600 text-sm py-2">Note</div>
                        <div className="text-sm text-gray-900">{po_data?.notes}</div>
                      </>
                    )}
                    {(advance || materialReadiness || afterDelivery || xDaysAfterDelivery) ? (
                      <>
                        <div className="text-gray-600 text-sm py-2">Payment Terms</div>
                        <div className="text-sm text-gray-900">
                          {(() => {
                            // Check if any of the variables is 100
                            if (advance === 100) {
                              return `${advance}% advance`;
                            } else if (materialReadiness === 100) {
                              return `${materialReadiness}% on material readiness`;
                            } else if (afterDelivery === 100) {
                              return `${afterDelivery}% after delivery to the site`;
                            } else if (xDaysAfterDelivery === 100) {
                              return `${xDaysAfterDelivery}% after 30 days of delivering the material(s)`;
                            }

                            // If none of the variables is 100, render non-zero values
                            const parts = [];
                            if (advance > 0) {
                              parts.push(`${advance}% advance`);
                            }
                            if (materialReadiness > 0) {
                              parts.push(`${materialReadiness}% on material readiness`);
                            }
                            if (afterDelivery > 0) {
                              parts.push(`${afterDelivery}% after delivery to the site`);
                            }
                            if (xDaysAfterDelivery > 0) {
                              parts.push(`${xDaysAfterDelivery}% after 30 days of delivering the material(s)`);
                            }

                            // Join the parts with commas and return
                            return parts.join(", ");
                          })()}
                        </div>

                      </>
                    ) : ""}

                    <img src={Seal} className="w-24 h-24" />
                    <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ display: 'block', pageBreakBefore: 'always', }}></div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-gray-200">
              <thead className="border-b border-black">
                <tr>
                  <th colSpan={6}>
                    <div className="flex justify-between border-gray-600 pb-1">
                      <div className="mt-2 flex justify-between">
                        <div>
                          {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
                          <img src={logo} alt="Nirmaan" width="180" height="52" />
                          <div className="pt-2 text-lg text-gray-600 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                        </div>
                      </div>
                      <div>
                        <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No. :</div>
                        <div className="text-lg font-light italic text-black">{(po_data?.name)?.toUpperCase()}</div>
                      </div>
                    </div>

                    <div className=" border-b-2 border-gray-600 pb-1 mb-1">
                      <div className="flex justify-between">
                        <div className="text-xs text-gray-600 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                        <div className="text-xs text-gray-600 font-normal">GST: 29ABFCS9095N1Z9</div>
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <div className="max-w-4xl mx-auto p-6 text-gray-800">
                  <h1 className="text-xl font-bold mb-4">Terms and Conditions</h1>
                  <h2 className="text-lg font-semibold mt-6">1. Invoicing:</h2>
                  <ol className="list-decimal pl-6 space-y-2 text-sm">
                    <li className="pl-2">All invoices shall be submitted in original and shall be tax invoices showing the breakup of tax structure/value payable at the prevailing rate and a clear description of goods.</li>
                    <li className="pl-2">All invoices submitted shall have Delivery Challan/E-waybill for supply items.</li>
                    <li className="pl-2">All Invoices shall have the tax registration numbers mentioned thereon. The invoices shall be raised in the name of “Stratos Infra Technologies Pvt Ltd, Bangalore”.</li>
                    <li className="pl-2">Payments shall be only entertained after receipt of the correct invoice.</li>
                    <li className="pl-2">In case of advance request, Advance payment shall be paid after the submission of an advance receipt (as suggested under GST law).</li>
                  </ol>

                  <h2 className="text-lg font-semibold mt-6">2. Payment:</h2>
                  <ol className="list-decimal pl-6 space-y-2 text-sm">
                    <li className="pl-2">Payment shall be done through RTGS/NEFT.</li>
                    <li className="pl-2">A retention amount shall be deducted as per PO payment terms and:</li>
                    <ol className="list-decimal pl-6 space-y-1 text-sm">
                      <li className="pl-2">In case the vendor is not completing the task assigned by Nirmaan a suitable amount, as decided by Nirmaan, shall be deducted from the retention amount.</li>
                      <li className="pl-2">The adjusted amount shall be paid on completion of the defect liability period.</li>
                      <li className="pl-2">Vendors are expected to pay GST as per the prevailing rules. In case the vendor is not making GST payments to the tax authority, Nirmaan shall deduct the appropriated amount from the invoice payment of the vendor.</li>
                      <li className="pl-2">Nirmaan shall deduct the following amounts from the final bills:</li>
                      <ol className="list-decimal pl-6 space-y-1 text-sm">
                        <li className="pl-2">Amount pertaining to unfinished supply.</li>
                        <li className="pl-2">Amount pertaining to Liquidated damages and other fines, as mentioned in the documents.</li>
                        <li className="pl-2">Any agreed amount between the vendor and Nirmaan.</li>
                      </ol>
                    </ol>
                  </ol>

                  <h2 className="text-lg font-semibold mt-6">3. Technical Specifications of the Work:</h2>
                  <ol className="list-decimal pl-6 space-y-2 text-sm">
                    <li className="pl-2">All goods delivered shall conform to the technical specifications mentioned in the vendor’s quote referred to in this PO or as detailed in Annexure 1 to this PO.</li>
                    <li className="pl-2">Supply of goods or services shall be strictly as per Annexure - 1 or the Vendor’s quote/PI in case of the absence of Annexure - I.</li>
                    <li className="pl-2">Any change in line items or quantities shall be duly approved by Nirmaan with rate approval prior to supply. Any goods supplied by the agency without obtaining due approvals shall be subject to the acceptance or rejection from Nirmaan.</li>
                    <li className="pl-2">Any damaged/faulty material supplied needs to be replaced with a new item free of cost, without extending the completion dates.</li>
                    <li className="pl-2">Material supplied in excess and not required by the project shall be taken back by the vendor at no cost to Nirmaan.</li>
                  </ol>
                  <br />
                  <br />
                  <br />
                  <br />
                  <br />

                  <h1 className="text-xl font-bold mb-4">General Terms & Conditions for Purchase Order</h1>
                  <ol className="list-decimal pl-6 space-y-2 text-sm">
                    <li className="pl-2"><div className="font-semibold">Liquidity Damages:</div> Liquidity damages shall be applied at 2.5% of the order value for every day of delay.</li>
                    <li className="pl-2"><div className="font-semibold">Termination/Cancellation:</div> If Nirmaan reasonably determines that it can no longer continue business with the vendor in accordance with applicable legal, regulatory, or professional obligations, Nirmaan shall have the right to terminate/cancel this PO immediately.</li>
                    <li className="pl-2"><div className="font-semibold">Other General Conditions:</div></li>
                    <ol className="list-decimal pl-6 space-y-1 text-sm">
                      <li className="pl-2">Insurance: All required insurance including, but not limited to, Contractors’ All Risk (CAR) Policy, FLEXA cover, and Workmen’s Compensation (WC) policy are in the vendor’s scope. Nirmaan in any case shall not be made liable for providing these insurance. All required insurances are required prior to the commencement of the work at the site.</li>
                      <li className="pl-2">Safety: The safety and security of all men deployed and materials placed by the Vendor or its agents for the project shall be at the risk and responsibility of the Vendor. Vendor shall ensure compliance with all safety norms at the site. Nirmaan shall have no obligation or responsibility on any safety, security & compensation related matters for the resources & material deployed by the Vendor or its agent.</li>
                      <li className="pl-2">Notice: Any notice or other communication required or authorized under this PO shall be in writing and given to the party for whom it is intended at the address given in this PO or such other address as shall have been notified to the other party for that purpose, through registered post, courier, facsimile or electronic mail.</li>
                      <li className="pl-2">Force Majeure: Neither party shall be liable for any delay or failure to perform if such delay or failure arises from an act of God or of the public enemy, an act of civil disobedience, epidemic, war, insurrection, labor action, or governmental action.</li>
                      <li className="pl-2">Name use: Vendor shall not use, or permit the use of, the name, trade name, service marks, trademarks, or logo of Nirmaan in any form of publicity, press release, advertisement, or otherwise without Nirmaan's prior written consent.</li>
                      <li className="pl-2">Arbitration: Any dispute arising out of or in connection with the order shall be settled by Arbitration in accordance with the Arbitration and Conciliation Act,1996 (As amended in 2015). The arbitration proceedings shall be conducted in English in Bangalore by the sole arbitrator appointed by the Purchaser.</li>
                      <li className="pl-2">The law governing: All disputes shall be governed as per the laws of India and subject to the exclusive jurisdiction of the court in Karnataka.</li>
                    </ol>
                  </ol>
                </div>
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
};
export const Component = POSummary;