// src/pages/ExpenseRequests/components/NewExpenseRequestDialog.tsx
//
// Raise an expense request. This creates an `Expense Request`, NOT an expense — the ledger
// row only exists once a reviewer approves, or at once for a raiser on Records without review
// (#1498: the button then reads "Record expense" and says who approves next).
//
// The type list comes from the backend (`get_request_catalog`) rather than a TS mirror, so
// the picker can never offer a type the create endpoint would then refuse. The catalog also
// carries each type's project flags, which drive the CONDITIONAL Project field:
//   project only     -> shown and required
//   non-project only -> hidden entirely
//   both             -> shown and optional; the choice picks the ledger
//
// The New Expense form (spec #1494, #1501) asks, in order: Type, Amount, Project (as above),
// an optional Vendor (searchable, once a project is chosen), Who gets paid (below), then the
// details, "Do you have the invoice?" and a Comment (optional). The type's "Enable Source" switch
// decides the details. ON: the type's own format. OFF (or no format): a required Description.
// Which fields show is `utils/newExpenseForm.newExpenseFields`.
//
// The invoice (#1502) is asked the same way for every type (`InvoiceSection`): Yes uploads it and
// Gemini fills its date and number; No adds it later from the request's page. Its notes are
// warnings and never block submit; the server returns the same ones (`flatten.invoice_warnings`).
//
// A staff stay that overlaps another for the same person (#1504) is flagged while the form is
// filled: in bold with the matches for a raiser on Records without review, as a quiet note for
// anyone else. It never blocks submit (`api/expense_requests/duplicates`).
//
// Who gets paid (ADR-0033, #1429, #1436): when the type's `payee_rule` asks (Required / Optional), the
// "Who gets paid" section picks or adds a Payee -- or, with a vendor picked, shows that vendor's
// account read-only. The server COPIES the account into the request's own pay-to fields
// (`services/payees/pay_to`) and refuses nothing: Required is this screen's rule.
//
// Office Rent (spec #1522, #1524): the raiser types the full rent, and the line under the Amount
// shows the 10% TDS and what the landlord gets (`utils/expenses/expenseTds`). A form's PAN answer
// not shaped like ABCPK1234D, or month answer not a month and year, blocks submit, and the server
// refuses it too. Office Rent's Who gets paid is Required: the landlord's account.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrappeFileUpload, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";

import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
    FuzzySearchSelect, FuzzyOptionType, TokenSearchConfig,
} from "@/components/ui/fuzzy-search-select";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import ProjectSelect from "@/components/custom-select/project-select";
import VendorSelect, { OTHERS_VENDOR_VALUE } from "@/components/custom-select/vendor-select";

import { DuplicatePayeeError, usePayeeChoice } from "@/components/payees/usePayeeChoice";
import { useVendorAccount } from "@/components/payees/vendorPayeeAccount";
import type { PayToAccount } from "@/types/NirmaanStack/Payee";
import {
    asksWhoGetsPaid,
    showsWhoGetsPaid,
    whoGetsPaidProblem,
} from "@/utils/payees/expensePayee";
import { payToSave } from "@/utils/payees/payToChoice";
import { OWN_ACCOUNT_REFUSAL } from "@/utils/payees/payeeForm";

import { invoiceNotes, newExpenseFields, newExpenseSubmit, whatHappensNext } from "@/utils/newExpenseForm";
import { raiserLevelOf } from "@/utils/approvalTiers";
import { CEO_AUTHORIZED_USER } from "@/constants/ceoHold";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useUserData } from "@/hooks/useUserData";
import { parseNumber } from "@/utils/parseNumber";
import { getFrappeError } from "@/utils/frappeErrors";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type {
    ExpenseRequest, GetRequestCatalogResponse, RequestCatalogType, SaveExpenseRequestResponse,
    StayDuplicate,
} from "@/types/NirmaanStack/ExpenseRequest";
import {
    answersFromSourceData, invalidMonthKeys, invalidPanKeys, NATIVE_INVOICE_SECTION, parseFormat,
    readDetailDescription, readNativeInvoice, seedAnswers,
} from "@/utils/expenseFormat";
import { expenseTdsSplit, tdsPreviewLine } from "@/utils/expenses/expenseTds";
import FormatFieldsRenderer, {
    FormatAnswers, FormatFiles, requiredKeys, toResponses,
} from "./FormatFieldsRenderer";
import InvoiceQuestion, {
    checksLine, EMPTY_INVOICE, invoiceSourceData, InvoiceValue,
} from "./InvoiceSection";
import WhoGetsPaidSection from "./WhoGetsPaidSection";
import DuplicateStayNote from "@/components/common/DuplicateStayNote";

