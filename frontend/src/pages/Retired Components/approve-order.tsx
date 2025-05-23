import { ProcurementActionsHeaderCard } from "@/components/helpers/ProcurementActionsHeaderCard";
import { RenderPRorSBComments } from "@/components/helpers/RenderPRorSBComments";
import { SelectUnit } from "@/components/helpers/SelectUnit";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { Category } from "@/types/NirmaanStack/Category";
import { Items } from "@/types/NirmaanStack/Items";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import formatToIndianRupee from "@/utils/FormatPrice";
import TextArea from "antd/es/input/TextArea";
import {
    useFrappeCreateDoc,
    useFrappeDeleteDoc,
    useFrappeFileUpload,
    useFrappeGetDoc,
    useFrappeGetDocList,
    useFrappePostCall,
    useFrappeUpdateDoc,
    useSWRConfig,
} from "frappe-react-sdk";
import Fuse from "fuse.js";
import {
    ArrowLeft,
    CheckCheck,
    CirclePlus,
    ListChecks,
    ListX,
    MessageCircleMore,
    Pencil,
    Trash,
    Trash2,
    Undo,
    Undo2,
    X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import ReactSelect from "react-select";

export const ApprovePRList : React.FC = () => {
  const { prId: id } = useParams<{ prId: string }>();
  const { data: pr, isLoading: pr_loading, error: pr_error, mutate: prMutate } = useFrappeGetDoc("Procurement Requests", id);
  const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc(
    "Projects",
    pr?.project,
    pr ? undefined : null
  );

  const { data: usersList, isLoading: usersListLoading, error: usersListError } = useFrappeGetDocList<NirmaanUsersType>("Nirmaan Users", {
    fields: ["name", "full_name"],
    limit: 1000,
  });

  const navigate = useNavigate();

  const getUserName = (id : string | undefined) => {
    return usersList?.find((user) => user?.name === id)?.full_name || ""
  };

  if (pr_loading || project_loading || usersListLoading)
    return (
      <div className="flex items-center h-[90vh] w-full justify-center">
        <TailSpin color={"red"} />{" "}
      </div>
    );
  if (pr_error || project_error || usersListError)
    return <h1>Error</h1>;
  if (pr?.workflow_state !== "Pending") {
    return (
      <div className="flex items-center justify-center h-[90vh]">
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
            onClick={() => navigate("/procurement-requests?tab=Approve PR")}
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
    />
  );
};

interface ApprovePRListPageProps {
  pr_data: any;
  project_data?: any;
  prMutate?: any;
}

const ApprovePRListPage : React.FC<ApprovePRListPageProps> = ({ pr_data, project_data, prMutate,}) => {
  const navigate = useNavigate();
  const userData = useUserData();

  const { data: category_list } = useFrappeGetDocList<Category>("Category", {
    fields: [ "category_name", "work_package", "image_url", "tax", "new_items", "name"],
    filters: [["work_package", "=", pr_data?.work_package]],
    orderBy: { field: "category_name", order: "asc" },
    limit: 10000,
  });

  const { data: item_list, mutate: item_list_mutate } = useFrappeGetDocList<Items>("Items", {
    fields: ["name", "item_name", "make_name", "unit_name", "category", "creation"],
    filters: [["category", "in", (category_list || [])?.map((i) => i?.name)]],
    orderBy: { field: "creation", order: "desc" },
    limit: 100000,
  },
  category_list?.length ? undefined : null
  );

  const { data: quote_data } = useFrappeGetDocList<ApprovedQuotations>("Approved Quotations", {
    fields: ["item_id", "quote"],
    limit: 100000,
  },
  `Approved Quotations`
);

  const { data: universalComments } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
    fields: ["*"],
    filters: [["reference_name", "=", pr_data.name]],
    orderBy: { field: "creation", order: "desc" },
  });

  const { data: usersList } = useFrappeGetDocList<NirmaanUsersType>("Nirmaan Users", {
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

  const { createDoc: createDoc, loading: createLoading } = useFrappeCreateDoc();

  const [showNewItemsCard, setShowNewItemsCard] = useState(false)

  const toggleNewItemsCard = useCallback(() => {
    setShowNewItemsCard((prevState) => !prevState);
  }, [showNewItemsCard]);

  interface ItemOptionsType {
    label: string;
    value: string;
    category: string;
    unit: string;
    tax: number;
  }

  const [itemOptions, setItemOptions] = useState<ItemOptionsType[]>([]);
  const [page, setPage] = useState<string>("itemlist");
  const [curItem, setCurItem] = useState<string>("");
  const [curCategory, setCurCategory] = useState<string>("");
  const [unit, setUnit] = useState<string>("");
  const [quantity, setQuantity] = useState<number | null | string>(null);
  const [dynamicPage, setDynamicPage] = useState<string | null>(null);
  const [universalComment, setUniversalComment] = useState<string | null>(null);
  const [stack, setStack] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({});
  const [requestCategory, setRequestCategory] = useState("");
  const [newItem, setNewItem] = useState({})

  const [requestItemName, setRequestItemName] = useState({});

  const [requestItemDialog, setRequestItemDialog] = useState(false);

  const toggleRequestItemDialog = () => {
    setRequestItemDialog((prevState) => !prevState);
  };

  const [newItemDialog, setNewItemDialog] = useState(false);

  const toggleNewItemDialog = useCallback(() => {
    setNewItemDialog((prevState) => !prevState);
  }, [newItemDialog]);

  const [editItem, setEditItem] = useState({})

  const [editItemDialog, setEditItemDialog] = useState(false);

  const toggleEditItemDialog = useCallback(() => {
    setEditItemDialog((prevState) => !prevState);
  }, [editItemDialog]);

  const [fuzzyMatches, setFuzzyMatches] = useState([]);

  const managersIdList = useMemo(() => usersList?.map((user) => user?.name) || [], [usersList])

  const getFullName = useMemo(() => (id: string | undefined) => {
    return usersList?.find((user) => user.name === id)?.full_name || "";
  }, [usersList]);

  const handleUniversalCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setUniversalComment(e.target.value === "" ? null : e.target.value);
  }, [setUniversalComment]);

  const triggerFileInput = useCallback((name: string) => {
    document.getElementById(`file-upload-${name}`)?.click();
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>, catName: string) => {
    const file = event.target.files?.[0];
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
  }, [setUploadedFiles]);

  const removeFile = useCallback((catName: string) => {
    setUploadedFiles((prev) => {
      const newFiles = { ...prev };
      delete newFiles[catName];
      return newFiles;
    });
  }, [setUploadedFiles]);

  const [orderData, setOrderData] = useState<ProcurementRequest | null>(null);

  // console.log("pr_data", pr_data)

  useEffect(() => {
    if(category_list) {
      const options : ItemOptionsType[] = [];
      item_list?.map((item) => {
        if (category_list.some(i => i.name === item.category)) {
          options.push({
            value: item.name,
            label: item.item_name,
            unit: item?.unit_name,
            category: item.category,
            tax: parseFloat(category_list?.find(i => i?.name === item.category)?.tax || "0"),
          });
        }
      });
      setItemOptions(options);
    }
  }, [category_list, item_list])

  useEffect(() => {
    if (!orderData?.project) {
      let mod_pr_data = {
        ...pr_data,
        category_list: JSON.parse(pr_data?.category_list),
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

  useEffect(() => {
    const newCategories : {name: string, status?: string, makes? : string[]}[] = [];
    if (orderData && orderData.procurement_list.list.some((i) => i.status === "Request")) {
      orderData.procurement_list.list.map((item) => {
        const isDuplicate = newCategories.some(
          (category) =>
            category.name === item.category && category?.status === item.status
        );
        if (!isDuplicate) {
          if (item.status === "Pending") {
            const makes = project_data.project_work_packages
            ? JSON.parse(project_data.project_work_packages).work_packages
                .flatMap((wp) => wp.category_list?.list || []) // Flatten all categories across work packages
                .filter((cat) => cat.name === item.category) // Filter categories matching item.category
                .flatMap((cat) => cat.makes || []) // Extract and flatten makes
            : []; // Return an empty array if project_work_packages is not defined 
            newCategories.push({ name: item.category, status: item.status, makes: makes || [] });
          } else {
            newCategories.push({ name: item.category, status: item.status });
          }
        }
      });
    } else {
      orderData?.procurement_list.list.map((item) => {
        const isDuplicate = newCategories.some(
          (category) => category.name === item.category
        );
        if (!isDuplicate) {
          const makes = project_data.project_work_packages
          ? JSON.parse(project_data.project_work_packages).work_packages
              .flatMap((wp) => wp.category_list?.list || []) // Flatten all categories across work packages
              .filter((cat) => cat.name === item.category) // Filter categories matching item.category
              .flatMap((cat) => cat.makes || []) // Extract and flatten makes
          : []; // Return an empty array if project_work_packages is not defined
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
  }, [orderData?.procurement_list]);


  const handleAdd = () => {
    if (curItem && Number(quantity)) {

        const curRequest = [...orderData.procurement_list.list];
        const curValue = {
          item: curItem.label,
          name: curItem.value,
          unit: curItem.unit,
          quantity: Number(quantity),
          category: curItem.category,
          tax: curItem.tax,
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
                You are trying to add the <b>item: {curItem?.label}</b> multiple times
                which is not allowed, instead edit the quantity directly!
              </span>
            ),
          });
        }
        setQuantity("");
        setCurItem("");
    }
  };

  const handleSave = (itemName: string, newQuantity: string) => {
    let curRequest = orderData?.procurement_list?.list || [];
    curRequest = curRequest.map((curValue) => {
      if (curValue.item === itemName) {
        return {
          ...curValue,
          quantity: parseFloat(newQuantity),
          comment: editItem?.comment || "",
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
    setCurItem("");
  };

  const handleDelete = (item: string) => {
    let curRequest = orderData?.procurement_list?.list || [];
    let itemToPush = curRequest.find((curValue) => curValue.item === item);

    if (itemToPush.status !== "Request") {
      setStack((prevStack) => [...prevStack, itemToPush]);
    }

    curRequest = curRequest.filter((curValue) => curValue.item !== item);
    setOrderData((prevState) => ({
      ...prevState,
      procurement_list: {
        list: curRequest,
      },
    }));

    setCurItem("");
  };

  const UndoDeleteOperation = () => {
    let curRequest = orderData?.procurement_list?.list || [];
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

  const { toast } = useToast();
  const { updateDoc: updateDoc, loading: updateLoading, error: submit_error,} = useFrappeUpdateDoc();
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
          procurement_request: orderData?.name,
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

      const res = await updateDoc("Procurement Requests", orderData?.name, {
        procurement_list: orderData?.procurement_list,
        category_list: orderData?.category_list,
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

      navigate("/procurement-requests?tab=Approve PR");
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

      const res = await updateDoc("Procurement Requests", orderData?.name, {
        procurement_list: orderData?.procurement_list,
        category_list: orderData?.category_list,
        workflow_state: "Rejected",
      });

      if (universalComment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Procurement Requests",
          reference_name: orderData?.name,
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
      navigate("/procurement-requests?tab=Approve PR");
    } catch (error) {
      toast({
        title: "Failed!",
        description: `There was an error while Rejected PR: ${orderData?.name}`,
        variant: "destructive",
      });
      console.log("error occured while rejecting PR", error, submit_error);
    }
  };

  const handleAddItem = async () => {
    try {
      const itemData = {
        category: curCategory.value,
        unit_name: newItem.unit_name,
        item_name: newItem.item_name,
      };

      const res = await createDoc("Items", itemData)

      const curRequest = [...orderData?.procurement_list?.list];

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

      curRequest.push(itemToAdd);

      setOrderData((prevState) => ({
        ...prevState,
        procurement_list: {
          list: curRequest,
        },
      }));
  
      await item_list_mutate();

      setNewItem({});

      setCurCategory("")

      toast({
        title: "Success!",
        description: `New Item: ${res?.item_name} created and added to Order List successfully!`,
        variant: "success",
      });


      toggleNewItemDialog()

    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: `Item Creation failed!`,
        variant: "destructive",
      });
    }

  };

  const handleDeletePr = async () => {
    try {
      await deleteDoc("Procurement Requests", orderData?.name);
      await mutate(`Procurement Requests ${orderData?.project}`);
      await mutate("ApprovePR,PRListMutate");
      toast({
        title: "Success!",
        description: `PR: ${orderData?.name} deleted successfully!`,
        variant: "success",
      });
      navigate("/procurement-requests?tab=Approve PR");
    } catch (error) {
      console.log("error while deleting PR", error);
      toast({
        title: "Failed!",
        description: `PR: ${orderData?.name} deletion Failed!`,
        variant: "destructive",
      });
    }
  };

  const handleRequestItem = async () => {
    const itemData = {
      category: requestCategory,
      unit_name: unit,
      item_name: curItem,
    };
    try {
      const res = await createDoc("Items", itemData);

      const curRequest = [...orderData?.procurement_list.list];

      const combinedRequest = [...curRequest, ...stack];

      const itemToUpdate = combinedRequest.find((i) => i.name === requestItemName.name);
      
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

      await updateDoc("Procurement Requests", orderData?.name, {
        procurement_list: { list: combinedRequest },
        category_list: {
          list: newCategories,
        },
      });

      await prMutate();

      await item_list_mutate();

      toast({
        title: "Success!",
        description: `Requested Item: ${res.item_name} created and added to Order List successfully!`,
        variant: "success",
      });

      setCurItem("");
      setUnit("");
      setQuantity("");
      setRequestCategory("");
      setRequestItemName({})

      toggleRequestItemDialog()

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
        let curRequest = [...orderData?.procurement_list?.list];

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



  // console.log("curItem", curItem)
  // console.log("stack", stack)
  // console.log("uploadedFiles", uploadedFiles)

    // console.log("orderData", orderData)

  return (
    <>
      {page == "itemlist" && (
        <div className="flex-1 space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
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

          {!showNewItemsCard && (
            <button
              className="text-lg text-blue-400 flex p-2 items-center gap-1"
              onClick={toggleNewItemsCard}
            >
              <CirclePlus className="w-4 h-4" /> Add Missing Items
            </button>
          )}

          {showNewItemsCard && (
            <Card className="p-4 max-sm:p-2 border border-gray-100 rounded-lg">
              <div className="flex justify-end mb-2">
                <button
                  className="text-red-600"
                  onClick={() => {
                    setCurItem("");
                    setCurCategory("");
                    toggleNewItemsCard()
                  }}
                >
                  <X className="w-6 h-6 " />
                </button>
              </div>

              <div className="flex space-x-2">
                <div className="w-1/2 md:w-2/3">
                  <h5 className="text-xs text-gray-400">Items</h5>
                  <ReactSelect
                    value={curItem}
                    options={itemOptions}
                    onChange={(selected) =>  setCurItem(selected)}
                    isClearable
                    onMenuOpen={() => setCurItem(null)}
                  />
                </div>
                <div className="flex-1">
                  <h5 className="text-xs text-gray-400">UOM</h5>
                  <input
                    className="h-[37px] w-full"
                    type="text"
                    placeholder={"Unit"}
                    value={curItem?.unit}
                  />
                </div>
                <div className="flex-1">
                  <h5 className="text-xs text-gray-400">Qty</h5>
                  <input
                    type="number"
                    className="h-[37px] w-full border p-2 rounded-lg outline-none"
                    onChange={(e) =>
                      setQuantity(
                        e.target.value === "" ? null : parseFloat(e.target.value)
                      )
                    }
                    value={quantity || ""}
                  />
                </div>
              </div>
              <div className="flex justify-between mt-4 items-center">
                {["Nirmaan Admin Profile"].includes(userData?.role) ? (
                  <Button
                    variant={"ghost"}
                    className="text-sm py-2 px-0 md:text-lg text-blue-400 flex items-center gap-1 hover:bg-white"
                    onClick={toggleNewItemDialog}
                  >
                    <CirclePlus className="w-4 h-4" />
                    Create new item
                  </Button>
                ) : (
                  <div />
                )}

                  <Button
                    disabled={!curItem || !quantity}
                    variant="outline"
                    className="border border-red-500 px-8 text-red-500"
                    onClick={handleAdd}
                  >
                    Add
                    </Button>
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
          {orderData?.procurement_list?.list?.length === 0 && (
            <div className="text-sm">
              No Items to display, please click on "Undo" button to recover the
              deleted items or add at least an item to enable the "Approve" or
              "Reject" button
            </div>
          )}

          {(orderData || [])?.category_list?.list?.filter((i) => i?.status !== "Request")
            ?.length !== 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Added Items</CardTitle>
                </CardHeader>
                <CardContent>
                  {orderData?.category_list?.list
                    ?.filter((i) => i?.status !== "Request")
                    ?.map((cat) => {
                      return (
                        <div key={cat.name}>
                          <div className="flex items-center justify-between">
                            <div key={cat.id} className="flex gap-1 items-center">
                              <h3 className="text-sm font-semibold py-2">
                                {cat.name}
                              </h3>
                              {/* <div
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
                              </div> */}
                              {/* {uploadedFiles[cat.name] && (
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
                              )} */}
                            </div>
                            <div className="text-sm font-bold text-gray-500">
                            {JSON.parse(project_data.project_work_packages).work_packages
                              .flatMap((wp) => wp.category_list?.list || []) // Flatten all categories across work packages
                              .filter((category) => category?.name === cat?.name)?.length > 0 ? (
                                JSON.parse(project_data.project_work_packages).work_packages
                                  .flatMap((wp) => wp.category_list?.list || [])
                                  .filter((category) => category?.name === cat?.name)
                                  .flatMap((category) => category.makes || [])
                                  .map((make, index, arr) => (
                                    <i key={index}>{make}{index < arr.length - 1 && ", "}</i>
                                  ))
                              ) : (
                                "--"
                              )}
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
                              {orderData?.procurement_list?.list?.map((item) => {
                                if (
                                  item.category === cat.name &&
                                  item.status !== "Request"
                                ) {
                                  return (
                                    <tr key={item.name}>
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
                                        <AlertDialog open={editItemDialog} onOpenChange={toggleEditItemDialog}>
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
                                            <Pencil className="w-4 h-4" />
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle className="flex justify-between">
                                                Edit Item
                                                <AlertDialogCancel
                                                  onClick={() => setEditItem({})}
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
                                                      {editItem.item}
                                                    </div>
                                                  </div>
                                                  <div className="w-[30%]">
                                                    <h5 className="text-base text-gray-400 text-left mb-1">
                                                      UOM
                                                    </h5>
                                                    <div className=" w-full  p-2 text-center justify-left flex">
                                                      {editItem.unit}
                                                    </div>
                                                  </div>
                                                  <div className="w-[25%]">
                                                    <h5 className="text-base text-gray-400 text-left mb-1">
                                                      Qty
                                                    </h5>
                                                    <input
                                                      type="number"
                                                      value={editItem.quantity || ""}
                                                      className=" rounded-lg w-full border p-2"
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
                                                    className="block p-2 border-gray-300 border rounded-md w-full"
                                                    placeholder="Add comment..."
                                                    onChange={(e) =>
                                                      setEditItem({
                                                        ...editItem,
                                                        comment:
                                                          e.target.value,
                                                      })
                                                    }
                                                    value={
                                                      editItem.comment || ""
                                                    }
                                                  />
                                                </div>
                                              </AlertDialogDescription>
                                              <AlertDialogDescription className="flex justify-end">
                                                <div className="flex gap-2">
                                                  <AlertDialogAction
                                                    className="bg-gray-100 text-black hover:text-white flex gap-1 items-center"
                                                    onClick={() =>
                                                      handleDelete(editItem.item)
                                                    }
                                                  >
                                                    <Trash2 className="h-4 w-4" />
                                                    Delete
                                                  </AlertDialogAction>
                                                  <AlertDialogAction
                                                    disabled={!editItem?.quantity}
                                                    onClick={() =>
                                                      handleSave(
                                                        editItem.item,
                                                        editItem.quantity
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

          {(orderData || [])?.category_list?.list?.filter((i) => i?.status === "Request")
            ?.length !== 0 && (
              <Card className="bg-yellow-50">
                <CardHeader>
                  <CardTitle>Requested Items</CardTitle>
                </CardHeader>
                <CardContent>
                  {orderData?.category_list?.list
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
                              {orderData?.procurement_list?.list?.map((item) => {
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
                                                    value={requestCategory}
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
                                                    <SelectUnit 
                                                      value={unit}
                                                      onValueChange={(value) => setUnit(value)}
                                                    />
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
                                                            ? 0
                                                            : parseFloat(
                                                              e.target.value
                                                            )
                                                        )
                                                      }
                                                      value={quantity || ""}
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
                                                      onClick={
                                                        handleRequestItem
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
                                                      <div className="flex justify-between items-center border-b pb-1">
                                                        <div className="flex flex-col gap-1">
                                                          <strong>{i?.item_name}</strong>

                                                          <div className="flex items-center gap-2">
                                                            <p className="text-gray-400 font-semibold">{item?.category}</p>
                                                            <i className="text-gray-500">
                                                              {" "}
                                                              - {i?.matchPercentage}% match
                                                            </i>
                                                          </div>            
                                                        </div>

                                                          <div
                                                            onClick={() => handleAddMatchingItem({ item_name: i?.item_name, unit: i?.unit_name, quantity: quantity || 1, category: i?.category }, requestItemName)}
                                                            className="text-primary font-bold text-xs cursor-pointer border p-2 rounded-md bg-gray-200 hover:bg-white flex items-center gap-1">
                                                              <CirclePlus className="w-4 h-4" />
                                                              Add
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

          <div className="space-y-2">
            <h2 className="text-base pl-2 font-bold tracking-tight">
              PR Comments
            </h2>
            <RenderPRorSBComments universalComment={(universalComments || [])
                ?.filter(
                  (comment) =>
                    (managersIdList || []).includes(comment.comment_by) ||
                    (comment.comment_by === "Administrator" &&
                      (comment.subject === "creating pr" ||
                        comment.subject === "resolving pr" ||
                        comment.subject === "editing pr"))
                )} getUserName={getFullName} />
          </div>

          <div className="flex gap-4 justify-end items-end mt-4">
            <Button
              disabled={!orderData?.procurement_list?.list?.length}
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
                !orderData?.procurement_list?.list?.length ||
                orderData?.procurement_list?.list?.some(
                  (i) => i?.status === "Request"
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

        </div>
      )}
      {page == "summary" && (
        <div className="flex-1 space-y-4">
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
                              {cat?.makes?.length > 0 ? (cat?.makes?.map((make, index, arr) => (
                                  <i key={index}>{make}{index < arr.length - 1 && ", "}</i>
                                ))
                            ) : (
                              "- no makes -")}
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
                        {orderData?.procurement_list?.list?.map((item: any) => {
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
                                  {minQuote ? formatToIndianRupee(minQuote * item.quantity) : "N/A"}
                                </TableCell>
                              </TableRow>
                            );
                          }
                        })}
                        {orderData?.procurement_list?.list?.map((item: any) => {
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
        <AlertDialog open={newItemDialog} onOpenChange={toggleNewItemDialog}>
                <AlertDialogContent>
                  <AlertDialogHeader className="text-start">
                    <AlertDialogTitle>
                      Create New{" "}
                      <strong className="text-primary">{pr_data?.work_package}</strong>{" "}
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
                            value={curCategory}
                            options={category_list?.map(i => ({label : i?.name, value : i?.name, tax : parseFloat(i?.tax || "0")}))}
                            onChange={(e) => {
                              setCurCategory(e);
                            }}
                            isClearable
                            onMenuOpen={() => setCurCategory(null)}
                          />
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
                            }
                            }
                          />
                        </div>
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
                            onChange={(value) => setNewItem((prevState) => ({
                              ...prevState,
                              unit_name: value,
                            }))}
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
                    {createLoading ? (
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
                      )}
                  </div>
                </AlertDialogContent>
              </AlertDialog>
    </>
  );
};

export default ApprovePRList;