import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useFrappeCreateDoc,
  useFrappeGetDocList,
  useFrappeGetDoc,
  useFrappeUpdateDoc,
  useFrappeFileUpload,
  useFrappePostCall,
  useFrappeDeleteDoc,
  useSWRConfig,
} from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  CheckCheck,
  ListChecks,
  ListX,
  MessageCircleMore,
  Paperclip,
  SquareCheckBig,
  Trash,
  Trash2,
  Undo,
  Undo2,
} from "lucide-react";
import imageUrl from "@/assets/user-icon.jpeg";
import ReactSelect from "react-select";
import { CirclePlus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Pencil, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import { ProcurementRequests as ProcurementRequestsType } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import TextArea from "antd/es/input/TextArea";
import { useUserData } from "@/hooks/useUserData";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TailSpin } from "react-loader-spinner";
import { ProcurementActionsHeaderCard } from "@/components/ui/ProcurementActionsHeaderCard";
import Fuse from "fuse.js";

const ApprovePRList = () => {
  const { prId: id } = useParams<{ prId: string }>();
  const [project, setProject] = useState();
  const [owner, setOwner] = useState(null);
  const {
    data: pr,
    isLoading: pr_loading,
    error: pr_error,
    mutate: prMutate,
  } = useFrappeGetDoc<ProcurementRequestsType>("Procurement Requests", id);
  const {
    data: project_data,
    isLoading: project_loading,
    error: project_error,
  } = useFrappeGetDoc<ProjectsType>(
    "Projects",
    project,
    project ? undefined : null
  );
  const {
    data: owner_data,
    isLoading: owner_loading,
    error: owner_error,
  } = useFrappeGetDoc<NirmaanUsersType>(
    "Nirmaan Users",
    owner,
    owner ? (owner === "Administrator" ? null : undefined) : null
  );

  const {
    data: usersList,
    isLoading: usersListLoading,
    error: usersListError,
  } = useFrappeGetDocList("Nirmaan Users", {
    fields: ["name", "full_name"],
    limit: 1000,
  });

  useEffect(() => {
    if (pr) {
      setProject(pr?.project);
      setOwner(pr?.owner);
    }
  }, [pr]);

  const navigate = useNavigate();

  const getUserName = (id) => {
    if (usersList) {
      return usersList.find((user) => user?.name === id)?.full_name;
    }
  };

  // console.log("within 1st component", owner_data)
  if (pr_loading || project_loading || owner_loading || usersListLoading)
    return (
      <div className="flex items-center h-[90vh] w-full justify-center">
        <TailSpin color={"red"} />{" "}
      </div>
    );
  if (pr_error || project_error || owner_error || usersListError)
    return <h1>Error</h1>;
  if (pr?.workflow_state !== "Pending") {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
          <p className="text-gray-600 text-lg">
            Hey there, the PR:{" "}
            <span className="font-medium text-gray-900">{pr?.name}</span> is no
            longer available in the <span className="italic">Pending</span>{" "}
            state. The current state is{" "}
            <span className="font-semibold text-blue-600">
              {pr?.workflow_state}
            </span>{" "}
            And the last modification was done by{" "}
            <span className="font-medium text-gray-900">
              {pr?.modified_by === "Administrator"
                ? pr?.modified_by
                : getUserName(pr?.modified_by)}
            </span>
            !
          </p>
          <button
            className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
            onClick={() => navigate("/approve-new-pr")}
          >
            Go Back to PR List
          </button>
        </div>
      </div>
    );
  }

  return (
    <ApprovePRListPage
      pr_data={pr}
      project_data={project_data}
      prMutate={prMutate}
      owner_data={
        owner_data == undefined ? { full_name: "Administrator" } : owner_data
      }
    />
  );
};

interface ApprovePRListPageProps {
  pr_data: ProcurementRequestsType | undefined;
  project_data: ProjectsType | undefined;
  owner_data: NirmaanUsersType | undefined | { full_name: String };
  prMutate?: any;
}

