// import { Button } from "@/components/ui/button"
// import { Vendors } from "@/types/NirmaanStack/Vendors"
// import { useFrappeGetDoc } from "frappe-react-sdk"
// import { ArrowLeft } from "lucide-react"
// import { Link, useNavigate, useParams } from "react-router-dom"

import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  OverviewSkeleton2,
  Skeleton,
  TableSkeleton,
} from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import SITEURL from "@/constants/siteURL";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { ColumnDef } from "@tanstack/react-table";
import { ConfigProvider, Menu, MenuProps } from "antd";
import { useFrappeFileUpload, useFrappeGetCall, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { debounce } from "lodash";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FilePenLine,
  Paperclip
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link, useParams } from "react-router-dom";
import { ApprovedSRList } from "../ServiceRequests/service-request/approved-sr-list";
import { EditVendor } from "./edit-vendor";

const Vendor : React.FC = () => {
  const { vendorId } = useParams<{ vendorId: string }>();

  return <div>{vendorId && <VendorView vendorId={vendorId} />}</div>;
};

export const Component = Vendor;

const VendorView = ({ vendorId }: { vendorId: string }) => {

  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const toggleEditSheet = useCallback(() => {
    setEditSheetOpen((prevState) => !prevState);
  }, [editSheetOpen]);

  const [editBankDetailsDialog, setEditBankDetailsDialog] = useState(false);
  const toggleEditBankDetailsDialog = useCallback(() => {
    setEditBankDetailsDialog((prevState) => !prevState);
  }, [editBankDetailsDialog]);

  const [editBankDetails, setEditBankDetails] = useState({
    account_name: "",
    account_number: "", 
    confirm_account_number: "",
    ifsc: "",
  });

  const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);

  const [currentPayment, setCurrentPayment] = useState<string | null>(null);

  const [screenShotDialog, setScreenShotDialog] = useState(false);

  const toggleScreenShotDialog = useCallback(() => {
    setScreenShotDialog((prevState) => !prevState);
  }, [setScreenShotDialog]);

  const {updateDoc, loading: updateLoading} = useFrappeUpdateDoc();

  const { upload: upload, loading: upload_loading } = useFrappeFileUpload()
  
  const { call, loading: callLoading } = useFrappePostCall('frappe.client.set_value')

  const { data, error, isLoading, mutate } = useFrappeGetDoc("Vendors", vendorId, `Vendors ${vendorId}`);

  useEffect(() => {
    if (data) {
      setEditBankDetails({
        account_name: data?.account_name,
        account_number: data?.account_number,
        confirm_account_number: data?.account_number,
        ifsc: data?.ifsc
      });
    }
  }, [data]);

  const { data: bank_details } = useFrappeGetCall("nirmaan_stack.api.bank_details.generate_bank_details",
        { ifsc_code:  editBankDetails?.ifsc},
        editBankDetails?.ifsc && editBankDetails?.ifsc?.length === 11 ? undefined : null
      );

  const [ifscError, setIfscError] = useState("");

  const debouncedIFSCChange = useCallback(
    debounce((value: string) => {
      if(!value) {
        setIfscError("");
        return;
      }
      if (value.length < 11) {
        setIfscError("IFSC code must be 11 characters long");
        return;
      }

      const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
      if (!ifscRegex.test(value)) {
        setIfscError("Invalid IFSC code format. Example: SBIN0005943");
      } else {
        setIfscError("");
      }
    }, 500),
    []
  );


  const handleUpdateVendor = async () => {
    try {

      await updateDoc("Vendors", data?.name, {
        ...editBankDetails,
        bank_name: bank_details?.message?.BANK,
        bank_branch: bank_details?.message?.BRANCH,
      })

      await mutate()

      toast({
        title: "Success!",
        description: `Vendor: ${data?.name} updated successfully!`,
        variant: "success",
      });

      toggleEditBankDetailsDialog()
      
    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: `${error}`,
        variant: "destructive",
      });
    }
  }

  const { data: vendorAddress, isLoading: vendorAddressLoading, error: vendorAddressError } = useFrappeGetDoc(
    "Address",
    data?.vendor_address,
    data?.vendor_address ? `Address ${data?.vendor_address}` : null
  );

  const { data: procurementOrders, isLoading: procurementOrdersLoading, error: procurementOrdersError } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders",
    {
      fields: ["*"],
      filters: [
        ["vendor", "=", vendorId],
        ["status", "!=", "Merged"],
      ],
      limit: 10000,
    },
    `Procurement Orders ${vendorId}`
  );

  const { data: Categories } = useFrappeGetDocList("Category",
    {
      fields: ["*"],
      limit: 10000,
    },
    "Category"
  );

  const { data: procurementRequests, isLoading: procurementRequestsLoading, error: procurementRequestsError } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
    {
      fields: ["*"],
      limit: 100000,
    },
    `Procurement Requests`
  );

  const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", {
    fields: ["name", "project_name"],
    limit: 1000,
  }, "Projects");