/** One option per expense type, picked by its name.
 *
 *  `scope` is shown grey on the right of each menu row (owner, 17 Sep 2026), worded as the
 *  Expense Packages master words it. Display only -- it is not searched. */
interface ExpenseTypeOption extends FuzzyOptionType {
    value: string;
    label: string;
    scope: "Project" | "Non-Project" | "Both";
}

const EXPENSE_TYPE_SEARCH: TokenSearchConfig = {
    searchFields: ["label"],
    minSearchLength: 1,
    partialMatch: true,
    minTokenLength: 1,
    fieldWeights: { label: 2.0 },
    minTokenMatches: 1,
};

interface Props {
    onSuccess?: () => void;
    /** The request being EDITED, or null to raise a new one.
     *
     *  ONE dialog for both, deliberately (ADR-0010 F3): a copy would be a near-twin of ~390
     *  lines, and every rule the create path applies -- the type/project gate, the vendor
     *  gate, the format renderer -- would have to be kept in step by hand across the two. */
    editing?: ExpenseRequest | null;
    onEditingChange?: (r: ExpenseRequest | null) => void;
}

interface FormState {
    expense_type: string;
    projects: string;
    // "" for no vendor chosen, or the SENTINEL once "Others (No Vendor)" is picked -- see
    // `vendor-select`. The payload maps both to nothing, so the sentinel never leaves this file.
    vendor: string;
    amount: string;
    description: string;
    comment: string;
}

const EMPTY: FormState = {
    expense_type: "", projects: "", vendor: "", amount: "", description: "", comment: "",
};


