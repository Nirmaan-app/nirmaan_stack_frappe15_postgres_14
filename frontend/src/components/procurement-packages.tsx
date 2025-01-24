import { Button } from "@/components/ui/button";
//import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFrappeDeleteDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
//import { HardHat } from "lucide-react";
// import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { DialogClose, DialogDescription } from "@/components/ui/dialog";
// import { ColumnDef } from "@tanstack/react-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { DataTable } from "@/components/data-table/data-table";
import { WPCard } from "@/components/wp-card";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useFrappeCreateDoc } from "frappe-react-sdk";
import { ButtonLoading } from "@/components/ui/button-loading";
import {
  ArrowLeft,
  CheckCheck,
  CirclePlus,
  Info,
  Pencil,
  X,
} from "lucide-react";
import { WPSkeleton } from "@/components/ui/skeleton";
import { toast, useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { useCallback, useEffect, useState } from "react";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { Label } from "./ui/label";
import ReactSelect from 'react-select';
import { Separator } from "./ui/separator";
import { TailSpin } from "react-loader-spinner";
import { debounce } from "lodash";

interface WorkPackage {
  work_package_name: string;
}

// const SOWFormSchema = z.object({
//     work_package_name: z
//         .string({
//             required_error: "Must provide type Name"
//         })
//         .min(3, {
//             message: "Type Name must be at least 3 characters.",
//         }),
// })

// type SOWFormValues = z.infer<typeof SOWFormSchema>

export const ProcurementPackages = () => {
  const navigate = useNavigate();

  const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

  const { createDoc, loading: createDocLoading } = useFrappeCreateDoc();

  const { deleteDoc, loading: deleteDocLoading } = useFrappeDeleteDoc();

  const {
    data: procurementPackages,
    isLoading: isLoading,
    error: error,
    mutate: mutate,
  } = useFrappeGetDocList<WorkPackage>("Procurement Packages", {
    fields: ["*"],
    limit: 1000,
  });

  const {
    data: categoriesList,
    isLoading: categoriesListLoading,
    mutate: categoriesListMutate,
  } = useFrappeGetDocList("Category", {
    fields: ["*"],
    limit: 10000,
  });

  const { data: itemList, isLoading: itemListLoading } = useFrappeGetDocList(
    "Items",
    {
      fields: ["*"],
      limit: 100000,
    }
  );

  const { data: categoryMakeList, isLoading: categoryMakeListLoading, mutate: categoryMakeListMutate } = useFrappeGetDocList("Category Makelist", {
    fields: ["*"],
    limit: 100000,
  })

  const { data: makeList, isLoading: makeListLoading, mutate: makeListMutate } = useFrappeGetDocList("Makelist", {
    fields: ["*"],
    limit: 100000,
  })

  const [editCategory, setEditCategory] = useState({});

  const [newCategoryMakes, setNewCategoryMakes] = useState(null);

  const [loadingFunc, setLoadingFunc] = useState("")

  const [makeOptions, setMakeOptions] = useState([])

  const [showNewMakeInput, setShowNewMakeInput] = useState(false)

  const [defaultOptions, setDefaultOptions] = useState([])

  // console.log("categories", categoriesList)

  // const form = useForm<SOWFormValues>({
  //     resolver: zodResolver(SOWFormSchema),
  //     defaultValues: {
  //         work_package_name: "",
  //     },
  //     mode: "onChange",
  // })

  // const {toast} = useToast()

  // const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
  // // 2. Define a submit handler.
  // function onSubmit(values: z.infer<typeof SOWFormSchema>) {
  //     // Do something with the form values.
  //     // ✅ This will be type-safe and validated.
  //     console.log("values ", values)

  //     createDoc('Work Packages', values)
  //         .then(() => {
  //             console.log(values)
  //             toast({
  //                 title: "Success!",
  //                 description: `${values.work_package_name} created successfully!`,
  //                 variant : "success"
  //             })

  //             form.reset({
  //                 work_package_name: ""
  //             })
  //             mutate()
  //             document.getElementById("dialogClosewp")?.click()
  //         }).catch(() => {
  //             console.log(submit_error)
  //         })
  // }

  // if (error) {
  //     console.log("Error in work-packages.tsx", error?.message)
  //     toast({
  //         title: "Error!",
  //         description: `Error ${error?.message}`,
  //         variant : "destructive"
  //     })
  // }
  // const columns: ColumnDef<WorkPackage>[] = useMemo(
  //     () => [
  //         {
  //             accessorKey: "work_package_name",
  //             header: ({ column }) => {
  //                 return (
  //                     <DataTableColumnHeader column={column} title="WP" />
  //                 )
  //             },
  //             cell: ({ row }) => {
  //                 return (
  //                     <div className="font-medium">
  //                         <Link className="underline hover:underline-offset-2" to="/wp">
  //                             {row.getValue("work_package_name")}
  //                         </Link>
  //                     </div>
  //                 )
  //             }
  //         }
  //     ],
  //     []
  // )
  // function closewindow() {
  //     var button = document.getElementById('dialogClose');
  //     mutate()
  // }

  const handleEditCategory = async () => {

    try {
      setLoadingFunc("handleEditCategory")

      const currentCategory = categoriesList?.find((i) => i?.name === editCategory?.name)

      const currentCategoryMakes = categoryMakeList?.filter((i) => i?.category === editCategory?.name)

      if (currentCategoryMakes?.length !== defaultOptions?.length) {

        const toDeleteMakes = currentCategoryMakes?.filter((i) => !defaultOptions?.some((j) => j?.make === i?.make))

        await Promise.all(
          toDeleteMakes?.map(async (item) => {
            try {
              await deleteDoc("Category Makelist", item?.name);
            } catch (error) {
              console.log("error while deleting category make", error);
            }
          })
        );

        await categoryMakeListMutate();
      }

      if (currentCategory?.new_items !== editCategory?.new_items || currentCategory?.tax !== editCategory?.tax) {
        await updateDoc("Category", editCategory?.name, {
          tax: editCategory?.tax,
          new_items: editCategory?.new_items,
        });

        setEditCategory({})
        await categoriesListMutate();
      }

      if (newCategoryMakes?.length > 0) {
        await Promise.all(
          newCategoryMakes?.map(async (item) => {
            try {
              await createDoc("Category Makelist", {
                category: editCategory?.name,
                make: item.value
              })
            } catch (error) {
              console.log("error while creating category make", error);
            }
          })
        );

        setNewCategoryMakes([])

        await categoryMakeListMutate()
      }

      toast({
        title: "Success",
        description: `${editCategory?.name} updated successfully!`,
        variant: "success",
      });

      document.getElementById("editCategoryAlertDialog")?.click()

    } catch (error) {
      toast({
        title: "Failed",
        description: `${editCategory?.name} updation failed!`,
        variant: "destructive",
      });
      console.log("error while editing category", error);
    } finally {
      setLoadingFunc("")
    }
  };

  useEffect(() => {
    if (makeList && editCategory && categoryMakeList) {
      const categoryMakes = categoryMakeList?.filter((catMake) => catMake?.category === editCategory?.name)

      let makeOptionsList = []
      if (categoryMakes?.length > 0) {
        makeOptionsList = makeList?.filter((i) => categoryMakes?.every((j) => j?.make !== i?.name))?.map((k) => ({ label: k?.name, value: k?.name })) || [];
      } else {
        makeOptionsList = makeList?.map((i) => ({ label: i?.name, value: i?.name })) || [];
      }

      setMakeOptions(makeOptionsList)

      setDefaultOptions(categoryMakes)

    }
  }, [makeList, editCategory?.name, categoryMakeList])

  const handleChange = (selectedOptions) => {
    setNewCategoryMakes(selectedOptions)
  }

  const handleAddNewMake = async (newMake, setNewMake) => {
    try {
      setLoadingFunc("handleAddNewMake")
      await createDoc("Makelist", {
        make_name: newMake
      })

      await makeListMutate()

      toast({
        title: "Success",
        description: `New make: ${newMake} created successfully!`,
        variant: "success",
      });

      setNewMake("")

    } catch (error) {
      console.log("error while adding new make", error);
      toast({
        title: "Failed",
        description: `unable to create new make!`,
        variant: "destructive",
      });
    } finally {
      setLoadingFunc("")
    }
  }

  // const handleCreateCategoryMakes = async () => {
  //   try {

  //     await Promise.all(
  //       newCategoryMakes?.map(async (item) => {
  //         try {
  //           await createDoc("Category Makelist", {
  //             category: editCategory?.name,
  //             make: item.value
  //           })
  //         } catch (error) {
  //           console.log("error while creating category make", error);
  //         }
  //       })
  //     );

  //     await categoryMakeListMutate()

  //     toast({
  //       title: "Success",
  //       description: `Category makes updated successfully!`,
  //       variant: "success",
  //     });

  //   } catch (error) {
  //     console.log("error while updating category makes", error);
  //     toast({
  //       title: "Failed",
  //       description: `unable to update category makes!`,
  //       variant: "destructive",
  //     });
  //   }
  // }

  console.log("defaultOptions", defaultOptions)

  return (
    <div className="flex-1 space-y-4">
      {/* <div className="flex items-center justify-between mb-2 space-y-2">
        <div className="flex">
          <ArrowLeft
            className="mt-1.5 cursor-pointer"
            onClick={() => navigate("/")}
          />
          <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">
            Procurement Packages
          </h2>
        </div> */}
      {/* <div className="flex items-center space-x-2">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary">
                                    <div className="flex cursor-pointer"><CirclePlus className="w-5 h-5 mt- pr-1 " />
                                        <span className="pl-1">Add New Work Package</span>
                                    </div>
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Add New Work Package</DialogTitle>
                                </DialogHeader>
                                <Form {...form}>
                                    <form onSubmit={(event) => {
                                        event.stopPropagation();
                                        return form.handleSubmit(onSubmit)(event);

                                    }} className="flex flex-col gap-2">
                                        <FormField
                                            control={form.control}
                                            name="work_package_name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Work Package Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Work Package Name" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="flex items-center justify-center">
                                        {(loading) ? (<ButtonLoading />) : (
                                            <>
                                            <Button type="submit">Submit</Button>
                                            <DialogClose id="dialogClosewp" className="hidden">hello</DialogClose>
                                            </>
                                            )}    
                                        </div>                                    
                                    </form>
                                </Form>
                            </DialogContent>
                        </Dialog>
                    </div> */}
      {/* </div> */}
      <div className="flex flex-col gap-4">
        {isLoading || categoriesListLoading || itemListLoading
          ? [...Array(5)].map((_, index) => (
            <div key={index}>
              <WPSkeleton />
            </div>
          ))
          : procurementPackages
            ?.sort((a, b) =>
              a?.work_package_name?.localeCompare(b?.work_package_name)
            )
            ?.map((d) => (
              <div key={d?.work_package_name}>
                {/* <WPCard wp={d.work_package_name} /> */}
                <Card className="hover:animate-shadow-drop-center">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                      {d?.work_package_name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-auto">
                    {categoriesList?.filter(
                      (i) => i?.work_package === d?.work_package_name
                    )?.length !== 0 && (
                        <Table>
                          <TableHeader className="bg-red-100">
                            <TableRow>
                              <TableHead className="w-[30%]">
                                Category
                              </TableHead>
                              <TableHead className="w-[30%]">
                                Make List
                              </TableHead>
                              <TableHead className="w-[10%]">
                                Items count
                              </TableHead>
                              <TableHead className="w-[5%]">Tax</TableHead>
                              <TableHead className="w-[10%]">
                                New Items Addition
                              </TableHead>
                              <TableHead className="w-[5%]">Edit</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {categoriesList
                              ?.filter(
                                (i) => i?.work_package === d?.work_package_name
                              )
                              ?.sort((a, b) => a?.name?.localeCompare(b?.name))
                              ?.map((cat) => (
                                <TableRow key={cat?.name}>
                                  <TableCell>{cat?.name}</TableCell>
                                  <TableCell>
                                    <div className="flex gap-1 flex-wrap">
                                      {categoryMakeList?.filter((i) => i?.category === cat?.name)?.length > 0 ?
                                        categoryMakeList?.filter((i) => i?.category === cat?.name)?.map((i) => (
                                          <Badge>{i?.make}</Badge>
                                        )) : "--"
                                      }
                                    </div>
                                  </TableCell>
                                  <TableCell className="flex  items-center gap-1">
                                    {
                                      itemList?.filter(
                                        (i) => i?.category === cat?.name
                                      )?.length
                                    }{" "}
                                    <HoverCard>
                                      <HoverCardTrigger>
                                        <Info
                                          onClick={() =>
                                            navigate(
                                              `/items?Category=${cat?.name}`
                                            )
                                          }
                                          className="w-4 h-4 text-blue-500 cursor-pointer"
                                        />
                                      </HoverCardTrigger>
                                      <HoverCardContent className="max-w-[150px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                        <p className="text-sm">
                                          Click to view items
                                        </p>
                                      </HoverCardContent>
                                    </HoverCard>
                                  </TableCell>
                                  <TableCell>{cat?.tax}%</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        cat?.new_items === "true"
                                          ? "green"
                                          : cat?.new_items === "false"
                                            ? "red"
                                            : "gray"
                                      }
                                    >
                                      {cat?.new_items === "true"
                                        ? "Enabled"
                                        : cat?.new_items === "false"
                                          ? "Disabled"
                                          : "Not Set"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <AlertDialog>
                                      <AlertDialogTrigger
                                        onClick={() => setEditCategory(cat)}
                                        asChild>
                                        <Pencil className="text-blue-600 cursor-pointer" />
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader className="text-start">
                                          <AlertDialogTitle>
                                            Edit{" "}
                                            <span className="text-primary">
                                              {editCategory?.name}
                                            </span>
                                          </AlertDialogTitle>
                                          <AlertDialogDescription className="w-full">
                                            <div className="flex flex-col items-start gap-1">
                                              <p>Tax</p>
                                              <Input
                                                id="tax"
                                                type="number"
                                                placeholder="Enter tax..."
                                                value={editCategory?.tax}
                                                onChange={(e) =>
                                                  setEditCategory((prev) => ({
                                                    ...prev,
                                                    tax: e.target.value,
                                                  }))
                                                }
                                              />
                                            </div>
                                            <div className="flex flex-col items-start gap-2 pt-6">
                                              <p className="font-semibold">
                                                Enable/Disable New Items
                                                Addition
                                              </p>
                                              <Switch
                                                id="hello"
                                                defaultChecked={
                                                  editCategory?.new_items ===
                                                  "true"
                                                }
                                                onCheckedChange={(e) =>
                                                  setEditCategory((prev) => ({
                                                    ...prev,
                                                    new_items: e
                                                      ? "true"
                                                      : "false",
                                                  }))
                                                }
                                              />
                                            </div>
                                            <Separator className="my-6" />

                                            <div className="flex gap-1 flex-wrap mb-4">
                                              {defaultOptions?.length > 0 && (
                                                defaultOptions?.map((i) => (
                                                  <Badge>{i?.make}
                                                    <X onClick={() => setDefaultOptions(defaultOptions?.filter((j) => j?.make !== i?.make))} className="ml-1 text-gray-200 w-6 h-6 cursor-pointer" />
                                                  </Badge>
                                                ))
                                              )}
                                            </div>
                                            <div>
                                              <Label>
                                                Add existing makes to <span className="text-primary">{editCategory?.name}</span>:
                                              </Label>
                                              {categoryMakeList && makeList && (
                                                <ReactSelect options={makeOptions} onChange={handleChange} isMulti />
                                              )}
                                            </div>


                                            {showNewMakeInput ? (
                                              <AddMakeComponent makeList={makeList} loadingFunc={loadingFunc} handleAddNewMake={handleAddNewMake} />
                                            ) : (
                                              <Button className="mt-4" onClick={() => setShowNewMakeInput(true)}>Create New Make</Button>
                                            )}
                                            <div className="flex items-center gap-2 justify-end mt-4">
                                              {loadingFunc === "handleEditCategory" ? (
                                                <TailSpin color={"red"} height={40} width={40} />
                                              ) : (
                                                <>
                                                  <AlertDialogCancel disabled={loadingFunc !== ""} className="flex items-center gap-1">
                                                    <X className="h-4 w-4" />
                                                    Cancel
                                                  </AlertDialogCancel>
                                                  <Button
                                                    className="flex items-center gap-1"
                                                    onClick={handleEditCategory}
                                                    disabled={
                                                      (cat?.tax ===
                                                        editCategory?.tax &&
                                                        cat?.new_items ===
                                                        editCategory?.new_items &&
                                                        !newCategoryMakes?.length > 0 &&
                                                        categoryMakeList?.filter((catMake) => catMake?.category === editCategory?.name)?.length === defaultOptions?.length) ||
                                                      loadingFunc !== ""
                                                    }
                                                  >
                                                    <CheckCheck className="h-4 w-4" />
                                                    Confirm
                                                  </Button>
                                                </>
                                              )}
                                            </div>
                                          </AlertDialogDescription>
                                          <AlertDialogCancel className="hidden" id="editCategoryAlertDialog">Close</AlertDialogCancel>
                                        </AlertDialogHeader>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      )}
                  </CardContent>
                </Card>
              </div>
            ))}
      </div>
    </div>
  );
};


const AddMakeComponent = ({ makeList, loadingFunc, handleAddNewMake }) => {
  const [newMake, setNewMake] = useState("");
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [checking, setChecking] = useState(false); // To show loading state for the check

  // Debounced function to check for duplicates
  const checkDuplicateMake = useCallback(
    debounce((value) => {
      if (!value) {
        setIsDuplicate(false);
        return;
      }

      setChecking(true);

      // Check if the entered name matches any in the makeList
      const duplicate = makeList.some((make) => make.name.toLowerCase() === value.toLowerCase());
      setIsDuplicate(duplicate);
      setChecking(false);
    }, 500), // 500ms debounce delay
    [makeList]
  );

  // Effect to trigger duplicate check when `newMake` changes
  useEffect(() => {
    checkDuplicateMake(newMake?.trim());
    return () => checkDuplicateMake.cancel(); // Cleanup debounce on unmount
  }, [newMake, checkDuplicateMake]);

  return (
    <div className="flex flex-col gap-1 mt-4">
      <Label>Add New Make:</Label>
      <div className="flex items-center gap-1">
        <Input
          type="text"
          placeholder="Enter new make name..."
          value={newMake}
          onChange={(e) => setNewMake(e.target.value)}
        />
        <div className="w-[80px]">
          {loadingFunc === "handleAddNewMake" ? (
            <TailSpin color={"red"} height={30} width={30} />
          ) : (
            <Button disabled={!newMake || isDuplicate || checking} onClick={() => handleAddNewMake(newMake, setNewMake)}>
              Submit
            </Button>
          )}
        </div>

      </div>
      {/* Feedback for duplicate make */}
      {isDuplicate && (
        <p className="text-sm text-red-500 mt-1">
          This make name already exists in the database.
        </p>
      )}
    </div>
  );
};

export default AddMakeComponent;