import { describe, expect, it } from "vitest";

import {
  type AuditQuestion,
  auditAnswersPayload,
  auditHistorySummary,
  auditMonthName,
  auditAnswersProblem,
  auditChecksLabel,
  countAuditIssues,
  parseAuditAnswers,
} from "./assetAudit";
import { AUDIT_QUESTIONS, auditQuestionsFor } from "./assetAuditQuestions";
import { describeHistory } from "./assetHistory";

// A cut-down IT set, in the shape of `assetAuditQuestions.ts`.
const IT: AuditQuestion[] = [
  { id: "who", question: "Who is using this device?", hint: null, text_prompt: "Where is it, and who has it?",
    choices: [{ id: "me", label: "Only me, for work", flag: false }, { id: "not_with_me", label: "I don't have it right now", flag: true }] },
  { id: "works", question: "Does it work properly?", hint: null, text_prompt: "What's the problem?",
    choices: [{ id: "fine", label: "Yes, it works fine", flag: false }, { id: "problem", label: "It works, but has a problem", flag: true }] },
  { id: "damage", question: "Is it damaged anywhere?", hint: null, text_prompt: "What's damaged?",
    choices: [{ id: "none", label: "No damage", flag: false }, { id: "small", label: "Small damage: scratches or dents", flag: true }] },
  { id: "charger", question: "Do you have its charger and cables?", hint: null, text_prompt: "Anything to add?",
    choices: [{ id: "have", label: "Yes, I have them", flag: false }, { id: "missing", label: "No, they're missing", flag: true }] },
];

const SAVED = {
  answers: [
    { id: "who", q: "Who is using this device?", a: "Only me, for work" },
    { id: "damage", q: "Is it damaged anywhere?", a: "Small damage: scratches or dents", flag: 1, text: "Dent on the lid" },
    { id: "charger", q: "Do you have its charger and cables?", a: "No, they're missing", flag: 1 },
  ],
};

describe("the questions block of the Submit audit dialog", () => {
  it("counts the questions left, in the server's words", () => {
    expect(auditAnswersProblem(IT, {})).toBe("Answer all 4 questions (4 left).");
    expect(auditAnswersProblem(IT, { who: { choice: "me" }, works: { choice: "" } })).toBe("Answer all 4 questions (3 left).");
    expect(auditAnswersProblem(IT, { who: { choice: "me" }, works: { choice: "fine" }, damage: { choice: "none" }, charger: { choice: "have" } })).toBeNull();
    expect(auditAnswersProblem([], {})).toBeNull(); // a category type with no questions
  });

  it("sends each answer with its question and choice text, red ones flagged, the note only under a red one", () => {
    const payload = auditAnswersPayload(IT, {
      who: { choice: "me", text: "typed before switching back" },
      works: { choice: "problem", text: "  Slow to start  " },
      damage: { choice: "small", text: "   " },
      charger: { choice: "have" },
    });
    expect(payload).toEqual([
      { id: "who", q: "Who is using this device?", a: "Only me, for work" },
      { id: "works", q: "Does it work properly?", a: "It works, but has a problem", flag: 1, text: "Slow to start" },
      { id: "damage", q: "Is it damaged anywhere?", a: "Small damage: scratches or dents", flag: 1 },
      { id: "charger", q: "Do you have its charger and cables?", a: "Yes, I have them" },
    ]);
    // what the server saves is read back the same way
    expect(parseAuditAnswers({ answers: payload })).toEqual(payload);
  });

  it("leaves out a question with no pick (Submit stays off until every one is answered)", () => {
    expect(auditAnswersPayload(IT, { who: { choice: "me" } }).map((a) => a.id)).toEqual(["who"]);
  });
});

describe("reading saved answers", () => {
  it("reads the server's {answers: [...]} as an object or as JSON text", () => {
    expect(parseAuditAnswers(SAVED)).toEqual(SAVED.answers);
    expect(parseAuditAnswers(JSON.stringify(SAVED))).toEqual(SAVED.answers);
  });

  it("reads anything else as no answers -- an audit sent before the questions", () => {
    for (const raw of [null, undefined, "", "not json", 7, [], {}, { answers: "x" }, SAVED.answers]) {
      expect(parseAuditAnswers(raw)).toEqual([]);
    }
  });

  it("drops a broken item and keeps the rest", () => {
    const answers = parseAuditAnswers({ answers: [null, { q: "Q?" }, { id: "x", q: "Q?", a: "A", flag: 0, text: " " }] });
    expect(answers).toEqual([{ id: "x", q: "Q?", a: "A" }]);
  });

  it("labels the checks for the Fulfilled list", () => {
    const answers = parseAuditAnswers(SAVED);
    expect(countAuditIssues(answers)).toBe(2);
    expect(auditChecksLabel(answers)).toBe("2 issues");
    expect(auditChecksLabel(answers.slice(0, 2))).toBe("1 issue");
    expect(auditChecksLabel(answers.slice(0, 1))).toBe("All OK");
    expect(auditChecksLabel([])).toBeNull();
  });
});

