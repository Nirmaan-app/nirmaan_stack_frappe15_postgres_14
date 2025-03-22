import ProjectSelect from "@/components/custom-select/project-select";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { Projects } from "@/types/NirmaanStack/Projects";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList } from "frappe-react-sdk";
import { Paperclip } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";

export const NewInflowPayment : React.FC = () => {

  const {newInflowDialog, toggleNewInflowDialog} = useDialogStore()

  const [newPayment, setNewPayment] = useState<ProjectInflows | null>(null);
  
  const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);
  const [isValid, setIsValid] = useState(true);

  const {createDoc, loading: createLoading} = useFrappeCreateDoc()

  const {upload, loading: uploadLoading} = useFrappeFileUpload()

  const {data : projectInflows, isLoading: projectInflowsLoading, mutate: projectInflowsMutate} = useFrappeGetDocList<ProjectInflows>("Project Inflows", {
      fields: ["*"],
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    }, "Project Inflows")
  
  const {data : projects, isLoading: projectsLoading} = useFrappeGetDocList<Projects>("Projects", {
    fields: ["name", "project_name", "customer"],
    limit: 1000,
  })

  const {data : customers, isLoading: customersLoading} = useFrappeGetDocList("Customers", {
    fields: ["company_name", 'name'],
    limit: 1000,
  })

  const validateProject = useMemo(
    () => (projectId : string) => {
      const project = projects?.find((i) => i?.name === projectId);
      if(!project?.customer) return false;
      return true;
  }, [projects])

  const getAmountReceived = useMemo(
    () => (projectId : string) => {
      let total = 0;
      const filteredPayments = projectInflows?.filter((i) => i?.project === projectId);
      filteredPayments?.forEach((i) => {
        total += parseNumber(i?.amount);
      });
      return total;
  }
, [projectInflows])

  const handleFileChange = (event : React.ChangeEvent<HTMLInputElement>) => {
      if(event.target.files && event.target.files.length > 0) {
          setPaymentScreenshot(event.target.files[0]);
      }
  };

  const AddPayment = useCallback(async () => {
    try {

      let filreUrl = null

      if(paymentScreenshot) {
        const fileArgs = {
          doctype: "Project Inflows",
          docname: "temp_doc",
          fieldname: "inflow_attachment",
          isPrivate: true,
        };
        const uploadedFile = await upload(paymentScreenshot, fileArgs);
        filreUrl = uploadedFile.file_url;
      }
      await createDoc("Project Inflows", {
        project: newPayment?.project,
        customer: newPayment?.customer,
        amount: newPayment?.amount,
        payment_date: newPayment?.payment_date,
        utr: newPayment?.utr,
        inflow_attachment: filreUrl ? filreUrl  : undefined
      })

      await projectInflowsMutate()

      toggleNewInflowDialog()

      toast({
        title: "Success!",
        description: "Payment added successfully!",
        variant: "success",
      });

    } catch (error) {
      console.log("error", error)
      toast({
        title: "Failed!",
        description: "Failed to add Payment!",
        variant: "destructive",
      });
    }
  }, [createDoc, newPayment, paymentScreenshot, toggleNewInflowDialog])
  
  return (
    <AlertDialog open={newInflowDialog} onOpenChange={toggleNewInflowDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-center">Add New Project Inflow Payment!</AlertDialogTitle>
                                  <div className="flex items-center justify-between">
                                      <Label className=" text-red-700">Project:</Label>
                                      <div className="w-[50%]">
                                        <ProjectSelect onChange={(option) => {
                                          let customer = ""
                                          if(option) {
                                            setIsValid(validateProject(option.value))
                                            customer = projects?.find(i => i?.name === option?.value)?.customer || ""
                                          }
                                          setNewPayment({...newPayment, project : option?.value || "", customer : customer})
                                        }} universal={false} />
                                      </div>
                                  </div>
                                  <div className="flex items-center justify-between">
                                      <Label className=" text-red-700">Customer Name:</Label>
                                      <span className="">
                                        {newPayment?.customer ? customers?.find(i => i?.name === newPayment?.customer)?.company_name : newPayment?.project ? (
                                          <span className="animate-pulse text-sm text-primary">No Customer Added to the Project!</span>
                                        ) : "--"}
                                      </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                      <Label className=" text-red-700">Total Amount Received:</Label>
                                      <span className="">{newPayment?.project ? formatToIndianRupee(getAmountReceived(newPayment?.project)) : "--"}</span>
                                  </div>
          
                                  <div className="flex flex-col gap-4 pt-4">
                                      <div className="flex gap-4 w-full">
                                          <Label className="w-[40%]">Amount<sup className=" text-sm text-red-600">*</sup></Label>
                                          <Input
                                              disabled={!isValid}
                                              type="number"
                                              placeholder="Enter Amount"
                                              value={newPayment?.amount || ""}
                                              onChange={(e) => setNewPayment({ ...newPayment, amount: parseNumber(e.target.value) })}
                                          />
                                      </div>
                                      <div className="flex gap-4 w-full">
                                          <Label className="w-[40%]">UTR<sup className=" text-sm text-red-600">*</sup></Label>
                                          <Input
                                              disabled={!isValid}
                                              type="text"
                                              placeholder="Enter UTR"
                                              value={newPayment?.utr || ""}
                                              onChange={(e) => setNewPayment({ ...newPayment, utr: e.target.value })}
                                          />
                                      </div>
                                      <div className="flex gap-4 w-full" >
                                          <Label className="w-[40%]">Payment Date<sup className=" text-sm text-red-600">*</sup></Label>
                                          <Input
                                                  disabled={!isValid}
                                                  type="date"
                                                  value={newPayment?.payment_date || ""}
                                                  placeholder="DD/MM/YYYY"
                                                  onChange={(e) => setNewPayment({...newPayment, payment_date: e.target.value})}
                                                  max={new Date().toISOString().split("T")[0]}
                                                  onKeyDown={(e) => e.preventDefault()}
                                               />
                                      </div>
                                  </div>
          
                                  <div className="flex flex-col gap-2">
                                      <div role="button" tabIndex={0} className={`text-blue-500 cursor-pointer flex gap-1 items-center justify-center border rounded-md border-blue-500 p-2 mt-4 ${paymentScreenshot && "opacity-50 cursor-not-allowed"}`}
                                          onClick={() => document.getElementById("file-upload")?.click()}
                                      >
                                          <Paperclip size="15px" />
                                          <span className="p-0 text-sm">Attach Screenshot</span>
                                          <input
                                              type="file"
                                              id={`file-upload`}
                                              className="hidden"
                                              onChange={handleFileChange}
                                              disabled={!!paymentScreenshot || !isValid}
                                          />
                                      </div>
                                      {(paymentScreenshot) && (
                                          <div className="flex items-center justify-between bg-slate-100 px-4 py-1 rounded-md">
                                              <span className="text-sm">{paymentScreenshot?.name}</span>
                                              <button
                                                  className="ml-1 text-red-500"
                                                  onClick={() => setPaymentScreenshot(null)}
                                              >
                                                  ✖
                                              </button>
                                          </div>
                                      )}
                                  </div>
          
                                  <div className="flex gap-2 items-center pt-4 justify-center">
          
                                      {createLoading || uploadLoading ? <TailSpin color="red" width={40} height={40} /> : (
                                          <>
                                              <AlertDialogCancel className="flex-1" asChild>
                                                  <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                              </AlertDialogCancel>
                                              <Button
                                                  onClick={AddPayment}
                                                  disabled={!newPayment?.amount || !newPayment?.utr || !newPayment?.payment_date || !isValid}
                                                  className="flex-1">Add Payment
                                              </Button>
                                          </>
                                      )}
                                  </div>
        </AlertDialogHeader>
      </AlertDialogContent>
    </AlertDialog>
  )
}