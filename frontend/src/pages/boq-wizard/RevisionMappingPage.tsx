import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFrappeError } from "@/utils/frappeErrors";
import { RevisionIdentityPanel } from "./RevisionIdentityPanel";
import { SheetPairingRow } from "./SheetPairingRow";
import {
  initDecisions,
  isGeneralSpecsOriginal,
  isMappingComplete,
  toConfirmPayload,
  unclaimedOriginals,
  type CommittedSheet,
  type DecisionMap,
  type RevisedSheetProposal,
} from "./revisionMapping";

/** Shape of get_revision_mapping_proposal's `message`. */
interface ProposalResponse {
  project?: string;
  source_boq: string;
  boq_name: string;
  source_version: number | null;
  committed_at: string | null;
  committed_sheets: CommittedSheet[];
  carry_counts: { rates: number; classifications: number };
  revised_sheets: RevisedSheetProposal[];
  self_collision: boolean;
}

/**
 * Revised-BoQ sheet-mapping screen (ADR-0014 D3, S3) -- ALWAYS shown for a revision, between
 * upload and hub. Zone 1 (RevisionIdentityPanel) is the F2 control; Zone 2 (SheetPairingRow
 * list) is the F1 control. Everything is editable and nothing binds until Confirm -- the
 * screen is a staging area, and Confirm is where irreversibility begins (it seeds the drafts).
 * Back-nav routes by entity id, never navigate(-1).
 */
function RevisionMappingPage() {
  const { boqId } = useParams<{ boqId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useFrappeGetCall<{ message: ProposalResponse }>(
    "nirmaan_stack.api.boq.wizard.revision.get_revision_mapping_proposal",
    { boq: boqId },
    boqId ? `rev-map-proposal::${boqId}` : null
  );
  const proposal = data?.message;

  const { call: callConfirm, loading: confirming } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.revision.confirm_revision_mapping"
  );

  // Editable per-sheet decisions, seeded ONCE from the proposal (a later SWR revalidation must
  // never clobber the user's in-progress edits -- the ref guard keeps it seed-once).
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const seeded = useRef(false);
  useEffect(() => {
    if (proposal && !seeded.current) {
      setDecisions(initDecisions(proposal.revised_sheets));
      seeded.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  const [saveError, setSaveError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
        <p className="font-medium text-foreground">Couldn't load the revision</p>
        <p className="text-sm text-muted-foreground">
          {error ? getFrappeError(error) : `No revision found for “${boqId}”.`}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/upload-boq")}>
          Back to Upload BoQ
        </Button>
      </div>
    );
  }

  const committed = proposal.committed_sheets;
  const complete = isMappingComplete(proposal.revised_sheets, decisions);
  const unclaimed = unclaimedOriginals(committed, decisions);

  const setChoice = (sheetName: string, choice: string) => {
    setSaveError(null);
    setDecisions((prev) => ({
      ...prev,
      // Changing the target resets the general-specs default to whether the NEW target is
      // itself general-specs (a smart default the user can still toggle).
      [sheetName]: { choice, general_specs: isGeneralSpecsOriginal(committed, choice) },
    }));
  };

  const toggleGeneralSpecs = (sheetName: string, value: boolean) => {
    setDecisions((prev) => ({
      ...prev,
      [sheetName]: { ...prev[sheetName], general_specs: value },
    }));
  };

  const handleConfirm = async () => {
    if (!complete || confirming) return;
    setSaveError(null);
    try {
      await callConfirm({
        boq: boqId,
        mapping: toConfirmPayload(proposal.revised_sheets, decisions),
      });
      // Confirmed -> the hub now renders the seeded drafts. Route by entity id.
      navigate(`/upload-boq/hub/${boqId}`);
    } catch (e) {
      setSaveError(getFrappeError(e) || "Couldn't confirm the mapping. Please try again.");
    }
  };

  const backToProject = () =>
    navigate(proposal.project ? `/projects/${proposal.project}?page=boq` : "/upload-boq");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Map the revised sheets</h1>
          <p className="text-sm text-muted-foreground">
            Pair each sheet in your revised workbook to the original it revises, or declare it
            new. Nothing is carried until you confirm.
          </p>
        </div>

        <RevisionIdentityPanel
          identity={{
            boq_name: proposal.boq_name,
            source_version: proposal.source_version,
            committed_at: proposal.committed_at,
            committed_sheets: committed,
            carry_counts: proposal.carry_counts,
          }}
        />

        {proposal.self_collision && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            Two or more tabs in the revised workbook have near-identical names. We couldn't
            safely auto-pair them — please map each one explicitly below.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revised sheets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {proposal.revised_sheets.map((s) => (
              <SheetPairingRow
                key={s.sheet_name}
                revised={s}
                decision={decisions[s.sheet_name] ?? { choice: "", general_specs: false }}
                committedSheets={committed}
                onChangeChoice={(choice) => setChoice(s.sheet_name, choice)}
                onToggleGeneralSpecs={(v) => toggleGeneralSpecs(s.sheet_name, v)}
              />
            ))}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          {committed.length - unclaimed.length} of {committed.length} original sheet
          {committed.length === 1 ? "" : "s"} claimed
          {unclaimed.length > 0 && (
            <>
              {" "}— <span className="text-foreground">{unclaimed.map((c) => c.sheet_name).join(", ")}</span>{" "}
              won't carry
            </>
          )}
          .
        </p>

        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" onClick={backToProject} disabled={confirming}>
            Back to project
          </Button>
          <Button onClick={handleConfirm} disabled={!complete || confirming}>
            {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm mapping
          </Button>
        </div>
        {!complete && (
          <p className="text-right text-xs text-muted-foreground">
            Every sheet must be mapped or declared new, with no original mapped twice.
          </p>
        )}
      </div>
    </div>
  );
}

export default RevisionMappingPage;
export { RevisionMappingPage as Component };