export const NewExpenseRequestDialog: React.FC<Props> = ({
    onSuccess, editing = null, onEditingChange,
}) => {
    const { newExpenseRequestDialog, setNewExpenseRequestDialog } = useDialogStore();
    const { toast } = useToast();
    const navigate = useNavigate();
    const { full_name, user_id, role } = useUserData();

    const [form, setForm] = useState<FormState>(EMPTY);
    const [answers, setAnswers] = useState<FormatAnswers>({});
    // Files are held, not uploaded, until submit -- a cancelled dialog then cannot orphan one.
    const [files, setFiles] = useState<FormatFiles>({});
    // The invoice belongs to the expense, not to its type, so a type change keeps it.
    const [invoice, setInvoice] = useState<InvoiceValue>(EMPTY_INVOICE);
    const patchInvoice = useCallback(
        (patch: Partial<InvoiceValue>) => setInvoice((v) => ({ ...v, ...patch })), []
    );
    const [submitting, setSubmitting] = useState(false);
    const amountRef = useRef<HTMLInputElement>(null);
    // Edit-only: the requester has asked to swap the project, so hand them the picker.
    const [changingProject, setChangingProject] = useState(false);
    // Who gets paid when no vendor is picked: an existing Payee, or a new one added on send. On an
    // edit (no vendor) the request's own account is seeded as the pick; while it stays picked the save
    // keeps it as it is (`utils/payees/payToChoice`), so a Payee edited since moves nothing.
    const payeeChoice = usePayeeChoice();

    const isEdit = !!editing;
    // The catalog lists only the types the caller's role may see. An EDIT also asks for the
    // request's own type, which its owner may keep even after that type's roles were narrowed.
    const { data: catalogRes, isLoading: catalogLoading } =
        useFrappeGetCall<{ message: GetRequestCatalogResponse }>(
            "nirmaan_stack.api.expense_requests.read.get_request_catalog",
            editing?.type ? { include_type: editing.type } : undefined,
            editing?.type ? `expense_request_catalog_${editing.type}` : "expense_request_catalog"
        );

    const { call: updateRequest } = useFrappePostCall<{ message?: SaveExpenseRequestResponse }>(
        "nirmaan_stack.api.expense_requests.update.update_expense_request"
    );
    const { call: createRequest } = useFrappePostCall<{ message?: SaveExpenseRequestResponse }>(
        "nirmaan_stack.api.expense_requests.create.create_expense_request"
    );
    const { upload } = useFrappeFileUpload();

    // Fetched once a type is picked. Returns null when the type's form is switched OFF, which
    // is how that switch reaches this screen.
    const { data: formatRes, isLoading: formatLoading } = useFrappeGetCall<{ message: { source_format: string | null } }>(
        "nirmaan_stack.api.expense_requests.read.get_expense_format",
        { expense_type: form.expense_type },
        form.expense_type ? `expense_format_${form.expense_type}` : null
    );
    const parsedFormat = useMemo(
        () => parseFormat(formatRes?.message?.source_format),
        [formatRes]
    );

    const catalogTypes = useMemo(() => catalogRes?.message?.types ?? [], [catalogRes]);

    const typeOptions: ExpenseTypeOption[] = useMemo(
        () => catalogTypes
            .map((t): ExpenseTypeOption => ({
                value: t.expense_type, label: t.expense_type,
                scope: t.project && t.non_project ? "Both" : t.project ? "Project" : "Non-Project",
            }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        [catalogTypes]
    );
    // Resolved from the options rather than held in state, so the chosen row and the form's
    // value can never disagree -- and an unloaded catalog reads as nothing selected.
    const selectedTypeOption = useMemo(
        () => typeOptions.find((o) => o.value === form.expense_type) ?? null,
        [typeOptions, form.expense_type]
    );

    const typesById = useMemo(() => {
        const m = new Map<string, RequestCatalogType>();
        catalogTypes.forEach((t) => m.set(t.expense_type, t));
        return m;
    }, [catalogTypes]);

    // Seed bound + default answers once a format is chosen. Keyed on the format's identity,
    // and it runs only after `handleTypeChange` has already cleared `answers` -- so it fills a
    // blank form and never overwrites something the requester typed.
    // ⚠️ SKIPPED ONCE WHEN OPENING AN EDIT. The format is fetched from the type, so this
    // effect resolves AFTER the edit seed below and would overwrite the requester's stored
    // answers with blank defaults -- silently, and only for formatted types. It is skipped
    // exactly once per opened request; a later type CHANGE clears the flag, so switching type
    // mid-edit still seeds the new format's defaults as it does on a fresh request.
    const skipNextSeed = useRef(false);
    useEffect(() => {
        if (!parsedFormat) return;
        if (skipNextSeed.current) { skipNextSeed.current = false; return; }
        setAnswers(seedAnswers(parsedFormat, { userFullName: full_name, userEmail: user_id }));
    }, [parsedFormat, full_name, user_id]);

    // The project to SHOW instead of the picker: only on an edit, only while the requester has
    // not asked to change it, and only while `form.projects` still holds what the request came
    // with -- a type change clears it, which must hand back the picker rather than keep showing
    // a project the new type may not even allow. Falls back to the id when the readable name is
    // absent, because showing the id beats showing nothing on a required field.
    const chosenProjectLabel = isEdit && !changingProject && form.projects
        ? (editing?.projects_name || form.projects)
        : "";

    const selected = form.expense_type ? typesById.get(form.expense_type) : undefined;
    // Which fields the type asks (`utils/newExpenseForm`). The Vendor is optional and PROJECT-ONLY,
    // shown once a project is CHOSEN: `Non Project Expenses` has no vendor column, so a vendor on a
    // non-project request would be dropped at approval. A type whose form is switched off (or
    // unwritten, or unparseable) asks a Description instead; while a form is still loading neither
    // is shown, so the Description never flashes up and vanishes.
    const fields = newExpenseFields({
        type: selected,
        projectChosen: !!form.projects,
        formatLoading,
        formatReady: !!parsedFormat,
    });
    const showProject = fields.project !== "hidden";
    const projectRequired = fields.project === "required";
    const showVendor = fields.vendor;
    const formatPending = fields.details === "loading";
    const isStandard = fields.details === "description";
    const vendorChosen = showVendor && !!form.vendor && form.vendor !== OTHERS_VENDOR_VALUE;

    // Who gets paid: asked unless the type says Not asked. With a vendor picked it is the vendor's
    // account, shown read-only, on a Not asked type too (the accountant pays it): the server copies
    // the vendor's Payee when the vendor is set or changed. An edit that keeps its vendor keeps the
    // account the request already holds, so that is what shows.
    const payeeRule = selected?.payee_rule ?? "";
    const asksPayee = !!selected && asksWhoGetsPaid(payeeRule);
    const showsPayee = !!selected && showsWhoGetsPaid(payeeRule, vendorChosen);
    const keepsVendorCopy = vendorChosen && !!editing?.pay_to && form.vendor === editing.vendor;
    const { account: vendorAccount, isLoading: vendorAccountLoading } =
        useVendorAccount(form.vendor, showsPayee && vendorChosen && !keepsVendorCopy);
    const vendorPayTo: PayToAccount | null = !vendorChosen
        ? null
        : keepsVendorCopy ? editing?.pay_to ?? null : vendorAccount?.payee ?? null;
    const vendorPayToLoading = vendorChosen && !keepsVendorCopy && vendorAccountLoading;
    const vendorName = vendorChosen ? (vendorAccount?.vendor_name || form.vendor) : null;
    const payeeProblem = showsPayee
        ? whoGetsPaidProblem({
            rule: payeeRule,
            expenseType: form.expense_type,
            vendor: vendorName,
            vendorHasAccount: !!vendorPayTo,
            hasChoice: payeeChoice.hasChoice,
        })
        : null;
    const payeeReady = !payeeProblem && (
        vendorChosen ? !vendorPayToLoading : !asksPayee || !payeeChoice.problem
    );

    const handleVendorChange = (value: string) => {
        setForm((f) => ({ ...f, vendor: value }));
    };

    const set = useCallback(
        <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v })),
        []
    );

    // Answers belong to the type that was on screen when they were typed. Carrying them to
    // a different type would silently file one type's answers under another's format.
    const handleTypeChange = (value: string) => {
        setAnswers({});
        setFiles({});
        // Clear the project: a stale value on a type that just became non-project would be
        // refused by the server, which reads as the form ignoring what was typed. The vendor
        // hangs off the project, so it goes with it -- a vendor left behind on a now
        // non-project type is exactly the value the server refuses.
        setForm((f) => ({ ...f, expense_type: value, projects: "", vendor: "" }));
    };

    // Clearing or switching the project clears the vendor with it. Without this a vendor
    // picked under one project would silently ride along to another, or sit invisible on a
    // request with no project at all.
    const handleProjectChange = (projectId: string) => {
        if (form.projects === projectId) return;
        setForm((f) => ({ ...f, projects: projectId, vendor: "" }));
    };

    // DUPLICATE STAY (#1504): asked of the server while the form is filled, never blocking. The
    // answers go in the same envelope submit sends; the server knows which forms it checks, so no
    // field name lives here. On an edit the server answers only once the stay itself has changed.
    // Debounced, so typing is not a call.
    const stayQueryNow = useMemo(
        () => (parsedFormat
            ? JSON.stringify({
                templateId: parsedFormat.templateId,
                templateVersion: parsedFormat.templateVersion,
                responses: toResponses(answers),
            })
            : ""),
        [parsedFormat, answers]
    );
    const [stayQuery, setStayQuery] = useState("");
    useEffect(() => {
        const t = setTimeout(() => setStayQuery(stayQueryNow), 500);
        return () => clearTimeout(t);
    }, [stayQueryNow]);
    const { data: stayRes } = useFrappeGetCall<{ message: { matches: StayDuplicate[] } }>(
        "nirmaan_stack.api.expense_requests.duplicates.check_duplicate_stay",
        { source_data: stayQuery, ...(isEdit ? { exclude: editing!.name } : {}) },
        stayQuery ? `exr_stay_${editing?.name ?? ""}_${stayQuery}` : null
    );
    // Only an answer about what is on screen NOW: a stale one would warn over changed dates.
    const stayMatches = stayQuery === stayQueryNow ? stayRes?.message?.matches ?? [] : [];

    const amountValue = parseNumber(form.amount);
    const missingFormatAnswers = useMemo(
        () => requiredKeys(parsedFormat).filter((k) => !(answers[k] || "").trim()),
        [parsedFormat, answers]
    );
    // A PAN not shaped like one is refused here and by the server (`create.guard_pan_answers`, #1524).
    const badPanAnswers = useMemo(() => invalidPanKeys(parsedFormat, answers), [parsedFormat, answers]);
    // A month not given as month and year (`YYYY-MM`) likewise (`create.guard_month_answers`).
    const badMonthAnswers = useMemo(() => invalidMonthKeys(parsedFormat, answers), [parsedFormat, answers]);
    // Office Rent withholds 10% (#1524): the raiser types the full rent and sees the split under it.
    const tdsLine = tdsPreviewLine(expenseTdsSplit(form.expense_type, amountValue));
    // The standard request's own requirement: the SAME rule the server's `guard_request_form`
    // applies. The vendor is optional (#1501) and the invoice only warns (#1502).
    const standardComplete = !isStandard || !!form.description.trim();
    const notes = invoiceNotes({
        hasFile: invoice.has === "yes" && !!invoice.file_url,
        read: invoice.read,
        invoice_date: invoice.invoice_date,
        invoice_ref: invoice.invoice_ref,
        typedAmount: amountValue,
    });
    // Records without review (#1498): the server says whether this raiser's request is approved on
    // submit; the button then reads "Record expense" and says who approves the Expense next.
    const submitWording = newExpenseSubmit({
        recordsWithoutReview: !!catalogRes?.message?.records_without_review,
        amount: amountValue,
        level: raiserLevelOf(role, user_id, CEO_AUTHORIZED_USER),
    });
    const canSubmit =
        !!form.expense_type &&
        amountValue > 0 &&
        (!projectRequired || !!form.projects) &&
        !formatPending &&
        missingFormatAnswers.length === 0 &&
        badPanAnswers.length === 0 &&
        badMonthAnswers.length === 0 &&
        standardComplete &&
        payeeReady &&
        !payeeChoice.adding &&
        !invoice.busy &&
        !submitting;

    const close = useCallback(() => {
        setForm(EMPTY);
        setChangingProject(false);
        setAnswers({});
        setFiles({});
        setInvoice(EMPTY_INVOICE);
        payeeChoice.reset();
        setNewExpenseRequestDialog(false);
        onEditingChange?.(null);
    }, [setNewExpenseRequestDialog, onEditingChange, payeeChoice.reset]);

    // Seed from the request being edited. Keyed on its NAME, not the object: the row is
    // re-fetched on every refresh, so an object-identity dep would re-seed the form under the
    // requester mid-edit and discard what they had typed.
    useEffect(() => {
        if (!editing) return;
        const stored = readNativeInvoice(editing.source_data);
        setForm({
            expense_type: editing.type ?? "",
            projects: editing.projects ?? "",
            // A saved request with no vendor shows the Vendor field EMPTY (spec #1494): the Vendor is
            // optional (#1501), so empty is how "no vendor" reads on a new request too. "Others (No
            // Vendor)" is a UI-only sentinel submit strips, so seeding it back named a choice the
            // requester may never have made.
            vendor: editing.vendor || "",
            amount: String(editing.amount ?? ""),
            // A format-less request keeps its typed text under the synthetic `detail`
            // key -- the doctype has no `description` column to read it back from.
            description: readDetailDescription(editing.source_data),
            comment: editing.comment ?? "",
        });
        setInvoice({
            ...EMPTY_INVOICE,
            has: stored.invoice_date || stored.invoice_ref || stored.invoice_attachment ? "yes" : "no",
            file_url: stored.invoice_attachment,
            invoice_date: stored.invoice_date,
            invoice_ref: stored.invoice_ref,
        });
        setChangingProject(false);
        // The request's own account (`pay_to`), seeded as the pick when it was picked rather than
        // copied from a vendor. A vendor's copy is not seeded: clearing the vendor then asks anew.
        payeeChoice.reset(editing.pay_to && !editing.vendor ? { kind: "own", account: editing.pay_to } : null);
        skipNextSeed.current = true;
        setAnswers(answersFromSourceData(editing.source_data));
        setFiles({});
    }, [editing?.name]);   // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = useCallback(async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            // Who gets paid, resolved FIRST: new payee details are added now (a duplicate stops
            // here, before any upload, with the Payee to pick shown in the section). With a vendor
            // nothing is sent: the server copies the vendor's Payee. An edit that leaves the
            // request's own account picked keeps it as it is.
            const payTo = asksPayee && !vendorChosen ? payToSave(await payeeChoice.resolve()) : {};

            // Upload now, so nothing is orphaned by a cancelled dialog. The file is stored as
            // a URL inside `source_data.attachments`, keyed by SLOT -- which is what lets the
            // backend find the slot declaring `maps_to: invoice_attachment` and carry that one
            // file onto the ledger row at approval.
            const attachments: Record<string, string[]> = {};
            for (const [slotKey, file] of Object.entries(files)) {
                if (!file) continue;
                const uploaded = await upload(file, {
                    doctype: "Expense Request", fieldname: "source_data", isPrivate: true,
                });
                attachments[slotKey] = [uploaded.file_url];
            }

            // The invoice, already uploaded when it was picked (so Gemini could read it), under
            // the same native keys for every type. It REPLACES any the edited request held: its
            // seeded answers carry the old one under the same section.
            const inv = invoiceSourceData(invoice);
            const { [NATIVE_INVOICE_SECTION]: _storedInvoice, ...formResponses } = toResponses(answers);
            const allAttachments = { ...attachments, ...inv.attachments };

            const submit = isEdit ? updateRequest : createRequest;
            const res = await submit({
                ...(isEdit ? { name: editing!.name } : {}),
                expense_type: form.expense_type,
                amount: amountValue,
                // ⚠️ NEVER send a hidden value. Someone can type a description and THEN pick
                // a type that has a format -- the field disappears but the text is still in
                // state, and submitting it would file an answer the requester can no longer
                // see. The state is kept (so switching back restores their typing); only the
                // PAYLOAD is gated.
                comment: form.comment || undefined,
                // Only ever send a project the type actually allows.
                projects: showProject && form.projects ? form.projects : undefined,
                // Same gate as the project, plus the sentinel: "Others (No Vendor)" is a
                // deliberate "no vendor on record", so it sends NOTHING rather than an
                // empty Link. The server refuses a vendor without a project, so the
                // `showVendor` half is what keeps a hidden value from ever reaching it.
                vendor:
                    showVendor && form.vendor && form.vendor !== OTHERS_VENDOR_VALUE
                        ? form.vendor
                        : undefined,
                // Never sent for a Not asked type or with a vendor: the request then has no
                // account of its own to pick (a vendor's is copied by the server).
                ...payTo,
                // Wrapped in the `responses` envelope the backend flattener reads. Omitted
                // entirely when the type has no format, so a format-less request stores NULL
                // and converts exactly as it would have before formats existed.
                // `source_data` is the ONLY home for the requester's detail. With a format
                // that is the answers; without one it is the typed description, under the
                // synthetic `detail.description` key. The doctype carries no `description`
                // field at all, so there is exactly one place every later reader looks and
                // nothing that can hold a second, disagreeing copy.
                source_data: parsedFormat
                    ? {
                        templateId: parsedFormat.templateId,
                        templateVersion: parsedFormat.templateVersion,
                        responses: { ...formResponses, ...inv.responses },
                        ...(Object.keys(allAttachments).length ? { attachments: allAttachments } : {}),
                    }
                    : isStandard
                        ? {
                            responses: {
                                detail: { description: form.description.trim() },
                                ...inv.responses,
                            },
                            ...(inv.attachments ? { attachments: inv.attachments } : {}),
                        }
                        : undefined,
            });
            const created = res?.message;
            // The server's own invoice warnings: a submit is never refused for them.
            const warnings = created?.warnings ?? [];
            if (isEdit) {
                toast({
                    title: "Changes saved",
                    description: [`${created?.name} is saved.`, ...warnings].join(" "),
                    variant: "success",
                });
            } else if (created) {
                // What happens next (`whatHappensNext`): the same message on every page that opens this
                // dialog. The Toaster sits outside the router, so the link navigates from here.
                const said = whatHappensNext(created, amountValue);
                const requestPath = said.requestPath;
                toast({
                    title: said.title,
                    description: [`${created.name}: ${said.next}`, ...warnings].join(" "),
                    variant: "success",
                    ...(requestPath ? {
                        action: (
                            <ToastAction altText="Open the request" onClick={() => navigate(requestPath)}>
                                Open request
                            </ToastAction>
                        ),
                    } : {}),
                });
            }
            close();
            onSuccess?.();
        } catch (e) {
            if (e instanceof DuplicatePayeeError) {
                toast({
                    title: e.message === OWN_ACCOUNT_REFUSAL ? "Can't use this account" : "This account is already a payee",
                    description: e.message,
                    variant: "destructive",
                });
                return;
            }
            // ⚠️ Frappe puts the useful text in `_server_messages` / `exception`, NEVER in
            // `message` -- so `e?.message` rendered the duplicate refusal as the entirely
            // uninformative "There was an error." `getFrappeError` is the shared reader.
            toast({
                title: isEdit ? "Could not save the changes" : "Could not raise the request",
                description: getFrappeError(e),
                variant: "destructive",
            });
        } finally {
            setSubmitting(false);
        }
    }, [canSubmit, createRequest, updateRequest, isEdit, editing, upload, files, form,
        amountValue, showProject, showVendor, isStandard, invoice,
        parsedFormat, answers, toast, navigate, close, onSuccess,
        asksPayee, vendorChosen, payeeChoice.resolve]);

    return (
        <AlertDialog
            open={newExpenseRequestDialog || isEdit}
            onOpenChange={(o) => { if (!o) close(); else setNewExpenseRequestDialog(true); }}
        >
            {/* Pinned to the top, not centred: picking a type adds the Project, Who gets paid, the
                form and the invoice, and a centred dialog then slid the Amount up from under the
                pointer (#1494 review S4; the focus half is on the type picker below). */}
            <AlertDialogContent className="top-[5vh] translate-y-0 max-w-2xl max-h-[90vh] overflow-y-auto">
                <AlertDialogHeader>
                    <AlertDialogTitle>{isEdit ? `Edit ${editing!.name}` : "New Expense"}</AlertDialogTitle>
                </AlertDialogHeader>
                <Separator />

                {/* The spec's order (#1501): Type, Amount, Project, Vendor, Who gets paid, then the
                    type's own questions or a Description, then the invoice and the Comment. */}
                <div className="space-y-4 py-2">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="new_expense_type">Expense Type <span className="text-destructive">*</span></Label>
                            <FuzzySearchSelect<ExpenseTypeOption, false>
                                inputId="new_expense_type"
                                allOptions={typeOptions}
                                tokenSearchConfig={EXPENSE_TYPE_SEARCH}
                                isLoading={catalogLoading}
                                value={selectedTypeOption}
                                onChange={(o) => {
                                    handleTypeChange(o?.value ?? "");
                                    // Hand focus to the Amount, the next field (#1494 review S4). Left in
                                    // the picker, the first click on the Amount was lost: the picker's
                                    // blur re-renders it, and while nothing holds focus the dialog's focus
                                    // trap takes it, so the Amount never got the click or the typing.
                                    // ⚠️ IN THIS EVENT, never from a timer: the pick re-renders
                                    // the whole form, and the browser dispatches keys typed meanwhile
                                    // before a timer runs, so they went to the picker and Amount stayed empty.
                                    amountRef.current?.focus();
                                }}
                                placeholder={catalogLoading ? "Loading…" : "Search or select a type…"}
                                // Scope rides the menu rows only; the chosen value stays a clean name
                                // -- the `VendorSelect` convention.
                                formatOptionLabel={(o, meta) => meta.context === "value" ? o.label : (
                                    <span className="flex items-center justify-between gap-2 w-full">
                                        <span className="truncate">{o.label}</span>
                                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                                            {o.scope}
                                        </span>
                                    </span>
                                )}
                                // The menu renders in the body -- REQUIRED inside a dialog or it
                                // clips at the dialog's edge, the same reason VendorSelect portals.
                                menuPortalTarget={document.body}
                                menuPosition="fixed"
                                // Clearing the type would leave the form with a format and no type
                                // to file it under; switching to another type is the way out.
                                isClearable={false}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="new_expense_amount">Amount <span className="text-destructive">*</span></Label>
                            <Input
                                id="new_expense_amount"
                                ref={amountRef}
                                type="number" placeholder="0" value={form.amount}
                                onChange={(e) => set("amount", e.target.value)}
                            />
                            {tdsLine ? (
                                <p className="text-xs text-muted-foreground">{tdsLine}</p>
                            ) : amountValue > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    {formatToRoundedIndianRupee(amountValue)}
                                </p>
                            )}
                        </div>
                    </div>

                    {showProject && (
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>
                                    Project {projectRequired && <span className="text-destructive">*</span>}
                                </Label>
                                {chosenProjectLabel ? (
                                    // ⚠️ `ProjectSelect` keeps its selection in INTERNAL state and
                                    // takes no `value`, so it CANNOT display a project the user did
                                    // not pick in this session -- on an edit it renders its
                                    // placeholder over a required field that IS set, which reads as
                                    // unset. It is shared across many screens, so the fix stays
                                    // HERE: show what the request already carries, and mount the
                                    // untouched picker only once the requester asks to change it.
                                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                                        <span className="truncate text-sm">{chosenProjectLabel}</span>
                                        <Button
                                            type="button" variant="ghost" size="sm"
                                            className="h-7 shrink-0 text-xs"
                                            onClick={() => setChangingProject(true)}
                                        >
                                            Change
                                        </Button>
                                    </div>
                                ) : (
                                    <ProjectSelect
                                        universal={false}
                                        usePortal
                                        onChange={(o) => handleProjectChange(o?.value ?? "")}
                                    />
                                )}
                                {!projectRequired && (
                                    <p className="text-xs text-muted-foreground">
                                        Optional. Pick a project to charge it there; leave blank for a
                                        company-wide expense.
                                    </p>
                                )}
                            </div>

                            {showVendor && (
                                <div className="space-y-1.5">
                                    <Label>
                                        Vendor <span className="text-xs font-normal text-muted-foreground">optional</span>
                                    </Label>
                                    <VendorSelect
                                        usePortal
                                        value={form.vendor}
                                        placeholder="Search vendors…"
                                        onChange={(o) => handleVendorChange(o?.value ?? "")}
                                    />
                                    {asksPayee && (
                                        <p className="text-xs text-muted-foreground">
                                            A vendor is paid into its own bank account.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {showsPayee && (
                        <WhoGetsPaidSection
                            rule={payeeRule}
                            expenseType={form.expense_type}
                            vendorChosen={vendorChosen}
                            vendorName={vendorName}
                            vendorPayTo={vendorPayTo}
                            vendorPayToLoading={vendorPayToLoading}
                            choice={payeeChoice}
                            problem={payeeProblem}
                            disabled={submitting}
                        />
                    )}

                    {parsedFormat && (
                        <FormatFieldsRenderer
                            format={parsedFormat}
                            answers={answers}
                            onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))}
                            files={files}
                            onFileChange={(slotKey, file) =>
                                setFiles((f) => {
                                    if (!file) { const { [slotKey]: _drop, ...rest } = f; return rest; }
                                    return { ...f, [slotKey]: file };
                                })
                            }
                            onFileError={(message) =>
                                toast({ title: "Attachment", description: message, variant: "destructive" })
                            }
                            disabled={submitting}
                        />
                    )}

                    {/* Bold with the matches for a raiser on Records without review, who acts as
                        their own reviewer; a quiet note for anyone else (#1504). Never blocks. */}
                    <DuplicateStayNote
                        matches={stayMatches}
                        variant={catalogRes?.message?.records_without_review ? "warning" : "note"}
                    />

                    {isStandard && (
                        <div className="space-y-1.5">
                            <Label>Description <span className="text-destructive">*</span></Label>
                            <Textarea
                                placeholder="What is this for?"
                                value={form.description}
                                onChange={(e) => set("description", e.target.value)}
                            />
                        </div>
                    )}

                    {selected && (
                        <InvoiceQuestion
                            value={invoice}
                            onChange={patchInvoice}
                            notes={notes}
                            docname={editing?.name}
                            onError={(title, description) =>
                                toast({ title, description, variant: "destructive" })
                            }
                            disabled={submitting}
                        />
                    )}

                    <div className="space-y-1.5">
                        <Label>
                            Comment <span className="text-xs font-normal text-muted-foreground">optional</span>
                        </Label>
                        <Textarea
                            rows={2}
                            placeholder="Anything the reviewer should know"
                            value={form.comment}
                            onChange={(e) => set("comment", e.target.value)}
                        />
                    </div>
                </div>

                <Separator />
                {!isEdit && submitWording.nextApprover && (
                    <p className="text-sm text-muted-foreground text-right">
                        {submitWording.nextApprover}
                    </p>
                )}
                <AlertDialogFooter className="flex-wrap items-center gap-2">
                    {notes.count > 0 && (
                        <span className="mr-auto text-sm text-muted-foreground">
                            {checksLine(notes.count)}
                        </span>
                    )}
                    <AlertDialogCancel onClick={close} disabled={submitting}>Cancel</AlertDialogCancel>
                    <Button onClick={handleSubmit} disabled={!canSubmit}>
                        {submitting
                            ? <TailSpin color="white" height={20} width={20} />
                            : isEdit ? "Save changes" : submitWording.label}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default NewExpenseRequestDialog;
