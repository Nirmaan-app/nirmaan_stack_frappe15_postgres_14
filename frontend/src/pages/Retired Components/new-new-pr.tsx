import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import {
  useFrappeCreateDoc,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
  useSWRConfig,
} from "frappe-react-sdk";
import Fuse from "fuse.js";
import {
  CheckCheck,
  CirclePlus,
  CircleX,
  ListChecks,
  MessageCircleMore,
  MessageCircleWarning,
  Pencil,
  Trash2,
  Undo
} from "lucide-react";
import { useEffect, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import ReactSelect, { components } from "react-select";
import { v4 as uuidv4 } from "uuid";
import { SelectUnit } from "../../components/helpers/SelectUnit";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { Card, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "../../components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../../components/ui/hover-card";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { toast } from "../../components/ui/use-toast";

export const NewProcurementRequest = ({ resolve = false, edit = false }) => {
  const { projectId, prId } = useParams();
  const userData = useUserData();
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();

  const [selectedWP, setSelectedWP] = useState("");
  const [curItem, setCurItem] = useState("");
  const [curCategory, setCurCategory] = useState("");
  const [itemOptions, setItemOptions] = useState([]);
  const [catOptions, setCatOptions] = useState([]);
  const [procList, setProcList] = useState([]);
  const [stack, setStack] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [editItem, setEditItem] = useState({});
  const [newPRComment, setNewPRComment] = useState("");
  const [newItem, setNewItem] = useState({});
  const [requestItem, setRequestItem] = useState("");
  const [fuzzyMatches, setFuzzyMatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState("wp-selection");
  const [requestItemDialogOpen, setRequestItemDialogOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const [isNewItemsDisabled, setIsNewItemsDisabled] = useState(false);

  const toggleNewItemDialog = () => {
    setOpen((prevState) => !prevState);
  };

  const toggleRequestItemDialog = () => {
    setRequestItemDialogOpen((prevState) => !prevState);
  };

  const { data: dynamic_pr, mutate: dynamic_pr_mutate } = useFrappeGetDoc(
    "Procurement Requests",
    prId,
    prId ? undefined : null
  );

  const { data: universalComments } = useFrappeGetDocList(
    "Nirmaan Comments",
    {
      fields: ["*"],
      filters: [
        ["reference_name", "=", prId],
        ["subject", "=", resolve ? "rejecting pr" : "creating pr"],
      ],
      orderBy: { field: "creation", order: "desc" },
    },
    prId ? undefined : null
  );

  const { data: usersList } = useFrappeGetDocList("Nirmaan Users", {
    fields: ["*"],
    limit: 1000,
    // filters: [["role_profile", "=", "Nirmaan Project Lead Profile"]]
  });

  const { data: category_list } = useFrappeGetDocList(
    "Category",
    {
      fields: [
        "category_name",
        "work_package",
        "image_url",
        "tax",
        "new_items",
        "name",
      ],
      filters: [["work_package", "=", selectedWP]],
      orderBy: { field: "category_name", order: "asc" },
      limit: 1000,
    },
    selectedWP ? undefined : null
  );

  const { data: item_list, mutate: item_list_mutate } = useFrappeGetDocList(
    "Items",
    {
      fields: [
        "name",
        "item_name",
        "make_name",
        "unit_name",
        "category",
        "creation",
      ],
      filters: [["category", "in", category_list?.map((i) => i?.name)]],
      orderBy: { field: "creation", order: "desc" },
      limit: 100000,
    },
    category_list?.length ? undefined : null
  );

  const { data: wp_list } = useFrappeGetDocList("Procurement Packages", {
    fields: ["work_package_name", "work_package_image"],
    orderBy: { field: "work_package_name", order: "asc" },
    limit: 1000,
  });

  // const { data: category_make_list, isLoading: category_make_list_loading, error: category_make_list_error } = useFrappeGetDocList("Category Makelist", {
  //   fields: ["*"],
  //   limit: 10000
  // })

  const { data: project } = useFrappeGetDoc("Projects", projectId);

  const { createDoc, loading: createLoading } = useFrappeCreateDoc();

  const {
    updateDoc,
    loading: updateLoading,
    error: update_error,
  } = useFrappeUpdateDoc();

  useEffect(() => {
    if ((resolve || edit) && dynamic_pr) {
      const newCategories = JSON.parse(dynamic_pr?.category_list)?.list || [];
      setSelectedCategories(newCategories);
      const newProcList = JSON.parse(dynamic_pr?.procurement_list)?.list || [];
      setProcList(newProcList);
      setPage("item-selection");
      setSelectedWP(dynamic_pr?.work_package || "");
      // console.log("newCategories", selectedCategories)
    }
  }, [dynamic_pr, prId, resolve, edit]);

  // console.log("procList", procList)

  // console.log("selectedWP", selectedWP)

  useEffect(() => {
    if (selectedWP && category_list) {
      const options = [];
      category_list?.map((item) => {
        if (item?.work_package === selectedWP) {
          options.push({
            value: item.category_name,
            label: item.category_name,
            tax: parseFloat(item?.tax || "0"),
          });
        }
      });
      setCatOptions(options);
    }
  }, [category_list, selectedWP]);

  useEffect(() => {
    if (selectedWP && catOptions && item_list) {
      const options = [];
      item_list?.map((item) => {
        if (catOptions.some(i => i.value === item.category)) {
          options.push({
            value: item.name,
            label: item.item_name,
            unit: item?.unit_name,
            category: item.category,
            tax: catOptions?.find(i => i?.value === item.category)?.tax,
          });
        }
      });
      setItemOptions(options);
    }
  }, [selectedWP, catOptions, item_list]);

  useEffect(() => {
    if (curCategory) {
      const bool = category_list?.find(i => i?.name === curCategory?.value)?.new_items
      setIsNewItemsDisabled((bool === "false" && !["Nirmaan Admin Profile"].includes(userData?.role)))
    } else {
      setIsNewItemsDisabled(false)
    }

  }, [curCategory])

  const handleCommentChange = (e) => {
    const value = e.target.value;
    setCurItem((prev) => ({
      ...prev,
      comment: value,
    }));
  };

  const handleQuantityChange = (e) => {
    const value = e.target.value;
    setCurItem((prev) => ({
      ...prev,
      quantity: value === "" ? 0 : parseFloat(value),
    }));
  };

  useEffect(() => {
    const newCategories = [];

    procList.map((item) => {
      const isDuplicate = newCategories.some(
        (category) =>
          category.name === item?.category && category.status === item.status
      );
      if (!isDuplicate) {
        //       if (item.status === "Pending") {
        //         const makes = project.project_work_packages
        // ? JSON.parse(project.project_work_packages).work_packages
        //     .flatMap((wp) => wp.category_list?.list || []) // Flatten all categories across work packages
        //     .filter((cat) => cat.name === item.category) // Filter categories matching item.category
        //     .flatMap((cat) => cat.makes || []) // Extract and flatten makes
        // : []; // Return an empty array if project_work_packages is not defined
        //         newCategories.push({ name: item.category, status: item.status, makes: makes || [] });
        //       } else {
        newCategories.push({ name: item.category, status: item.status });
        // }
      }
    });

    setSelectedCategories(newCategories);
  }, [procList]);

  const getFullName = (id) => {
    return usersList?.find((user) => user.name == id)?.full_name;
  };

  const handleUpdateItem = (item) => {
    const updateItem = procList?.find((i) => i?.name === item);

    if (updateItem) {
      if (
        updateItem?.comment !== editItem?.comment ||
        updateItem?.quantity !== editItem?.quantity ||
        updateItem?.unit !== editItem?.unit ||
        updateItem?.item !== editItem?.item ||
        updateItem?.category !== editItem?.category
      ) {
        setProcList((prevList) =>
          prevList.map((i) =>
            i?.name === item
              ? {
                ...i,
                comment: editItem?.comment,
                quantity: editItem?.quantity,
                unit: editItem?.unit,
                item: editItem?.item,
                category: editItem?.category,
                tax: parseFloat(
                  category_list?.find((i) => i?.name === editItem?.category)
                    ?.tax
                ),
              }
              : i
          )
        );
      }
    }
  };

  const handleAddNewItem = (request = false) => {
    const curProcList = [...procList];
    const itemToAdd = {
      item: request ? newItem?.item_name : curItem?.label,
      name: request ? uuidv4() : curItem?.value,
      unit: request ? newItem?.unit_name : curItem?.unit,
      quantity: request
        ? parseFloat(newItem?.quantity)
        : parseFloat(curItem?.quantity),
      category: request ? curCategory?.value : curItem?.category,
      tax: request ? curCategory?.tax : curItem?.tax,
      comment: request ? newItem?.comment : curItem?.comment,
      status: request ? "Request" : "Pending",
    };
    // Check if item exists in the current list
    const isDuplicate = curProcList.some(
      (item) => item?.name === itemToAdd.name
    );

    if (!isDuplicate) {
      // Check if the stack has this item and remove it
      const itemInStackIndex = stack.findIndex(
        (stackItem) => stackItem?.name === itemToAdd.name
      );

      if (itemInStackIndex > -1) {
        stack.splice(itemInStackIndex, 1);
        setStack([...stack]); // Update stack state after removal
      }

      // const isDuplicate = selectedCategories.some(category => (category.name === curCategory?.value && category.status === itemToAdd.status));
      // if (!isDuplicate) {
      //     setSelectedCategories([...selectedCategories, {"name" : curCategory?.value, "status" : itemToAdd?.status}])
      // }

      // if(selectedCategories?.every((i) => (i?.name !== curCategory?.value && i?.status !== itemToAdd?.status))) {
      //     setSelectedCategories([...selectedCategories, {"name" : curCategory?.value, "status" : itemToAdd?.status}])
      // }

      // Add item to the current request list
      curProcList.push(itemToAdd);
      setProcList(curProcList);

      toast({
        title: `${request ? "Request " : ""}Item: ${curItem?.label} added!`,
        variant: "success",
      });

    } else {
      toast({
        title: "Invalid Request!",
        description: (
          <span>
            You are trying to add the <strong>item: {curItem?.label}</strong> multiple
            times which is not allowed, instead edit the quantity directly!
          </span>
        ),
      });
    }

    setCurCategory("")

    if (request) {
      setNewItem({});
      setFuzzyMatches([]);
      toggleNewItemDialog();
    } else {
      setCurItem("");
    }

  };

  const handleDeleteItem = (item: string) => {
    let curRequest = procList;
    let itemToPush = curRequest.find((curValue) => curValue.name === item);

    setStack((prevStack) => [...prevStack, itemToPush]);
    curRequest = curRequest.filter((curValue) => curValue.name !== item);
    setProcList(curRequest);
  };

  const UndoDeleteOperation = () => {
    let curRequest = procList;
    let itemToRestore = stack.pop();

    curRequest.push(itemToRestore);

    setProcList(curRequest);
    // if (selectedCategories?.every((i) => i?.name !== itemToRestore?.category)) {
    //     setSelectedCategories([...selectedCategories, { name: itemToRestore?.category }]);
    // }

    const newCategories = [];

    curRequest.map((item) => {
      const isDuplicate = newCategories.some(
        (category) =>
          category.name === item?.category && category.status === item.status
      );
      if (!isDuplicate) {
        newCategories.push({ name: item.category, status: item.status });
      }
    });

    setSelectedCategories(newCategories);

    setStack([...stack]);
  };

  const handleSubmit = async () => {
    if (
      userData?.role === "Nirmaan Project Manager Profile" ||
      userData?.role === "Nirmaan Admin Profile" ||
      userData?.role === "Nirmaan Procurement Executive Profile" ||
      userData?.role === "Nirmaan Project Lead Profile"
    ) {
      try {
        const res = await createDoc("Procurement Requests", {
          project: projectId,
          work_package: selectedWP,
          category_list: { list: selectedCategories },
          procurement_list: { list: procList },
        });

        if (newPRComment) {
          await createDoc("Nirmaan Comments", {
            comment_type: "Comment",
            reference_doctype: "Procurement Requests",
            reference_name: res.name,
            comment_by: userData?.user_id,
            content: newPRComment,
            subject: "creating pr",
          });
        }
        // console.log("newPR", res);
        await mutate(`Procurement Requests ${projectId}`);
        await mutate(`Procurement Orders ${projectId}`);

        toast({
          title: "Success!",
          description: `New PR: ${res?.name} created successfully!`,
          variant: "success",
        });

        navigate("/prs&milestones/procurement-requests");
      } catch (error) {
        console.log("submit_error", error);

        toast({
          title: "Failed!",
          description: `PR Creation failed!`,
          variant: "destructive",
        });
      }
    }
  };

  const handleResolve = async () => {
    try {
      const res = await updateDoc("Procurement Requests", prId, {
        category_list: { list: selectedCategories },
        procurement_list: { list: procList },
        workflow_state: "Pending",
      });

      if (newPRComment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Procurement Requests",
          reference_name: prId,
          comment_by: userData?.user_id,
          content: newPRComment,
          subject: edit ? "editing pr" : "resolving pr",
        });
      }
      // console.log("newPR", res)
      await mutate(`Procurement Requests ${res?.project}`);
      await mutate(`Procurement Orders ${res?.project}`);
      await mutate(`Procurement Requests ${prId}`);
      await mutate(`Nirmaan Comments ${prId}`);

      navigate(`/prs&milestones/procurement-requests/${prId}`);

      toast({
        title: "Success!",
        description: `PR: ${prId} Resolved successfully and Sent for Approval!`,
        variant: "success",
      });
    } catch (error) {
      console.log(`Error while resolving Rejected PR`, error, update_error);
      toast({
        title: "Failed!",
        description: `Resolving PR: ${prId} Failed!`,
        variant: "destructive",
      });
    }
  };

  const handleAddItem = async () => {
    try {
      const itemData = { item_name: newItem.item_name, unit_name: newItem.unit_name, category: curCategory.value };

      const res = await createDoc("Items", itemData);

      const curProcList = [...procList];
      const itemToAdd = {
        item: res?.item_name,
        name: res?.name,
        unit: res?.unit_name,
        quantity: parseFloat(newItem?.quantity),
        category: res.category,
        tax: curCategory?.tax,
        comment: newItem?.comment,
        status: "Pending",
      };

      curProcList.push(itemToAdd);

      setProcList(curProcList);

      await item_list_mutate();

      setNewItem({});

      toggleNewItemDialog();

      toast({
        title: "Success!",
        description: `New Item: ${res?.item_name} created and added to Order List successfully!`,
        variant: "success",
      });
    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: `Item Creation failed!`,
        variant: "destructive",
      });
    }
  };

  const handleCancelDraft = async () => {
    try {
      await updateDoc("Procurement Requests", prId, {
        workflow_state: "Pending",
      });

      await mutate(`Procurement Requests ${prId}`);

      navigate(-1);

      toast({
        title: "Success!",
        description: `PR: ${prId} Draft Cancelled!`,
        variant: "success",
      });
    } catch (error) {
      console.log("error while cancelling pr draft", error);
      toast({
        title: "Failed!",
        description: `PR: ${prId} Draft Cancellation failed!`,
        variant: "destructive",
      });
    }
  };

  const fuse = new Fuse(item_list, {
    keys: ["item_name"], // Fields to search
    threshold: 0.3, // Lower threshold for stricter matches
    distance: 100, // Maximum distance for matching
    includeScore: true, // Include scores for sorting
  });

  const handleFuzzySearch = (input) => {
    if (!input.trim()) {
      setFuzzyMatches([]);
      return;
    }

    const results = fuse.search(input);
    if (results.length > 0) {
      const matches = results.map((result) => ({
        ...result.item,
        matchPercentage: Math.round((1 - result.score) * 100), // Convert score to percentage
      }));
      setFuzzyMatches(matches);
    } else {
      setFuzzyMatches([]);
    }
  };

  //   console.log("fuzzyMatches", fuzzyMatches);
  // console.log("selectedCategories", selectedCategories)

  // console.log("curItem", curItem);

  // console.log("curCategory", curCategory);

  // console.log("procList", procList);

  // console.log("editItem", editItem)

  // console.log("comments", universalComments)

  return (
    <div className="flex-1 space-y-4 px-4">
      {page === "wp-selection" && !selectedWP && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {wp_list
            ?.filter((item) => {
              let wp_arr = JSON.parse(
                project?.project_work_packages || "[]"
              )?.work_packages?.map((item) => item.work_package_name);
              if (
                item.work_package_name === "Tool & Equipments" ||
                wp_arr?.includes(item.work_package_name)
              )
                return true;
            })
            .map((item) => (
              <Card
                className="flex flex-col items-center shadow-none text-center border border-grey-500 hover:animate-shadow-drop-center"
                onClick={() => {
                  setSelectedWP(item?.work_package_name);
                  setPage("item-selection");
                }}
              >
                <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                  <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                    <img
                      className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0"
                      src={
                        item.work_package_image === null
                          ? imageUrl
                          : item.work_package_image
                      }
                      alt="Project"
                    />
                    <span>{item.work_package_name}</span>
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
        </div>
      )}

      {page === "item-selection" && selectedWP && (
        <>
          {edit && (
            <div>
              <Alert variant="warning" className="">
                <AlertTitle className="text-sm flex items-center gap-2">
                  <MessageCircleWarning className="h-4 w-4 text-sm" />
                  Heads Up
                </AlertTitle>
                <AlertDescription className="py-2 px-2 flex justify-between items-center text-xs">
                  <span className="mr-2">
                    This PR is now marked as "Draft", please either cancel or
                    update!
                  </span>
                  <Button
                    disabled={updateLoading}
                    onClick={handleCancelDraft}
                    className="flex items-center gap-2"
                  >
                    {updateLoading ? (
                      <TailSpin width={20} height={16} color="white" />
                    ) : (
                      <>
                        <CircleX className="w-4 h-4" />
                        <span>Cancel Draft</span>
                      </>
                    )}
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h3 className="max-sm:text-xs font-semibold text-gray-400">
                Package
              </h3>
              <div className="">
                <span className="font-semibold max-sm:text-xs">
                  {selectedWP}
                </span>
                {!edit && !resolve && (
                  <Dialog>
                    <DialogTrigger>
                      <Pencil className="inline-block ml-1 cursor-pointer underline w-4 h-4 text-blue-600" />
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                      <DialogHeader>
                        <DialogTitle>Reset Order List?</DialogTitle>
                        <DialogDescription>
                          Going back to work package selection will clear your
                          current order list. Are you sure?
                        </DialogDescription>
                      </DialogHeader>
                      <DialogDescription className="flex items-center justify-center gap-2">
                        <Button
                          onClick={() => {
                            setPage("wp-selection");
                            setSelectedWP("");
                            setProcList([]);
                            setSelectedCategories([]);
                            setCurCategory("");
                            setCurItem("");
                          }}
                        >
                          Yes
                        </Button>
                        <DialogClose asChild>
                          <Button variant={"outline"}>No</Button>
                        </DialogClose>
                      </DialogDescription>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
            <div className="w-[60%] max-sm:text-sm hidden">
              <ReactSelect
                isDisabled={!selectedWP}
                value={curCategory}
                options={catOptions}
                onChange={(e) => {
                  setCurItem("");
                  setCurCategory(e);
                }}
                isClearable
              />
            </div>
          </div>
          <ReactSelect
            value={curItem}
            isDisabled={!selectedWP}
            options={itemOptions}
            onChange={(e) => setCurItem(e)}
            components={{ MenuList: CustomMenuList }}
            onAddItemClick={toggleNewItemDialog}
            // onRequestItemClick={toggleRequestItemDialog}
            // isNewItemsCreationDisabled={
            //   category_list?.find((i) => i?.name === curCategory?.value)
            //     ?.new_items === "false" &&
            //     !["Nirmaan Admin Profile"].includes(userData?.role)
            //     ? true
            //     : false
            // }
            isClearable
            onMenuOpen={() => setCurItem(null)}
          />
          <div className="flex items-center gap-4">
            <div className="w-1/2">
              <h3 className="max-sm:text-xs font-semibold text-gray-400">
                Comment
              </h3>
              <Input
                type="text"
                value={curItem?.comment || ""}
                onChange={handleCommentChange}
                disabled={!curItem}
              />
            </div>
            <div className="flex-1">
              <h3 className="max-sm:text-xs font-semibold text-gray-400">
                Unit
              </h3>
              <Input type="text" disabled value={curItem?.unit || ""} />
            </div>
            <div className="flex-1">
              <h3 className="max-sm:text-xs font-semibold text-gray-400">
                Qty<sup className="text-sm text-red-600">*</sup>
              </h3>
              <Input
                type="number"
                value={curItem?.quantity || ""}
                onChange={handleQuantityChange}
                disabled={!curItem}
              />
            </div>
          </div>
          <Button
            onClick={() => handleAddNewItem()}
            disabled={!curItem?.quantity}
            variant={"outline"}
            className="w-full border border-primary text-primary"
          >
            Add Item
          </Button>
          <div className="flex flex-col justify-between h-[58vh]">
            <div
              className={`${universalComments?.length > 0
                ? "max-h-[40vh]"
                : "max-h-[60vh]"
                } overflow-y-auto`}
            >
              <div className="flex justify-between items-center max-md:py-2 py-4">
                <h2 className="font-semibold">Order List</h2>
                {stack.length !== 0 && (
                  <div className="flex items-center space-x-2">
                    <HoverCard>
                      <HoverCardTrigger>
                        <button
                          onClick={() => UndoDeleteOperation()}
                          className="flex items-center max-md:text-sm max-md:px-2 max-md:py-1  px-4 py-2 bg-blue-500 text-white font-semibold rounded-full shadow-md hover:bg-blue-600 transition duration-200 ease-in-out"
                        >
                          <Undo className="mr-2 max-md:w-4 max-md:h-4" />{" "}
                          {/* Undo Icon */}
                          Undo
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent className="bg-gray-800 text-white p-2 rounded-md shadow-lg mr-[100px]">
                        Click to undo the last deleted operation
                      </HoverCardContent>
                    </HoverCard>
                  </div>
                )}
              </div>

              {procList?.length === 0 && (
                <div
                  className={`h-[35vh] flex items-center justify-center font-bold`}
                >
                  Empty!
                </div>
              )}

              <div

              >
                {
                  // procList.length !== 0 ? (
                  selectedCategories?.filter((i) => i?.status !== "Request")
                    ?.length !== 0 &&
                  selectedCategories
                    ?.filter((i) => i?.status !== "Request")
                    ?.map((cat, index) => {
                      return (
                        <div key={index} className="mb-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4 ml-4">
                              <div className="flex items-center gap-2">
                                <div className="w-1 h-1 rounded-full bg-black" />
                                <p className="text-sm font-semibold">
                                  {index > 9 ? "" : 0}
                                  {index + 1}
                                </p>
                              </div>
                              <h3 className="text-sm font-semibold py-2">
                                {cat.name}
                              </h3>
                            </div>

                            {/* {category_make_list?.filter(i => i?.category === cat?.name)?.length > 0 ? (
                            category_make_list?.filter(i => i?.category === cat?.name)?.map((i, index, arr) => (
                              <i>{i?.make}{index < arr.length - 1 && ", "}</i>
                            ))
                          ) : "--"} */}
                          </div>

                          <table className="table-auto w-full">
                            <thead>
                              <tr className="bg-gray-200">
                                <th className="w-[60%] text-left px-4 py-1 text-xs">
                                  Item Name
                                </th>
                                <th className="w-[20%] px-4 py-1 text-xs text-center">
                                  Unit
                                </th>
                                <th className="w-[10%] px-4 py-1 text-xs text-center">
                                  Qty
                                </th>
                                <th className="w-[10%] px-4 py-1 text-xs text-center">
                                  Edit
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {procList?.map((item) => {
                                if (
                                  item.category === cat?.name &&
                                  item?.status !== "Request"
                                ) {
                                  return (
                                    <tr key={item.name}>
                                      <td className="w-[60%] text-left border-b-2 px-4 py-1 text-sm">
                                        {item.item}
                                        {item?.comment && (
                                          <div className="flex gap-1 items-start block border rounded-md p-1 md:w-[60%]">
                                            <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                                            <div className="text-xs ">
                                              {item.comment}
                                            </div>
                                          </div>
                                        )}
                                      </td>
                                      <td className="w-[20%] border-b-2 px-4 py-1 text-sm text-center">
                                        {item.unit}
                                      </td>
                                      <td className="w-[10%] border-b-2 px-4 py-1 text-sm text-center">
                                        {item.quantity}
                                      </td>
                                      <td className="w-[10%] border-b-2 px-4 py-1 text-sm text-center">
                                        <AlertDialog>
                                          <AlertDialogTrigger
                                            onClick={() =>
                                              setEditItem({
                                                name: item.name,
                                                quantity: item?.quantity,
                                                comment: item?.comment,
                                                unit: item?.unit,
                                                item: item.item,
                                                category: item?.category,
                                              })
                                            }
                                          >
                                            <Pencil className="w-4 h-4 text-black" />
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle className="flex justify-between items-center">
                                                Edit Item
                                                <AlertDialogCancel className="border-none shadow-none p-0">
                                                  X
                                                </AlertDialogCancel>
                                              </AlertDialogTitle>
                                              <AlertDialogDescription className="flex flex-col gap-2">
                                                <div className="flex space-x-2">
                                                  <div className="w-1/2 md:w-2/3">
                                                    <h5 className="text-base text-gray-400 text-left mb-1">
                                                      Item Name
                                                    </h5>
                                                    <div className="w-full  p-1 text-left">
                                                      {item.item}
                                                    </div>
                                                  </div>
                                                  <div className="w-[30%]">
                                                    <h5 className="text-base text-gray-400 text-left mb-1">
                                                      UOM
                                                    </h5>
                                                    <div className=" w-full  p-2 text-center justify-left flex">
                                                      {item.unit}
                                                    </div>
                                                  </div>
                                                  <div className="w-[25%]">
                                                    <h5 className="text-base text-gray-400 text-left mb-1">
                                                      Qty
                                                    </h5>
                                                    <Input
                                                      type="number"
                                                      value={
                                                        editItem?.quantity ||
                                                        ""
                                                      }
                                                      onChange={(e) =>
                                                        setEditItem({
                                                          ...editItem,
                                                          quantity:
                                                            e.target.value ===
                                                              ""
                                                              ? 0
                                                              : parseFloat(
                                                                e.target
                                                                  .value
                                                              ),
                                                        })
                                                      }
                                                    />
                                                  </div>
                                                </div>
                                                <div className="flex gap-1 items-center pt-1">
                                                  <MessageCircleMore className="h-8 w-8" />
                                                  <textarea
                                                    // disabled={userData?.role === "Nirmaan Project Manager Profile"}
                                                    className="block p-2 border-gray-300 border rounded-md w-full"
                                                    placeholder="Add comment..."
                                                    value={
                                                      editItem?.comment || ""
                                                    }
                                                    onChange={(e) =>
                                                      setEditItem({
                                                        ...editItem,
                                                        comment:
                                                          e.target.value,
                                                      })
                                                    }
                                                  />
                                                </div>
                                              </AlertDialogDescription>
                                              <AlertDialogDescription className="flex justify-end">
                                                <div className="flex gap-2">
                                                  <AlertDialogAction
                                                    onClick={() =>
                                                      handleDeleteItem(
                                                        editItem.name
                                                      )
                                                    }
                                                    className="bg-gray-100 text-black hover:text-white flex items-center gap-1"
                                                  >
                                                    <Trash2 className="h-4 w-4" />
                                                    Delete
                                                  </AlertDialogAction>
                                                  <AlertDialogAction
                                                    className="flex items-center gap-1"
                                                    disabled={
                                                      !editItem?.quantity
                                                    }
                                                    onClick={() =>
                                                      handleUpdateItem(
                                                        editItem.name
                                                      )
                                                    }
                                                  >
                                                    <ListChecks className="h-4 w-4" />
                                                    Update
                                                  </AlertDialogAction>
                                                </div>
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      </td>
                                    </tr>
                                  );
                                }
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    })
                }
                {
                  // procList.length !== 0 ? (
                  selectedCategories?.filter((i) => i?.status === "Request")
                    ?.length !== 0 && (
                    <div className="bg-yellow-50">
                      <h2 className="font-semibold">Requested Items</h2>
                      {selectedCategories
                        ?.filter((i) => i?.status === "Request")
                        ?.map((cat, index) => {
                          return (
                            <div key={index} className="mb-4">
                              <div className="flex items-center gap-4 ml-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-1 h-1 rounded-full bg-black" />
                                  <p className="text-sm font-semibold">
                                    {index > 9 ? "" : 0}
                                    {index + 1}
                                  </p>
                                </div>
                                <h3 className="text-sm font-semibold py-2">
                                  {cat.name}
                                </h3>
                              </div>
                              <table className="table-auto w-full">
                                <thead>
                                  <tr className="bg-gray-200">
                                    <th className="w-[60%] text-left px-4 py-1 text-xs">
                                      Item Name
                                    </th>
                                    <th className="w-[20%] px-4 py-1 text-xs text-center">
                                      Unit
                                    </th>
                                    <th className="w-[10%] px-4 py-1 text-xs text-center">
                                      Qty
                                    </th>
                                    <th className="w-[10%] px-4 py-1 text-xs text-center">
                                      Edit
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {procList?.map((item) => {
                                    if (
                                      item.category === cat?.name &&
                                      item?.status === "Request"
                                    ) {
                                      return (
                                        <tr
                                          key={item.name}
                                          className="bg-yellow-50"
                                        >
                                          <td className="w-[60%] text-left border-b-2 px-4 py-1 text-sm">
                                            {item.item}
                                            {item?.comment && (
                                              <div className="flex gap-1 items-start block border rounded-md p-1 md:w-[60%]">
                                                <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                                                <div className="text-xs ">
                                                  {item.comment}
                                                </div>
                                              </div>
                                            )}
                                          </td>
                                          <td className="w-[20%] border-b-2 px-4 py-1 text-sm text-center">
                                            {item.unit}
                                          </td>
                                          <td className="w-[10%] border-b-2 px-4 py-1 text-sm text-center">
                                            {item.quantity}
                                          </td>
                                          <td className="w-[10%] border-b-2 px-4 py-1 text-sm text-center">
                                            <AlertDialog>
                                              <AlertDialogTrigger
                                                onClick={() =>
                                                  setEditItem({
                                                    category: item?.category,
                                                    name: item.name,
                                                    item: item.item,
                                                    quantity: item?.quantity,
                                                    comment:
                                                      item?.comment || "",
                                                    unit: item?.unit,
                                                  })
                                                }
                                              >
                                                <Pencil className="w-4 h-4 text-black" />
                                              </AlertDialogTrigger>
                                              <AlertDialogContent>
                                                <AlertDialogHeader>
                                                  <AlertDialogTitle className="flex justify-between items-center">
                                                    Edit Item
                                                    <AlertDialogCancel className="border-none shadow-none p-0">
                                                      X
                                                    </AlertDialogCancel>
                                                  </AlertDialogTitle>
                                                  <AlertDialogDescription className="flex flex-col gap-2">
                                                    <div className="w-full">
                                                      <h5 className="text-base text-gray-400 text-left mb-1">
                                                        Category
                                                      </h5>
                                                      <Select
                                                        value={editItem?.category || ""}
                                                        onValueChange={(
                                                          value
                                                        ) =>
                                                          setEditItem(
                                                            (prev) => ({
                                                              ...prev,
                                                              category: value,
                                                            })
                                                          )
                                                        }
                                                      >
                                                        <SelectTrigger className="">
                                                          <SelectValue
                                                            className="text-gray-200"
                                                            placeholder="Select Category"
                                                          />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                          {category_list?.map(
                                                            (item) => (
                                                              <SelectItem
                                                                value={
                                                                  item.category_name
                                                                }
                                                              >
                                                                {
                                                                  item.category_name
                                                                }
                                                              </SelectItem>
                                                            )
                                                          )}
                                                        </SelectContent>
                                                      </Select>
                                                    </div>
                                                    <div className="flex space-x-2">
                                                      <div className="w-1/2 md:w-2/3">
                                                        <h5 className="text-base text-gray-400 text-left mb-1">
                                                          Item Name
                                                        </h5>
                                                        <Input
                                                          value={editItem?.item}
                                                          onChange={(e) =>
                                                            setEditItem(
                                                              (prev) => ({
                                                                ...prev,
                                                                item: e.target
                                                                  .value,
                                                              })
                                                            )
                                                          }
                                                        />
                                                      </div>
                                                      <div className="w-[30%]">
                                                        <h5 className="text-base text-gray-400 text-left mb-1">
                                                          UOM
                                                        </h5>
                                                        <SelectUnit
                                                          value={editItem?.unit || ""}
                                                          onChange={(value) => setEditItem(
                                                            (prev) => ({
                                                              ...prev,
                                                              unit: value,
                                                            })
                                                          )}
                                                        />
                                                      </div>
                                                      <div className="w-[25%]">
                                                        <h5 className="text-base text-gray-400 text-left mb-1">
                                                          Qty
                                                        </h5>
                                                        <Input
                                                          type="number"
                                                          value={
                                                            editItem?.quantity ||
                                                            ""
                                                          }
                                                          onChange={(e) =>
                                                            setEditItem({
                                                              ...editItem,
                                                              quantity:
                                                                e.target
                                                                  .value === ""
                                                                  ? 0
                                                                  : parseFloat(
                                                                    e.target
                                                                      .value
                                                                  ),
                                                            })
                                                          }
                                                        />
                                                      </div>
                                                    </div>
                                                    <div className="flex gap-1 items-center pt-1">
                                                      <MessageCircleMore className="h-8 w-8" />
                                                      <textarea
                                                        // disabled={userData?.role === "Nirmaan Project Manager Profile"}
                                                        className="block p-2 border-gray-300 border rounded-md w-full"
                                                        placeholder="Add comment..."
                                                        value={
                                                          editItem?.comment ||
                                                          ""
                                                        }
                                                        onChange={(e) =>
                                                          setEditItem({
                                                            ...editItem,
                                                            comment:
                                                              e.target.value,
                                                          })
                                                        }
                                                      />
                                                    </div>
                                                  </AlertDialogDescription>
                                                  <AlertDialogDescription className="flex justify-end">
                                                    <div className="flex gap-2">
                                                      <AlertDialogAction
                                                        onClick={() =>
                                                          handleDeleteItem(
                                                            editItem.name
                                                          )
                                                        }
                                                        className="bg-gray-100 text-black hover:text-white flex items-center gap-1"
                                                      >
                                                        <Trash2 className="h-4 w-4" />
                                                        Delete
                                                      </AlertDialogAction>
                                                      <AlertDialogAction
                                                        className="flex items-center gap-1"
                                                        disabled={
                                                          !editItem?.quantity ||
                                                          !editItem?.category ||
                                                          !editItem?.unit ||
                                                          !editItem?.item
                                                        }
                                                        onClick={() =>
                                                          handleUpdateItem(
                                                            editItem.name
                                                          )
                                                        }
                                                      >
                                                        <ListChecks className="h-4 w-4" />
                                                        Update
                                                      </AlertDialogAction>
                                                    </div>
                                                  </AlertDialogDescription>
                                                </AlertDialogHeader>
                                              </AlertDialogContent>
                                            </AlertDialog>
                                          </td>
                                        </tr>
                                      );
                                    }
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                    </div>
                  )
                }
              </div>
            </div>
            <div>
              {(resolve || edit) && universalComments?.length > 0 && (
                <Card className="flex flex-col items-start shadow-none border border-grey-500 p-3 mt-2">
                  <h3 className="font-bold flex items-center gap-1">
                    <MessageCircleMore className="w-5 h-5" />
                    Previous Comments
                  </h3>
                  {universalComments
                    ?.filter(
                      (comment) =>
                        comment?.subject ===
                        (resolve ? "rejecting pr" : "creating pr")
                    )
                    ?.map((cmt) => (
                      <div
                        key={cmt.name}
                        className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg w-full"
                      >
                        <Avatar>
                          <AvatarImage
                            src={`https://api.dicebear.com/6.x/initials/svg?seed=${cmt.comment_by}`}
                          />
                          <AvatarFallback>{cmt.comment_by[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="font-medium text-sm text-gray-900">
                            {cmt.content}
                          </p>
                          <div className="flex justify-between items-center mt-2">
                            <p className="text-sm text-gray-500">
                              {cmt.comment_by === "Administrator"
                                ? "Administrator"
                                : getFullName(cmt.comment_by)}
                            </p>
                            <p className="text-xs text-gray-400">
                              {formatDate(cmt.creation.split(" ")[0])}{" "}
                              {cmt.creation.split(" ")[1].substring(0, 5)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                </Card>
              )}
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    disabled={!procList.length}
                    variant={`${!procList.length ? "secondary" : "destructive"
                      }`}
                    className="w-full my-2"
                  >
                    <div className="flex items-center gap-1">
                      <ListChecks className="h-4 w-4" />
                      {resolve ? "Resolve" : edit ? "Update" : "Submit"}
                    </div>
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Are you Sure?</DialogTitle>
                    <DialogDescription>
                      {resolve
                        ? "Click on Confirm to resolve and send the PR for Approval"
                        : edit
                          ? "Click on Confirm to update and send the PR for Approval"
                          : "If there is any pending PR created by you with the same Project & Package, then the older PRs will be merged with this PR. Are you sure you want to continue?"}
                    </DialogDescription>
                  </DialogHeader>
                  <textarea
                    className="w-full border rounded-lg p-2 min-h-12"
                    placeholder={`${resolve
                      ? "Write Resolving Comments here..."
                      : edit
                        ? "Write Editing Comments here..."
                        : "Write Comments here..."
                      }`}
                    value={newPRComment}
                    onChange={(e) => setNewPRComment(e.target.value)}
                  />
                  <DialogDescription className="flex justify-center">
                    {resolve || edit ? (
                      updateLoading || createLoading ? (
                        <TailSpin width={60} color={"red"} />
                      ) : (
                        <Button
                          onClick={handleResolve}
                          className="flex items-center gap-1"
                        >
                          <CheckCheck className="h-4 w-4" />
                          Confirm
                        </Button>
                      )
                    ) : createLoading ? (
                      <TailSpin width={60} color={"red"} />
                    ) : (
                      <Button
                        onClick={handleSubmit}
                        className="flex items-center gap-1"
                      >
                        <CheckCheck className="h-4 w-4" />
                        Confirm
                      </Button>
                    )}
                  </DialogDescription>

                  {/* <DialogClose className="hidden" id="dialogCloseforNewPR">Close</DialogClose> */}
                </DialogContent>
              </Dialog>

              <AlertDialog open={open} onOpenChange={toggleNewItemDialog}>
                <AlertDialogContent>
                  <AlertDialogHeader className="text-start">
                    <AlertDialogTitle>
                      Create/Request New{" "}
                      <strong className="text-primary">{selectedWP}</strong>{" "}
                      Item
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="curCategory"
                            className="block text-sm font-medium text-gray-700"
                          >
                            Category
                            <sup className="text-sm text-red-600">*</sup>
                          </label>
                          <ReactSelect
                            isDisabled={!selectedWP}
                            value={curCategory}
                            options={catOptions}
                            onChange={(e) => {
                              setCurCategory(e);
                            }}
                            isClearable
                            onMenuOpen={() => setCurCategory(null)}

                          />
                          {isNewItemsDisabled && <p className="text-red-500 text-sm">New Items Creation is disabled for this category, proceed to request item instead!</p>}
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="itemName"
                            className="block text-sm font-medium text-gray-700"
                          >
                            Item Name
                            <sup className="text-sm text-red-600">*</sup>
                          </label>
                          <Input
                            type="text"
                            id="itemName"
                            disabled={!curCategory}
                            value={newItem?.item_name || ""}
                            onChange={(e) => {
                              setNewItem((prevState) => ({
                                ...prevState,
                                item_name: e.target.value,
                              }))
                              handleFuzzySearch(e.target.value);
                            }
                            }
                            autoComplete="off"
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                          />
                        </div>
                        {fuzzyMatches.length > 0 && isFocused && (
                          <div className="relative">
                            <ul className="absolute z-10 bg-white border border-gray-300 rounded-md shadow-lg max-h-40 w-full overflow-y-auto">
                              {fuzzyMatches.slice(0, 5).map((item, index) => (
                                <li
                                  key={`${item.name}-${index}`}
                                  className="p-2 hover:bg-gray-100 flex justify-between items-center"
                                >

                                  <div className="flex flex-col gap-1">
                                    <strong>{item?.item_name}</strong>

                                    <div className="flex items-center gap-2">
                                      <p className="text-gray-400 font-semibold">{item?.category}</p>
                                      <i className="text-gray-500">
                                        {" "}
                                        - {item?.matchPercentage}% match
                                      </i>
                                    </div>

                                  </div>
                                  <div
                                    onMouseDown={() => {
                                      setCurItem({
                                        label: item.item_name,
                                        value: item?.name,
                                        unit: item?.unit_name,
                                        category: item?.category,
                                        tax: parseFloat(
                                          category_list?.find(
                                            (i) => i?.name === item?.category
                                          )?.tax)
                                      });
                                      toggleNewItemDialog();
                                    }}
                                    className="text-primary bg-gray-300 hover:bg-white rounded-md p-2 font-bold text-xs cursor-pointer flex items-center gap-1">
                                    <CirclePlus className="w-4 h-4" />
                                    Add
                                  </div>
                                  {/* <span>
                                  <strong>{item.item_name}</strong>
                                  <span className="text-gray-500">
                                    {" "}
                                    - {item.matchPercentage}% match
                                  </span>
                                </span>
                                {item.matchPercentage > 60 && index === 0 && (
                                  <div className="flex items-center gap-2 px-2 py-1 bg-blue-100 rounded-md shadow">
                                    <Sparkles className="w-4 h-4" />
                                    <p className="text-blue-700">
                                      <strong>Recommended</strong>
                                    </p>
                                  </div>
                                )} */}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="flex gap-2 items-center">
                          <div className="flex flex-col gap-1 w-1/2">
                            <label
                              htmlFor="itemUnit"
                              className="block text-sm font-medium text-gray-700"
                            >
                              Item Unit
                              <sup className="text-sm text-red-600">*</sup>
                            </label>
                            <SelectUnit
                              value={newItem?.unit_name || ""}
                              disabled={!curCategory}
                              onChange={(value) =>
                                setNewItem((prevState) => ({
                                  ...prevState,
                                  unit_name: value,
                                }))
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-1 w-1/2 items-start">
                            <label
                              htmlFor="quantity"
                              className="block text-sm font-medium text-gray-700"
                            >
                              Quantity
                              <sup className="text-sm text-red-600">*</sup>
                            </label>
                            <Input
                              disabled={!curCategory}
                              type="number"
                              id="quantity"
                              onChange={(e) =>
                                setNewItem((prevState) => ({
                                  ...prevState,
                                  quantity: e.target.value,
                                }))
                              }
                              value={newItem?.quantity || ""}
                            />
                          </div>
                        </div>
                        <div className="w-full flex flex-col gap-1">
                          <h3>Comment</h3>
                          <Input
                            type="text"
                            placeholder="Optional"
                            value={newItem?.comment || ""}
                            onChange={(e) =>
                              setNewItem((prev) => ({
                                ...prev,
                                comment: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="flex gap-2 justify-end items-center">
                    {isNewItemsDisabled ? (
                      <>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <Button
                          disabled={!curCategory || !newItem?.item_name || !newItem?.unit_name || !newItem?.quantity}
                          variant={"default"}
                          onClick={() => handleAddNewItem(true)}
                          className=" flex items-center gap-1"
                        >
                          <ListChecks className="h-4 w-4" /> Request
                        </Button>
                      </>
                    ) : (
                      createLoading ? (
                        <TailSpin width={30} height={30} color={"red"} />
                      ) : (
                        <>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <Button
                            disabled={!curCategory || !newItem?.item_name || !newItem?.unit_name || !newItem?.quantity}
                            variant={"default"}
                            onClick={handleAddItem}
                            className=" flex items-center gap-1"
                          >
                            <ListChecks className="h-4 w-4" /> Create
                          </Button>
                        </>
                      )
                    )}
                  </div>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog open={requestItemDialogOpen} onOpenChange={toggleRequestItemDialog}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex justify-between">
                      Request New Item
                    </AlertDialogTitle>
                    <AlertDialogDescription className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1 items-start">
                        <label
                          htmlFor="itemName"
                          className="block text-sm font-medium text-gray-700"
                        >
                          Item Name
                          <sup className="text-sm text-red-600">*</sup>
                        </label>
                        <Input
                          type="text"
                          id="itemName"
                          autoComplete="off"
                          value={requestItem?.name || ""}
                          onFocus={() => setIsFocused(true)}
                          onBlur={() => setIsFocused(false)}
                          onChange={(e) => {
                            setRequestItem((prevState) => ({
                              ...prevState,
                              name: e.target.value,
                            }));
                            handleFuzzySearch(e.target.value);
                          }}
                        />
                      </div>

                      {fuzzyMatches.length > 0 && isFocused && (
                        <div className="relative">
                          <ul className="absolute z-10 bg-white border border-gray-300 rounded-md shadow-lg max-h-40 w-full overflow-y-auto">
                            {fuzzyMatches.slice(0, 5).map((item, index) => (
                              <li
                                key={item.item_name}
                                className="p-2 hover:bg-gray-100 flex justify-between items-center"
                              // onMouseDown={() => {
                              //   setCurCategory({
                              //     label: item?.category,
                              //     value: item?.category,
                              //     tax: parseFloat(
                              //       category_list?.find(
                              //         (i) => i?.name === item?.category
                              //       )?.tax
                              //     ),
                              //   });
                              //   setCurItem({
                              //     label: item.item_name,
                              //     value: item?.name,
                              //     unit: item?.unit_name,
                              //   });
                              //   toggleRequestItemDialog();
                              // }}
                              >

                                <div className="flex flex-col gap-1">
                                  <strong>{item?.item_name}</strong>

                                  <div className="flex items-center gap-2">
                                    <p className="text-gray-400 font-semibold">{item?.category}</p>
                                    <i className="text-gray-500">
                                      {" "}
                                      - {item?.matchPercentage}% match
                                    </i>
                                  </div>

                                </div>

                                <div
                                  onMouseDown={() => {
                                    setCurCategory({
                                      label: item?.category,
                                      value: item?.category,
                                      tax: parseFloat(
                                        category_list?.find(
                                          (i) => i?.name === item?.category
                                        )?.tax
                                      ),
                                    });
                                    setCurItem({
                                      label: item.item_name,
                                      value: item?.name,
                                      unit: item?.unit_name,
                                    });
                                    toggleRequestItemDialog();
                                  }}
                                  className="text-primary bg-gray-300 hover:bg-white rounded-md p-2 font-bold text-xs cursor-pointer flex items-center gap-1">
                                  <CirclePlus className="w-4 h-4" />
                                  Add
                                </div>
                                {/* <span>
                                  <strong>{item.item_name}</strong>
                                  <span className="text-gray-500">
                                    {" "}
                                    - {item.matchPercentage}% match
                                  </span>
                                </span>
                                {item.matchPercentage > 60 && index === 0 && (
                                  <div className="flex items-center gap-2 px-2 py-1 bg-blue-100 rounded-md shadow">
                                    <Sparkles className="w-4 h-4" />
                                    <p className="text-blue-700">
                                      <strong>Recommended</strong>
                                    </p>
                                  </div>
                                )} */}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-1 w-1/2 items-start">
                          <label
                            htmlFor="itemUnit"
                            className="block text-sm font-medium text-gray-700"
                          >
                            Item Unit
                            <sup className="text-sm text-red-600">*</sup>
                          </label>

                          <SelectUnit
                            value={requestItem?.unit || ""}
                            onChange={(value) =>
                              setRequestItem((prevState) => ({
                                ...prevState,
                                unit: value,
                              }))
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1 w-1/2 items-start">
                          <label
                            htmlFor="quantity"
                            className="block text-sm font-medium text-gray-700"
                          >
                            Quantity
                            <sup className="text-sm text-red-600">*</sup>
                          </label>
                          <Input
                            type="number"
                            id="quantity"
                            onChange={(e) =>
                              setRequestItem((prevState) => ({
                                ...prevState,
                                quantity: e.target.value,
                              }))
                            }
                            value={requestItem?.quantity || ""}
                            className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                          />
                        </div>
                      </div>
                      <div className="w-full flex flex-col gap-1 items-start">
                        <h3>Comment</h3>
                        <Input
                          type="text"
                          value={requestItem?.comment || ""}
                          onChange={(e) =>
                            setRequestItem((prev) => ({
                              ...prev,
                              comment: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="flex gap-2 justify-end items-center">
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <Button
                      disabled={
                        !requestItem?.name ||
                        !requestItem?.unit ||
                        !requestItem?.quantity
                      }
                      onClick={() => handleAddNewItem(true)}
                      className="flex items-center gap-1"
                    >
                      <ListChecks className="h-4 w-4" /> Submit
                    </Button>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const CustomMenuList = (props) => {
  const {
    children, // options rendered as children
    selectProps: {
      onAddItemClick,
      // onRequestItemClick,
      // isNewItemsCreationDisabled,
    }, // custom handler for "Add Item"
  } = props;

  // console.log("isNewItemsCreationDisabled", isNewItemsCreationDisabled)

  return (
    <div>
      {/* Scrollable options */}
      <components.MenuList {...props}>
        <div>{children}</div>
      </components.MenuList>
      <div
        className={`sticky top-0 z-10 bg-white border-primary border`}
      >
        {/* {isNewItemsCreationDisabled ? (
          <Button
            variant={"ghost"}
            className="w-full rounded-none text-sm py-2 px-0 md:text-lg text-blue-300 flex flex-col items-center justify-center hover:bg-white"
            onClick={onRequestItemClick}
            onTouchStart={onRequestItemClick}
          >
            <p className="flex items-center gap-1">
              <CirclePlus className="w-4 h-4" />
              Request new item
            </p>
            <span className="text-xs text-primary text-wrap">
              New Item Creation is disabled for this Category, either request
              for a new item here or contact the Administrator!
            </span>
          </Button>
        ) : ( */}
        <Button
          // disabled={isNewItemsCreationDisabled}
          variant={"ghost"}
          className="w-full rounded-none flex items-center justify-center gap-1"
          onClick={onAddItemClick}
          onTouchStart={onAddItemClick}

        >
          <CirclePlus className="w-4 h-4" />
          Create/Request New Item
        </Button>
        {/* )} */}
      </div>
    </div>
  );
};