describe("the history card", () => {
  it("carries the answers on an Audit Fulfilled entry only", () => {
    const entries = describeHistory(
      [
        { name: "h1", idx: 1, event: "Audit Requested", reason: "10/2026", audit_answers: SAVED },
        { name: "h2", idx: 2, event: "Audit Fulfilled", reason: "Good · for 10/2026", audit_answers: JSON.stringify(SAVED) },
      ],
      (id) => id ?? ""
    );
    expect(entries.map((entry) => [entry.key, entry.answers.length])).toEqual([["h2", 3], ["h1", 0]]);
  });
});

describe("audit history rows in words", () => {
  it("names the month", () => {
    expect(auditMonthName("11/2026")).toBe("November 2026");
    expect(auditMonthName("01/2027")).toBe("January 2027");
    expect(auditMonthName("13/2026")).toBe("13/2026");
    expect(auditMonthName(null)).toBe("");
  });

  it("keeps a sent audit to its month, with the holder's remarks apart", () => {
    expect(auditHistorySummary("Audit Fulfilled", "for 11/2026")).toEqual({ line: "For November 2026", remarks: null });
    expect(auditHistorySummary("Audit Fulfilled", "for 10/2026 · Kept in the site store")).toEqual({
      line: "For October 2026",
      remarks: "Kept in the site store",
    });
    // a row sent before 2026-10-15: its condition is not shown
    expect(auditHistorySummary("Audit Fulfilled", "Poor · was Good · for 11/2026")).toEqual({ line: "For November 2026", remarks: null });
  });

  it("says why a requested audit opened, and which month was missed", () => {
    expect(auditHistorySummary("Audit Requested", "11/2026")?.line).toBe("For November 2026 · opened by the monthly run");
    expect(auditHistorySummary("Audit Requested", "11/2026 · handover")?.line).toBe("For November 2026 · opened when the declaration was signed");
    expect(auditHistorySummary("Audit Requested", "11/2026 · category audit switched on")?.line).toBe(
      "For November 2026 · opened when the category's audit was switched on"
    );
    expect(auditHistorySummary("Audit Requested", "11/2026 · return rejected")?.line).toBe("For November 2026 · opened when the return was rejected");
    expect(auditHistorySummary("Audit Missed", "10/2026")).toEqual({ line: "October 2026 was not sent", remarks: null });
  });

  it("leaves every other event, and an empty text, alone", () => {
    expect(auditHistorySummary("Assigned", "Moved to site")).toBeNull();
    expect(auditHistorySummary("Audit Fulfilled", null)).toBeNull();
  });
});

describe("the question sets", () => {
  it("asks four questions per type, in a fixed order", () => {
    expect(auditQuestionsFor("Project").map((q) => q.id)).toEqual(["where", "works", "damage", "parts"]);
    expect(auditQuestionsFor("IT").map((q) => q.id)).toEqual(["who", "works", "damage", "charger"]);
    for (const other of [null, undefined, "", "Furniture"]) expect(auditQuestionsFor(other)).toEqual([]);
  });

  it("gives every question a good answer, a red answer and a prompt, with no id twice", () => {
    for (const [type, questions] of Object.entries(AUDIT_QUESTIONS)) {
      expect(new Set(questions.map((q) => q.id)).size, type).toBe(questions.length);
      for (const q of questions) {
        expect(new Set(q.choices.map((c) => c.id)).size, q.id).toBe(q.choices.length);
        expect(q.choices.some((c) => !c.flag), q.id).toBe(true);
        expect(q.choices.some((c) => c.flag), q.id).toBe(true);
        expect(q.text_prompt, q.id).toBeTruthy();
      }
    }
  });

  it("fits what the server accepts: at most 10 answers, every text under 300 characters", () => {
    for (const questions of Object.values(AUDIT_QUESTIONS)) {
      expect(questions.length).toBeLessThanOrEqual(10);
      for (const q of questions) {
        expect(q.question.length).toBeLessThanOrEqual(300);
        for (const c of q.choices) expect(c.label.length).toBeLessThanOrEqual(300);
      }
    }
  });
});
