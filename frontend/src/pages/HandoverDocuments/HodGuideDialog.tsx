// "Details": how the Handover Documents tab works, in the order a site team uses it. The three kinds of
// document are the thing to understand first, so they are a table rather than prose.

import {
  BookOpenText,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  FileText,
  Library,
  MousePointerClick,
  Upload,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { SHOW_BINDER_BUTTON } from "./hodApi";

const Section: React.FC<{
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}> = ({ icon: Icon, title, children }) => (
  <div className="flex gap-3">
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50">
      <Icon className="h-3.5 w-3.5 text-red-700" />
    </div>
    <div className="min-w-0 space-y-1.5 text-sm text-gray-700">
      <p className="font-semibold text-gray-900">{title}</p>
      {children}
    </div>
  </div>
);

const Pill: React.FC<{ className: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <span
    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
  >
    {children}
  </span>
);

/** The three kinds, with the documents in each and what the team does with them. */
const KINDS: Array<{
  kind: string;
  tone: string;
  documents: string;
  todo: React.ReactNode;
}> = [
  {
    kind: "You fill it",
    tone: "bg-blue-50 text-blue-700",
    documents:
      "1 Escalation Chart · 7 Maintenance Checklist (result, remarks, comments) · 8 Inventory List · 9 Recommended Tools (remarks) · 10 Attic Stock List · 11 Key List · 12 Equipment Warranty · 13 Completion Certificate",
    todo: (
      <>
        <b>Fill Form</b> → <b>Download</b> → get it signed →{" "}
        <b>Upload Signed</b>
      </>
    ),
  },
  {
    kind: "Same for every project",
    tone: "bg-violet-50 text-violet-700",
    documents:
      "5 O&M Manual and 6 Do's & Don'ts — and the items inside the Maintenance Checklist and the Tools list",
    todo: (
      <>
        Nothing to fill: <b>Download</b> → sign → <b>Upload Signed</b>
      </>
    ),
  },
  {
    kind: "From Nirmaan",
    tone: "bg-amber-50 text-amber-700",
    documents:
      "2 Demo & Training · 3 Commissioning Report · 4 Material TDS · 14 Factory Test Reports · 15 Snag List · 16 As Built Drawings",
    todo: (
      <>
        <b>Select &amp; Download</b> the records you need → sign →{" "}
        <b>Upload Signed</b>
      </>
    ),
  },
];

export const HodGuideDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>How Handover Documents work</DialogTitle>
        <DialogDescription>
          Every system this project hands over gets the same 16 documents. Fill
          them, get them signed, upload the signed copies — then download one
          binder for the client.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <Section icon={ClipboardList} title="1. Add the systems you hand over">
          <p>
            <b>Create Handover Documents</b> (later <b>+ Add system</b>) — tick
            the systems: Electrical, HVAC, CCTV… Each one gets its own tab with
            the same 16 documents.
          </p>
          <p>
            A document this project does not need: switch <b>Use</b> off. It
            leaves the printed checklist (the numbers close up) and the binder,
            and can be switched back on any time. <b>Remove system</b> deletes
            that system&apos;s 16 rows — it warns first if anything was filled.
          </p>
        </Section>

        <Section icon={FileText} title="2. The 16 documents come in three kinds">
          <div className="overflow-hidden rounded-md border">
            {KINDS.map((k, i) => (
              <div
                key={k.kind}
                className={`grid gap-1 p-3 ${i > 0 ? "border-t" : ""}`}
              >
                <Pill className={`w-fit ${k.tone}`}>{k.kind}</Pill>
                <p className="text-[13px] leading-relaxed text-gray-600">
                  {k.documents}
                </p>
                <p className="text-[13px] text-gray-700">{k.todo}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={CheckCircle2} title="3. You answer each document">
          <p>The Checklist Status column is the handover answer:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <Pill className="bg-green-600 text-white">YES</Pill> handed over
              — it prints YES on the checklist and the document goes into the
              binder
            </li>
            <li>
              <Pill className="bg-gray-100 text-gray-600">NO</Pill> not handed
              over (where every document starts)
            </li>
            <li>
              <Pill className="bg-amber-50 text-amber-700">NA</Pill> not
              applicable to this project
            </li>
          </ul>
          <p>
            <b>YES waits until the document is saved</b> — fill the form, or
            tick and save the records it hands over. NO and NA can be set at any
            time. A switched-off document is not on the checklist at all, which
            is different from NA.
          </p>
        </Section>

        <Section icon={MousePointerClick} title="4. The Actions column">
          <p>
            The button on the right is the next step for that row — Fill Form,
            Download, Select &amp; Download, Upload Signed or View Signed.
          </p>
          <p>
            The <b>⋮</b> menu has the rest: view or edit the form, see the
            records a From Nirmaan document reads, preview the PDF, download it
            again, and replace or remove the signed copy.
          </p>
        </Section>

        <Section icon={Database} title="5. Documents that come from Nirmaan">
          <p>
            Demo &amp; Training, Commissioning and Factory Test come from the{" "}
            <b>Commission Report</b>, Material TDS from the <b>TDS list</b>, the
            Snag List from <b>Snag List</b> batches, and As Built from the{" "}
            <b>Design Tracker</b>. They are maintained there, never here.
          </p>
          <p>
            <b>Select &amp; Download</b> lists what is <b>finished</b> for this
            system — commissioning reports that are Submitted or Client
            Accepted, As Built drawings that are Submitted or Approved, and the
            Completed snags of each list. Work still in progress is not listed,
            and the snag list prints with the same filter. <b>View</b> any of
            it, tick what belongs in the handover (all ticked at first) and{" "}
            <b>Download selected</b> — the same ticks are used in the binder.
          </p>
        </Section>

        <Section icon={Upload} title="6. Signed copies win">
          <p>
            An uploaded signed copy is what the client receives: in the binder
            it replaces the generated page, and for a From Nirmaan document it
            replaces the reports behind it.
          </p>
        </Section>

        <Section
          icon={Download}
          title={
            SHOW_BINDER_BUTTON ? "7. Checklist and binder" : "7. Checklist PDF"
          }
        >
          <p>
            <b>Checklist PDF</b> — the cover page and the checklist of the
            switched-on documents.
          </p>
          {SHOW_BINDER_BUTTON && (
          <p>
            <b>Download binder</b> — one PDF with the cover, the checklist, and
            every switched-on document behind a divider page. It is the
            client&apos;s finished set, so it unlocks only once{" "}
            <b>every document is Completed</b>; until then the button says how
            many are still to go. Switch off what this project does not need
            and those stop counting. The button itself counts the steps while
            it builds, and the PDF downloads by itself — about a minute for a
            big binder.
          </p>
          )}
        </Section>

        <Section icon={Library} title="8. Where the standard text lives">
          <p>
            The O&amp;M manuals, Do&apos;s &amp; Don&apos;ts, maintenance
            checks, tools and warranty equipment are kept once per system in the
            library, under <b>Packages Settings → Handover Documents</b> (the{" "}
            <b>Edit library</b> button opens it).
          </p>
          <p>
            An edit there shows on the next download of every project handing
            that system over — so fix the wording before teams start filling.
            The <b>Edit library</b> button only appears for the people allowed
            to change it.
          </p>
        </Section>

        <Section icon={BookOpenText} title="Good to know">
          <ul className="ml-4 list-disc space-y-1">
            <li>
              Anything you leave empty prints blank, so a sheet can still be
              filled in by hand on site.
            </li>
            <li>
              Dates default to the day you download, except the Maintenance
              Checklist, which stays blank unless you set the date of the check.
            </li>
            <li>
              The Escalation Chart starts with three levels; <b>Add level</b> in
              its form prints a fourth (and the same contacts reach the warranty
              certificate).
            </li>
          </ul>
        </Section>
      </div>

      <DialogFooter>
        <Button onClick={() => onOpenChange(false)}>Got it</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
