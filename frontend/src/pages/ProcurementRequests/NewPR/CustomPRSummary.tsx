import React from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PaymentTermsDetailsDisplay } from "@/pages/ProcurementRequests/VendorQuotesSelection/components/PaymentTermsDetailsDisplay";
import { PaymentTermsData } from "@/pages/ProcurementRequests/VendorQuotesSelection/types/paymentTerms";
import formatToIndianRupee from "@/utils/FormatPrice";
import {
  ArrowBigUpDash,
  ArrowLeft,
  CheckCheck,
  CirclePlus,
  ListChecks,
  Pencil,
  Undo2,
} from "lucide-react";
import { TailSpin } from "react-loader-spinner";

// +++ Import the Header Card and its data type +++
import { ProcurementHeaderCard } from "@/components/helpers/ProcurementHeaderCard";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";

// Define the type for the summary data object
interface ApprovalSummary {
  vendorId: string;
  vendorName: string;
  items: {
    name: string;
    item: string;
    quantity: number;
    quote: number;
    tax: number;
    amountInclGst: number;
  }[];
  total: number;
  totalInclGst: number;
}

// Define the props for the component
interface CustomPRSummaryProps {
  // +++ Add orderData to the props +++
  orderData: ProcurementRequest | undefined;
  approvalSummary: ApprovalSummary;
  resolve: boolean;
  onBack: () => void;
  setEditingVendor: (
    vendorContext: { id: string; name: string; total: number } | null
  ) => void;
  vendorTotal: number;
  arePaymentTermsSet: boolean;
  paymentTerms: PaymentTermsData;
  comment: string | null;
  setComment: (comment: string | null) => void;
  handleSubmit: () => void;
  handleResolvePR: () => void;
  newCustomPRLoading: boolean;
  resolveCustomPRCallLoading: boolean;
}

export const CustomPRSummary: React.FC<CustomPRSummaryProps> = ({
  orderData, // Destructure the new prop
  approvalSummary,
  resolve,
  onBack,
  setEditingVendor,
  vendorTotal,
  arePaymentTermsSet,
  paymentTerms,
  comment,
  setComment,
  handleSubmit,
  handleResolvePR,
  newCustomPRLoading,
  resolveCustomPRCallLoading,
}) => {
  return (
    <>
      {/* +++ Render the Header Card at the top of the summary view +++ */}
      <ProcurementHeaderCard orderData={orderData} customPr />

      <div className="flex items-center mt-4"> {/* Added margin for spacing */}
        <ArrowLeft className="cursor-pointer" onClick={onBack} />
        <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">
          Final Review & Summary
        </h2>
      </div>

      {/* Items for Approval Section */}
      <div className="p-4 md:p-6 rounded-lg bg-green-50 border border-green-200">
        <div className="flex items-center mb-2">
          <ListChecks className="h-5 w-5 mr-2 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-800">
            Items for Approval
          </h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          These items will be submitted for approval for the selected vendor.
        </p>
        <dl className="space-y-4">
          <div
            key={approvalSummary.vendorId}
            className="border-t border-green-200 pt-4"
          >
            {/* Vendor Header and Payment Terms Button */}
            <dt className="flex justify-between items-center text-sm border-b border-grey-200 font-medium pb-2">
              <p>
                Vendor:{" "}
                <span className="font-semibold text-red-600">
                  {approvalSummary.vendorName}
                </span>
              </p>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-primary border-primary justify-start hover:text-white hover:bg-red-600"
                  onClick={() =>
                    setEditingVendor({
                      id: approvalSummary.vendorId,
                      name: approvalSummary.vendorName,
                      total: vendorTotal,
                    })
                  }
                >
                  {arePaymentTermsSet ? (
                    <Pencil className="mr-2 h-4 w-4 flex-shrink-0" />
                  ) : (
                    <CirclePlus className="mr-2 h-4 w-4 flex-shrink-0" />
                  )}
                  {arePaymentTermsSet
                    ? "Edit Payment Terms"
                    : "Add Payment Terms"}
                </Button>
              </div>
            </dt>

            {/* Item List and Totals */}
            <dd className="mt-1 pl-2 md:pl-5">
              <ul className="list-disc space-y-2 text-gray-800">
                {approvalSummary.items.map((item) => (
                  <li key={item.name} className="text-sm">
                    {item.item_name}
                    <span className="mx-1">-</span> {item.quantity} x{" "}
                    {formatToIndianRupee(item.quote)}
                    <span className="mx-1 text-gray-500">+</span> {item.tax}%
                    GST
                    <span className="mx-1">=</span>{" "}
                    <span className="font-medium">
                      {formatToIndianRupee(item.amountInclGst)}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Payment Terms Display */}
              {arePaymentTermsSet && (
                <PaymentTermsDetailsDisplay
                  terms={paymentTerms[approvalSummary.vendorId]}
                />
              )}

              {/* Subtotals */}
              <div className="mt-4 pt-4 border-t border-gray-200 text-right text-sm font-medium text-gray-800">
                <p>
                  Subtotal:{" "}
                  <span className="font-semibold">
                    {formatToIndianRupee(approvalSummary.total)}
                  </span>
                </p>
                <p>
                  Subtotal (inc. GST):{" "}
                  <span className="font-semibold text-green-700">
                    {formatToIndianRupee(approvalSummary.totalInclGst)}
                  </span>
                </p>
              </div>
            </dd>
          </div>
        </dl>
      </div>

      {/* New Final Submission Dialog */}
      <div className="flex flex-col justify-end items-end mr-2 my-4">
        <Dialog>
          <DialogTrigger asChild>
            <Button
              className="flex items-center gap-1"
              disabled={
                !arePaymentTermsSet ||
                newCustomPRLoading ||
                resolveCustomPRCallLoading
              }
            >
              <ArrowBigUpDash className="" />
              {resolve ? "Resolve & Submit" : "Send for Approval"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Have you cross-checked your selections?</DialogTitle>
              <DialogDescription>
                Click 'Confirm' to proceed. You can add optional remarks below.
              </DialogDescription>
              <div className="flex flex-col gap-2 mt-2 text-start">
                <h4 className="font-bold">Remarks (Optional)</h4>
                <Textarea
                  className="border-green-400 focus:border-green-800 bg-green-100"
                  placeholder="Type here..."
                  value={comment || ""}
                  onChange={(e) =>
                    setComment(e.target.value === "" ? null : e.target.value)
                  }
                />
              </div>
            </DialogHeader>
            <div className="flex items-center justify-center gap-4 pt-2">
              {newCustomPRLoading || resolveCustomPRCallLoading ? (
                <TailSpin width={40} color={"red"} />
              ) : (
                <>
                  <DialogClose asChild>
                    <Button
                      variant="outline"
                      className="flex items-center gap-1 flex-1"
                    >
                      <Undo2 className="h-4 w-4" />
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button
                    variant="default"
                    onClick={resolve ? handleResolvePR : handleSubmit}
                    className="flex items-center gap-1 flex-1"
                  >
                    <CheckCheck className="h-4 w-4" />
                    Confirm
                  </Button>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {!arePaymentTermsSet && (
          <p className="text-xs text-red-500 mt-2">
            Please add payment terms for the vendor before proceeding.
          </p>
        )}
      </div>
    </>
  );
};