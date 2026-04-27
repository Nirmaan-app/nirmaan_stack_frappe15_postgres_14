import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowUpFromLine } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { useToast } from "@/components/ui/use-toast";
import {
  FuzzySearchSelect,
  type FuzzyOptionType,
} from "@/components/ui/fuzzy-search-select";
import type { Projects } from "@/types/NirmaanStack/Projects";
import { useWarehouseStock } from "./hooks/useWarehouseStock";
import formatToIndianRupee from "@/utils/FormatPrice";

interface ProjectOption extends FuzzyOptionType {
  label: string;
  value: string;
}

interface Selection {
  item_id: string;
  make: string | null;
  item_name: string;
  unit: string;
  category: string;
  transfer_quantity: number;
  available_quantity: number;
  estimated_rate: number;
}

// Stock rows are keyed by (item_id, make) — a composite key string used for
// React list keys and selection de-dup. null/empty make is its own bucket.
const rowKey = (item_id: string, make: string | null | undefined) =>
  `${item_id}__${make || ""}`;

export default function RequestFromWarehouse() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [targetProject, setTargetProject] = useState<ProjectOption | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: projects, isLoading: projectsLoading } =
    useFrappeGetDocList<Projects>(
      "Projects",
      {
        fields: ["name", "project_name", "creation"],
        limit: 0,
        orderBy: { field: "creation", order: "desc" },
      },
      "warehouse-request-projects-newest-first"
    );

  // Preserve the backend's `creation desc` order so newest projects surface
  // at the top of the dropdown.
  const projectOptions = useMemo<ProjectOption[]>(
    () =>
      (projects ?? []).map((p) => ({
        label: p.project_name || p.name,
        value: p.name,
      })),
    [projects]
  );

  const { data: stockData, isLoading: loadingStock } = useWarehouseStock("");
  const stockRows = useMemo(() => stockData?.message || [], [stockData]);

  const { call: createITR } = useFrappePostCall(
    "nirmaan_stack.api.internal_transfers.create_transfer_request.create_transfer_request"
  );

  const toggleItem = useCallback(
    (item: typeof stockRows[0]) => {
      const make = (item as any).make || null;
      const key = rowKey(item.item_id, make);
      setSelections((prev) => {
        const exists = prev.find((s) => rowKey(s.item_id, s.make) === key);
        if (exists) return prev.filter((s) => rowKey(s.item_id, s.make) !== key);
        return [...prev, {
          item_id: item.item_id,
          make,
          item_name: item.item_name,
          unit: item.unit,
          category: item.category,
          transfer_quantity: 1,
          available_quantity: item.available_quantity,
          estimated_rate: item.estimated_rate,
        }];
      });
    }, []
  );

  const updateQuantity = useCallback((key: string, qty: number) => {
    setSelections((prev) =>
      prev.map((s) =>
        rowKey(s.item_id, s.make) === key
          ? { ...s, transfer_quantity: Math.max(0, Math.min(qty, s.available_quantity)) }
          : s
      )
    );
  }, []);

  const handleSubmit = async () => {
    if (!targetProject?.value) {
      toast({ title: "Error", description: "Please select a target project.", variant: "destructive" });
      return;
    }
    const valid = selections.filter((s) => s.transfer_quantity > 0);
    if (valid.length === 0) {
      toast({ title: "Error", description: "Select at least one item with quantity > 0.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const result = await createITR({
        target_project: targetProject.value,
        selections: JSON.stringify(
          valid.map((s) => ({
            item_id: s.item_id,
            make: s.make,
            source_project: "",
            source_type: "Warehouse",
            transfer_quantity: s.transfer_quantity,
          }))
        ),
      });
      const created = (result as any)?.message?.requests || [];
      toast({ title: "Success", description: `Transfer Request ${created.join(", ")} created.`, variant: "success" });
      navigate("/internal-transfer-memos");
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to create request.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/warehouse")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-xl font-semibold">Request Material from Warehouse</h2>
      </div>

      <div className="rounded-md border bg-card p-4 space-y-2">
        <div>
          <Label className="text-sm font-semibold">Select Destination</Label>
          <p className="text-xs text-muted-foreground">
            Select the project where these warehouse materials will be delivered.
          </p>
        </div>
        <FuzzySearchSelect<ProjectOption>
          allOptions={projectOptions}
          value={targetProject}
          onChange={(opt) => setTargetProject(opt as ProjectOption | null)}
          tokenSearchConfig={{
            searchFields: ["label", "value"],
            minSearchLength: 1,
            partialMatch: true,
            fieldWeights: { label: 2, value: 1 },
          }}
          isClearable
          isLoading={projectsLoading}
          placeholder="Search and select target project..."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Warehouse Stock</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingStock ? (
            <div className="flex justify-center p-8">
              <TailSpin color="#D03B45" height={40} width={40} />
            </div>
          ) : stockRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No items available in warehouse.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead>Make</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Est. Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockRows.map((item) => {
                    const make = (item as any).make || null;
                    const key = rowKey(item.item_id, make);
                    const selected = selections.find((s) => rowKey(s.item_id, s.make) === key);
                    return (
                      <TableRow key={key} className={selected ? "bg-blue-50" : ""}>
                        <TableCell>
                          <input type="checkbox" checked={!!selected} onChange={() => toggleItem(item)} className="rounded" />
                        </TableCell>
                        <TableCell className="font-medium">{item.item_name}</TableCell>
                        <TableCell>{make || "-"}</TableCell>
                        <TableCell>{item.category}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell className="text-right">{item.available_quantity}</TableCell>
                        <TableCell className="text-right">
                          {selected ? (
                            <Input
                              type="number" min={1} max={item.available_quantity}
                              value={selected.transfer_quantity}
                              onChange={(e) => updateQuantity(key, parseFloat(e.target.value) || 0)}
                              className="w-24 text-right ml-auto"
                            />
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-right">{formatToIndianRupee(item.estimated_rate)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selections.length > 0 && targetProject?.value && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setSelections([])}>Clear</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <TailSpin color="#fff" height={16} width={16} />
            ) : (
              <>
                <ArrowUpFromLine className="mr-2 h-4 w-4" />
                Request {selections.length} item(s)
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
