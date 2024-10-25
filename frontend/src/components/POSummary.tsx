import { useNavigate, useParams } from "react-router-dom";
import { Pie, PieChart, Label } from "recharts";
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
import { ArrowLeft } from "lucide-react";

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
    const { id } = useParams();
    const poId = id?.replaceAll("&=", "/");
    const { data: po, isLoading: poLoading, error: poError } = useFrappeGetDoc("Procurement Orders", poId);

    if (po) {
        return <POSummaryPage po_data={po} />;
    }
};

interface PODataType {
  name: string;
  creation: string;
  modified: string;
  project_name: string;
  project_address: string;
  vendor_name: string;
  vendor_address: string;
  vendor_gst: string;
  status: string;
  order_list: string;
}

const POSummaryPage = ({ po_data }: { po_data: PODataType }) => {

  const itemsOrderList = JSON.parse(po_data?.order_list)?.list;
  const navigate = useNavigate();

  const { data: vendorAddress } = useFrappeGetDoc("Address", po_data?.vendor_address);

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

  return (
    <div className="flex flex-col gap-4">
            {/* Header with Back Button */}
            <div className="flex items-center gap-1 flex-wrap">
                <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                <h2 className="text-xl max-md:text-lg font-bold tracking-tight">Summary: </h2>
                <span className="text-red-500 text-2xl max-md:text-xl">PO-{po_data?.name}</span>
            </div>

            {/* PO Details Card */}
            <Card className="w-full">
                <CardHeader>
                    <CardTitle className="text-xl text-red-600 flex items-center justify-between">
                        PO Details
                        <Badge variant={`${po_data.status === "PO Approved" ? "green" : "yellow"}`}>
                            {po_data.status}
                        </Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-1">
                            <Label className="text-slim text-red-300">Project:</Label>
                            <p className="font-semibold">{po_data?.project_name}</p>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-slim text-red-300">Vendor:</Label>
                            <p className="font-semibold">{po_data?.vendor_name}</p>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-slim text-red-300">Date Created:</Label>
                            <p className="font-semibold">{new Date(po_data?.creation).toDateString()}</p>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-slim text-red-300">Vendor Address:</Label>
                            <p className="font-semibold">
                                {vendorAddress?.address_line1}, {vendorAddress?.address_line2}, {vendorAddress?.city}, {vendorAddress?.state}-{vendorAddress?.pincode}
                            </p>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-slim text-red-300">Vendor GST:</Label>
                            <p className="font-semibold">{po_data?.vendor_gst}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Order Details and Totals */}
            <Card className="w-full">
                <CardHeader>
                    <CardTitle className="text-xl text-red-600">Order Details & Totals</CardTitle>
                </CardHeader>
                <CardContent>
                    {itemsOrderList.map((category: any) => (
                        <div key={category.name} className="my-3">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-red-100">
                                        <TableHead className="w-[30%] text-red-700 font-extrabold">{category.category}</TableHead>
                                        <TableHead className="w-[15%]">UOM</TableHead>
                                        <TableHead className="w-[15%]">Qty</TableHead>
                                        <TableHead className="w-[15%]">Quote</TableHead>
                                        <TableHead className="w-[15%]">Tax (%)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {itemsOrderList
                                        .filter((item: any) => item.category === category.category)
                                        .map((item: any) => (
                                            <TableRow key={item.item}>
                                                <TableCell>{item.item}</TableCell>
                                                <TableCell>{item.unit}</TableCell>
                                                <TableCell>{item.quantity}</TableCell>
                                                <TableCell>{formatToIndianRupee(item.quote)}</TableCell>
                                                <TableCell>{item.tax}%</TableCell>
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </Table>
                        </div>
                    ))}
                </CardContent>
            </Card>
            <Card className="flex flex-col">
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
            </Card>

    </div>
  );
};
