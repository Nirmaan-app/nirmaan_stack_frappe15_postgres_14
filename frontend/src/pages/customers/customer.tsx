import {
  Card,
  CardContent,
  CardDescription
} from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { OverviewSkeleton, Skeleton } from "@/components/ui/skeleton";
// import { fetchDoc } from "@/reactQuery/customFunctions";
// import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Customers } from "@/types/NirmaanStack/Customers";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import { ColumnDef } from "@tanstack/react-table";
import { Radio } from "antd";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { FilePenLine } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { InFlowPayments } from "../projects/InFlowPayments";
import EditCustomer from "./edit-customer";

const Customer = () => {
  const { customerId } = useParams<{ customerId: string }>();

  return <div>{customerId && <CustomerView customerId={customerId} />}</div>;
};

export const Component = Customer;

const CustomerView = ({ customerId }: { customerId: string }) => {
  const [searchParams] = useSearchParams(); 
  const [tab, setTab] = useState<string>(searchParams.get("tab") || "Projects")

  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const toggleEditSheet = () => {
    setEditSheetOpen((prevState) => !prevState);
  };

  const { data, isLoading, error } = useFrappeGetDoc<Customers>(
    "Customers",
    customerId,
    `Customers ${customerId}`,
    {
      revalidateIfStale: false,
    }
  );

  const { data: associatedProjects, isLoading: associatedProjectsLoading } = useFrappeGetDocList<Projects>("Projects", {
    fields: ["*"],
    filters: [["customer", "=", customerId]],
    limit: 1000,
  });

  const customerAddressID = data?.company_address;

  const {
    data: customerAddress,
    isLoading: customerAddressLoading,
    error: customerAddressError,
  } = useFrappeGetDoc(
    "Address",
    customerAddressID,
    `${customerAddressID ? `Address ${customerAddressID}` : ""}`,
    {
      revalidateIfStale: false,
    }
  );

  const updateURL = useCallback(
      (params: Record<string, string>) => {
      const url = new URL(window.location.href);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      window.history.pushState({}, '', url);
    }, []);

  const tabs = useMemo(() => [
        {
          label: "Projects",
          value: "Projects"
        },
        {
          label: "Payments Inflow",
          value: "Payments Inflow"
        },
      ], [])

  const onClick = useCallback(
      (value : string) => {
        if (tab === value) return;
        setTab(value);
        updateURL({ tab: tab });
      }
      , [tab, updateURL]);

  const columns: ColumnDef<Projects>[] = useMemo(
      () => [
        {
          accessorKey: "name",
          header: ({ column }) => {
            return <DataTableColumnHeader column={column} title="ID" />;
          },
          cell: ({ row }) => {
            return (
              <div className="font-medium">
                <Link
                  className="underline hover:underline-offset-2"
                  to={`/projects/${row.getValue("name")}?page=overview`}
                >
                  {row.getValue("name")?.slice(-4)}
                </Link>
              </div>
            );
          },
        },
        {
          accessorKey: "project_name",
          header: ({ column }) => {
            return <DataTableColumnHeader column={column} title="Project Name" />;
          },
          cell: ({ row }) => {
            return (
              <Link
                className="underline hover:underline-offset-2"
                to={`/projects/${row.getValue("name")}?page=overview`}
              >
                <div className="font-medium">{row.getValue("project_name")}</div>
              </Link>
            );
          },
        },
        {
          accessorKey: "status",
          header: ({ column }) => {
            return <DataTableColumnHeader column={column} title="Status" />;
          },
          cell: ({ row }) => {
            return (
              <div className="font-medium">
                <Badge>{row.getValue("status")}</Badge>
              </div>
            );
          },
          filterFn: (row, id, value) => {
            return value.includes(row.getValue(id));
          },
        },
        {
          accessorKey: "creation",
          header: ({ column }) => {
            return <DataTableColumnHeader column={column} title="Date" />;
          },
          cell: ({ row }) => {
            return (
              <div className="font-medium">
                {formatDate(row.getValue("creation")?.split(" ")[0])}
              </div>
            );
          },
        },
        {
          id: "location",
          accessorFn: (row) => `${row.project_city},${row.project_state}`,
          header: ({ column }) => {
            return <DataTableColumnHeader column={column} title="Location" />;
          },
        },
      ],
      [data]
    );

  if (error || customerAddressError)
    return (
      <h1 className="text-red-700">
        There is an Error while fetching the account
      </h1>
    );

  return (
    <div className="flex-1 md:space-y-4">
      <div className="flex items-center gap-1 max-md:mb-2">
        {isLoading ? (
          <Skeleton className="h-10 w-1/3 bg-gray-300" />
        ) : (
          <h2 className="text-xl md:text-3xl font-bold tracking-tight ml-2">
            {data?.company_name}
          </h2>
        )}
        <Sheet open={editSheetOpen} onOpenChange={toggleEditSheet}>
          <SheetTrigger>
            <FilePenLine className="text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
          </SheetTrigger>
          <SheetContent className="overflow-auto">
            <EditCustomer toggleEditSheet={toggleEditSheet} />
          </SheetContent>
        </Sheet>
      </div>
      {isLoading || customerAddressLoading || associatedProjectsLoading ? (
        <OverviewSkeleton />
      ) : (
        <>
          <Card>
            <CardContent className="flex max-lg:flex-col max-lg:gap-10 mt-6">
              {/* <Card className="bg-[#F9FAFB]">
                  <CardHeader>
                    <CardContent className="flex max-lg:flex-col max-lg:gap-10"> */}
              <div className="space-y-4 lg:w-[50%]">
                <CardDescription className="space-y-2">
                  <span>Company Id</span>
                  <p className="font-bold text-black">{data?.name}</p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>Contact Person</span>
                  <p className="font-bold text-black">
                    {!data.company_contact_person
                      ? "N.A."
                      : data.company_contact_person}
                  </p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>Contact Number</span>
                  <p className="font-bold text-black">
                    {!data.company_phone ? "N.A." : data.company_phone}
                  </p>
                </CardDescription>
                <CardDescription className="space-y-2">
                  <span>Email Address</span>
                  <p className="font-bold text-black">
                    {!data.company_email ? "N.A." : data.company_email}
                  </p>
                </CardDescription>
                <CardDescription className="space-y-2">
                  <span>GST Number</span>
                  <p className="font-bold text-black">{data?.company_gst}</p>
                </CardDescription>
              </div>

              <div className="space-y-4">
                <CardDescription className="space-y-2">
                  <span>Address</span>
                  <p className="font-bold text-black">
                    {customerAddress?.address_line1},{" "}
                    {customerAddress?.address_line2}, {customerAddress?.city},{" "}
                    {customerAddress?.state}, {customerAddress?.pincode}
                  </p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>City</span>
                  <p className="font-bold text-black">
                    {customerAddress?.city}
                  </p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>State</span>
                  <p className="font-bold text-black">
                    {customerAddress?.state}
                  </p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>Country</span>
                  <p className="font-bold text-black">
                    {customerAddress?.country}
                  </p>
                </CardDescription>
              </div>
              {/* </CardContent>
                  </CardHeader>
                </Card> */}
            </CardContent>
          </Card>

          {tabs && (
                <Radio.Group
                    options={tabs}
                    defaultValue="Projects"
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => onClick(e.target.value)}
                />
            )}

            {tab === "Projects" && (
              <DataTable
                    columns={columns}
                    data={associatedProjects || []}
                  />
            )}

            {tab === "Payments Inflow" && (
              <InFlowPayments customerId={customerId} />
            )}

          {/* <div className="mt-4">
            <h2 className="text-2xl max-md:text-xl font-semibold font-bold pb-2 ml-2">
              Associated Projects
            </h2>
            {associatedProjects?.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {associatedProjects?.map((project) => (
                  <Link key={project.name} to={`/projects/${project?.name}`}>
                    <Card className="flex flex-col">
                      <CardHeader>
                        <CardTitle className="flex justify-between items-start">
                          <span className="text-lg">
                            {project?.project_name}
                          </span>
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {project?.name}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-grow">
                        <div className="flex items-center gap-2 mb-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {project?.project_city}, {project?.project_state}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-center bg-gray-50 py-2">Not Available</p>
            )}
          </div> */}
          </>
      )}
    </div>
  );
};