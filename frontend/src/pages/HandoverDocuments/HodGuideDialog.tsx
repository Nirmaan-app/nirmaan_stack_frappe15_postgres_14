// "Details": how the Handover Documents tab works, in the order a site team uses it.

import {
  BookOpenText,
  CheckCircle2,
  ClipboardList,
  Database,
  FileText,
  Library,
  Upload,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const Section: React.FC<{
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}> = ({ icon: Icon, title, children }) => (
  <div className="flex gap-3">
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50">
      <Icon className="h-3.5 w-3.5 text-red-700" />
    </div>
    <div className="space-y-1 text-sm text-gray-700">
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

export const HodGuideDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>How Handover Documents work</DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        <Section icon={ClipboardList} title="1. Add the systems">
          <p>
            <b>Create Handover Documents</b> (later <b>+ Add system</b>) — tick
            the systems this project hands over (Electrical, HVAC, …). Each
            system gets its own tab with the 16 handover documents.
          </p>
          <p>
            A document the project does not need: turn its <b>Use</b> switch
            off. It disappears from the printed checklist (the numbers close up)
            and from the binder.
          </p>
        </Section>

        <Section icon={CheckCircle2} title="2. Status follows your actions">
          <p>
            Nobody picks the status by hand — it moves when the work is done:
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <Pill className="bg-gray-100 text-gray-600">Pending</Pill> nothing
              done yet
            </li>
            <li>
              <Pill className="bg-blue-50 text-blue-700">Form Filled</Pill> the
              form was filled and saved (only documents with something to fill)
            </li>
            <li>
              <Pill className="bg-green-50 text-green-700">Completed</Pill> the
              signed copy is uploaded
            </li>
          </ul>
        </Section>

        <Section icon={FileText} title="3. Documents you fill (Form)">
          <p>
            Escalation Chart, Inventory List, Attic Stock List, Key List,
            O&amp;M Manual (blanks + project pictures), Equipment Warranty,
            Completion Certificate.
          </p>
          <p>
            <b>Fill Form</b> → save (<i>Form Filled</i>) → <b>Download</b> → get
            it signed → <b>Upload Signed</b> (<i>Completed</i>).
          </p>
        </Section>

        <Section icon={Library} title="4. Library documents">
          <p>
            Do&apos;s &amp; Don&apos;ts, Maintenance Checklist, Recommended
            Tools — the text is the same for every project and comes from the
            HOD library. Nothing to fill: <b>Download</b> → sign →{" "}
            <b>Upload Signed</b>.
          </p>
          <p>
            To change a system&apos;s library text (or its tools / warranty
            equipment), use <b>Edit library</b>.
          </p>
        </Section>

        <Section icon={Database} title="5. From Nirmaan">
          <p>
            Demo &amp; Training, Commissioning Report, Material TDS, Factory
            Test Reports, Snag List and As Built come from the Commission
            Report, TDS list, Snag List and Design Tracker — they are fixed
            there, not here.
          </p>
          <p>
            <b>Select &amp; Download</b> shows everything available for this
            system — Commission reports, TDS data sheets, each uploaded snag
            list, and the As Built drawings (downloaded from their Google Drive
            links). <b>View</b> any of them, tick the ones you need (all are
            ticked at first) and <b>Download selected</b>. The same ticks are
            used in the binder. Then upload the signed set (<i>Completed</i>).
          </p>
        </Section>

        <Section icon={Upload} title="6. Signed copies">
          <p>
            An uploaded signed copy is what the client receives: it replaces the
            generated document in the binder. Replace or remove it from the{" "}
            <b>⋮</b> menu.
          </p>
        </Section>

        <Section icon={BookOpenText} title="7. Checklist and binder">
          <p>
            <b>Checklist PDF</b> — cover page + the checklist (switched-on
            documents only).
          </p>
          <p>
            <b>Download binder</b> — everything in one PDF: cover, checklist,
            then each document behind a divider page. It first checks every
            switched-on document; any with nothing to download is listed so you
            can switch it off (or add its content) before it starts. A progress
            bar shows each step, and the PDF downloads by itself.
          </p>
        </Section>
      </div>

      <DialogFooter>
        <Button onClick={() => onOpenChange(false)}>Got it</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
