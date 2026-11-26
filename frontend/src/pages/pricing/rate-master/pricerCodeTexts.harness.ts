// VAV-2c1 (owner 2026-11-22 10:49 / 13:03 "a"; R3 / R9): every string of the screen code a pricer can read, listed by a program.
// Walks the TypeScript syntax tree of the rate-helper / rate-master / pricing files (no test, harness or fixture): string literals,
// template pieces and JSX text that hold words (at least one space or a sentence), each with its file and line. Never a comment.
// Used by the maker of VAV-2c1_Texts.tsv and by vav2c1CodeLabels.test.ts, so the list and the guard cannot disagree.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export interface CodeText { file: string; line: number; kind: "literal" | "template" | "jsx"; text: string }
export const CODE_DIRS = ["pages/boq-wizard/rate-helper", "pages/pricing"];
const SKIP = /(\.test\.|\.harness\.|__fixtures__|\.awaiting\.|electricalRuleCases)/;

export function codeFiles(src: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n)) out.push(p.split("\\").join("/")); } };
  for (const d of CODE_DIRS) walk(join(src, d));
  return out.filter((f) => !SKIP.test(f)).sort();
}

/** A string a person reads: it has a space between two words and is not a class list, a selector, a path or a regular expression. */
export const readable = (t: string): boolean => /[A-Za-z]{2,}[^A-Za-z]* [A-Za-z(]|\([A-Z]/.test(t) && !/^[\w\s:\-[\]./#%()&,>]*(?:\b(?:flex|rounded|border|text-|bg-|px-|py-|h-\d|w-\d|dark:)\b)/.test(t)
  && !/\[bswd]|\(\?[:!=<]/.test(t);

export function walkCode(src: string, files = codeFiles(src)): CodeText[] {
  const out: CodeText[] = [];
  for (const f of files) {
    const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const rel = f.slice(f.indexOf("/pages/") + 1);
    const add = (n: ts.Node, kind: CodeText["kind"], text: string) => {
      if (readable(text)) out.push({ file: rel, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, kind, text: text.replace(/\s+/g, " ").trim() });
    };
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n, "literal", n.text);
      else if (ts.isTemplateExpression(n)) { add(n, "template", n.head.text + n.templateSpans.map((s) => `{}${s.literal.text}`).join("")); n.templateSpans.forEach((s) => visit(s.expression)); return; }
      else if (ts.isJsxText(n)) add(n, "jsx", n.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}
