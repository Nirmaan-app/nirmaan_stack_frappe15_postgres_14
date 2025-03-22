import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { SelectUnit } from "@/components/helpers/SelectUnit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { Items as ItemsType } from "@/types/NirmaanStack/Items";
import { UserContext } from "@/utils/auth/UserProvider";
import { formatDate } from "@/utils/FormatDate";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { ListChecks, ShoppingCart } from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";

export default function Items() {
  const [curItem, setCurItem] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");

  const userData = useUserData();

  const { newItemDialog, toggleNewItemDialog } = useContext(UserContext)

  const {
    data: data,
    isLoading: isLoading,
    error: error,
    mutate: mutate,
  } = useFrappeGetDocList<ItemsType>("Items", {
    fields: [
      "name",
      "item_name",
      "unit_name",
      "make_name",
      "category",
      "creation",
    ],
    limit: 100000,
    orderBy: { field: "creation", order: "desc" },
  });
  const {
    data: category_list,
    isLoading: category_loading,
    error: category_error,
  } = useFrappeGetDocList("Category", {
    fields: ["*"],
    orderBy: { field: "work_package", order: "asc" },
    limit: 1000,
  });

  const {
    createDoc: createDoc,
    loading: loading,
    isCompleted: submit_complete,
    error: submit_error,
  } = useFrappeCreateDoc();
  const { toast } = useToast();

  const columns: ColumnDef<ItemsType>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Product ID" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              <Link
                className="underline hover:underline-offset-2 whitespace-nowrap"
                to={`${row.getValue("name")}`}
              >
                {row.getValue("name").slice(-6)}
              </Link>
            </div>
          );
        },
      },
      {
        accessorKey: "item_name",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Product Name" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              <Link
                className="underline hover:underline-offset-2 whitespace-nowrap"
                to={`${row.getValue("name")}`}
              >
                {row.getValue("item_name")}
              </Link>
              {/* `${item.item_name} ${ ? "-" + row.getValue("make_name") : ""}` */}
            </div>
          );
        },
      },
      // {
      //   accessorKey: "make_name",
      //   header: ({ column }) => {
      //     return <DataTableColumnHeader column={column} title="Make" />;
      //   },
      //   cell: ({ row }) => {
      //     return (
      //       <div className="font-medium">
      //         {row.getValue("make_name") || "--"}
      //         `${item.item_name} ${ ? "-" + row.getValue("make_name") : ""}`
      //       </div>
      //     );
      //   },
      // },
      {
        accessorKey: "creation",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Date Added" />;
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
        accessorKey: "unit_name",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Unit" />;
        },
        cell: ({ row }) => {
          return <div className="font-medium">{row.getValue("unit_name")}</div>;
        },
      },
      {
        accessorKey: "category",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Category" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              <Badge>{row.getValue("category")}</Badge>
            </div>
          );
        },
        filterFn: (row, id, value) => {
          return value.includes(row.getValue(id));
        },
      },
    ],
    []
  );

  const handleAddItem = () => {
    const itemData = {
      category: category,
      unit_name: unit,
      item_name: curItem,
    };
    createDoc("Items", itemData)
      .then(() => {
        console.log(itemData);
        toast({
          title: "Success!",
          description: `Item: ${curItem} created successfully!`,
          variant: "success",
        });

        toggleNewItemDialog()
        // document.getElementById("dialogCloseItem")?.click();
        setUnit("");
        setCurItem("");
        setCategory("");
        mutate();
      })
      .catch(() => {
        console.log("submit_error", submit_error);
        toast({
          title: "Error!",
          description: `Error ${submit_error?.message}`,
          variant: "destructive",
        });
      });
  };

  const categoryOptions = useMemo(() => category_list?.map((item) => ({
    value: item.name,
    label:
      item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")",
  })) || [], [category_list]);

  if (error || category_error)
    return error ? <h1>error.message</h1> : <h1>category_error.message</h1>;

  return (
    <div className="flex-1 space-y-4">
        <Card className="hover:animate-shadow-drop-center max-md:w-full my-2 w-[60%]">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
        {(userData.role === "Nirmaan Admin Profile") && (
            <Dialog open={newItemDialog} onOpenChange={toggleNewItemDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="mb-2 text-center">Add New Product</DialogTitle>
                  <div className="flex flex-col gap-4 ">
                    <div className="flex flex-col items-start">
                      <label
                        htmlFor="itemUnit"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Category<sup className="pl-1 text-sm text-red-600">*</sup>
                      </label>
                      <Select onValueChange={(value) => setCategory(value)}>
                        <SelectTrigger className="">
                          <SelectValue
                            className="text-gray-200"
                            placeholder="Select Category"
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {category_list?.map((cat) => {
                            return (
                              <SelectItem value={cat.category_name}>
                                {cat.category_name}-({cat.work_package})
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col items-start">
                      <label
                        htmlFor="itemName"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Product Name
                        <sup className="pl-1 text-sm text-red-600">*</sup>
                      </label>
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
                      <label
                        htmlFor="itemUnit"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Product Unit
                        <sup className="pl-1 text-sm text-red-600">*</sup>
                      </label>
                      <SelectUnit value={unit} onChange={(value) => setUnit(value)} />
                    </div>
                  </div>
                </DialogHeader>
                <Button
                  onClick={() => handleAddItem()}
                  disabled={loading || !curItem || !unit || !category}
                  className="flex items-center gap-1"
                >
                  <ListChecks className="h-4 w-4" />
                  Submit
                </Button>
              </DialogContent>
            </Dialog>
          )}
        {isLoading || category_loading ? (
          <TableSkeleton />
        ) : (
          <DataTable
            columns={columns}
            data={data || []}
            category_options={categoryOptions}
          />
        )}
    </div>
  );
}