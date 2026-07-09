/**
 * TEMPORARY — "Resolve Invoices" admin tool (~1 week).
 *
 * Lists the EXTRACTION-FAILED invoices (mismatched-PO invoices whose line items
 * couldn't pass the AI match gate during the invoice_qty backfill) and lets an
 * Admin re-run the AI ("Analyze"), correct the invoice-line -> PO-item mapping
 * (and the per-line qty) inline, then Save -> recomputes invoice_qty.
 *
 * Reuses the app's LineItemMappingReview (with the opt-in editableQty prop).
 *
 * DELETE this file, its route in routesConfig.tsx, the backend temp_resolve.py,
 * and the editableQty prop on LineItemMappingReview when the window is over.
 */
import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, ExternalLink, Sparkles } from "lucide-react";
import {
  LineItemMappingReview,
  LineMatch,
  POItem,
} from "@/pages/ProcurementOrders/invoices-and-dcs/components/LineItemMappingReview";

interface UnresolvedInvoice {
  po: string; project: string; project_name: string; invoice: string;
  invoice_no: string; amount: number; status: string; attachment_url: string | null;
}

export default function ResolveInvoices() {
  const { user_id, role } = useUserData();
  const isAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile";

  const { data, isLoading, error, mutate } = useFrappeGetCall(
    "nirmaan_stack.api.invoices.temp_resolve.get_unresolved_invoices",
    {},
    isAdmin ? undefined : null,          // don't fetch unless admin
  );
  const list: UnresolvedInvoice[] = data?.message || [];

  if (!isAdmin) return <div className="p-6 text-red-600">Admin only.</div>;
  if (isLoading) return <div className="p-6 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error.message}</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Resolve Invoices <span className="text-sm font-normal text-muted-foreground">(temporary — extraction failures)</span>
        </h1>
        <span className="text-sm text-muted-foreground">{list.length} unresolved</span>
      </div>

      {list.length === 0 ? (
        <div className="text-green-600">🎉 Nothing to resolve — every extraction-failed invoice is mapped.</div>
      ) : (
        <div className="space-y-4">
          {list.map((inv) => (
            <InvoiceCard
              key={inv.invoice}
              inv={inv}
              onDone={() =>
                // Drop the resolved card IMMEDIATELY (the resolve is already committed). The
                // get_unresolved_invoices refetch is expensive, so don't make the user wait on it.
                mutate(
                  (cur: any) => ({
                    ...(cur || {}),
                    message: (cur?.message || []).filter((i: UnresolvedInvoice) => i.invoice !== inv.invoice),
                  }),
                  { revalidate: false },
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InvoiceCard({ inv, onDone }: { inv: UnresolvedInvoice; onDone: () => void }) {
  const { toast } = useToast();
  const { call: analyzeCall, loading: analyzing } = useFrappePostCall("nirmaan_stack.api.invoices.temp_resolve.analyze_invoice");
  const { call: resolveCall, loading: saving } = useFrappePostCall("nirmaan_stack.api.invoices.temp_resolve.resolve_invoice");

  const [extracted, setExtracted] = useState<any | null>(null);
  const [lineMatch, setLineMatch] = useState<LineMatch | null>(null);
  const [failMsg, setFailMsg] = useState<string | null>(null);

  const analyze = async () => {
    setFailMsg(null);
    try {
      const res: any = await analyzeCall({ invoice: inv.invoice });
      const msg = res?.message;
      if (!msg?.ok) { setFailMsg(msg?.error || "AI could not read this invoice."); return; }
      setExtracted(msg.extracted);
      setLineMatch(msg.extracted.line_match as LineMatch);
    } catch (e: any) {
      setFailMsg(e?.message || "Analyze failed.");
    }
  };

  const cancel = () => { setLineMatch(null); setExtracted(null); };

  const save = async () => {
    if (!lineMatch) return;
    try {
      const res: any = await resolveCall({
        invoice: inv.invoice,
        line_match: JSON.stringify(lineMatch),
        extracted: JSON.stringify(extracted),
      });
      toast({ title: `Resolved — ${res?.message?.mapped ?? 0} line(s) mapped to PO items`, variant: "success" });
      onDone();
    } catch (e: any) {
      toast({ title: "Failed to resolve", description: e?.message, variant: "destructive" });
    }
  };

  const poItems: POItem[] = extracted?.po_items || [];

  return (
    <div className="border rounded-md p-4 space-y-3 bg-white">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">
            {inv.po}
            {inv.project_name && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">· {inv.project_name}</span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            Invoice <b>{inv.invoice_no}</b> · ₹{Number(inv.amount).toLocaleString("en-IN")} · {inv.status}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {inv.attachment_url && (
            <a href={inv.attachment_url} target="_blank" rel="noreferrer"
               className="text-sm text-blue-600 inline-flex items-center gap-1">
              View Invoice <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {!lineMatch && (
            <Button size="sm" onClick={analyze} disabled={analyzing}>
              {analyzing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Analyze with AI
            </Button>
          )}
        </div>
      </div>

      {failMsg && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {failMsg} — resolve this one manually.
        </div>
      )}

      {/* Review & map (editable qty + PO-item dropdowns) */}
      {lineMatch && (
        <>
          <LineItemMappingReview
            extracted={extracted}
            poItems={poItems}
            lineMatch={lineMatch}
            onChange={setLineMatch}
            editableQty
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save &amp; Resolve
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
