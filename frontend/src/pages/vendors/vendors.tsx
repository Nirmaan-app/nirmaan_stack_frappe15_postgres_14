import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Vendors as VendorsType } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Ellipsis, Package } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link, useSearchParams } from "react-router-dom";

import { Radio } from 'antd';

export default function Vendors() {

  const [searchParams] = useSearchParams();
  
  const [type, setType] = useState<string>(searchParams.get("type") || "Material");

  const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]); // State for dynamic category options

  const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList("Vendors", {
    fields: ["*"],
    limit: 10000,
    orderBy: { field: "creation", order: "desc" }
  },
    "vendors"
  )

  const { data: category_data, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
    fields: ["*"],
    limit: 10000
  })
  // Extract unique categories from the data dynamically
  useEffect(() => {
    if (category_data) {
      const currOptions = category_data.map((item) => ({
        value: item.name,
        label: item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")"
      }))
      setCategoryOptions(currOptions);
    }
    // console.log("options", categoryOptions)
  }, [category_data]);

  const getVendorAddr = useMemo(() => (id: string) => {
    if (data) {
      const vendor = data?.find((ven) => ven?.name === id);
      return { city: vendor?.vendor_city, state: vendor?.vendor_state };
    }
  }, [data]);

  const updateURL = useCallback((key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.pushState({}, "", url);
}, []);

const onClick = useCallback((value: string) => {
    if (type === value) return; // Prevent redundant updates

    setType(value);
    updateURL("type", value);
}, [type, updateURL]);

const sVendorsCount = useMemo(() => data?.filter(i => i?.vendor_type === "Service").length, [data]);
const mVendorsCount = useMemo(() => data?.filter(i => i?.vendor_type === "Material").length, [data]);
const msVendorsCount = useMemo(() => data?.filter(i => i?.vendor_type === "Material & Service").length, [data]);

const items = useMemo(() => [
    {
        label: (
            <div className="flex items-center">
                <span>Material</span>
                <span className="ml-2 text-xs font-bold">
                    {mVendorsCount}
                </span>
            </div>
        ),
        value: "Material",
    },
    {
        label: (
            <div className="flex items-center">
                <span>Service</span>
                <span className="ml-2 rounded text-xs font-bold">
                  {sVendorsCount}
                </span>
            </div>
        ),
        value: "Service",
    },
    {
      label: (
          <div className="flex items-center">
              <span>Material & Service</span>
              <span className="ml-2 rounded text-xs font-bold">
                {msVendorsCount}
              </span>
          </div>
      ),
      value: "Material & Service",
  },
], [data, sVendorsCount, mVendorsCount, msVendorsCount]);


  const columns: ColumnDef<VendorsType>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Vendor ID" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/vendors/${row.getValue("name")}`}>
                {row.getValue("vendor_type") === "Material" ? "M" : row.getValue("vendor_type") === "Service" ? "S" : "MS"}-{row.getValue("name").slice(-4)}
              </Link>
            </div>
          )
        }
      },
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
              <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/vendors/${row.getValue("name")}`}>
                {row.getValue("vendor_name")}
              </Link>
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
        accessorKey: "vendor_type",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Vendor Type" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {row.getValue("vendor_type")}
            </div>
          )
        }
      },
      {
        accessorKey: "vendor_email",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Vendor Email" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium flex items-center justify-start">
              {row.getValue("vendor_email") || "--"}
            </div>
          )
        }
      },
      {
        id: "vendor_address",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Address" />
        ),
        cell: ({ row }) => {
          const id = row.getValue("name");
          const address = getVendorAddr(id);
          return (
            <div>
              <span>{address?.city}, </span>
              <span>{address?.state}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "vendor_category", // Add the categories column
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Categories" />
        ),
        cell: ({ row }) => (
          <div className="font-medium">
            {/* Display the categories as a comma-separated string */}
            {row.getValue("vendor_category")['categories'].length <= 3 ?
              (row.getValue("vendor_category")['categories'].map((item) =>
                <Badge className="mb-0.5 ml-0.5">{item}</Badge>
              ))
              :
              (<div>{row.getValue("vendor_category")['categories'].slice(0, 3).map((item) =>
                <Badge className="mb-0.5 ml-0.5">{item}</Badge>
              )}
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <Button className="m-0.5 h-5" variant="outline" ><Ellipsis className="w-3.5 h-3.5" /></Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80">
                    <div className="flex-col">
                      {row.getValue("vendor_category")['categories'].slice(3).map((item) =>
                        <Badge className="mb-0.5 ml-0.5">{item}</Badge>
                      )}
                    </div>
                  </HoverCardContent>
                </HoverCard>


              </div>
              )

            }

          </div>
        ),
        // Implement filtering for the categories
        filterFn: (row, _columnId, filterValue: string[]) => {
          const categories = row.getValue<string[]>("vendor_category")['categories'] || [];
          return filterValue.every((filter) => categories.includes(filter));
        },
      },
    ],
    [data, category_data]
  )

  // if (isLoading || category_loading) return <h1>Loading...</h1>
  if (error || category_error)
    return error ? (
      <h1>{error?.message}</h1>
    ) : (
      <h1>{category_error?.message}</h1>
    );
  return (
    <div className="flex-1 space-y-4">
        <Card className="hover:animate-shadow-drop-center max-md:w-full my-2 w-[60%]">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Total Vendors</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="flex justify-between items-center">
            <div className="text-2xl font-bold">
              {isLoading ? (
                <TailSpin
                  visible={true}
                  height="30"
                  width="30"
                  color="#D03B45"
                  ariaLabel="tail-spin-loading"
                  radius="1"
                  wrapperStyle={{}}
                  wrapperClass=""
                />
              ) : (
                data?.length
              )}
            </div>
            <div className="flex flex-col gap-1 text-sm font-semibold">
            <div className="flex items-center gap-1">
              <span>Material : {mVendorsCount}</span>
              <span>|</span>
              <span>Service : {sVendorsCount}</span>
            </div>
            <span>Material & Service : {msVendorsCount}</span>
            </div>
          </CardContent>
        </Card>
            {items && (
                    <Radio.Group
                        options={items}
                        defaultValue="Material"
                        optionType="button"
                        buttonStyle="solid"
                        value={type}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}
        {isLoading || category_loading ? (
          <TableSkeleton />
        ) : (
          <DataTable
            columns={columns}
            data={data?.filter(i => i?.vendor_type === type) || []}
            category_options={categoryOptions}
          />
        )}
    </div>
  );
}