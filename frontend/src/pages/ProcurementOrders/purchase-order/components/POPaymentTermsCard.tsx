import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { ValidationIndicator } from "@/components/validations/ValidationIndicator";
import { VALIDATION_CONFIG } from "@/components/validations/ValidationTypes";
import { usePOValidation } from "@/hooks/usePOValidation";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { Projects } from "@/types/NirmaanStack/Projects";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { BookCheck, CalendarDays, CircleX, HandCoins, Info, ListChecks, PencilIcon, Truck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { TailSpin } from "react-loader-spinner";

interface POPaymentTermsCardProps {
  accountsPage: boolean
  estimatesViewing: boolean
  summaryPage: boolean
  PO: ProcurementOrder | null
  getTotal: {
    total: number
    totalGst: number
    totalAmt: number
  }
  poMutate: any

  advance: number
  materialReadiness : number
  afterDelivery : number
  xDaysAfterDelivery : number
  xDays : number

  setAdvance: React.Dispatch<React.SetStateAction<number>>
  setMaterialReadiness: React.Dispatch<React.SetStateAction<number>>
  setAfterDelivery: React.Dispatch<React.SetStateAction<number>>
  setXDaysAfterDelivery: React.Dispatch<React.SetStateAction<number>>
  setXDays: React.Dispatch<React.SetStateAction<number>>
}

export const POPaymentTermsCard: React.FC<POPaymentTermsCardProps> = ({
  PO, accountsPage, estimatesViewing, summaryPage, getTotal, poMutate,
  advance, materialReadiness, afterDelivery, xDaysAfterDelivery, xDays,
  setAdvance, setMaterialReadiness, setAfterDelivery, setXDaysAfterDelivery, setXDays
}) => {


  if(!PO) return <div>No PO ID Provided</div>

  const { hasMissingGST } = usePOValidation(PO);
  const { control, handleSubmit, reset } = useForm({
      defaultValues: {
        advance: 0,
        materialReadiness: 0,
        afterDelivery: 0,
        xDaysAfterDelivery: 0,
        xDays: 0,
        loadingCharges: 0,
        freightCharges: 0,
        notes: "",
      },
    });

  const { data: poProject } = useFrappeGetDoc<Projects>(
    "Projects",
    PO?.project,
    PO ? `Projects ${PO}` : null
  );

  const [loadingCharges, setLoadingCharges] = useState(0);
  const [freightCharges, setFreightCharges] = useState(0);
  const { updateDoc, loading : updateLoading } = useFrappeUpdateDoc();
  // const [notes, setNotes] = useState("");
  const [selectedGST, setSelectedGST] = useState<{gst : string | undefined, location? : string | undefined} | null>(null);
  const [editPOTermsDialog, setEditPOTermsDialog] = useState(false);
  
  const toggleEditPOTermsDialog = useCallback(() => {
      setEditPOTermsDialog((prevState) => !prevState);
    }, []);

  const resetForm = useCallback((poData: typeof PO) => {
      if (!poData) return;
      
      const chargesArray = poData.advance?.split(', ');
      const parsedCharges = chargesArray?.map(charge => parseFloat(charge));
      
      setAdvance(parsedCharges?.[0] || 0);
      setMaterialReadiness(parsedCharges?.[1] || 0);
      setAfterDelivery(parsedCharges?.[2] || 0);
      setXDaysAfterDelivery(parsedCharges?.[3] || 0);
      setXDays(parsedCharges?.[4] || 0);
      setLoadingCharges(parseNumber(poData.loading_charges));
      setFreightCharges(parseNumber(poData.freight_charges));
      // setNotes(poData.notes || '');
  
      reset({
        advance: parsedCharges?.[0] || 0,
        materialReadiness: parsedCharges?.[1] || 0,
        afterDelivery: parsedCharges?.[2] || 0,
        xDaysAfterDelivery: parsedCharges?.[3] || 0,
        xDays: parsedCharges?.[4] || 0,
        loadingCharges: parseNumber(poData.loading_charges),
        freightCharges: parseNumber(poData.freight_charges),
        notes: poData.notes || '',
      });
  
      if (poData.project_gst) {
        setSelectedGST(prev =>  ({ ...prev, gst: poData.project_gst }));
      }
  
    }, [reset]);
  
  const checkPrintDisabled =
        advance > 100 ||
        advance < 0 ||
        materialReadiness > 100 ||
        materialReadiness < 0 ||
        afterDelivery > 100 ||
        afterDelivery < 0 ||
        xDaysAfterDelivery > 100 ||
        xDaysAfterDelivery < 0 ||
        ![100, 0].includes(
          advance + materialReadiness + afterDelivery + xDaysAfterDelivery
        );
  useEffect(() => {
      if (PO || !editPOTermsDialog) {
        resetForm(PO);
      }
    }, [PO, editPOTermsDialog, resetForm]);

  const onSubmit = async (data: any) => {
        try {
          const updateData = {
            advance: `${parseNumber(data?.advance)}, ${parseNumber(data?.materialReadiness)}, ${parseNumber(data?.afterDelivery)}, ${
              parseNumber(data?.xDaysAfterDelivery)}, ${parseNumber(data?.xDays)}`,
            loading_charges: parseNumber(data?.loadingCharges),
            freight_charges: parseNumber(data?.freightCharges),
            notes: data.notes || "",
            project_gst: selectedGST?.gst,
          };
    
          const res = await updateDoc("Procurement Orders", PO?.name, updateData);
    
          await poMutate();
          toggleEditPOTermsDialog();
          toast({
            title: "Success!",
            description: `${res.name} updated successfully!`,
            variant: "success",
          });
        } catch (error) {
          console.log("update_submit_error", error);
          toast({
            title: "Failed!",
            description: `Failed to update ${PO?.name}`,
            variant: "destructive",
          });
        }
      };
  return (
            <Card className="rounded-sm shadow-md col-span-3 overflow-x-auto">
                <CardHeader>
                  <CardTitle className="text-xl max-sm:text-lg text-red-600 flex items-center justify-between">
                    <div className="flex items-center">
                      {/* Payment Terms
                       */}Project Payments
                      {hasMissingGST && (
                        <ValidationIndicator error={VALIDATION_CONFIG.MISSING_GST} />
                      )}
                    </div>
                    {!summaryPage &&
                      !accountsPage &&
                      !estimatesViewing &&
                      // PO?.status === "PO Approved" && 
                      (
                        <Dialog
                          open={editPOTermsDialog}
                          onOpenChange={toggleEditPOTermsDialog}
                        >
                          <DialogTrigger>
                            <Button
                              variant={"outline"}
                              className="flex items-center gap-1"
                            >
                              <PencilIcon className="w-4 h-4" />
                              Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader className="text-start">
                              <DialogTitle className="text-center">
                                Edit Terms and Charges
                              </DialogTitle>
    
                              <div className="px-4 flex flex-col gap-4 pt-2">
                                <div className="flex flex-col gap-1">
                                  <h3
                                    className={`font-semibold text-lg tracking-tight ${
                                      !selectedGST?.gst ? "text-primary" : ""
                                    }`}
                                  >
                                    Project GST Selection
                                    <sup className="text-sm text-red-600">*</sup>
                                  </h3>
                                  {poProject &&
                                    JSON.parse(poProject?.project_gst_number)?.list
                                      ?.length > 0 && (
                                      <>
                                        <Select
                                          value={selectedGST?.gst}
                                          defaultValue={PO?.project_gst}
                                          onValueChange={(selectedOption) => {
                                            const gstArr = JSON.parse(
                                              poProject?.project_gst_number
                                            )?.list;
                                            setSelectedGST(
                                              gstArr.find(
                                                (item) =>
                                                  item.gst === selectedOption
                                              )
                                            );
                                          }}
                                        >
                                          <SelectTrigger
                                            className={`${
                                              !selectedGST?.gst
                                                ? "text-primary border-primary ring-1 ring-inset ring-primary"
                                                : ""
                                            }`}
                                          >
                                            <SelectValue placeholder="Select Project GST" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {JSON.parse(
                                              poProject?.project_gst_number
                                            )?.list?.map((option) => (
                                              <SelectItem
                                                key={option.location}
                                                value={option.gst}
                                              >
                                                {option.location}
                                                {` (${option.gst})`}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        {selectedGST?.gst && !PO?.project_gst && (
                                          <span className="text-sm">
                                            <strong>Note:</strong>{" "}
                                            <span className="text-primary">
                                              GST selected but not saved, click on
                                              Save below!
                                            </span>
                                          </span>
                                        )}
                                      </>
                                    )}
                                </div>
                                <h3 className="font-semibold text-lg tracking-tight">
                                  Terms:
                                </h3>
                                <div className="flex justify-between items-center pb-2 border-b border-gray-300">
                                  <p className="text-sm text-gray-500">Terms</p>
                                  <p className="text-sm text-gray-500">
                                    Percentage(%)
                                  </p>
                                </div>
                                <form
                                  onSubmit={handleSubmit(onSubmit)}
                                  className="space-y-4"
                                >
                                  {/* Payments Section */}
                                  <section className="space-y-2">
                                    <div className="flex flex-col gap-2">
                                      <div className="flex justify-between items-center">
                                        <Label>After Delivery</Label>
                                        <Controller
                                          control={control}
                                          name="afterDelivery"
                                          render={({ field }) => (
                                            <Input
                                              {...field}
                                              className="max-w-[120px]"
                                              onChange={(e) => {
                                                const value = e.target.value;
                                                field.onChange(e);
                                                setAfterDelivery(
                                                  value !== "" ? parseFloat(value) : 0
                                                );
                                              }}
                                            />
                                          )}
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <Label>Advance</Label>
                                        <Controller
                                          control={control}
                                          name="advance"
                                          render={({ field }) => (
                                            <Input
                                              {...field}
                                              className="max-w-[120px]"
                                              onChange={(e) => {
                                                const value = e.target.value;
                                                field.onChange(e);
                                                setAdvance(
                                                  value !== "" ? parseFloat(value) : 0
                                                );
                                              }}
                                            />
                                          )}
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <Label>Material Readiness</Label>
                                        <Controller
                                          control={control}
                                          name="materialReadiness"
                                          render={({ field }) => (
                                            <Input
                                              {...field}
                                              className="max-w-[120px]"
                                              onChange={(e) => {
                                                const value = e.target.value;
                                                field.onChange(e);
                                                setMaterialReadiness(
                                                  value !== "" ? parseFloat(value) : 0
                                                );
                                              }}
                                            />
                                          )}
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <Label>
                                          After{" "}
                                          <Controller
                                            control={control}
                                            name="xDays"
                                            render={({ field }) => (
                                              <input
                                                {...field}
                                                className="max-w-[45px] inline border px-2 rounded text-center text-black"
                                                onChange={(e) => {
                                                  const value = e.target.value;
                                                  field.onChange(e);
                                                  setXDays(
                                                    value !== ""
                                                      ? parseFloat(value)
                                                      : 0
                                                  );
                                                }}
                                              />
                                            )}
                                          />{" "}
                                          days of delivery
                                        </Label>
                                        <Controller
                                          control={control}
                                          name="xDaysAfterDelivery"
                                          render={({ field }) => (
                                            <Input
                                              {...field}
                                              className="max-w-[120px]"
                                              onChange={(e) => {
                                                const value = e.target.value;
                                                field.onChange(e);
                                                setXDaysAfterDelivery(
                                                  value !== "" ? parseFloat(value) : 0
                                                );
                                              }}
                                            />
                                          )}
                                        />
                                      </div>
                                    </div>
    
                                    <div className="flex items-center gap-1">
                                      <Badge>
                                        Total aggregated percentages:{" "}
                                        {advance +
                                          materialReadiness +
                                          afterDelivery +
                                          xDaysAfterDelivery}
                                        %
                                      </Badge>
                                      <HoverCard>
                                        <HoverCardTrigger>
                                          <Info className="w-4 h-4 text-blue-500" />
                                        </HoverCardTrigger>
                                        <HoverCardContent side="left">
                                          <Badge variant={"red"}>Note</Badge>{" "}
                                          <strong className="text-xs">
                                            Total aggregated percentage must sum up
                                            to 100% to enable save button!
                                          </strong>
                                        </HoverCardContent>
                                      </HoverCard>
                                    </div>
                                  </section>
    
                                  {/* Additional Charges Section */}
                                  <section className="flex flex-col gap-2">
                                    <h3 className="font-semibold text-lg tracking-tight">
                                      Additional Charges:
                                    </h3>
                                    <div className="flex justify-between items-center pb-2 border-b border-gray-300">
                                      <p className="text-sm text-gray-500">Type</p>
                                      <p className="text-sm text-gray-500">
                                        Amount
                                      </p>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <Label>Loading</Label>
                                      <Controller
                                        control={control}
                                        name="loadingCharges"
                                        render={({ field }) => (
                                          <Input
                                            {...field}
                                            className="max-w-[120px]"
                                            onChange={(e) => {
                                              const value = e.target.value;
                                              field.onChange(e);
                                              setLoadingCharges(
                                                value !== "" ? parseFloat(value) : 0
                                              );
                                            }}
                                          />
                                        )}
                                      />
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <Label>Freight</Label>
                                      <Controller
                                        control={control}
                                        name="freightCharges"
                                        render={({ field }) => (
                                          <Input
                                            {...field}
                                            className="max-w-[120px]"
                                            onChange={(e) => {
                                              const value = e.target.value;
                                              field.onChange(e);
                                              setFreightCharges(
                                                value !== "" ? parseFloat(value) : 0
                                              );
                                            }}
                                          />
                                        )}
                                      />
                                    </div>
                                  </section>
    
                                  {/* Notes Section */}
                                  <section>
                                    <Label>Add Notes:</Label>
                                    <Controller
                                      control={control}
                                      name="notes"
                                      render={({ field }) => (
                                        <Textarea
                                          {...field}
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            field.onChange(value);
                                            // setNotes(value);
                                          }}
                                          className="w-full"
                                        />
                                      )}
                                    />
                                  </section>
                                </form>
    
                                <div className="flex gap-2 items-center justify-end">
                                  {updateLoading ? (
                                    <TailSpin color="red" height={40} width={40} />
                                  ) : (
                                    <>
                                      <DialogClose asChild>
                                        <Button
                                          variant={"outline"}
                                          className="flex items-center gap-1"
                                        >
                                          <CircleX className="h-4 w-4" />
                                          Cancel
                                        </Button>
                                      </DialogClose>
                                      <Button
                                        type="submit"
                                        className="flex items-center gap-1"
                                        disabled={checkPrintDisabled}
                                        onClick={() =>
                                          onSubmit(control._formValues)
                                        }
                                      >
                                        <ListChecks className="h-4 w-4" />
                                        Save
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </DialogHeader>
                          </DialogContent>
                        </Dialog>
                      )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-sm:text-xs">
                  <div className="grid grid-cols-5">
                    {/* Terms */}
                    <div className="col-span-3 flex flex-col gap-4">
                      <div className="flex items-center gap-1 bg-red-100 p-2 border-gray-400">
                        <span className="font-semibold">Terms</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <HandCoins className="w-4 h-4 text-muted-foreground" />
                        <Label className="font-light">Advance</Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <BookCheck className="w-4 h-4 text-muted-foreground" />
                        <Label className="font-light">Material Readiness</Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Truck className="w-4 h-4 text-muted-foreground" />
                        <Label className="font-light">After Delivery</Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <CalendarDays className="w-4 h-4 text-muted-foreground" />
                        <Label className="font-light">
                          After {xDays || "--"} days of delivery
                        </Label>
                      </div>
                    </div>
    
                    {/* Percentages */}
                    <div className="col-span-1 flex flex-col gap-4">
                      <div className="flex items-center gap-1 bg-red-100 py-2 border-gray-400">
                        <span className="font-semibold">%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">{advance}%</Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">{materialReadiness}%</Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">{afterDelivery}%</Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">{xDaysAfterDelivery}%</Label>
                      </div>
                    </div>
    
                    {/* Amounts  */}
                    <div className="col-span-1 flex flex-col gap-4">
                      <div className="flex items-center gap-1 bg-red-100 p-2 border-gray-400">
                        <span className="font-semibold">Amount</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">
                          {formatToIndianRupee(
                            getTotal?.totalAmt * (advance / 100)
                          )}
                        </Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">
                          {formatToIndianRupee(
                            getTotal?.totalAmt * (materialReadiness / 100)
                          )}
                        </Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">
                          {formatToIndianRupee(
                            getTotal?.totalAmt * (afterDelivery / 100)
                          )}
                        </Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">
                          {formatToIndianRupee(
                            getTotal?.totalAmt * (xDaysAfterDelivery / 100)
                          )}
                        </Label>
                      </div>
                    </div>
                  </div>
    
                  <div className="grid grid-cols-5 mt-4">
                    <div className="col-span-4 flex flex-col gap-4">
                      <div className="flex items-center gap-1 bg-red-100 p-2 border-gray-400">
                        <span className="font-semibold">Additional Charges</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">Loading</Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">Freight</Label>
                      </div>
                    </div>
    
                    {/* Amounts  */}
                    <div className="col-span-1 flex flex-col gap-4">
                      <div className="flex items-center gap-1 bg-red-100 p-2 border-gray-400">
                        <span className="font-semibold">Amount</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">
                          {formatToIndianRupee(loadingCharges * 1.18)}
                        </Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="font-light">
                          {formatToIndianRupee(freightCharges * 1.18)}
                        </Label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
  )
}

export default POPaymentTermsCard;