import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { v4 as uuidv4 } from 'uuid';

// Frappe SDK and Utils
import { useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall,useFrappeGetDoc } from "frappe-react-sdk";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

// UI Components
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { ProcurementHeaderCard } from "@/components/helpers/ProcurementHeaderCard";
import { SelectUnit } from "@/components/helpers/SelectUnit";
import { VendorsReactSelect } from "@/components/helpers/VendorsReactSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { CirclePlus, Trash2 } from "lucide-react";

// Hooks and Types
import { useUserData } from "@/hooks/useUserData";
import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor";
import { NewVendor } from "@/pages/vendors/new-vendor";
import { ProcurementItem, ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";

// New Imports for Summary & Payment Terms
import { CustomPRSummary } from './CustomPRSummary';
import { PaymentTermsDialog } from '../VendorQuotesSelection/components/PaymentTermsDialog';
import { PaymentTermsData, VendorPaymentTerm } from '@/pages/ProcurementRequests/VendorQuotesSelection/types/paymentTerms';

// Local type definitions for this component
interface CustomPRItem extends ProcurementItem {
  procurement_package: string;
}

interface DisplayItem extends CustomPRItem {
  amountInclGst: number;
}

interface NewCustomPRProps {
  resolve?: boolean;
}

export const NewCustomPR: React.FC<NewCustomPRProps> = ({ resolve = false }) => {
  const navigate = useNavigate();
  const { prId, projectId } = useParams<{ prId: string, projectId: string }>();

  // --- Data Fetching ---
  const { data: prDoc, isLoading: prDocLoading } = useFrappeGetDoc<ProcurementRequest>(
    "Procurement Requests", 
    prId,
    prId ? `Procurement Request ${prId}` : undefined
  );

  const { data: vendor_list, isLoading: vendorListLoading } = useFrappeGetDocList<Vendors>("Vendors", {
    fields: ["*"],
    limit: 10000,
  }, "Vendors");
  
  const { data: procurement_packages, isLoading: procurementPackagesLoading } = useFrappeGetDocList("Procurement Packages", {
    fields: ["*"],
    filters: [["name", "!=", "Services"]],
    orderBy: { field: 'name', order: 'asc' },
    limit: 100
  }, "Procurement Packages-Services");

  const { data: category_data, isLoading: categoryDataLoading } = useFrappeGetDocList("Category", {
    fields: ["*"],
    filters: [['work_package', '!=', 'Services']],
    orderBy: { field: 'category_name', order: 'asc' },
    limit: 10000
  }, "Categories-Services");

  const { call: newCustomPRCall, loading: newCustomPRLoading } = useFrappePostCall("nirmaan_stack.api.custom_pr_api.new_custom_pr");
  const { call: resolveCustomPRCall, loading: resolveCustomPRCallLoading } = useFrappePostCall("nirmaan_stack.api.custom_pr_api.resolve_custom_pr");
  const { upload } = useFrappeFileUpload();

  // --- Component State ---
  const [section, setSection] = useState("choose-vendor");
  const [selectedVendor, setSelectedvendor] = useState<Vendor | null>(null);
  const [order, setOrder] = useState<CustomPRItem[]>([]);
  const [amounts, setAmounts] = useState<{ [key: string]: number }>({});
  const [categories, setCategories] = useState<{ list: { name: string, makes: string[] }[] }>({ list: [] });
  const [comment, setComment] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermsData>({});
  const [editingVendor, setEditingVendor] = useState<{ id: string; name: string; total: number; } | null>(null);

  // --- Memoized Values & Derived State ---
  const vendorOptions: Vendor[] = useMemo(() => vendor_list?.map((item) => ({
    value: item.name,
    label: item.vendor_name,
    city: item?.vendor_city || "",
    state: item?.vendor_state || "",
  })) || [], [vendor_list]);

  const vendorTotal = useMemo(() => {
    if (!selectedVendor || order.length === 0) return 0;
    return order.reduce((total, item) => {
      const quantity = item.quantity || 0;
      const quote = amounts[item.name] || 0;
      const taxRate = parseNumber(item.tax) / 100;
      const itemTotal = quantity * quote;
      return total + (itemTotal * (1 + taxRate));
    }, 0);
  }, [order, amounts, selectedVendor]);

  const arePaymentTermsSet = useMemo(() => {
    if (!selectedVendor) return false;
    return !!paymentTerms[selectedVendor.value];
  }, [selectedVendor, paymentTerms]);

  const approvalSummary = useMemo(() => {
    if (!selectedVendor) return null;
    const items: DisplayItem[] = [];
    let totalExclGst = 0;
    let totalInclGst = 0;
    order.forEach(item => {
      const quote = amounts[item.name] || 0;
      const quantity = item.quantity || 0;
      const taxRate = parseNumber(item.tax) / 100;
      const baseTotal = quote * quantity;
      const finalAmount = baseTotal * (1 + taxRate);
      items.push({ ...item, amountInclGst: finalAmount });
      totalExclGst += baseTotal;
      totalInclGst += finalAmount;
    });
    return {
      vendorId: selectedVendor.value,
      vendorName: selectedVendor.label,
      items,
      total: totalExclGst,
      totalInclGst: totalInclGst,
    };
  }, [order, amounts, selectedVendor]);

  const checkNextButtonStatus = useCallback(() => {
    const allAmountsFilled = Object.values(amounts).every(amount => amount && amount > 0);
    const allAmountsCount = Object.keys(amounts)?.length === order?.length;
    const allFieldsFilled = !order.some(i => !i?.quantity || !i?.unit || !i?.category || !i?.procurement_package || !i?.tax || !(i.item || i.item_name));
    return allAmountsFilled && allAmountsCount && allFieldsFilled && order.length !== 0 && !!selectedVendor?.value;
  }, [amounts, order, selectedVendor]);

  // --- Effects ---
  useEffect(() => {
    if (resolve && prDoc && vendor_list && vendor_list.length > 0) {
      const request = prDoc;
      
      const transformedOrder = (request?.order_list || []).map((item: any) => ({
        ...item,
        item: item.item_name || item.item,
        name: item.item_id || item.name // Restore UUID from item_id if available
      })) as CustomPRItem[];

      setOrder(transformedOrder);
      setCategories(request?.category_list);
      
      const amounts: { [key: string]: number } = {};
      transformedOrder.forEach(item => { amounts[item.name] = item.quote; });
      setAmounts(amounts);
      
      const vendorId = request?.order_list?.[0]?.vendor;
      const vendor = vendor_list?.find(v => v.name === vendorId);
      if(vendor) {
        setSelectedvendor({ value: vendor.name, label: vendor.vendor_name, city: vendor.vendor_city || "", state: vendor.vendor_state || "" });
      }
      
      if (request.payment_terms && typeof request.payment_terms === 'string') {
        try {
          const parsedData = JSON.parse(request.payment_terms);
          if (parsedData && parsedData.list) {
            setPaymentTerms(parsedData.list);
          }
        } catch (e) {
          console.error("Failed to parse payment_terms from PR", e);
        }
      }
    }
  }, [resolve, prId, prDoc, vendor_list]);

  // --- Handlers ---
  const handleAmountChange = useCallback((id: string, value: string) => {
    setAmounts(prev => ({ ...prev, [id]: parseNumber(value) }));
  }, []);

  const handleSaveAmounts = useCallback(() => {
    let newOrderData = order.map(item => ({ ...item, quote: amounts[item.name], vendor: selectedVendor?.value }));
    setOrder(newOrderData);
    setSection("summary");
    const newCategories: { name: string, makes: string[] }[] = [];
    order.forEach((item) => {
      if (!newCategories.some(category => category.name === item.category)) {
        newCategories.push({ name: item.category, makes: [] });
      }
    });
    setCategories({ list: newCategories });
  }, [order, amounts, selectedVendor]);

  const handleInputChange = useCallback((id: string, field: keyof CustomPRItem, value: string | number) => {
    setOrder(currentOrder =>
      currentOrder.map(item => {
        if (item.name !== id) return item;
        if (field === 'procurement_package') return { ...item, procurement_package: value as string, category: '' };
        return { ...item, [field]: value };
      })
    );
  }, []);

  const handleConfirmPaymentTerms = useCallback((vendorId: string, data: VendorPaymentTerm) => {
    setPaymentTerms(prev => ({ ...prev, [vendorId]: data }));
    setEditingVendor(null);
  }, []);

  const handleSubmit = async () => {
    if (!selectedVendor) {
      toast({ title: "Vendor Not Selected", variant: "destructive" });
      return;
    }
    try {
      let file_url = null;
      if (attachment) {
        const fileArgs = { doctype: "Procurement Requests", docname: "temp_doc", fieldname: "attachment", isPrivate: true };
        const uploadedFile = await upload(attachment, fileArgs);
        file_url = uploadedFile.file_url;
      }
      const response = await newCustomPRCall({
        project_id: projectId,
        order: order,
        categories: categories.list,
        comment: comment,
        attachment: attachment ? { file_url: file_url } : null,
        payment_terms: Object.keys(paymentTerms).length > 0 ? JSON.stringify({ list: paymentTerms }) : null
      });

      if (response.message.status === 200) {
        toast({ title: "Success!", description: response.message.message, variant: "success" });
        navigate("/prs&milestones/procurement-requests");
      } else {
        toast({ title: "Failed!", description: response.message.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Failed!", description: `Unable to send Custom PR for approval`, variant: "destructive" });
    }
  };

  const handleResolvePR = async () => {
    if (!selectedVendor) {
      toast({ title: "Vendor Not Selected", variant: "destructive" });
      return;
    }
    try {
      let file_url = null;
      if (attachment) {
        const fileArgs = { doctype: "Procurement Requests", docname: "temp_doc", fieldname: "attachment", isPrivate: true };
        const uploadedFile = await upload(attachment, fileArgs);
        file_url = uploadedFile.file_url;
      }
      const response = await resolveCustomPRCall({
        project_id: prDoc?.project,
        pr_id: prId,
        order: order,
        categories: categories.list,
        comment: comment,
        attachment: attachment ? { file_url: file_url } : null,
        payment_terms: Object.keys(paymentTerms).length > 0 ? JSON.stringify({ list: paymentTerms }) : null
      });

      if (response.message.status === 200) {
        toast({ title: "Success!", description: response.message.message, variant: "success" });
        navigate(-1);
      } else {
        toast({ title: "Failed!", description: response.message.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Failed!", description: `Unable to resolve Custom PR!`, variant: "destructive" });
    }
  };

  if (prDocLoading || vendorListLoading || procurementPackagesLoading || categoryDataLoading) {
    return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>;
  }

  // --- Render ---
  return (
    <div className="flex-1 space-y-4">
      {/* The Header Card is now only rendered here, at the top level */}
      {section === "choose-vendor" && (
          <ProcurementHeaderCard orderData={prDoc} customPr />
      )}
      
      {section === "choose-vendor" && (
        <>
          <div className="flex justify-between items-center">
            <h2 className="text-lg text-gray-400">Select vendor for this Custom PR</h2>
            <Sheet>
              <SheetTrigger className="text-blue-500">
                <div className="text-base text-blue-400 text-center"><CirclePlus className="w-4 h-4 inline-block" /> <span>New Vendor</span></div>
              </SheetTrigger>
              <SheetContent className="overflow-auto">
                <SheetHeader className="text-start">
                  <SheetTitle><div className="flex-1"><span className="underline">Add New Vendor</span><p className=" text-xs font-light text-slate-500 p-1">Add a new vendor here</p></div></SheetTitle>
                  <NewVendor renderCategorySelection={false} navigation={false} />
                </SheetHeader>
              </SheetContent>
            </Sheet>
          </div>
          <div className="flex gap-4 items-start">
            <div className="w-2/3">
              <VendorsReactSelect selectedVendor={selectedVendor} vendorOptions={vendorOptions} setSelectedvendor={setSelectedvendor} />
            </div>
            <CustomAttachment maxFileSize={20 * 1024 * 1024} selectedFile={attachment} onFileSelect={setAttachment} label="Attach" className="w-1/3" />
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-full inline-block align-middle">
              <Table>
                <TableHeader>
                  <TableRow className="bg-red-100">
                    <TableHead className="text-red-700 font-extrabold min-w-[200px]">Procurement Package</TableHead>
                    <TableHead className="text-red-700 font-extrabold min-w-[150px]">Category</TableHead>
                    <TableHead className="min-w-[250px]">Item Name/Description</TableHead>
                    <TableHead className="min-w-[100px]">Unit</TableHead>
                    <TableHead className="min-w-[100px]">Quantity</TableHead>
                    <TableHead className="min-w-[100px]">Tax (%)</TableHead>
                    <TableHead className="min-w-[100px]">Quote</TableHead>
                    <TableHead className="min-w-[100px]">Amount</TableHead>
                    <TableHead>Delete</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order?.length > 0 ? order?.map((item: CustomPRItem) => (
                    <TableRow key={item.name}>
                      <TableCell className="font-semibold">
                        <Select value={item.procurement_package} onValueChange={(value) => handleInputChange(item.name, "procurement_package", value)}>
                          <SelectTrigger><SelectValue placeholder="Select Procurment Package" /></SelectTrigger>
                          <SelectContent>{procurement_packages?.map((pp) => (<SelectItem key={pp?.name} value={pp?.name}>{pp?.name}</SelectItem>))}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="font-semibold">
                        <Select value={item.category} onValueChange={(value) => handleInputChange(item.name, "category", value)} disabled={!item?.procurement_package}>
                          <SelectTrigger><SelectValue placeholder="Select Category" /></SelectTrigger>
                          <SelectContent>{category_data?.filter((i) => item?.procurement_package === i?.work_package)?.map((cat) => (<SelectItem key={cat?.name} value={cat?.name}>{cat?.name}</SelectItem>))}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="whitespace-pre-wrap"><Textarea value={item?.item ||item?.item_name|| ""} onChange={(e) => handleInputChange(item.name, "item", e.target.value)} /></TableCell>
                      <TableCell><SelectUnit value={item?.unit || ""} onChange={(value) => handleInputChange(item.name, "unit", value)} /></TableCell>
                      <TableCell><Input type="number" value={item?.quantity || ""} onChange={(e) => handleInputChange(item.name, "quantity", parseFloat(e.target.value))} /></TableCell>
                      <TableCell className="font-semibold">
                        <Select value={String(item.tax)} onValueChange={(value) => handleInputChange(item.name, "tax", value)}>
                          <SelectTrigger><SelectValue placeholder="Select Tax %" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem key={5} value={"5"}>5 %</SelectItem>
                            <SelectItem key={12} value={"12"}>12 %</SelectItem>
                            <SelectItem key={18} value={"18"}>18 %</SelectItem>
                            <SelectItem key={28} value={"28"}>28 %</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input type="number" value={amounts[item.name] || ""} onChange={(e) => handleAmountChange(item.name, e.target.value)} disabled={!selectedVendor?.value} /></TableCell>
                      <TableCell className="text-primary">{formatToIndianRupee(item?.quantity * (amounts[item.name] || 0))}</TableCell>
                      <TableCell><Trash2 className="text-red-500 cursor-pointer" onClick={() => {
                        setOrder(prev => prev.filter(i => i.name !== item.name));
                        const updatedAmounts = { ...amounts };
                        delete updatedAmounts[item.name];
                        setAmounts(updatedAmounts);
                      }} /></TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={9} className="text-center py-2">Start Adding Items!</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="flex justify-between items-center mt-4 pl-2">
            <Button onClick={() => setOrder(prev => [...prev, { name: uuidv4(), procurement_package: "", category: "", item: "", quantity: 0, unit: "", quote: 0, tax: 18, status: "Pending" }])}>New Item</Button>
            <div className="flex items-center gap-2"><Button disabled={!checkNextButtonStatus()} onClick={handleSaveAmounts}>Next</Button></div>
          </div>
        </>
      )}

      {section == "summary" && approvalSummary && (
        <CustomPRSummary
          orderData={prDoc}
          approvalSummary={approvalSummary}
          resolve={resolve}
          onBack={() => setSection("choose-vendor")}
          setEditingVendor={setEditingVendor}
          vendorTotal={vendorTotal}
          arePaymentTermsSet={arePaymentTermsSet}
          paymentTerms={paymentTerms}
          comment={comment}
          setComment={setComment}
          handleSubmit={handleSubmit}
          handleResolvePR={handleResolvePR}
          newCustomPRLoading={newCustomPRLoading}
          resolveCustomPRCallLoading={resolveCustomPRCallLoading}
        />
      )}

      {editingVendor && (
        <PaymentTermsDialog
          isOpen={!!editingVendor}
          onClose={() => setEditingVendor(null)}
          vendorName={editingVendor.name}
          poAmount={editingVendor.total}
          initialData={paymentTerms[editingVendor.id]}
          onConfirm={(data) => handleConfirmPaymentTerms(editingVendor.id, data)}
        />
      )}
    </div>
  );
};
// import { CustomAttachment } from "@/components/helpers/CustomAttachment";
// import { ProcurementHeaderCard } from "@/components/helpers/ProcurementHeaderCard";
// import { SelectUnit } from "@/components/helpers/SelectUnit";
// import { VendorsReactSelect } from "@/components/helpers/VendorsReactSelect";
// import { Button } from "@/components/ui/button";
// import {
//     Dialog,
//     DialogClose,
//     DialogContent,
//     DialogDescription,
//     DialogHeader,
//     DialogTitle,
//     DialogTrigger,
// } from "@/components/ui/dialog";
// import { Input } from "@/components/ui/input";
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// import {
//     Sheet,
//     SheetContent,
//     SheetHeader,
//     SheetTitle,
//     SheetTrigger,
// } from "@/components/ui/sheet";
// import {
//     Table,
//     TableBody,
//     TableCell,
//     TableHead,
//     TableHeader,
//     TableRow,
// } from "@/components/ui/table";
// import { Textarea } from "@/components/ui/textarea";
// import { toast } from "@/components/ui/use-toast";
// import { useUserData } from "@/hooks/useUserData";
// import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor";
// import { NewVendor } from "@/pages/vendors/new-vendor";
// import { ProcurementItem, ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
// import { Vendors } from "@/types/NirmaanStack/Vendors";
// import formatToIndianRupee from "@/utils/FormatPrice";
// import { parseNumber } from "@/utils/parseNumber";
// import { Table as AntTable, ConfigProvider } from "antd";
// import {
//     useFrappeFileUpload,
//     useFrappeGetDocList,
//     useFrappePostCall
// } from "frappe-react-sdk";
// import {
//     ArrowLeft,
//     CheckCheck,
//     CirclePlus,
//     Settings2,
//     Trash2,
//     Undo2
// } from "lucide-react";
// import React, { useCallback, useEffect, useMemo, useState } from "react";
// import { TailSpin } from "react-loader-spinner";
// import { useNavigate, useParams } from "react-router-dom";
// import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique IDs

// interface CustomPRItem extends ProcurementItem {
//   procurement_package: string;
// }

// interface NewCustomPRProps {
//   resolve?: boolean;
// }

// export const NewCustomPR : React.FC<NewCustomPRProps> = ({resolve = false}) => {

//   const navigate = useNavigate();

//   const {prId} = useParams<{ prId: string }>();

//   const {data : prList, isLoading: prListLoading} = useFrappeGetDocList<ProcurementRequest>("Procurement Requests", {
//     fields: ["*"],
//     filters: [["name", "=", prId]]
//   },
//   prId ? `Procurement Requests ${prId}` : null
// )

// const { data: vendor_list, isLoading : vendorListLoading } = useFrappeGetDocList<Vendors>("Vendors",
//   {
//     fields: ["*"],
//     limit: 10000,
//   },
//   "Vendors"
// );

//   const {projectId} = useParams<{ projectId: string }>();

//   const [comment, setComment] = useState<any>(null);
//   const [section, setSection] = useState("choose-vendor");
//   const [selectedVendor, setSelectedvendor] = useState<Vendor | null>(null);
//   const [amounts, setAmounts] = useState<{ [key: string]: number }>({}); // New state for amounts
//   const [order, setOrder] = useState<CustomPRItem[]>([]);
//   const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
//   const [categories, setCategories] = useState<{ list: { name: string, makes : string[] }[] }>({ list: [] });
//   const [attachment, setAttachment] = useState<File | null>(null);

//   const groupedData : {[key: string]: CustomPRItem[]} = useMemo(() => {
//     return order?.reduce((acc :{[key: string]: CustomPRItem[]}, item) => {
//       acc[item.category] = acc[item.category] || [];
//       acc[item.category].push(item);
//       return acc;
//     }, {});
//   }, [order]);

//   // console.log("groupedData, ", groupedData)

//   useEffect(() => {
//     if (groupedData) {
//       setExpandedRowKeys(Object.keys(groupedData));
//     }
//   }, [groupedData]);

//   useEffect(() => {
//     if(resolve && prList &&  prList.length > 0 && vendor_list && vendor_list.length > 0) {
//       const request = prList[0];
//       setOrder(request?.procurement_list?.list as typeof order)
//       setCategories(request?.category_list)
//       const amounts : { [key: string]: number } = {};
//       request?.procurement_list?.list?.forEach(item => {
//         amounts[item.name] = item.quote;
//       })
//       setAmounts(amounts);
//       const vendorId = request?.procurement_list?.list?.[0]?.vendor;
//       const vendor = vendor_list?.find(v => v.name === vendorId);

//       setSelectedvendor({
//         value: vendor?.name || "",
//         label: vendor?.vendor_name || "",
//         city: vendor?.vendor_city || "",
//         state: vendor?.vendor_state || "",
//       })

//     }
//   }, [resolve, prId, prList, vendor_list])

//   // Main table columns
//   const columns = useMemo(() => [
//     {
//       title: "Category",
//       dataIndex: "category",
//       key: "category",
//       width: "35%",
//       render: (text, record) => <strong className="text-primary">{text}({record.procurement_package})</strong>,
//     },
//     {
//       title: "Selected Vendor",
//       key: "vendor",
//       // width: "45%",
//       render: () => (
//         <span className="font-semibold text-primary">
//           {selectedVendor?.label}
//         </span>
//       ),
//     },
//   ], [selectedVendor]);

//   // Inner table columns
//   const innerColumns = useMemo(() => [
//     {
//       title: "Item",
//       dataIndex: "item",
//       key: "item",
//       width: "30%",
//       render: (text) => (
//         <span className="italic whitespace-pre-wrap">{text}</span>
//       ),
//     },
//     {
//       title: "Unit",
//       dataIndex: "unit",
//       key: "unit",
//       width: "10%",
//       render: (text) => <span>{text}</span>,
//     },
//     {
//       title: "Quantity",
//       dataIndex: "quantity",
//       key: "quantity",
//       width: "10%",
//       render: (text) => <span>{text}</span>,
//     },
//     {
//       title: "Tax (%)",
//       dataIndex: "tax",
//       key: "tax",
//       width: "10%",
//       render: (text) => <span>{text}</span>,
//     },
//     {
//       title: "quote",
//       dataIndex: "quote",
//       key: "quote",
//       width: "10%",
//       render: (text) => (
//         <span className="italic">{formatToIndianRupee(text)}</span>
//       ),
//     },
//     {
//       title: "Amount",
//       dataIndex: "amount",
//       key: "amount",
//       width: "10%",
//       render: (text, record) => (
//         <span className="italic">
//           {formatToIndianRupee(record.quote * record.quantity)}
//         </span>
//       ),
//     },
//   ], []);

//   const {data : procurement_packages, isLoading: procurementPackagesLoading} = useFrappeGetDocList("Procurement Packages", {
//     fields: ["*"],
//     filters: [["name", "!=", "Services"]],
//     orderBy: { field: 'name', order: 'asc' },
//     limit: 100
//   }, "Procurement Packages-Services")

//   const { data: category_data, isLoading: categoryDataLoading } = useFrappeGetDocList("Category", {
//     fields: ["*"],
//     filters: [['work_package', '!=', 'Services']],
//     orderBy: { field: 'category_name', order: 'asc' },
//     limit: 10000
//   }, "Categories-Services")

//   const vendorOptions : Vendor[] = useMemo(() => vendor_list?.map((item) => ({
//     value: item.name,
//     label: item.vendor_name,
//     city: item?.vendor_city || "",
//     state: item?.vendor_state || "",
//   })) || [], [vendor_list]);

//   const {call : newCustomPRCall, loading: newCustomPRLoading} = useFrappePostCall("nirmaan_stack.api.custom_pr_api.new_custom_pr");
//   const {call : resolveCustomPRCall, loading : resolveCustomPRCallLoading} = useFrappePostCall("nirmaan_stack.api.custom_pr_api.resolve_custom_pr");
//   const {upload} = useFrappeFileUpload()

//   const handleAmountChange = useCallback((id: string, value: string) => {
//     const numericValue = parseNumber(value);
//     setAmounts((prev) => ({ ...prev, [id]: numericValue }));
//   }, []);

//   const handleSaveAmounts = useCallback(() => {
//     let newOrderData = [];
//     for (let item of order) {
//       newOrderData.push({...item, quote : amounts[item.name], vendor: selectedVendor?.value});
//     }
//     setOrder(newOrderData);
//     setSection("summary");
//     const newCategories: { name: string, makes : string[] }[] = [];
//     console.log("custom order", order)
//     order.forEach((item) => {
//         const isDuplicate = newCategories.some(category => category.name === item.category);
//         if (!isDuplicate) {
//             newCategories.push({ name: item.category, makes: [] });
//         }
//     });
//      console.log("custom order2", order)
//     setCategories({ list: newCategories });

//   }, [order, amounts, section]);

//   const checkNextButtonStatus = useCallback(() => {
//     const allAmountsFilled = Object.values(amounts).every(
//       (amount) => amount && amount > 0
//     );
//     const allAmountsCount = Object.keys(amounts)?.length === order?.length;
//     const allFieldsFilled = order?.some(
//       (i) =>
//         !i?.quantity || !i?.unit || !i?.category || !i?.procurement_package || !i?.tax || !i.item
//     )
//     return allAmountsFilled && allAmountsCount && !allFieldsFilled && order.length !== 0 && selectedVendor?.value;

//   }, [amounts, order, selectedVendor]);

//   const handleSubmit = async () => {
//     try {

//         let file_url = null;

//         if(attachment) {
//           const fileArgs = {
//             doctype : "Procurement Requests",
//             docname: "temp_doc",
//             fieldname: "attachment",
//             isPrivate: true,
//           }
//           const uploadedFile = await upload(attachment, fileArgs)
//           file_url = uploadedFile.file_url;
//         }
//         const response = await newCustomPRCall({
//             project_id: projectId,
//             order: order,
//             categories: categories.list,
//             comment: comment,
//             attachment: attachment ? {file_url: file_url} : null
//         });

//         if (response.message.status === 200) {
//             toast({
//                 title: "Success!",
//                 description: response.message.message,
//                 variant: "success",
//             });
//             navigate("/prs&milestones/procurement-requests");
//         } else if(response.message.status === 400) {
//             toast({
//                 title: "Failed!",
//                 description: response.message.error,
//                 variant: "destructive",
//             });
//             console.log("error while sending SR for approval", response.message);
//         }
//     } catch (error) {
//         toast({
//             title: "Failed!",
//             description: `Unable to send Custom PR for approval`,
//             variant: "destructive",
//         });
//         console.log("error while sending SR for approval", error);
//     }
// };

// const handleResolvePR = async () => {
//     try {
//       let file_url = null;

//         if(attachment) {
//           const fileArgs = {
//             doctype : "Procurement Requests",
//             docname: "temp_doc",
//             fieldname: "attachment",
//             isPrivate: true,
//           }
//           const uploadedFile = await upload(attachment, fileArgs)
//           file_url = uploadedFile.file_url;
//         }
//           const response = await resolveCustomPRCall({
//             project_id: prList?.[0]?.project,
//             pr_id: prId,
//             order: order,
//             categories: categories.list,
//             comment: comment,
//             attachment: attachment ? {file_url: file_url} : null
//         });

//         if (response.message.status === 200) {
//             toast({
//                 title: "Success!",
//                 description: response.message.message,
//                 variant: "success",
//             });
//             navigate(-1);
//         } else if(response.message.status === 400) {
//             toast({
//                 title: "Failed!",
//                 description: response.message.error,
//                 variant: "destructive",
//             });
//             console.log("Unable to resolve Custom PR!", response.message);
//         }
//     } catch (error) {
//         toast({
//             title: "Failed!",
//             description: `Unable to resolve Custom PR!`,
//             variant: "destructive",
//         });
//         console.log("Unable to resolve Custom PR!", error);
//     }
// };


//   const handleInputChange = useCallback((id: string, field: string, value: string | number) => {
//     if (field) {
//       let updatedOrder : CustomPRItem[];
//       if(field === "procurement_package"){
//         updatedOrder = order.map((item: any) =>
//           item.name === id ? { ...item, [field]: value, category : field === "procurement_package" ? null : item.category } : item
//         );
//       } else {
//         updatedOrder = order.map((item: any) =>
//           item.name === id ? { ...item, [field]: value } : item
//         );
//       }
//       setOrder(updatedOrder);
//     }
//   }, [order]);

//   if (prListLoading || vendorListLoading || procurementPackagesLoading || categoryDataLoading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>

//   return (
//     <div className="flex-1 space-y-4">

//       {section === "summary" && (
//         <div className="flex items-center">
//         <ArrowLeft
//           className="cursor-pointer"
//           onClick={() => setSection("choose-vendor")}
//         />
//         <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">
//           Comparison
//         </h2>
//       </div>
//       )}

//       <ProcurementHeaderCard orderData={prList?.[0]} customPr />

//       {section === "choose-vendor" && (
//         <>
//             <div className="flex justify-between items-center">
//               <h2 className="text-lg text-gray-400">
//                 Select vendor for this Custom PR
//               </h2>
//               <Sheet>
//                 <SheetTrigger className="text-blue-500">
//                   <div className="text-base text-blue-400 text-center">
//                     <CirclePlus className="w-4 h-4 inline-block" />{" "}
//                     <span>New Vendor</span>
//                   </div>
//                 </SheetTrigger>
//                 <SheetContent className="overflow-auto">
//                   <SheetHeader className="text-start">
//                     <SheetTitle>
//                       <div className="flex-1">
//                         <span className="underline">Add New Vendor</span>
//                         <p className=" text-xs font-light text-slate-500 p-1">
//                           Add a new vendor here
//                         </p>
//                       </div>
//                     </SheetTitle>
//                     <NewVendor
//                       renderCategorySelection={false}
//                       navigation={false}
//                     />
//                   </SheetHeader>
//                 </SheetContent>
//               </Sheet>
//             </div>
//             <div className="flex gap-4 items-start">
//               <div className="w-2/3">
//                 <VendorsReactSelect selectedVendor={selectedVendor} vendorOptions={vendorOptions} setSelectedvendor={setSelectedvendor} />
//               </div>
//                 <CustomAttachment
//                   maxFileSize={20 * 1024 * 1024} // 20MB
//                   selectedFile={attachment}
//                   onFileSelect={setAttachment}
//                   label="Attach"
//                   className="w-1/3"
//                  />
//             </div>
//             <div className="overflow-x-auto">
//               <div className="min-w-full inline-block align-middle">
//                 <Table>
//                   <TableHeader>
//                     <TableRow className="bg-red-100">
//                       <TableHead className="text-red-700 font-extrabold min-w-[200px]">
//                         Procurement Package
//                       </TableHead>
//                       <TableHead className="text-red-700 font-extrabold min-w-[150px]">
//                         Category
//                       </TableHead>
//                       <TableHead className="min-w-[250px]">Item Name/Description</TableHead>
//                       <TableHead className="min-w-[100px]">Unit</TableHead>
//                       <TableHead className="min-w-[100px]">Quantity</TableHead>
//                       <TableHead className="min-w-[100px]">Tax (%)</TableHead>
//                       <TableHead className="min-w-[100px]">Quote</TableHead>
//                       <TableHead className="min-w-[100px]">Amount</TableHead>
//                       <TableHead className="">Delete</TableHead>
//                     </TableRow>
//                   </TableHeader>
//                   <TableBody>
//                     {order?.length > 0 ? 
//                     order?.map((item: CustomPRItem) => (
//                       <TableRow key={item.name}>
//                         <TableCell className="font-semibold">
//                           {/* {item.procurement_package} */}
//                           <Select
//                             value={item.procurement_package}
//                             onValueChange={(value) => handleInputChange(item.name, "procurement_package", value)}
//                           >
//                             <SelectTrigger >
//                               <SelectValue className="text-gray-200" placeholder="Select Procurment Package" />
//                             </SelectTrigger>
//                             <SelectContent>
//                               {procurement_packages
//                                 ?.map((pp) => (
//                                   <SelectItem key={pp?.name} value={pp?.name}>{pp?.name}</SelectItem>
//                                 ))}
//                             </SelectContent>
//                           </Select>
//                         </TableCell>
//                         <TableCell className="font-semibold">
//                           {/* {item.category} */}
//                           <Select
//                             value={item.category}
//                             onValueChange={(value) => handleInputChange(item.name, "category", value)}
//                           >
//                             <SelectTrigger disabled={!item?.procurement_package}>
//                               <SelectValue className="text-gray-200" placeholder="Select Category" />
//                             </SelectTrigger>
//                             <SelectContent>
//                               {category_data?.filter((i) => item?.procurement_package === i?.work_package)
//                                 ?.map((cat) => (
//                                   <SelectItem key={cat?.name} value={cat?.name}>{cat?.name}</SelectItem>
//                                 ))}
//                             </SelectContent>
//                           </Select>
//                         </TableCell>
//                         {/* Description Field */}
//                         <TableCell className="whitespace-pre-wrap">
//                           <Textarea
//                             value={item?.item || ""}
//                             onChange={(e) =>
//                               handleInputChange(
//                                 item.name,
//                                 "item",
//                                 e.target.value
//                               )
//                             }
//                           />
//                         </TableCell>

//                         {/* Unit Field */}
//                         <TableCell>
//                           <SelectUnit value={item?.unit || ""} onChange={(value) => handleInputChange(item.name, "unit", value)} />
//                         </TableCell>

//                         {/* Quantity Field */}
//                         <TableCell>
//                           <Input
//                             type="number"
//                             value={item?.quantity || ""}
//                             onChange={(e) =>
//                               handleInputChange(
//                                 item.name,
//                                 "quantity",
//                                 parseFloat(e.target.value)
//                               )
//                             }
//                           />
//                         </TableCell>
//                         <TableCell className="font-semibold">
//                           {/* {item.tax} */}
//                           <Select
//                             value={item.tax}
//                             onValueChange={(value) => handleInputChange(item.name, "tax", value)}
//                           >
//                             <SelectTrigger >
//                               <SelectValue className="text-gray-200" placeholder="Select Tax %" />
//                             </SelectTrigger>
//                             <SelectContent>
//                                 <SelectItem key={5} value={5}>5 %</SelectItem>
//                                 <SelectItem key={12} value={12}>12 %</SelectItem>
//                                 <SelectItem key={18} value={18}>18 %</SelectItem>
//                                 <SelectItem key={28} value={28}>28 %</SelectItem>
//                             </SelectContent>
//                           </Select>
//                         </TableCell>
//                         <TableCell>
//                           <Input
//                             type="number"
//                             value={amounts[item.name] || ""}
//                             onChange={(e) =>
//                               handleAmountChange(item.name, e.target.value)
//                             }
//                             disabled={!selectedVendor?.value}
//                           />
//                         </TableCell>
//                         <TableCell className="text-primary">
//                           {formatToIndianRupee(
//                             item?.quantity * (amounts[item.name] || 0)
//                           )}
//                         </TableCell>
//                         <TableCell>
//                           <Trash2 className="text-red-500 cursor-pointer" onClick={() => {
//                             setOrder(prev => prev.filter(i => i.name !== item.name))
//                             const updatedAmounts = { ...amounts }
//                             delete updatedAmounts[item.name]
//                             setAmounts(updatedAmounts)
//                           }} />
//                         </TableCell>
//                       </TableRow>
//                     )) :    <TableRow>
//                               <TableCell colSpan={9} className="text-center py-2">
//                                 Start Adding Items!
//                               </TableCell>
//                             </TableRow>
//                   }
//                   </TableBody>
//                 </Table>
//               </div>
//             </div>
//             <div className="flex justify-between items-center mt-4 pl-2">
//               <Button onClick={() => setOrder(prev => [...prev, { name: uuidv4(), procurement_package: "", category: "", item: "", quantity: 0, unit: "", quote: 0, tax : 18, status : "Pending" }])}>New Item</Button>
//               <div className="flex items-center gap-2">

//               <Button
//                 disabled={!checkNextButtonStatus()}
//                 onClick={handleSaveAmounts}
//               >
//                 Next
//               </Button>

//               </div>
//             </div>
//         </>
//       )}
//       {section == "summary" && (
//         <>
//           <div className="mt-6 overflow-x-auto">
//             <ConfigProvider>
//               <AntTable
//                 dataSource={(
//                   (groupedData && Object.keys(groupedData)) ||
//                   []
//                 ).map((key) => ({
//                   key,
//                   category: key,
//                   procurement_package: groupedData[key][0]?.procurement_package,
//                   items: groupedData[key],
//                 }))}
//                 columns={columns}
//                 expandable={{
//                   expandedRowKeys,
//                   onExpandedRowsChange: setExpandedRowKeys,
//                   expandedRowRender: (record) => (
//                     <AntTable
//                       dataSource={record.items}
//                       columns={innerColumns}
//                       pagination={false}
//                       rowKey={(item) => item.name}
//                     />
//                   ),
//                 }}
//               />
//             </ConfigProvider>
//           </div>
//           <div className="flex flex-col justify-end items-end mr-2 mb-4 mt-4">
//             <Dialog>
//               <DialogTrigger asChild>
//                 <Button className="flex items-center gap-1">
//                     <Settings2 className="h-4 w-4" />
//                     {resolve ? "Resolve" : "Send for Approval"}
//                 </Button>
//               </DialogTrigger>
//               <DialogContent className="sm:max-w-[425px]">
//                 <DialogHeader>
//                   <DialogTitle>Are you sure?</DialogTitle>
//                   <DialogDescription>
//                     Click on Confirm to submit for approval!
//                     <Textarea
//                       className="mt-4"
//                       placeholder={`Optional`}
//                       onChange={(e: any) =>
//                         setComment(
//                           e.target.value === "" ? null : e.target.value
//                         )
//                       }
//                       value={comment || ""}
//                     />
//                   </DialogDescription>
//                 </DialogHeader>
//                 <DialogDescription className="flex items-center justify-center gap-2">
//                   <DialogClose asChild>
//                     <Button
//                       disabled={newCustomPRLoading || resolveCustomPRCallLoading}
//                       variant="secondary"
//                       className="flex items-center gap-1"
//                     >
//                       <Undo2 className="h-4 w-4" />
//                       Cancel
//                     </Button>
//                   </DialogClose>
//                     <Button
//                       variant="default"
//                       className="flex items-center gap-1"
//                       onClick={resolve ? handleResolvePR : handleSubmit}
//                       disabled={newCustomPRLoading || resolveCustomPRCallLoading}
//                     >
//                       {newCustomPRLoading || resolveCustomPRCallLoading ? (
//                         <TailSpin width={20} height={20} color="white" />
//                       ) : (
//                         <>
//                           <CheckCheck className="h-4 w-4" />
//                           Confirm
//                         </>
//                       )}
//                     </Button>
//                 </DialogDescription>
//               </DialogContent>
//             </Dialog>
//           </div>
//         </>
//       )}
//     </div>
//   );
// };