import { useState } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { OrderDetailLink } from "@/pages/ProjectPayments/components/OrderDetailLink";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";

import { OrderDoctype, useAmountPaidMismatch } from "../hooks/useAmountPaidMismatch";

interface AmountPaidMismatchReportProps {
  doctype: OrderDoctype;
}

const ORDER_LABEL: Record<OrderDoctype, string> = {
  "Procurement Orders": "PO",
  "Service Requests": "WO",
};

/** A rupee figure with its minus sign in front: "₹600.00", "−₹200.00", "₹0.00". */
const rupees = (value: number) =>
  value < 0 ? `−${formatToIndianRupeeOrZero(-value)}` : formatToIndianRupeeOrZero(value);

/** A difference, always signed: "+₹600.00", "−₹200.00", "₹0.00". */
const signedRupees = (value: number) => (value > 0 ? `+${rupees(value)}` : rupees(value));

const errorMessage = (e: unknown) => {
  const err = e as { message?: string; exception?: string } | undefined;
  return err?.message || err?.exception || "The recount failed.";
};

/**
 * Reports → PO / WO "Amount Paid Mismatch" (#1455, ADR-0034): every order whose stored Amount Paid
 * or Amount Due differs from its payments less Received refunds by ₹1 or more, worked out live by
 * the server. Recount sets one order from source (a PO's refund links and vendor credit too); a
 * wrong payment is fixed on the payment, and the order then recounts by itself.
 */
export default function AmountPaidMismatchReport({ doctype }: AmountPaidMismatchReportProps) {
  const label = ORDER_LABEL[doctype];
  const { rows, isLoading, isRefreshing, error, refresh, recount } = useAmountPaidMismatch(doctype);
  const [recounting, setRecounting] = useState<string | null>(null);

  const handleRecount = async (name: string) => {
    setRecounting(name);
    try {
      const reply = await recount(name);
      toast({
        title: reply.recounted ? `${name} recounted` : `${name} was already right`,
        description: reply.recounted
          ? "Amount Paid and Amount Due are now set from its payments and refunds."
          : "Nothing was changed.",
        variant: "success",
      });
    } catch (e) {
      toast({ title: `Could not recount ${name}`, description: errorMessage(e), variant: "destructive" });
    } finally {
      setRecounting(null);
    }
  };

  if (error) return <AlertDestructive error={error} />;
  if (isLoading) return <LoadingFallback />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {label}s whose stored Amount Paid or Amount Due differs by ₹1 or more from their Paid payments
          less Received refunds. If a payment is wrong, fix the payment: the {label} then recounts by itself.
          Recount sets the {label} from its payments and refunds.
        </p>
        <Button variant="outline" size="sm" onClick={() => refresh()} disabled={isRefreshing}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          Every {label}'s Amount Paid and Amount Due match its payments and refunds.
        </div>
      ) : (
        <>
          <p className="text-sm font-medium">
            {rows.length} {label}{rows.length === 1 ? "" : "s"} to check
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{label}</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount Paid</TableHead>
                  <TableHead className="text-right">Correct Amount Paid</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead className="text-right">Amount Due</TableHead>
                  <TableHead className="text-right">Correct Amount Due</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <OrderDetailLink docName={row.name} className="text-blue-600 underline-offset-2 hover:underline">
                        {row.name}
                      </OrderDetailLink>
                    </TableCell>
                    <TableCell>{row.project_name || row.project || "--"}</TableCell>
                    <TableCell>{row.vendor_name || row.vendor || "--"}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.status || "--"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {rupees(row.stored_paid)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {rupees(row.correct_paid)}
                    </TableCell>
                    <TableCell
                      className={`whitespace-nowrap text-right tabular-nums ${
                        row.paid_difference ? "font-medium text-red-600" : "text-muted-foreground"
                      }`}
                    >
                      {signedRupees(row.paid_difference)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {rupees(row.stored_due)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {rupees(row.correct_due)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRecount(row.name)}
                        disabled={recounting !== null}
                      >
                        {recounting === row.name && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                        Recount
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
