// src/utils/assetAuditQuestions.ts
//
// The question of the monthly asset audit (owner, 2026-10-21): ONE question for every asset, Project and IT alike --
// "Is it working?". It lives here only: the Submit audit dialog shows it at once, with no request. Each answer is
// sent with its question and choice text (`auditAnswersPayload`), the server checks its shape
// (`services/asset_audit.clean_answers`) and keeps it as sent, so rewording never changes an old audit (the 4-question
// audits sent before 2026-10-21 keep their answers).
// The `flag` choice is a red answer: it needs a description of the problem, and the dialog then offers one optional
// image of it instead of the remarks box.

import type { AuditQuestion } from "@/utils/assetAudit";

export const AUDIT_QUESTIONS: readonly AuditQuestion[] = [
  {
    id: "working",
    question: "Is it working?",
    hint: null,
    text_prompt: "Describe the problem",
    choices: [
      { id: "yes", label: "Yes, it is working", flag: false },
      { id: "no", label: "No, it is not working", flag: true },
    ],
  },
];