const projectValues = useMemo(() => projects?.map((item) => ({
  label: item.project_name,
  value: item.name,
})) || [], [projects]);

const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList<ProjectPayments>("Project Payments",
    {
      fields: ["*"],
      filters: [["vendor", "=", vendorId], ["status", "=", "Paid"]],
      limit: 100000,
      orderBy: {field: "payment_date", order: "asc"}
    }
  );

  type MenuItem = Required<MenuProps>["items"][number];

  const items: MenuItem[] = useMemo(() => [
    {
      label: "Overview",
      key: "overview",
    },
    ["Material", "Material & Service"].includes(data?.vendor_type || "")
      ? {
        label: "Material Orders",
        key: "materialOrders",
      }
      : null,
    // data?.vendor_type === "Material"
    //   ? {
    //     label: "Previous Orders",
    //     key: "previousOrders",
    //   }
    //   : null,
    // data?.vendor_type === "Material"
    //   ? {
    //     label: "Open Orders",
    //     key: "openOrders",
    //   }
    //   : null,
    ["Service", "Material & Service"].includes(data?.vendor_type || "")
      ? {
        label: "Service Orders",
        key: "serviceOrders",
      }
      : null,
      {
        label: "Vendor Payments",
        key: "vendorPayments",
      },
  ], [data]);

  const [current, setCurrent] = useState("overview");

  const onClick: MenuProps["onClick"] = useCallback((e) => {
    setCurrent(e.key);
  }, [current]);

  const getWorkPackage = (pr: string, procRequests: ProcurementRequest[]) => {
    return useMemo(() =>
      procRequests?.find((proc) => proc.name === pr)?.work_package || "",
      [procRequests, pr]
    );
  }

  const getCategories = (ol: any) => {
    return useMemo(() => Array.from(new Set(ol?.list?.map((order: any) => order.category))), [ol]);
  }


  const getTotal = (ol : any, id : string) => {
    return useMemo(() => {
      // Calculate PO Amount without GST
      const poAmountWithoutGST = ol.list.reduce((total, item) => {
        return total + parseNumber(item.quantity * item.quote);
      }, 0);

      // Calculate PO Amount with GST
      const poAmountWithGST = ol.list.reduce((total, item) => {
        const itemTotal = item.quantity * item.quote;
        const taxAmount = (item.tax || 0) / 100 * itemTotal;
        return total + itemTotal + taxAmount;
      }, 0);

      // Calculate Total Amount Paid
      const payments = projectPayments?.filter((payment) => payment.document_name === id);
      const totalAmountPaid = payments?.reduce((acc, payment) => {
        const amount = parseNumber(payment.amount);
        return acc + amount;
      }, 0) || 0;

      return {
        poAmountWithoutGST,
        poAmountWithGST,
        totalAmountPaid,
      };
    }, [ol, id, projectPayments]);
  };

  type ExpandedPackagesState = {
    [key: string]: boolean;
  };

  const [expandedPackages, setExpandedPackages] =
    useState<ExpandedPackagesState>({});

  const toggleExpand = useCallback((packageName: string) => {
    setExpandedPackages((prev) => ({
      ...prev,
      [packageName]: !prev[packageName],
    }));
  }, [expandedPackages]);

  const vendorCategories = useMemo(() => (data && data?.vendor_category && JSON.parse(data?.vendor_category)?.categories) || [], [data]);

  const groupedCategories: { [key: string]: string[] } = useMemo(() => {
    if (!Categories || !vendorCategories.length) return {};

    const filteredCategories = Categories.filter((category) =>
      vendorCategories.includes(category.name)
    );

    const grouped = filteredCategories.reduce((acc, category) => {
      const { work_package, name } = category;

      if (!acc[work_package]) {
        acc[work_package] = [];
      }

      acc[work_package].push(name);

      return acc;
    }, {});

    return grouped;
  }, [Categories, data]);

  useEffect(() => {
    const initialExpandedState = Object.keys(groupedCategories).reduce(
      (acc : Record<string, boolean>, work_package) => {
        acc[work_package] = true;
        return acc;
      },
      {}
    );
    setExpandedPackages(initialExpandedState);
  }, [groupedCategories]);

  const columns: ColumnDef<ProcurementOrder>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader
              className="text-black"
              column={column}
              title="PO ID"
            />
          );
        },
        cell: ({ row }) => {
          const data = row.original
          const poId = data?.name
          return (
            <div className="text-[#11050599] flex items-center gap-2">
              <Link
                className="underline hover:underline-offset-2"
                to={poId?.replaceAll("/", "&=")}
              >
                {poId?.split("/")[1]}
              </Link>
              <ItemsHoverCard  order_list={data.order_list?.list} />
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader
              className="text-black"
              column={column}
              title="Status"
            />
          );
        },
        cell: ({ row }) => {
          return (
            <div>
              <Badge>{row.getValue("status")}</Badge>
            </div>
          );
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader
              className="text-black"
              column={column}
              title="Date Created"
            />
          );
        },
        cell: ({ row }) => {
          return (
            <div className="text-[#11050599]">
              {row.getValue("creation")?.split(" ")[0]}
            </div>
          );
        },
      },
      {
        accessorKey: "project",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader
              className="text-black"
              column={column}
              title="Project"
            />
          );
        },
        cell: ({ row }) => {
          const project = projectValues.find(
            (project) => project.value === row.getValue("project")
        );
          return (
            <div className="text-[#11050599] min-w-[100px]">
              {project?.label || "--"}
            </div>
          );
        },
        filterFn: (row, id, value) => {
          return value.includes(row.getValue(id));
        },
      },
      {
        id: "pr",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader
              className="text-black"
              column={column}
              title="PR ID"
            />
          );
        },
        cell: ({ row }) => {
          return (
            <div className="text-[#11050599] min-w-[160px]">
              {row.getValue("procurement_request")}
            </div>
          );
        },
      },

      {
        accessorKey: "procurement_request",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader
              className="text-black"
              column={column}
              title="Package"
            />
          );
        },
        cell: ({ row }) => {
          return (
            <div className="text-[#11050599]">
              {getWorkPackage(
                row.getValue("procurement_request"),
                procurementRequests || []
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "order_list",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader
              className="text-black"
              column={column}
              title="Category"
            />
          );
        },
        cell: ({ row }) => {
          return (
            <ul className="text-[#11050599] list-disc">
              {getCategories(row.getValue("order_list")).map((cat, index) => (
                <li key={index}>{cat}</li>
              ))}
            </ul>
          );
        },
      },
      {
        id: "total",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader
              className="text-black"
              column={column}
              title="Order Financials"
            />
          );
        },
        cell: ({ row }) => {
          return (
            <div className="flex flex-col gap-2 text-[#11050599] min-w-[200px]">
              <Badge>PO Value (Excl. GST): {formatToRoundedIndianRupee(getTotal(row.getValue("order_list"), row.getValue('name'),).poAmountWithoutGST)}</Badge>
              <Badge>PO Value (Incl. GST): {formatToRoundedIndianRupee(getTotal(row.getValue("order_list"), row.getValue("name")).poAmountWithGST)}</Badge>
              <Badge>Amount Paid: {formatToRoundedIndianRupee(getTotal(row.getValue("order_list"), row.getValue("name")).totalAmountPaid)}</Badge>
            </div>
          );
        },
      },
    ],
    [procurementOrders, procurementRequests, projectPayments, getTotal, getCategories, projectValues]
  );

  const paymentColumns : ColumnDef<ProjectPayments>[] = useMemo(
    () => [
      {
        accessorKey: "utr",
        header: "Payment UTR",
        cell: ({ row }) => {
            const data = row.original;
            return <div  className="font-medium min-w-[130px]">
              {(data?.utr && data?.payment_attachment) ? (
                <div className="text-blue-500 underline">
                      <a
                        href={`${SITEURL}${data?.payment_attachment}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {data?.utr}
                      </a>
                  </div>
                  ) : data?.utr ? (
                    <div className="flex items-center gap-1">
                      {data?.utr}
                      <Paperclip onClick={() => {
                        setCurrentPayment(data?.name)
                        toggleScreenShotDialog()
                      }} className="w-4 h-4 text-primary cursor-pointer" />
                    </div>
                  ) : "--"}
              </div>;
        }
    },
      {
        accessorKey: "document_name",
        header: "#PO",
        cell: ({ row }) => {
            const data = row.original;
            return <div  className="font-medium min-w-[170px]">
              {data?.document_name}
              </div>;
        }
    },
    {
      accessorKey: "project",
      header: "Project",
      cell: ({ row }) => {
          const project = projectValues.find(
              (project) => project.value === row.getValue("project")
          );
          return project ? <div className="font-medium">{project.label}</div> : null;
      },
      filterFn: (row, id, value) => {
          return value.includes(row.getValue(id))
      },
  },
        {
            accessorKey: "payment_date",
            header: ({ column }) => {
                return (
                    <DataTableColumnHeader column={column} title="Payment Date" />
                )
            },
            cell: ({ row }) => {
                const data = row.original
                return <div className="font-medium">{formatDate(data?.payment_date || data?.creation)}</div>;
            },
        },
        {
            accessorKey: "amount",
            header: ({ column }) => {
                return (
                    <DataTableColumnHeader column={column} title="Amount Paid" />
                )
            },
            cell: ({ row }) => {
                return <div className="font-medium">
                    {formatToRoundedIndianRupee(row.getValue("amount"))}
                </div>
            },
        },
        {
          accessorKey: "status",
          header: ({ column }) => {
              return (
                  <DataTableColumnHeader column={column} title="Status" />
              )
          },
          cell: ({ row }) => {
              return <div className="font-medium">
                  {row.getValue("status")}
              </div>
          },
      },
    ],
    [projectValues, projectPayments]
);

const AddScreenShot = async () => {
  try {

      const fileArgs = {
        doctype: "Project Payments",
        docname: currentPayment,
        fieldname: "payment_attachment",
        isPrivate: true,
      };

      const uploadedFile = await upload(paymentScreenshot, fileArgs);

      await call({
        doctype: "Project Payments",
        name: currentPayment,
        fieldname: "payment_attachment",
        value: uploadedFile.file_url,
      });

      await projectPaymentsMutate()

      toggleScreenShotDialog()

      setPaymentScreenshot(null)

      setCurrentPayment(null)

      toast({
        title: "Success!",
        description: "Payment Screenshot added successfully!",
        variant: "success",
      });
    
  } catch (error) {
    console.log("error", error)
    toast({
      title: "Failed!",
      description: "Failed to add Screenshot!",
      variant: "destructive",
    });
  }
}

  if (
    error ||
    vendorAddressError ||
    procurementOrdersError ||
    procurementRequestsError ||
    projectPaymentsError
  )
    return (
      <h1 className="text-red-700">
        There is an error while fetching the document, please check!
      </h1>
    );

  return (
    <div className="flex-1 space-y-2 md:space-y-4">
      <div className="flex items-center gap-1">
        {isLoading ? (
          <Skeleton className="h-10 w-1/3 bg-gray-300" />
        ) : (
          <h2 className="text-xl md:text-3xl font-bold tracking-tight ml-4">
            {data?.vendor_name}
          </h2>
        )}
        <Sheet open={editSheetOpen} onOpenChange={toggleEditSheet}>
          <SheetTrigger>
            <FilePenLine className="text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
          </SheetTrigger>
          <SheetContent className="overflow-auto">
            <EditVendor toggleEditSheet={toggleEditSheet} />
          </SheetContent>
        </Sheet>
      </div>
      <ConfigProvider
        theme={{
          components: {
            Menu: {
              horizontalItemSelectedColor: "#D03B45",
              itemSelectedBg: "#FFD3CC",
              itemSelectedColor: "#D03B45",
            },
          },
        }}
      >
        <Menu
          selectedKeys={[current]}
          onClick={onClick}
          mode="horizontal"
          items={items}
        />
      </ConfigProvider>
      {/* Overview Section */}
      {current === "overview" &&
        (isLoading || vendorAddressLoading ? (
          <OverviewSkeleton2 />
        ) : (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-primary">Vendor Details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-10 w-full">
                <div className="flex lg:justify-between max-lg:flex-col max-lg:gap-10">
                  <div className="space-y-6 max-sm:space-y-4">
                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">Vendor ID</p>
                      <span className=" text-black">{data?.name}</span>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">Contact Person</p>
                      <span className=" text-black">
                        {data?.vendor_contact_person_name
                          || "N/A"}
                      </span>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">Contact Number</p>
                      <span className=" text-black">
                        {data?.vendor_mobile || "N/A"}
                      </span>
                    </CardDescription>
                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">GST Number</p>
                      <span className=" text-black">{data?.vendor_gst || "N/A"}</span>
                    </CardDescription>
                  </div>

                  <div className="space-y-6 max-sm:space-y-4 lg:text-end">
                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">Address</p>
                      <span className=" text-black">
                        {vendorAddress?.address_line1},{" "}
                        {vendorAddress?.address_line2}, {vendorAddress?.city},{" "}
                        {vendorAddress?.state}
                      </span>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">City</p>
                      <span className=" text-black">
                        {vendorAddress?.city}
                      </span>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">State</p>
                      <span className=" text-black">
                        {vendorAddress?.state}
                      </span>
                    </CardDescription>
                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">pincode</p>
                      <span className=" text-black">
                        {vendorAddress?.pincode}
                      </span>
                    </CardDescription>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-primary flex items-center justify-between">
                  <p>Account Details</p>
                  <Button onClick={toggleEditBankDetailsDialog} variant={"outline"} className="flex items-center gap-1 border-primary">
                    Edit
                    <FilePenLine className="w-4 h-4" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-10 w-full">
                <div className="flex lg:justify-between max-lg:flex-col max-lg:gap-10">
                  <div className="space-y-6 max-sm:space-y-4">
                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">Account Name</p>
                      <span className=" text-black">{data?.account_name || "N/A"}</span>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">IFSC</p>
                      <span className=" text-black">
                        {data?.ifsc
                          || "N/A"}
                      </span>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">Branch</p>
                      <span className=" text-black">
                        {data?.bank_branch || "N/A"}
                      </span>
                    </CardDescription>
                  </div>

                  <div className="space-y-6 max-sm:space-y-4 lg:text-end">
                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">Account Number</p>
                      <span className=" text-black">
                        {data?.account_number || "N/A"}
                      </span>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <p className="text-primary font-semibold">Bank</p>
                      <span className=" text-black">
                        {data?.bank_name || "N/A"}
                      </span>
                    </CardDescription>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-primary">Packages-Categories Offered</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="space-y-2">
                  <ul className={`flex gap-2 flex-wrap`}>
                    {Object.entries(groupedCategories).map(
                      ([workPackage, categoryList], index) => (
                        <li
                          key={index}
                          className={`border p-1 max-md:p-2 bg-white rounded-lg shadow-sm max-sm:w-full`}
                        >
                          <div
                            className="flex items-center gap-4 justify-between max-md:gap-2 cursor-pointer hover:bg-gray-100 p-2 max-md:p-1 rounded-md transition-all duration-200"
                            onClick={() => toggleExpand(workPackage)}
                          >
                            <div className="flex items-center gap-2">
                              {expandedPackages[workPackage] ? (
                                <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                              ) : (
                                <ChevronRightIcon className="w-5 h-5 text-gray-500" />
                              )}
                              <span className="text-md font-medium text-gray-800">
                                {workPackage}
                              </span>
                            </div>
                            <span className="text-sm text-gray-500">
                              {categoryList.length} items
                            </span>
                          </div>
                          {expandedPackages[workPackage] && (
                            <ul className="pl-8 mt-2 space-y-2">
                              {categoryList.map((cat, index) => (
                                <li
                                  key={index}
                                  className="flex items-center gap-2 p-2 bg-gray-50 hover:bg-gray-100 rounded-md transition-all duration-200"
                                >
                                  <CheckCircleIcon className="w-5 h-5 text-green-500" />
                                  <span className="text-sm font-medium text-gray-600">
                                    {cat}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      )
                    )}
                  </ul>
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        ))}

              <AlertDialog open={editBankDetailsDialog} onOpenChange={toggleEditBankDetailsDialog}>
                <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                    <AlertDialogHeader className="text-start">
                        <AlertDialogTitle className="text-center">
                            Account Details
                        </AlertDialogTitle>

                        <div className="flex flex-col gap-4 pt-4">
                            <div className="flex items-center gap-4 w-full">
                                <Label className="w-[60%]">Holder Name<sup className="text-sm text-red-600">*</sup></Label>
                                <Input
                                    type="text"
                                    placeholder="Enter Holder Name"
                                    value={editBankDetails?.account_name || ""}
                                    onChange={(e) => setEditBankDetails({ ...editBankDetails, account_name: e.target.value })}
                                />
                            </div>
                            <div className="flex items-center gap-4 w-full">
                                <Label className="w-[60%]">Account number<sup className="text-sm text-red-600">*</sup></Label>
                                <Input
                                    type="password"
                                    autoComplete="new-password" 
                                    autoCorrect="off"
                                    placeholder="Enter Account number"
                                    value={editBankDetails?.account_number || ""}
                                    onChange={(e) => setEditBankDetails({ ...editBankDetails, account_number: e.target.value })}
                                />
                            </div>
                            <div className="flex items-center gap-4 w-full">
                                <Label className="w-[60%]">Confirm Account number<sup className="text-sm text-red-600">*</sup></Label>
                                <div className="flex flex-col gap-1 w-full">
                                <Input
                                    autoComplete="new-password" 
                                    autoCorrect="off"
                                    placeholder="Confirm Account Number"
                                    value={editBankDetails?.confirm_account_number || ""}
                                    onChange={(e) => setEditBankDetails({ ...editBankDetails, confirm_account_number: e.target.value })}
                                />
                                {editBankDetails?.account_number !== editBankDetails?.confirm_account_number && (
                                    <span className="text-red-500 text-xs">Account numbers do not match.</span>
                                )}
                                </div>
                            </div>
                            <div className="flex items-center gap-4 w-full">
                                <Label className="w-[60%]">IFSC<sup className=" text-sm text-red-600">*</sup></Label>
                                <div className="flex flex-col gap-1 w-full">
                                <Input
                                    type="text"
                                    placeholder="Enter 11 character IFSC code"
                                    value={editBankDetails?.ifsc || ""}
                                    onChange={(e) => {
                                      const value = e.target.value.toUpperCase();
                                      setEditBankDetails(prev => ({ ...prev, ifsc: value }));
                                      debouncedIFSCChange(value)
                                    }}
                                />
                                {bank_details && !bank_details.message.error && <span className="text-xs">{bank_details.message.BANK} - {bank_details.message.BRANCH}</span>}
                                {bank_details && bank_details.message.error && <span className="text-red-500 text-xs">{bank_details.message.error}</span>}
                                {ifscError && (
                                  <span className="text-red-500 text-xs">{ifscError}</span>
                                )}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2 items-end pt-4 justify-center">
                            {updateLoading ? <TailSpin color="red" width={40} height={40} /> : (
                                <>
                                    <AlertDialogCancel className="flex-1" asChild>
                                        <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                    </AlertDialogCancel>
                                     <Button
                                        disabled={!!ifscError || (bank_details && bank_details.message.error) || editBankDetails?.account_number !== editBankDetails?.confirm_account_number}
                                        onClick={handleUpdateVendor}
                                        className="flex-1">
                                            Confirm
                                    </Button>
                                </>
                            )}
                        </div>

                    </AlertDialogHeader>
                </AlertDialogContent>
            </AlertDialog>


                    {current === "materialOrders" &&
                      (procurementOrdersLoading || procurementRequestsLoading ? (
                        <TableSkeleton />
                      ) : (
                        <DataTable
                          columns={columns}
                          data={procurementOrders || []}
                          project_values={projectValues}
                        />
                    ))}

                          <AlertDialog open={screenShotDialog} onOpenChange={toggleScreenShotDialog}>
                            <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                                <AlertDialogHeader className="text-start">
                                <AlertDialogTitle className="text-center">
                                  Attach Screenshot
                                </AlertDialogTitle>
                                <CustomAttachment 
                                  maxFileSize={20 * 1024 * 1024} // 20MB
                                  selectedFile={paymentScreenshot}
                                  onFileSelect={setPaymentScreenshot}
                                  className="pt-2"
                                  label="Attach Screenshot"
                                />

                                <div className="flex gap-2 items-center pt-4 justify-center">
                                    {(upload_loading || callLoading) ? <TailSpin color="red" width={40} height={40} /> : (
                                        <>
                                        <AlertDialogCancel className="flex-1" asChild>
                                            <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                        </AlertDialogCancel>
                                        <Button
                                            onClick={AddScreenShot}
                                            disabled={!paymentScreenshot}
                                            className="flex-1">Confirm
                                        </Button>
                                        </>
                                    )}
                                </div>
                                
                                </AlertDialogHeader>
                            </AlertDialogContent>
                        </AlertDialog>

      {/* Transactions Section  */}

      {current === "serviceOrders" && (
        <ApprovedSRList for_vendor={data?.name} />
      )}

      {current === "vendorPayments" &&
        (projectPaymentsLoading || projectsLoading ? (
          <TableSkeleton />
        ) : (
          <DataTable
            columns={paymentColumns}
            data={projectPayments || []}
            project_values={projectValues}
          />
        ))}
    </div>
  );
};