const ApprovePRListPage = ({
  pr_data,
  project_data,
  owner_data,
  prMutate,
}: ApprovePRListPageProps) => {
  const navigate = useNavigate();
  const userData = useUserData();

  const {
    data: category_list,
    isLoading: category_list_loading,
    error: category_list_error,
  } = useFrappeGetDocList("Category", {
    fields: [
      "category_name",
      "work_package",
      "image_url",
      "tax",
      "new_items",
      "name",
    ],
    orderBy: { field: "category_name", order: "asc" },
    limit: 1000,
  });
  const {
    data: item_list,
    isLoading: item_list_loading,
    error: item_list_error,
    mutate: item_list_mutate,
  } = useFrappeGetDocList("Items", {
    fields: [
      "name",
      "item_name",
      "make_name",
      "unit_name",
      "category",
      "creation",
    ],
    orderBy: { field: "creation", order: "desc" },
    limit: 10000,
  });

  const { data: quote_data } = useFrappeGetDocList("Approved Quotations", {
    fields: ["item_id", "quote"],
    limit: 10000,
  });

  const { data: universalComments } = useFrappeGetDocList("Nirmaan Comments", {
    fields: ["*"],
    filters: [["reference_name", "=", pr_data.name]],
    orderBy: { field: "creation", order: "desc" },
  });

  const { data: usersList } = useFrappeGetDocList("Nirmaan Users", {
    fields: ["*"],
    limit: 1000,
    filters: [
      [
        "role_profile",
        "in",
        [
          "Nirmaan Project Manager Profile",
          "Nirmaan Procurement Executive Profile",
          "Nirmaan Project Lead Profile",
        ],
      ],
    ],
  });

  // console.log("universalCOmment", universalComments)

  const { data: category_make_list, isLoading: category_make_list_loading, error: category_make_list_error } = useFrappeGetDocList("Category Makelist", {
    fields: ["*"],
    limit: 10000
  })

  const {
    createDoc: createDoc,
    error: update_error,
    loading: createLoading,
  } = useFrappeCreateDoc();

  interface Category {
    name: string;
  }

  const [page, setPage] = useState<string>("itemlist");
  const [curItem, setCurItem] = useState<string>("");
  const [curCategory, setCurCategory] = useState<string>("");
  const [unit, setUnit] = useState<string>("");
  const [quantity, setQuantity] = useState<number | null | string>(null);
  // const [item_id, setItem_id] = useState<string>('');
  // const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });
  // const [make, setMake] = useState("");
  const [tax, setTax] = useState<number | null>(null);
  const [dynamicPage, setDynamicPage] = useState<string | null>(null);
  const [comments, setComments] = useState({});
  const [universalComment, setUniversalComment] = useState<string | null>(null);
  const [stack, setStack] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [managersIdList, setManagersIdList] = useState(null);
  const [requestCategory, setRequestCategory] = useState("");

  const [requestItemName, setRequestItemName] = useState("");

  const [requestItemDialog, setRequestItemDialog] = useState(false);

  const toggleRequestItemDialog = () => {
    setRequestItemDialog((prevState) => !prevState);
  };

  const [fuzzyMatches, setFuzzyMatches] = useState([]);

  useEffect(() => {
    if (usersList) {
      let ids = usersList.map((user) => user?.name);
      setManagersIdList(ids);
    }
  }, [usersList]);

  // console.log("usersList", usersList)
  // const fileInputRefs = useRef({});

  const getFullName = (id) => {
    return usersList?.find((user) => user.name == id)?.full_name;
  };

  const handleCommentChange = (item, e) => {
    setComments((prevComments) => ({
      ...prevComments,
      [item.item]: e.target.value,
    }));
  };

  const handleUniversalCommentChange = (e) => {
    setUniversalComment(e.target.value === "" ? null : e.target.value);
  };

  const addCategory = (categoryName: string) => {
    setCurCategory(categoryName);
    setTax(
      category_list?.find((category) => category.category_name === categoryName)
        .tax
    );
    // const isDuplicate = categories.list.some(category => category.name === categoryName);
    // if (!isDuplicate) {
    //     setCategories(prevState => ({
    //         ...prevState,
    //         list: [...prevState.list, { name: categoryName }]
    //     }));
    // }
  };

  const handleCategoryClick = (category: string, value: string) => {
    addCategory(category);
    setPage(value);
  };

  const triggerFileInput = (name: string) => {
    // console.log("triggering input", name)
    // if (fileInputRefs.current[name]) {
    //     fileInputRefs.current[name].click();
    // }
    document.getElementById(`file-upload-${name}`)?.click();
  };

  const handleFileChange = (event, catName) => {
    const file = event.target.files[0];
    if (file && file.type !== "application/pdf") {
      alert("Please upload a valid PDF file.");
      return;
    }
    if (file) {
      setUploadedFiles((prev) => ({
        ...prev,
        [catName]: file,
      }));
    }
  };

  const removeFile = (catName) => {
    setUploadedFiles((prev) => {
      const newFiles = { ...prev };
      delete newFiles[catName];
      return newFiles;
    });
  };

  const [orderData, setOrderData] = useState({
    project: "",
    work_package: "",
    procurement_list: {
      list: [],
    },
    category_list: {
      list: [],
    },
  });

  // console.log("pr_data", pr_data)

  useEffect(() => {
    if (!orderData.project) {
      let mod_pr_data = {
        ...pr_data,
        procurement_list: JSON.parse(pr_data?.procurement_list),
      };
      setOrderData(mod_pr_data);
      // console.log("within effect 1", pr_data, orderData)
      // JSON.parse(pr_data?.procurement_list).list.map((items) => {
      //     const isDuplicate = categories.list.some(category => category.name === items.category);
      //     if (!isDuplicate) {
      //         setCategories(prevState => ({
      //             ...prevState,
      //             list: [...prevState.list, { name: items.category }]
      //         }));
      //     }
      //     // console.log("within effect 2", categories)
      // });

      // setCategories(prevState => ({
      //     ...prevState,
      //     list: prevState.list.filter((category, index, self) =>
      //         index === self.findIndex((c) => (
      //             c.name === category.name
      //         ))
      //     )
      // }));
    }
  }, [pr_data]);

  const item_options: string[] = [];

  if (curCategory) {
    item_list?.map((item) => {
      if (item.category === curCategory)
        item_options.push({
          value: item.item_name,
          label: `${item.item_name}`,
        });
    });
  }

  useEffect(() => {
    const newCategories = [];
    if (orderData.procurement_list.list.some((i) => i.status === "Request")) {
      orderData.procurement_list.list.map((item) => {
        const isDuplicate = newCategories.some(
          (category) =>
            category.name === item.category && category?.status === item.status
        );
        if (!isDuplicate) {
          if (item.status === "Pending") {
            const makes = category_make_list?.filter(i => i?.category === item.category)?.map(i => i?.make);
            newCategories.push({ name: item.category, status: item.status, makes: makes || [] });
          } else {
            newCategories.push({ name: item.category, status: item.status });
          }
        }
      });
    } else {
      orderData.procurement_list.list.map((item) => {
        const isDuplicate = newCategories.some(
          (category) => category.name === item.category
        );
        if (!isDuplicate) {
          const makes = category_make_list?.filter(i => i?.category === item.category)?.map(i => i?.make);
          newCategories.push({ name: item.category, makes: makes || [] });
        }
      });
    }
    setOrderData((prevState) => ({
      ...prevState,
      category_list: {
        list: newCategories,
      },
    }));
  }, [orderData.procurement_list]);

  const handleChange = (selectedItem) => {
    // console.log('Selected item:', selectedItem);
    setCurItem(selectedItem.value);
    item_list?.map((item) => {
      if (item.item_name == selectedItem.value) {
        setUnit(item.unit_name);
        // setMake(item.make_name);
      }
    });
  };

  const handleAdd = () => {
    if (curItem && Number(quantity)) {
      let itemIdToUpdate = null;
      // let itemMake = null;

      // Find item ID and make
      item_list.forEach((item) => {
        if (item.item_name === curItem) {
          itemIdToUpdate = item.name;
          // itemMake = item.make_name;
        }
      });

      if (itemIdToUpdate) {
        const curRequest = [...orderData.procurement_list.list];
        const curValue = {
          item: `${curItem}`,
          name: itemIdToUpdate,
          unit: unit,
          quantity: Number(quantity),
          category: curCategory,
          tax: Number(tax),
          status: "Pending",
        };

        // Check if item exists in the current list
        const isDuplicate = curRequest.some(
          (item) => item.name === curValue.name
        );

        if (!isDuplicate) {
          // Check if the stack has this item and remove it
          const itemInStackIndex = stack.findIndex(
            (stackItem) => stackItem?.name === curValue.name
          );

          if (itemInStackIndex > -1) {
            stack.splice(itemInStackIndex, 1);
            setStack([...stack]); // Update stack state after removal
          }

          // Add item to the current request list
          curRequest.push(curValue);
          setOrderData((prevState) => ({
            ...prevState,
            procurement_list: {
              list: curRequest,
            },
          }));
        } else {
          toast({
            title: "Invalid Request!",
            description: (
              <span>
                You are trying to add the <b>item: {curItem}</b> multiple times
                which is not allowed, instead edit the quantity directly!
              </span>
            ),
          });
        }
        setQuantity("");
        setCurItem("");
        setUnit("");
        // setItem_id('');
        // setMake("");
      }
    }
  };

  const handleSave = (itemName: string, newQuantity: string) => {
    let curRequest = orderData.procurement_list.list;
    curRequest = curRequest.map((curValue) => {
      if (curValue.item === itemName) {
        return {
          ...curValue,
          quantity: parseInt(newQuantity),
          comment:
            comments[itemName] === undefined
              ? curValue.comment || ""
              : comments[itemName] || "",
        };
      }
      return curValue;
    });
    setOrderData((prevState) => ({
      ...prevState,
      procurement_list: {
        list: curRequest,
      },
    }));
    setQuantity("");
    setCurItem("");
  };

  const handleDelete = (item: string) => {
    let curRequest = orderData.procurement_list.list;
    let itemToPush = curRequest.find((curValue) => curValue.item === item);

    if (itemToPush.status !== "Request") {
      setStack((prevStack) => [...prevStack, itemToPush]);
      setComments((prev) => {
        delete prev[item];
        return prev;
      });
    }

    curRequest = curRequest.filter((curValue) => curValue.item !== item);
    setOrderData((prevState) => ({
      ...prevState,
      procurement_list: {
        list: curRequest,
      },
    }));
    setQuantity("");
    setCurItem("");
  };

  const UndoDeleteOperation = () => {
    let curRequest = orderData.procurement_list.list;
    let itemToRestore = stack.pop();

    curRequest.push(itemToRestore);

    setOrderData((prevState) => ({
      ...prevState,
      procurement_list: {
        list: curRequest,
      },
    }));

    setStack([...stack]);
  };

  // console.log("userdata", userData)
  const { toast } = useToast();
  const {
    updateDoc: updateDoc,
    loading: updateLoading,
    isCompleted: submit_complete,
    error: submit_error,
  } = useFrappeUpdateDoc();
  const { upload } = useFrappeFileUpload();
  const { call, loading: callLoading } = useFrappePostCall(
    "frappe.client.set_value"
  );
  const { deleteDoc } = useFrappeDeleteDoc();
  const { mutate } = useSWRConfig();

  const handleFileUpload = async (category: string) => {
    if (uploadedFiles[category]) {
      try {
        const doc = await createDoc("Category BOQ Attachments", {
          procurement_request: orderData.name,
          category: category,
        });

        const fileArgs = {
          doctype: "Category BOQ Attachments",
          docname: doc.name,
          fieldname: "boq",
          isPrivate: true,
        };

        const uploadResult = await upload(uploadedFiles[category], fileArgs);
        await call({
          doctype: "Category BOQ Attachments",
          name: doc.name,
          fieldname: "boq",
          value: uploadResult.file_url,
        });
        setUploadedFiles((prev) => ({ ...prev, [category]: null }));
      } catch (error) {
        console.error("Error uploading file:", error);
      }
    }
  };

  const handleApprove = async () => {
    try {
      await Promise.all(
        Object.keys(uploadedFiles).map((cat) => handleFileUpload(cat))
      );

      const res = await updateDoc("Procurement Requests", orderData.name, {
        procurement_list: orderData.procurement_list,
        category_list: orderData.category_list,
        workflow_state: "Approved",
      });

      if (universalComment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Procurement Requests",
          reference_name: res.name,
          comment_by: userData?.user_id,
          content: universalComment,
          subject: "approving pr",
        });
      }

      // console.log("orderData2", res);
      document.getElementById("dialogCloseforApproveOrder")?.click();
      toast({
        title: "Success!",
        description: `PR: ${res?.name} is successfully Approved!`,
        variant: "success",
      });

      navigate("/approve-new-pr");
    } catch (submit_error) {
      toast({
        title: "Failed!",
        description: `${submit_error?.message}`,
        variant: "destructive",
      });

      console.log("submit_error", submit_error);
    }
  };

  const handleReject = async () => {
    try {
      // await Promise.all(
      //     Object.keys(uploadedFiles).map(cat => handleFileUpload(cat))
      // );

      const res = await updateDoc("Procurement Requests", orderData.name, {
        procurement_list: orderData.procurement_list,
        category_list: orderData.category_list,
        workflow_state: "Rejected",
      });

      if (universalComment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Procurement Requests",
          reference_name: orderData.name,
          comment_by: userData?.user_id,
          content: universalComment,
          subject: "rejecting pr",
        });
      }
      await mutate("ApprovePR,PRListMutate");

      document.getElementById("dialogCloseforApproveOrder")?.click();
      toast({
        title: "Success!",
        description: `PR: ${res?.name} is successfully Rejected!`,
        variant: "success",
      });
      navigate("/approve-new-pr");
    } catch (error) {
      toast({
        title: "Failed!",
        description: `There was an error while Rejected PR: ${orderData.name}`,
        variant: "destructive",
      });
      console.log("error occured while rejecting PR", error, submit_error);
    }
  };

  const handleCreateItem = () => {
    setUnit("");
    setCurItem("");
    // setMake("");
    setPage("additem");
  };

  const handleCategoryClick2 = (category: string) => {
    addCategory(category);
    setPage("additem");
  };

  const handleAddItem = () => {
    const itemData = {
      category: curCategory,
      unit_name: unit,
      item_name: curItem,
      // make_name: make,
    };
    // console.log("itemData", itemData)
    createDoc("Items", itemData)
      .then(() => {
        // console.log(itemData)
        setUnit("");
        setCurItem("");
        // setMake("");
        setPage("itemlist");
        item_list_mutate();
      })
      .catch(() => {
        console.log("submit_error", update_error);
      });
  };

  const handleDeletePr = async () => {
    try {
      await deleteDoc("Procurement Requests", orderData.name);
      await mutate(`Procurement Requests ${orderData?.project}`);
      await mutate("ApprovePR,PRListMutate");
      toast({
        title: "Success!",
        description: `PR: ${orderData.name} deleted successfully!`,
        variant: "success",
      });
      navigate("/approve-new-pr");
    } catch (error) {
      console.log("error while deleting PR", error);
      toast({
        title: "Failed!",
        description: `PR: ${orderData.name} deletion Failed!`,
        variant: "destructive",
      });
    }
  };

  const handleRequestItem = async (item) => {
    const itemData = {
      category: requestCategory,
      unit_name: unit,
      item_name: curItem,
    };
    try {
      const res = await createDoc("Items", itemData);

      const curRequest = [...orderData.procurement_list.list];

      const combinedRequest = [...curRequest, ...stack];

      const itemToUpdate = combinedRequest.find((i) => i.name === item.name);
      itemToUpdate.item = res.item_name;
      itemToUpdate.unit = res.unit_name;
      itemToUpdate.quantity = quantity;
      itemToUpdate.status = "Pending";
      itemToUpdate.name = res.name;
      itemToUpdate.category = res.category;
      itemToUpdate.tax = parseFloat(
        category_list?.find((i) => i?.name === res.category)?.tax
      );

      const newCategories = [];

      if (combinedRequest.some((i) => i.status === "Request")) {
        combinedRequest.map((item) => {
          const isDuplicate = newCategories.some(
            (category) =>
              category.name === item.category &&
              category?.status === item.status
          );
          if (!isDuplicate) {
            newCategories.push({ name: item.category, status: item.status });
          }
        });
      } else {
        combinedRequest.map((item) => {
          const isDuplicate = newCategories.some(
            (category) => category.name === item.category
          );
          if (!isDuplicate) {
            newCategories.push({ name: item.category });
          }
        });
      }

      setOrderData((prevState) => ({
        ...prevState,
        procurement_list: {
          list: curRequest,
        },
      }));

      await updateDoc("Procurement Requests", orderData.name, {
        procurement_list: { list: combinedRequest },
        category_list: {
          list: newCategories,
        },
      });

      await prMutate();

      await item_list_mutate();

      toast({
        title: "Success!",
        description: `Requested Item: ${res.item_name} created and added successfully!`,
        variant: "success",
      });

      setCurItem("");
      setUnit("");
      setQuantity("");
      setRequestCategory("");
    } catch (error) {
      toast({
        title: "Failed!",
        description: `RequestedItem: ${curItem} creation Failed!`,
        variant: "destructive",
      });
      console.log("error while creating requested item", error);
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

  const handleAddMatchingItem = (item, requestItem) => {

    if (item?.item_name && item?.quantity) {
      let itemIdToUpdate = null;
      // let itemMake = null;

      // Find item ID and make
      item_list?.forEach((i) => {
        if (i.item_name === item?.item_name) {
          itemIdToUpdate = i.name;
          // itemMake = i.make_name;
        }
      });

      if (itemIdToUpdate) {
        let curRequest = [...orderData.procurement_list.list];

        curRequest = curRequest.filter((curValue) => curValue.name !== requestItem?.name);

        const curValue = {
          item: `${item?.item_name}`,
          name: itemIdToUpdate,
          unit: item?.unit,
          quantity: item?.quantity,
          category: item?.category,
          tax: parseFloat(category_list?.find((c) => c.name === item?.category)?.tax),
          status: "Pending",
        };

        // Check if item exists in the current list
        const isDuplicate = curRequest.some(
          (j) => j.name === curValue.name
        );

        if (!isDuplicate) {

          // Check if the stack has this item and remove it
          const itemInStackIndex = stack.findIndex(
            (stackItem) => stackItem?.name === curValue.name
          );

          if (itemInStackIndex > -1) {
            stack.splice(itemInStackIndex, 1);
            setStack([...stack]); // Update stack state after removal
          }

          // Add item to the current request list
          curRequest.push(curValue);

          setOrderData((prevState) => ({
            ...prevState,
            procurement_list: {
              list: curRequest,
            }
          }));

          toast({
            title: "Success!",
            description: (
              <ul className="pl-2 list-disc">
                <li>Item <strong>{item?.item_name}</strong> added to the order_list successfully!</li>
                <li>The requested item <strong>{requestItem?.item_name}</strong> is now removed from the order_list!</li>
              </ul>
            ),
            variant: "success",
          })

          toggleRequestItemDialog()
        } else {
          toast({
            title: "Invalid Request!",
            description: (
              <span>
                The <b>item: {item?.item_name}</b> cannot be added because it is already present in the order_list!
              </span>
            ),
          });
        }
        setCurItem("");
        setUnit("");
        setQuantity("");
        setRequestCategory("");
      }
    }
  }


  // console.log("stack", stack)
  // console.log("uploadedFiles", uploadedFiles)

  //   console.log("orderData", orderData)

  return (
    <>
      {page == "categorylist" && (
        <div className="flex-1 space-y-4">
          <div className="flex items-center">
            <ArrowLeft
              className="cursor-pointer"
              onClick={() => setPage("itemlist")}
            />
            <h2 className="text-lg pl-2 font-bold tracking-tight text-pageheader">
              Select Category
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {category_list?.map((item) => {
              if (item.work_package === orderData.work_package) {
                return (
                  <Card
                    className="flex flex-col items-center shadow-none border border-grey-500 hover:animate-shadow-drop-center"
                    onClick={() =>
                      handleCategoryClick(item.category_name, "itemlist")
                    }
                  >
                    <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                      <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                        <img
                          className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0"
                          src={
                            item.image_url === null ? imageUrl : item.image_url
                          }
                          alt="Category"
                        />
                        <span>{item.category_name}</span>
                      </CardTitle>
                    </CardHeader>
                  </Card>
                );
              }
            })}
          </div>
        </div>
      )}
      {page == "itemlist" && (
        <div className="flex-1 space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
              <h2 className="text-lg pl-2 font-bold tracking-tight text-pageheader">
                Approve/Reject/Delete
              </h2>
            </div>

            <AlertDialog>
              <AlertDialogTrigger>
                <Button>
                  <div className="flex items-center gap-1">
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </div>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <div className="text-center font-bold">
                    Are you sure, you want to delete the PR?
                  </div>
                </AlertDialogHeader>
                <AlertDialogDescription className="flex gap-2 items-center justify-center">
                  <AlertDialogCancel>
                    <div className="flex">
                      <Undo2 className="h-4 w-4 mr-1" />
                      Go Back
                    </div>
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeletePr}>
                    <div className="flex">
                      <Trash2 className="h-4 w-4 mr-1 mt-0.5" />
                      Confirm
                    </div>
                  </AlertDialogAction>
                </AlertDialogDescription>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <ProcurementActionsHeaderCard orderData={orderData} pr={true} />

          {curCategory === "" && (
            <button
              className="text-lg text-blue-400 flex p-2 items-center gap-1"
              onClick={() => setPage("categorylist")}
            >
              <CirclePlus className="w-4 h-4" /> Add Missing Items
            </button>
          )}

          {curCategory && (
            <Card className="p-4 max-sm:p-2 border border-gray-100 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <div
                  onClick={() => {
                    setCurItem("");
                    // setMake("");
                    setPage("categorylist");
                  }}
                  className="text-blue-400 underline flex items-center gap-1 cursor-pointer"
                >
                  <h3 className="font-bold">{curCategory}</h3>
                  <Pencil className="w-4 h-4" />
                </div>
                <button
                  className="text-red-600"
                  onClick={() => {
                    setCurItem("");
                    // setMake("");
                    setCurCategory("");
                  }}
                >
                  <X className="w-6 h-6 " />
                </button>
              </div>

              <div className="flex space-x-2">
                <div className="w-1/2 md:w-2/3">
                  <h5 className="text-xs text-gray-400">Items</h5>
                  <ReactSelect
                    value={{
                      value: curItem,
                      label: `${curItem}`,
                    }}
                    options={item_options}
                    onChange={handleChange}
                  />
                </div>
                <div className="flex-1">
                  <h5 className="text-xs text-gray-400">UOM</h5>
                  <input
                    className="h-[37px] w-full"
                    type="text"
                    placeholder={unit || "Unit"}
                    value={unit}
                  />
                </div>
                <div className="flex-1">
                  <h5 className="text-xs text-gray-400">Qty</h5>
                  <input
                    className="h-[37px] w-full border p-2 rounded-lg outline-none"
                    onChange={(e) =>
                      setQuantity(
                        e.target.value === "" ? null : parseInt(e.target.value)
                      )
                    }
                    value={quantity}
                    type="number"
                  />
                </div>
              </div>
              <div className="flex justify-between mt-4 items-center">
                {["Nirmaan Admin Profile"].includes(userData?.role) ? (
                  <Button
                    disabled={!curCategory}
                    variant={"ghost"}
                    className="text-sm py-2 px-0 md:text-lg text-blue-400 flex items-center gap-1 hover:bg-white"
                    onClick={() => handleCreateItem()}
                  >
                    <CirclePlus className="w-4 h-4" />
                    Create new item
                  </Button>
                ) : (
                  <div />
                )}

                {curItem && Number(quantity) ? (
                  <Button
                    variant="outline"
                    className="left-0 border rounded-lg py-1 border-red-500 px-8 text-red-500"
                    onClick={() => handleAdd()}
                  >
                    Add
                  </Button>
                ) : (
                  <Button
                    disabled={true}
                    variant="secondary"
                    className="left-0 border rounded-lg py-1 border-red-500 px-8 text-red-500"
                  >
                    Add
                  </Button>
                )}
              </div>
            </Card>
          )}
          <div className="flex justify-between items-center">
            <p className="text-xs text-red-700 pl-2">Added Items</p>
            {stack.length !== 0 && (
              <div className="flex items-center space-x-2">
                <HoverCard>
                  <HoverCardTrigger>
                    <button
                      onClick={() => UndoDeleteOperation()}
                      className="flex items-center max-md:text-sm max-md:px-2 max-md:py-1  px-4 py-2 bg-blue-500 text-white font-semibold rounded-full shadow-md hover:bg-blue-600 transition duration-200 ease-in-out"
                    >
                      <Undo className="mr-2 max-md:w-4 max-md:h-4" />
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
          {orderData?.procurement_list.list.length === 0 && (
            <div className="text-sm">
              No Items to display, please click on "Undo" button to recover the
              deleted items or add at least an item to enable the "Approve" or
              "Reject" button
            </div>
          )}

          {orderData.category_list.list?.filter((i) => i?.status !== "Request")
            ?.length !== 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Added Items</CardTitle>
                </CardHeader>
                <CardContent>
                  {orderData.category_list.list
                    ?.filter((i) => i?.status !== "Request")
                    ?.map((cat) => {
                      return (
                        <div key={cat.name}>
                          <div className="flex items-center justify-between">
                            <div key={cat.id} className="flex gap-1 items-center">
                              <h3 className="text-sm font-semibold py-2">
                                {cat.name}
                              </h3>
                              <div
                                className={`text-blue-500 cursor-pointer flex gap-1 items-center border rounded-md border-blue-500 px-1 ${uploadedFiles[cat.name] &&
                                  "opacity-50 cursor-not-allowed"
                                  }`}
                                onClick={() => triggerFileInput(cat.name)}
                              >
                                <Paperclip size="15px" />
                                <span className="p-0 text-sm">Attach</span>
                                <input
                                  type="file"
                                  id={`file-upload-${cat.name}`}
                                  className="hidden"
                                  accept=".pdf"
                                  // ref={(el) => (fileInputRefs.current[cat.name] = el)}
                                  onChange={(event) =>
                                    handleFileChange(event, cat.name)
                                  }
                                  disabled={uploadedFiles[cat.name] ? true : false}
                                />
                              </div>
                              {uploadedFiles[cat.name] && (
                                <div className="flex items-center ml-2">
                                  <span className="text-sm">
                                    {uploadedFiles[cat.name].name}
                                  </span>
                                  <button
                                    className="ml-1 text-red-500"
                                    onClick={() => removeFile(cat.name)}
                                  >
                                    ✖
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="text-sm font-bold text-gray-500">
                              {category_make_list?.filter(i => i?.category === cat?.name)?.length > 0 ? (
                                category_make_list?.filter(i => i?.category === cat?.name)?.map((i, index, arr) => (
                                  <i>{i?.make}{index < arr.length - 1 && ", "}</i>
                                ))
                              ) : "--"}
                            </div>
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
                                  Quantity
                                </th>
                                <th className="w-[10%] px-4 py-1 text-xs text-center">
                                  Edit
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {orderData.procurement_list.list?.map((item) => {
                                if (
                                  item.category === cat.name &&
                                  item.status !== "Request"
                                ) {
                                  return (
                                    <tr key={item.item}>
                                      <td className="w-[60%] text-left border-b-2 px-4 py-1 text-sm">
                                        {item.item}
                                        {item.comment && (
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
                                              setQuantity(parseInt(item.quantity))
                                            }
                                          >
                                            <Pencil className="w-4 h-4" />
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle className="flex justify-between">
                                                Edit Item
                                                <AlertDialogCancel
                                                  onClick={() => setQuantity("")}
                                                  className="border-none shadow-none p-0"
                                                >
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
                                                    <input
                                                      type="number"
                                                      defaultValue={item.quantity}
                                                      className=" rounded-lg w-full border p-2"
                                                      onChange={(e) =>
                                                        setQuantity(
                                                          e.target.value !== ""
                                                            ? parseInt(
                                                              e.target.value
                                                            )
                                                            : null
                                                        )
                                                      }
                                                    />
                                                  </div>
                                                </div>
                                                <div className="flex gap-1 items-center pt-1">
                                                  <MessageCircleMore className="h-8 w-8" />
                                                  <textarea
                                                    className="block p-2 border-gray-300 border rounded-md w-full"
                                                    placeholder="Add comment..."
                                                    onChange={(e) =>
                                                      handleCommentChange(item, e)
                                                    }
                                                    defaultValue={
                                                      item.comment || ""
                                                    }
                                                  />
                                                </div>
                                              </AlertDialogDescription>
                                              <AlertDialogDescription className="flex justify-end">
                                                <div className="flex gap-2">
                                                  <AlertDialogAction
                                                    className="bg-gray-100 text-black hover:text-white flex gap-1 items-center"
                                                    onClick={() =>
                                                      handleDelete(item.item)
                                                    }
                                                  >
                                                    <Trash2 className="h-4 w-4" />
                                                    Delete
                                                  </AlertDialogAction>
                                                  <AlertDialogAction
                                                    disabled={!quantity}
                                                    onClick={() =>
                                                      handleSave(
                                                        item.item,
                                                        quantity
                                                      )
                                                    }
                                                    className="flex gap-1 items-center"
                                                  >
                                                    <ListChecks className="h-4 w-4" />
                                                    Save
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
                </CardContent>
              </Card>
            )}

          {orderData.category_list.list?.filter((i) => i?.status === "Request")
            ?.length !== 0 && (
              <Card className="bg-yellow-50">
                <CardHeader>
                  <CardTitle>Requested Items</CardTitle>
                </CardHeader>
                <CardContent>
                  {orderData.category_list.list
                    ?.filter((i) => i?.status === "Request")
                    ?.map((cat) => {
                      return (
                        <div key={cat.name}>
                          <h3 className="text-sm font-semibold py-2">
                            {cat.name}
                          </h3>
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
                                  Quantity
                                </th>
                                <th className="w-[10%] px-4 py-1 text-xs text-center">
                                  Action
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {orderData.procurement_list.list?.map((item) => {
                                if (
                                  item.category === cat.name &&
                                  item.status === "Request"
                                ) {
                                  return (
                                    <tr key={item.item}>
                                      <td className="w-[60%] text-left border-b-2 px-4 py-1 text-sm">
                                        {item.item}
                                        {item.comment && (
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
                                      <td className="w-[10%] border-b-2 px-4 py-1 text-sm text-center ">
                                        <div className="flex items-center gap-1">
                                          <AlertDialog open={requestItemDialog} onOpenChange={toggleRequestItemDialog}>
                                            <AlertDialogTrigger
                                              onClick={() => {
                                                handleFuzzySearch(item.item);
                                                setCurItem(item.item);
                                                setRequestItemName({ item_name: item.item, name: item?.name })
                                                setUnit(item.unit);
                                                setQuantity(item.quantity);
                                                setRequestCategory(
                                                  item.category
                                                );
                                              }}
                                            >
                                              <ListChecks
                                                className="h-4 w-4 text-green-600"
                                              />
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                              <AlertDialogHeader>
                                                <AlertDialogTitle>
                                                  Approve and Add{" "}
                                                  <span className="text-primary">
                                                    {curItem}
                                                  </span>
                                                </AlertDialogTitle>
                                              </AlertDialogHeader>
                                              <AlertDialogDescription className="flex flex-col gap-2">
                                                <p>
                                                  Please check and rectify the
                                                  details of the item before
                                                  clicking on confirm!
                                                </p>
                                                <div className="w-full">
                                                  <h5 className="text-sm font-medium text-gray-700 mb-1">
                                                    Category
                                                  </h5>
                                                  <Select
                                                    defaultValue={requestCategory}
                                                    onValueChange={(value) =>
                                                      setRequestCategory(value)
                                                    }
                                                  >
                                                    <SelectTrigger className="">
                                                      <SelectValue
                                                        className="text-gray-200"
                                                        placeholder="Select Category"
                                                      />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                      {category_list
                                                        ?.filter(
                                                          (i) =>
                                                            i?.work_package ===
                                                            orderData?.work_package
                                                        )
                                                        ?.map((item) => (
                                                          <SelectItem
                                                            value={
                                                              item.category_name
                                                            }
                                                          >
                                                            {item.category_name}
                                                          </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                  </Select>
                                                </div>
                                                <label
                                                  htmlFor="itemName"
                                                  className="block text-sm font-medium text-gray-700"
                                                >
                                                  Item Name
                                                  <sup className="text-sm text-red-600">
                                                    *
                                                  </sup>
                                                </label>
                                                <Input
                                                  type="text"
                                                  id="itemName"
                                                  value={curItem}
                                                  onChange={(e) =>
                                                    setCurItem(e.target.value)
                                                  }
                                                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                                />

                                                <div className="flex items-center gap-2 w-full">
                                                  <div className="w-[60%]">
                                                    <label
                                                      htmlFor="itemUnit"
                                                      className="block text-sm font-medium text-gray-700"
                                                    >
                                                      Item Unit
                                                      <sup className="text-sm text-red-600">
                                                        *
                                                      </sup>
                                                    </label>
                                                    <Select
                                                      value={unit}
                                                      onValueChange={(value) =>
                                                        setUnit(value)
                                                      }
                                                    >
                                                      <SelectTrigger>
                                                        <SelectValue
                                                          className="text-gray-200"
                                                          placeholder="Select Unit"
                                                        />
                                                      </SelectTrigger>
                                                      <SelectContent>
                                                        {/* <SelectItem value="PCS">PCS</SelectItem> */}
                                                        <SelectItem value="BOX">
                                                          BOX
                                                        </SelectItem>
                                                        <SelectItem value="ROLL">
                                                          ROLL
                                                        </SelectItem>
                                                        {/* <SelectItem value="PKT">PKT</SelectItem> */}
                                                        <SelectItem value="LENGTH">
                                                          LTH
                                                        </SelectItem>
                                                        <SelectItem value="MTR">
                                                          MTR
                                                        </SelectItem>
                                                        <SelectItem value="NOS">
                                                          NOS
                                                        </SelectItem>
                                                        <SelectItem value="KGS">
                                                          KGS
                                                        </SelectItem>
                                                        <SelectItem value="PAIRS">
                                                          PAIRS
                                                        </SelectItem>
                                                        <SelectItem value="PACKS">
                                                          PACKS
                                                        </SelectItem>
                                                        <SelectItem value="DRUM">
                                                          DRUM
                                                        </SelectItem>
                                                        <SelectItem value="SQMTR">
                                                          SQMTR
                                                        </SelectItem>
                                                        <SelectItem value="LTR">
                                                          LTR
                                                        </SelectItem>
                                                        <SelectItem value="BUNDLE">
                                                          BUNDLE
                                                        </SelectItem>
                                                        <SelectItem value="FEET">
                                                          FEET
                                                        </SelectItem>
                                                      </SelectContent>
                                                    </Select>
                                                  </div>

                                                  <div className="w-[40%]">
                                                    <label
                                                      htmlFor="quantity"
                                                      className="block text-sm font-medium text-gray-700"
                                                    >
                                                      Quantity
                                                      <sup className="text-sm text-red-600">
                                                        *
                                                      </sup>
                                                    </label>
                                                    <Input
                                                      type="number"
                                                      id="quantity"
                                                      onChange={(e) =>
                                                        setQuantity(
                                                          e.target.value === ""
                                                            ? null
                                                            : parseInt(
                                                              e.target.value
                                                            )
                                                        )
                                                      }
                                                      value={quantity || ""}
                                                      className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                                    />
                                                  </div>
                                                </div>
                                              </AlertDialogDescription>
                                              <AlertDialogDescription className="flex items-center justify-end gap-2">
                                                {createLoading ||
                                                  updateLoading ? (
                                                  <TailSpin
                                                    width={30}
                                                    height={30}
                                                    color={"red"}
                                                  />
                                                ) : (
                                                  <>
                                                    <AlertDialogCancel
                                                      onClick={() => {
                                                        setCurItem("");
                                                        setUnit("");
                                                        setQuantity("");
                                                      }}
                                                      className="flex items-center gap-1"
                                                    >
                                                      <X className="h-4 w-4" />
                                                      Cancel
                                                    </AlertDialogCancel>
                                                    <Button
                                                      disabled={
                                                        !unit ||
                                                        !curItem ||
                                                        !quantity ||
                                                        !requestCategory
                                                      }
                                                      onClick={() =>
                                                        handleRequestItem(item)
                                                      }
                                                      className="flex items-center gap-1"
                                                    >
                                                      <CheckCheck className="h-4 w-4" />
                                                      Confirm
                                                    </Button>
                                                  </>
                                                )}
                                              </AlertDialogDescription>
                                              {fuzzyMatches?.length > 0 && (
                                                <div className="border rounded p-2 bg-red-50 text-sm">
                                                  <h3 className="text-sm">Below are the top 3 matches for the above requested item <span className="text-primary">{curItem}</span></h3>
                                                  <span className="text-xs italic">- You can click on <span className="bg-gray-200">Add this item</span> button to add the item to the order_list automatically with the default quantity as {quantity}!</span>
                                                  <p className="text-xs italic">- This will also permanently remove the current request item entry from the order_list!</p>
                                                  <div className="flex flex-col gap-2 mt-4 border rounded p-2 bg-gray-50">
                                                    {fuzzyMatches?.slice(0, 3)?.map((i, index) => (
                                                      <div className="flex flex-col gap-1 border-b pb-1">
                                                        <p className="flex justify-between items-center">
                                                          <strong>{i?.item_name}</strong>
                                                          <span className="text-gray-500">
                                                            {" "}
                                                            - {i?.matchPercentage}% match
                                                          </span>
                                                        </p>
                                                        <div className="flex justify-between items-center">
                                                          <p className="text-gray-400 font-semibold">{i?.category}</p>
                                                          <p
                                                            onClick={() => handleAddMatchingItem({ item_name: i?.item_name, unit: i?.unit_name, quantity: quantity || 1, category: i?.category }, requestItemName)}
                                                            className="text-primary font-bold text-xs cursor-pointer border p-1 rounded-md bg-gray-200">Add this item</p>
                                                        </div>

                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                            </AlertDialogContent>
                                          </AlertDialog>
                                          <span>|</span>
                                          <AlertDialog>
                                            <AlertDialogTrigger
                                              onClick={() => {
                                                setCurItem(item.item);
                                              }}
                                            >
                                              <Trash className="w-4 h-4 text-primary cursor-pointer" />
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                              <AlertDialogHeader>
                                                <AlertDialogTitle>
                                                  Reject{" "}
                                                  <span className="text-primary">
                                                    {curItem}
                                                  </span>
                                                </AlertDialogTitle>
                                              </AlertDialogHeader>
                                              <AlertDialogDescription>
                                                Click on Confirm to remove this
                                                item from the order list
                                                permanently!
                                              </AlertDialogDescription>
                                              <AlertDialogDescription className="flex items-center justify-end gap-2">
                                                <AlertDialogCancel className="flex items-center gap-1">
                                                  <X className="h-4 w-4" />
                                                  Cancel
                                                </AlertDialogCancel>
                                                <AlertDialogAction
                                                  onClick={() =>
                                                    handleDelete(curItem)
                                                  }
                                                  className="flex items-center gap-1"
                                                >
                                                  <CheckCheck className="h-4 w-4" />
                                                  Confirm
                                                </AlertDialogAction>
                                              </AlertDialogDescription>
                                            </AlertDialogContent>
                                          </AlertDialog>
                                        </div>
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
                </CardContent>
              </Card>
            )}

          <div className="flex items-center space-y-2 pt-4">
            <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">
              PR Comments
            </h2>
          </div>

          <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-4">
            {universalComments?.filter(
              (comment) =>
                managersIdList?.includes(comment.comment_by) ||
                (comment.comment_by === "Administrator" &&
                  (comment.subject === "creating pr" ||
                    comment.subject === "resolving pr" ||
                    comment.subject === "editing pr"))
            ).length ? (
              universalComments
                .filter(
                  (comment) =>
                    managersIdList?.includes(comment.comment_by) ||
                    (comment.comment_by === "Administrator" &&
                      (comment.subject === "creating pr" ||
                        comment.subject === "resolving pr" ||
                        comment.subject === "editing pr"))
                )
                .map((cmt) => (
                  <div
                    key={cmt.name}
                    className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg"
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
                ))
            ) : (
              <span className="text-xs font-semibold flex items-center justify-center">
                No Comments Found.
              </span>
            )}
          </div>

          <div className="flex gap-4 justify-end items-end mt-4">
            <Button
              disabled={!orderData.procurement_list.list.length}
              variant="secondary"
              className=""
              onClick={() => {
                setPage("summary");
                setDynamicPage("reject");
              }}
            >
              <div className="flex items-center gap-1">
                <ListX className="h-4 w-4" />
                Reject
              </div>
            </Button>
            <Button
              disabled={
                !orderData.procurement_list.list.length ||
                orderData.procurement_list.list?.some(
                  (i) => i.status === "Request"
                )
              }
              className=""
              onClick={() => {
                setPage("summary");
                setDynamicPage("approve");
              }}
            >
              <div className="flex items-center gap-1">
                <ListChecks className="h-4 w-4" />
                Approve
              </div>
            </Button>
          </div>

          {/* <button className="bottom-0 h-8 w-full bg-red-700 rounded-md text-sm text-white" onClick={()=>handleSubmit()}>Next</button> */}
        </div>
      )}
      {page == "summary" && (
        <div className="flex-1 space-y-4">
          {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
          <div className="flex items-center pt-1">
            <ArrowLeft
              className="cursor-pointer"
              onClick={() => setPage("itemlist")}
            />
            <h2 className="text-lg pl-2 font-bold tracking-tight">
              Quantity Summary:{" "}
              <span className="text-red-700">
                PR-{orderData?.name?.slice(-4)}
              </span>
            </h2>
          </div>
          <ProcurementActionsHeaderCard orderData={orderData} pr={true} />

          <div className="overflow-x-auto">
            <div className="min-w-full inline-block align-middle">
              {(() => {
                const categories = [];
                try {
                  const categoryList = orderData?.category_list?.list || [];
                  categoryList.forEach((i) => {
                    if (categories.every((j) => j?.name !== i?.name)) {
                      categories.push(i);
                    }
                  });
                } catch (e) {
                  console.error("Error parsing category_list JSON:", e);
                }

                return categories?.map((cat) => (
                  <div className="">
                    {/* <div className="text-base font-semibold text-black p-2">{cat.name}</div> */}
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-red-100">
                          <TableHead className="w-[50%]">
                            <div>
                              <span className="text-red-700 pr-1 font-extrabold">
                                {cat.name}
                              </span>
                              ({category_make_list?.filter(i => i?.category === cat?.name)?.length > 0 ? (
                                category_make_list?.filter(i => i?.category === cat?.name)?.map((i, index, arr) => (
                                  <i>{i?.make}{index < arr.length - 1 && ", "}</i>
                                ))
                              ) : "--"})
                            </div>
                            {uploadedFiles[cat.name] && (
                              <div className="flex gap-1 items-end">
                                <p>Attached File:</p>{" "}
                                <span className="text-red-700">
                                  {uploadedFiles[cat.name].name}
                                </span>
                              </div>
                            )}
                          </TableHead>
                          <TableHead className="w-[20%]">UOM</TableHead>
                          <TableHead className="w-[10%]">Qty</TableHead>
                          <TableHead className="w-[10%]">Est. Amt</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderData?.procurement_list.list.map((item: any) => {
                          if (
                            item.category === cat.name &&
                            item.status !== "Request"
                          ) {
                            const quotesForItem = quote_data
                              ?.filter(
                                (value) =>
                                  value.item_id === item.name &&
                                  value.quote != null
                              )
                              ?.map((value) => value.quote);
                            let minQuote;
                            if (quotesForItem && quotesForItem.length > 0)
                              minQuote = Math.min(...quotesForItem);
                            return (
                              <TableRow key={item.item}>
                                <TableCell>
                                  {item.item}
                                  <div className="flex gap-1 pt-2 items-start">
                                    <MessageCircleMore className="h-6 w-6 text-blue-400" />
                                    <p
                                      className={`text-xs ${!item.comment ? "text-gray-400" : ""
                                        }`}
                                    >
                                      {item.comment || "No Comments"}
                                    </p>
                                  </div>
                                </TableCell>
                                <TableCell>{item.unit}</TableCell>
                                <TableCell>{item.quantity}</TableCell>
                                <TableCell className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                  {minQuote ? minQuote * item.quantity : "N/A"}
                                </TableCell>
                              </TableRow>
                            );
                          }
                        })}
                        {orderData?.procurement_list.list.map((item: any) => {
                          if (
                            item.category === cat.name &&
                            item.status === "Request"
                          ) {
                            return (
                              <TableRow
                                className="bg-yellow-50"
                                key={item.item}
                              >
                                <TableCell>
                                  {item.item}(
                                  <span className="text-primary">
                                    requested
                                  </span>
                                  )
                                  <div className="flex gap-1 pt-2 items-start">
                                    <MessageCircleMore className="h-6 w-6 text-blue-400" />
                                    <p
                                      className={`text-xs ${!item.comment ? "text-gray-400" : ""
                                        }`}
                                    >
                                      {item.comment || "No Comments"}
                                    </p>
                                  </div>
                                </TableCell>
                                <TableCell>{item.unit}</TableCell>
                                <TableCell>{item.quantity}</TableCell>
                                <TableCell className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                  N/A
                                </TableCell>
                              </TableRow>
                            );
                          }
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ));
              })()}

              {universalComments?.filter(
                (comment) =>
                  managersIdList?.includes(comment.comment_by) ||
                  (comment.comment_by === "Administrator" &&
                    (comment.subject === "creating pr" ||
                      comment.subject === "resolving pr" ||
                      comment.subject === "editing pr"))
              ).length !== 0 && (
                  <div className="flex flex-col gap-2 py-4">
                    <h2 className="text-base font-bold tracking-tight">
                      Previous Comments
                    </h2>
                    <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-4">
                      {universalComments
                        .filter(
                          (comment) =>
                            managersIdList?.includes(comment.comment_by) ||
                            (comment.comment_by === "Administrator" &&
                              (comment.subject === "creating pr" ||
                                comment.subject === "resolving pr" ||
                                comment.subject === "editing pr"))
                        )
                        .map((cmt) => (
                          <div
                            key={cmt.name}
                            className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg"
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
                    </div>
                  </div>
                )}
            </div>
          </div>
          <div className="flex flex-col justify-end items-end">
            <Dialog>
              <div className="flex gap-4">
                <Button variant="secondary" onClick={() => setPage("itemlist")}>
                  <div className="flex items-center gap-1">
                    <Undo2 className="h-4 w-4" />
                    Go Back
                  </div>
                </Button>
                <DialogTrigger asChild>
                  {dynamicPage === "reject" ? (
                    <Button>
                      <div className="flex items-center gap-1">
                        <ListX className="h-4 w-4" />
                        Reject
                      </div>
                    </Button>
                  ) : (
                    <Button>
                      <div className="flex items-center gap-1">
                        <ListChecks className="h-4 w-4" />
                        Approve
                      </div>
                    </Button>
                  )}
                </DialogTrigger>
              </div>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Are you Sure?</DialogTitle>
                  <DialogDescription>
                    {dynamicPage === "reject"
                      ? "Click on Confirm to Reject."
                      : "Click on Confirm to Approve."}
                  </DialogDescription>
                </DialogHeader>
                <DialogDescription className="flex items-center flex-col gap-2">
                  <div className="flex flex-col gap-2 w-full">
                    <h2 className="text-base font-bold tracking-tight">
                      Add Comments
                    </h2>
                    <TextArea
                      placeholder="type here..."
                      defaultValue={universalComment || ""}
                      onChange={handleUniversalCommentChange}
                    />
                  </div>

                  <div className="flex items-center justify-center">
                    {dynamicPage === "reject" ? (
                      createLoading || updateLoading || callLoading ? (
                        <TailSpin width={60} color={"red"} />
                      ) : (
                        <Button
                          variant="default"
                          onClick={() => handleReject()}
                          className="flex items-center gap-1"
                        >
                          <CheckCheck />
                          Confirm
                        </Button>
                      )
                    ) : createLoading || updateLoading || callLoading ? (
                      <TailSpin width={60} color={"red"} />
                    ) : (
                      <Button
                        variant="default"
                        onClick={() => handleApprove()}
                        className="flex items-center gap-1"
                      >
                        <CheckCheck />
                        Confirm
                      </Button>
                    )}
                  </div>
                </DialogDescription>
                <DialogClose className="hidden" id="dialogCloseforApproveOrder">
                  Close
                </DialogClose>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      )}
      {page == "additem" && (
        <div className="flex-1 space-y-4">
          {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
          <div className="flex items-center gap-1">
            <ArrowLeft
              className="cursor-pointer"
              onClick={() => {
                setCurItem("");
                // setMake("");
                setPage("itemlist");
              }}
            />
            <h2 className="text-base font-bold tracking-tight">
              Create new Item
            </h2>
          </div>
          <div className="mb-4">
            <div className="flex">
              <div className="text-lg font-bold py-2">Category: </div>
              <button
                onClick={() => {
                  setCurItem("");
                  // setMake("");
                  setPage("categorylist2");
                }}
                className="text-blue-500 underline ml-1"
              >
                <div className="flex">
                  <div className="text-lg font-bold">{curCategory}</div>
                  <Pencil className="w-4 h-4 ml-1 mt-1.5" />
                </div>
              </button>
            </div>
            <label
              htmlFor="itemName"
              className="block text-sm font-medium text-gray-700"
            >
              Item Name
            </label>
            <Input
              type="text"
              id="itemName"
              value={curItem}
              onChange={(e) => setCurItem(e.target.value)}
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
            {/* <label
              htmlFor="makeName"
              className="block text-sm font-medium text-gray-700"
            >
              Make Name
            </label>
            <Input
              type="text"
              id="makeName"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            /> */}
          </div>
          <div className="mb-4">
            <label
              htmlFor="itemUnit"
              className="block text-sm font-medium text-gray-700"
            >
              Item Unit
            </label>
            <Select onValueChange={(value) => setUnit(value)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue
                  className="text-gray-200"
                  placeholder="Select Unit"
                />
              </SelectTrigger>
              <SelectContent>
                {/* <SelectItem value="PCS">PCS</SelectItem> */}
                <SelectItem value="BOX">BOX</SelectItem>
                <SelectItem value="ROLL">ROLL</SelectItem>
                {/* <SelectItem value="PKT">PKT</SelectItem> */}
                <SelectItem value="LENGTH">LTH</SelectItem>
                <SelectItem value="MTR">MTR</SelectItem>
                <SelectItem value="NOS">NOS</SelectItem>
                <SelectItem value="KGS">KGS</SelectItem>
                <SelectItem value="PAIRS">PAIRS</SelectItem>
                <SelectItem value="PACKS">PACKS</SelectItem>
                <SelectItem value="DRUM">DRUM</SelectItem>
                {/* <SelectItem value="COIL">COIL</SelectItem> */}
                <SelectItem value="SQMTR">SQMTR</SelectItem>
                <SelectItem value="LTR">LTR</SelectItem>
                {/* <SelectItem value="PAC">PAC</SelectItem> */}
                {/* <SelectItem value="BAG">BAG</SelectItem> */}
                <SelectItem value="BUNDLE">BUNDLE</SelectItem>
                <SelectItem value="FEET">FEET</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="py-10">
            <div className="">
              <Dialog>
                <DialogTrigger asChild>
                  {curItem && unit ? (
                    <Button className="mt-15 h-8 w-full bg-red-700 rounded-md text-sm text-white">
                      Confirm and Submit
                    </Button>
                  ) : (
                    <Button
                      disabled={true}
                      variant="secondary"
                      className="h-8 w-full rounded-md text-sm"
                    >
                      Confirm and Submit
                    </Button>
                  )}
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Are you Sure</DialogTitle>
                    <DialogDescription>
                      Click on Confirm to create new Item.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogClose>
                    <Button variant="secondary" onClick={() => handleAddItem()}>
                      Confirm
                    </Button>
                  </DialogClose>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      )}
      {page == "categorylist2" && (
        <div className="flex-1 md:space-y-4">
          <div className="flex items-center space-y-2">
            <ArrowLeft
              className="cursor-pointer"
              onClick={() => setPage("additem")}
            />
            <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">
              Select Category
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
            {category_list?.map((item) => {
              if (item.work_package === orderData.work_package) {
                return (
                  <Card
                    className="flex flex-col items-center shadow-none border border-grey-500 hover:animate-shadow-drop-center"
                    onClick={() => handleCategoryClick2(item.category_name)}
                  >
                    <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                      <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                        <img
                          className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0"
                          src={
                            item.image_url === null ? imageUrl : item.image_url
                          }
                          alt="Category"
                        />
                        <span>{item.category_name}</span>
                      </CardTitle>
                      {/* <HardHat className="h-4 w-4 text-muted-foreground" /> */}
                    </CardHeader>
                  </Card>
                );
              }
            })}
          </div>
        </div>
      )}
    </>
  );
};

export const Component = ApprovePRList;