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
import { useFrappeGetDoc } from "frappe-react-sdk";
import formatToIndianRupee from "@/utils/FormatPrice";
import { Badge } from "./ui/badge";
import { ArrowLeft, Building, Calendar, MapPin, ReceiptIndianRupee, User } from "lucide-react";
import { Label } from "./ui/label";
import { useEffect, useState } from "react";
import { ProcurementOrders as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";

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

export const POSummary = () => {

  const [address, setAddress] = useState()
  const { id } = useParams();
  const poId = id?.replaceAll("&=", "/");


  const { data: po, isLoading: poLoading, error: poError } = useFrappeGetDoc("Procurement Orders", poId);
  const { data: vendor_address, isLoading: vendor_address_loading, error: vendor_error } = useFrappeGetDoc("Address", address)

  useEffect(() => {
    if (!poLoading && po) {
      setAddress(po?.vendor_address)
    }
  }, [po])

  if (poLoading || vendor_address_loading) return <h1>Loading</h1>
  if (poError || vendor_error) return <h1>Error</h1>
  if (po && vendor_address) {
    return <POSummaryPage po_data={po} vendorAddress={vendor_address} />;
  }
};

interface POSummaryPageProps {
  po_data: ProcurementOrdersType
  vendorAddress: any
}

const POSummaryPage = ({ po_data, vendorAddress }: POSummaryPageProps) => {

  const itemsOrderList = JSON.parse(po_data?.order_list)?.list;
  const navigate = useNavigate();

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

  const overallTotal = Object.values(categoryTotals).reduce(
    (acc, totals) => ({
      withoutGst: acc.withoutGst + totals.withoutGst,
      withGst: acc.withGst + totals.withGst,
    }),
    { withoutGst: 0, withGst: 0 }
  );

  const pieChartData = Object.keys(categoryTotals).map((category) => ({
    name: category,
    value: categoryTotals[category].withGst,
    fill: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // Random colors
  }));

  console.log("po_data", itemsOrderList)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 flex-wrap">
        <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
        <h2 className="text-xl max-md:text-lg font-bold tracking-tight">Summary: </h2>
        <span className="text-red-500 text-2xl max-md:text-xl"> {po_data?.name}</span>
      </div>

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
                <span className="font-semibold">{formatToIndianRupee(overallTotal.withoutGst)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total (Incl. GST):</span>
                <span className="font-semibold">{formatToIndianRupee(overallTotal.withGst)}</span>
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
              <div key={categoryName} className="my-3">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-red-100">
                      <TableHead className="w-[30%] text-red-700 font-extrabold">{categoryName}</TableHead>
                      <TableHead className="w-[15%]">Qty</TableHead>
                      <TableHead className="w-[15%]">UOM</TableHead>
                      <TableHead className="w-[15%]">Amount(Excl. GST)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.name}>
                        <TableCell>{item.item}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
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

    </div>
  );
};
