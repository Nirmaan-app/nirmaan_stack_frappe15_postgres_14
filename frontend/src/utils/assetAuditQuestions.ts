// src/utils/assetAuditQuestions.ts
//
// The questions of the monthly asset audit (owner, 2026-10-15): one fixed set per category type, written the way
// you'd ask a person. They live here only -- the Submit audit dialog shows them at once, with no request. Each
// answer is sent with its question and choice text (`auditAnswersPayload`), the server checks its shape
// (`services/asset_audit.clean_answers`) and keeps it as sent, so rewording a question never changes an old audit.
// A `flag` choice is a red answer: it opens a text box the holder may fill in.

import type { AuditQuestion } from "@/utils/assetAudit";

export const AUDIT_QUESTIONS: Record<"Project" | "IT", AuditQuestion[]> = {
  Project: [
    {
      id: "where",
      question: "Where is this item right now?",
      hint: null,
      text_prompt: "Where is it, and who has it?",
      choices: [
        { id: "site", label: "With me, at the project site", flag: false },
        { id: "office", label: "With me, at the office / store", flag: false },
        { id: "not_with_me", label: "It's not with me", flag: true },
      ],
    },
    {
      id: "works",
      question: "Does it work properly when you use it?",
      hint: null,
      text_prompt: "What's the problem?",
      choices: [
        { id: "fine", label: "Yes, it works fine", flag: false },
        { id: "problem", label: "It works, but has a problem", flag: true },
        { id: "not_working", label: "It doesn't work at all", flag: true },
      ],
    },
    {
      id: "damage",
      question: "Is it damaged anywhere?",
      hint: null,
      text_prompt: "What's damaged?",
      choices: [
        { id: "none", label: "No damage", flag: false },
        { id: "small", label: "Small damage: scratches or dents", flag: true },
        { id: "bad", label: "Badly damaged: cracked or broken", flag: true },
      ],
    },
    {
      id: "parts",
      question: "Are all its parts and accessories with it?",
      hint: "For example: test leads, probes, drill bits, carry case, charger.",
      text_prompt: "What's missing?",
      choices: [
        { id: "all", label: "Yes, everything is there", flag: false },
        { id: "missing", label: "Something is missing", flag: true },
      ],
    },
  ],
  IT: [
    {
      id: "who",
      question: "Who is using this device?",
      hint: null,
      text_prompt: "Where is it, and who has it?",
      choices: [
        { id: "me", label: "Only me, for work", flag: false },
        { id: "not_with_me", label: "I don't have it right now", flag: true },
      ],
    },
    {
      id: "works",
      question: "Does it work properly?",
      hint: "A problem could be: slow, hangs, battery drains fast.",
      text_prompt: "What's the problem?",
      choices: [
        { id: "fine", label: "Yes, it works fine", flag: false },
        { id: "problem", label: "It works, but has a problem", flag: true },
        { id: "no_power", label: "It doesn't switch on", flag: true },
      ],
    },
    {
      id: "damage",
      question: "Is it damaged anywhere?",
      hint: "Screen, body, keys or ports.",
      text_prompt: "What's damaged?",
      choices: [
        { id: "none", label: "No damage", flag: false },
        { id: "small", label: "Small damage: scratches or dents", flag: true },
        { id: "bad", label: "Badly damaged: cracked or broken", flag: true },
      ],
    },
    {
      id: "charger",
      question: "Do you have its charger and cables?",
      hint: null,
      text_prompt: "Anything to add?",
      choices: [
        { id: "have", label: "Yes, I have them", flag: false },
        { id: "missing", label: "No, they're missing", flag: true },
        { id: "damaged", label: "Yes, but they're damaged", flag: true },
        { id: "none_needed", label: "It doesn't need any", flag: false },
      ],
    },
  ],
};

/** The questions for an asset of `categoryType` ("Project" / "IT"), in order; [] for any other type. */
export function auditQuestionsFor(categoryType: string | null | undefined): AuditQuestion[] {
  return categoryType === "Project" || categoryType === "IT" ? AUDIT_QUESTIONS[categoryType] : [];
}
