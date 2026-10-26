// Who may work the Credit Card sub-tab of Pending Invoices Upload (#1570, ADR-0039 ruling 8) -- spelled in two
// languages. `services/role_profiles.py` is the boundary (`api/expenses/card_invoices`); `roles.ts` only hides
// the tab and the No invoice button. Neither side can import the other, so this reads the Python file as text
// (the `outflowUndoAccessParity.test.ts` shape). A profile added on one side only would show a control the
// server refuses, or hide one a person is allowed to use -- and nothing else would fail.
//
// ⚠️ THE FIRST CASE GUARDS THE PATH. Everything below parses a file read from disk; a moved file would parse to
// an empty set, and an empty set on both sides "matches".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CARD_NO_INVOICE_PROFILES, PENDING_INVOICE_UPLOAD_PROFILES } from "./roles";

const roleProfilesSource = readFileSync(
  fileURLToPath(new URL("../../../nirmaan_stack/services/role_profiles.py", import.meta.url)),
  "utf8",
);

/** The right-hand side of every top-level `NAME = ...` assignment, a bracketed one read to its close. */
const assignments = (source: string): Map<string, string> => {
  const found = new Map<string, string>();
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Z][A-Z0-9_]*) = (.*)$/);
    if (!match) continue;
    let rhs = match[2];
    const depth = (text: string) => (text.match(/[([{]/g) ?? []).length - (text.match(/[)\]}]/g) ?? []).length;
    while (depth(rhs) > 0 && i + 1 < lines.length) rhs += "\n" + lines[++i].replace(/#.*$/, "");
    found.set(match[1], rhs);
  }
  return found;
};

/** The profiles a Python constant holds: its quoted strings and, in order, the constants it names, resolved. */
const pythonProfiles = (source: string, name: string): string[] => {
  const table = assignments(source);
  const resolve = (constant: string): string[] => {
    const rhs = table.get(constant);
    if (rhs === undefined) throw new Error(`role_profiles.py has no ${constant}`);
    return [...rhs.matchAll(/"([^"]+)"|\b([A-Z][A-Z0-9_]*)\b/g)].flatMap((m) => (m[1] ? [m[1]] : resolve(m[2])));
  };
  return resolve(name);
};

describe("card invoice access parity -- the screen shows exactly what the server allows", () => {
  it("★ reads the real role_profiles.py", () => {
    expect(roleProfilesSource).toContain("CARD_NO_INVOICE_PROFILES = ");
    expect(roleProfilesSource).toContain("PENDING_INVOICE_UPLOAD_PROFILES = ");
  });

  it("★ CARD_NO_INVOICE_PROFILES is the same set on both sides", () => {
    const python = new Set(pythonProfiles(roleProfilesSource, "CARD_NO_INVOICE_PROFILES"));
    expect(python).toEqual(new Set(["Nirmaan Admin Profile", "Nirmaan Accountant Lead Profile"]));
    expect(python).toEqual(new Set(CARD_NO_INVOICE_PROFILES));
  });

  it("★ PENDING_INVOICE_UPLOAD_PROFILES is the same set on both sides", () => {
    const python = new Set(pythonProfiles(roleProfilesSource, "PENDING_INVOICE_UPLOAD_PROFILES"));
    expect(python.has("Nirmaan PMO Executive Profile")).toBe(true);
    expect(python.has("Nirmaan Procurement Executive Profile")).toBe(true);
    expect(python).toEqual(new Set(PENDING_INVOICE_UPLOAD_PROFILES));
  });
});
